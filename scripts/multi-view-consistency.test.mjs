// 仅验证本地工程流程和出站约束，不消耗真实图片/检查额度。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fixture, input, facts, pixel, modelConfig, materialComparison } from './etsy-fixture.mjs'
import { composeFeltPrompt, makeFeltContext, defaultPhotography, normalizePhotography, createEtsyModels, normalizeViewChecks, exportProduct } from '../.etsy-test/host.js'
const checks = () => Object.fromEntries(['identity', 'composition', 'material', 'accessories', 'photography'].map(key => [key, { status: 'PASS', evidence: `模拟可见依据：${key}一致` }]))
const report = (overrides = {}) => ({ status: 'PASS', summary: '检查完成', issues: [], uncertainties: [], assessedAt: Date.now(), model: 'mock', advisory: true, viewChecks: checks(), materialComparison: materialComparison(), ...overrides })
async function setup(t, options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'turntable-')), f = fixture(root, options)
  await f.workflow.ready
  t.after(async () => { f.workflow.dispose(); await f.workflow.idle(); await rm(root, { recursive: true, force: true }) })
  return { ...f, root }
}
async function master(f, overrides = {}) {
  const p = await f.workflow.start(input({ count: 1, autoCheck: false, maxCalls: 100, copyTiming: 'selected', photography: { ...defaultPhotography(), photography_preset: 'custom', custom_background: '浅蓝墙和灰色台面，柔和左侧窗光', subject_height_ratio: 0.6 }, ...overrides }))
  await f.workflow.idle(); let product = await f.workflow.get(p.id)
  await f.workflow.confirmDesign(p.id, product.images[0].id, '领口是双层；左耳花朵3片花瓣；不可增加配件')
  await f.workflow.idle(); product = await f.workflow.get(p.id)
  return { product, design: product.finalDesigns[0] }
}
async function until(condition) { for (let n = 0; n < 200; n++) { if (await condition()) return; await new Promise(resolve => setTimeout(resolve, 10)) }; throw new Error('测试等待条件未满足') }

test('自定义背景只扩展场景，兼容旧勾选冲突，空描述在规划前拒绝', async t => {
  const legacy = { ...defaultPhotography(), preserve_background: true }
  assert.equal(normalizePhotography(legacy).photography_preset, 'preserve-original')
  assert.equal(legacy.photography_preset, 'natural-tabletop')
  const photo = { ...defaultPhotography(), photography_preset: 'custom', custom_background: '浅蓝墙、灰色石台，无木纹' }
  const prompt = composeFeltPrompt(makeFeltContext({ basePrompt: 'Keep the same boy', stage: 'generation', photography: photo }), 'gpt-image-2').prompt
  assert.match(prompt, /浅蓝墙、灰色石台，无木纹/); assert.doesNotMatch(prompt, /on a realistic light oak/)
  const edited = composeFeltPrompt(makeFeltContext({ basePrompt: 'Edit the source', stage: 'refinement', photography: photo, userRequirements: '仅修改材质，保留原背景', latestInstruction: '背景改为浅蓝墙和灰色石台' }), 'gpt-image-2')
  assert.equal(edited.photography.photography_preset, 'custom'); assert.equal(edited.photography.custom_background, photo.custom_background)
  assert.throws(() => normalizePhotography({ ...photo, custom_background: 'x'.repeat(1001) }), /1000/)
  const f = await setup(t)
  await assert.rejects(f.workflow.start(input({ photography: { ...photo, custom_background: '' } }), undefined, { creativity: 'balanced' }), /填写背景/)
  assert.equal(f.counts.generation, 0); assert.equal(f.counts.planning ?? 0, 0); assert.equal((await f.workflow.list()).length, 0)
})

test('独立规则在GPT/Gemini/Grok中均不包含改款/转换与通用材质重设，固定细节优先', async t => {
  const f = await setup(t), { product, design } = await master(f)
  await f.workflow.generateViews(product.id, design.id, ['left'], 'prompt-separation', product.request); await f.workflow.idle()
  const view = (await f.workflow.get(product.id)).images.find(image => image.kind === 'view')
  const context = f.queue.get(view.taskId).request.feltContext
  for (const model of ['gpt-image-2', 'gemini-image', 'grok-imagine-image']) {
    const result = composeFeltPrompt(context, model)
    assert.deepEqual(result.modules, { multi_view_consistency_v1_0: '1.0', hero_surface_continuity_v1_0: '1.0', product_view_direction_v1_0: '1.0', product_spatial_v1_0: '1.0' })
    assert.match(result.prompt, /Show this exact photographed product/)
    assert.match(result.prompt, /User fixed details, highest priority: 领口是双层/)
    assert.match(result.prompt, /same 1:1 frame/); assert.equal(result.photography.subject_height_ratio, 0.6)
    assert.doesNotMatch(result.prompt, /\[REFERENCE_DESIGN_V2|\[NEEDLE_FELT_RULES|\[felt_photography_v1_0\]|\[felt_composition_v1_0\]/)
    assert.match(result.prompt, /Do not reinterpret its material or increase detail/)
  }
})

test('左→右→背仍逐图等待检查，摄影跟随主图，分辨率采用本次明确选择', async t => {
  const calls = [], events = []; let releaseLeft, checkingLeft = false
  const gate = new Promise(resolve => { releaseLeft = resolve }); t.after(() => releaseLeft())
  const f = await setup(t, { generate: async request => {
    if (request.feltContext?.multiView) { const angle = request.feltContext.multiView.angle; calls.push(request); events.push(`generate-${angle}`) }
    return { images: [{ b64: pixel, mime: 'image/png' }] }
  }, vision: async (_, __, ___, refs, siblings, signal, context) => {
    assert.equal(context.creativity, undefined); assert.equal(context.plan, undefined)
    assert.equal(context.multiView.references[0].image, 2, '检查请求中待检图第一、身份主图第二，角色描述必须与实际顺序相符')
    assert.equal(context.multiView.references.length, refs.length)
    events.push(`review-${context.angle}`)
    if (context.angle === 'left') { checkingLeft = true; await gate }
    events.push(`reviewed-${context.angle}`); return report()
  } })
  const { product, design } = await master(f, { generation: { ...input().generation, quality: '4k', detail: 'high' } })
  const original = structuredClone(product.images[0])
  await f.workflow.generateViews(product.id, design.id, ['back', 'right', 'left'], 'serial-views-001', { ...product.request, photography: { ...defaultPhotography(), photography_preset: 'white-studio', subject_height_ratio: 0.85, aspect_ratio: '16:9' }, size: '16:9', quality: '1k' })
  await until(() => checkingLeft); assert.equal(calls.length, 1, '首角度检查完成前不能派发第二张')
  releaseLeft(); await f.workflow.idle()
  const done = await f.workflow.get(product.id), views = done.images.filter(image => image.kind === 'view')
  assert.deepEqual(views.map(image => image.angle), ['left', 'right', 'back'])
  assert.deepEqual(events, ['generate-left', 'review-left', 'reviewed-left', 'generate-right', 'review-right', 'reviewed-right', 'generate-back', 'review-back', 'reviewed-back'])
  assert.deepEqual(calls.map(request => request.images.length), [1, 1, 0])
  for (const request of calls) {
    assert.equal(request.feltContext.multiView.references[0].id, original.id)
    assert.equal(request.size, '1:1'); assert.equal(request.quality, '1k')
    assert.equal(request.feltContext.photography.subject_height_ratio, 0.6)
    assert.equal(request.feltContext.photography.photography_preset, 'custom')
  }
  assert.deepEqual(done.images[0], original); assert.equal(f.counts.generation, 4); assert.equal(f.counts.quality, 3)
  assert.equal(calls[2].feltContext.multiView.references.length, 1)
  assert.ok((await exportProduct(done, f.workflow.store)).includes(Buffer.from('multi_view_consistency_v1_0')))
})

test('检查不完整或有偏差的视角不传播，不自动返工，后续仍以主图完成', async t => {
  const requests = []
  const f = await setup(t, { generate: async request => { if (request.feltContext?.multiView) requests.push(request); return { images: [{ b64: pixel, mime: 'image/png' }] } }, vision: async (_, __, ___, ____, _____, ______, context) => context.angle === 'left' ? report({ viewChecks: undefined }) : report({ status: 'REVISE', viewChecks: { ...checks(), material: { status: 'REVISE', evidence: '比主图更粗糙' } } }) })
  const { product, design } = await master(f)
  await f.workflow.generateViews(product.id, design.id, ['left', 'right', 'back'], 'excluded-bad-views', product.request); await f.workflow.idle()
  assert.deepEqual(requests.map(request => request.images.length), [1, 1, 0]); assert.equal(f.counts.generation, 4)
  const done = await f.workflow.get(product.id), views = done.images.filter(image => image.kind === 'view')
  await f.workflow.approveView(product.id, views[0].id, true)
  await f.workflow.generateViews(product.id, design.id, ['front'], 'human-approved-reference', product.request); await f.workflow.idle()
  assert.equal(requests.at(-1).feltContext.multiView.references[1].role, 'human-confirmed')
})

test('单张修正锁定原主图与摄影快照，保留其他角度和父子版本', async t => {
  const f = await setup(t), { product, design } = await master(f)
  await f.workflow.generateViews(product.id, design.id, ['left', 'right'], 'correction-initial', product.request); await f.workflow.idle()
  let done = await f.workflow.get(product.id); const left = done.images.find(image => image.angle === 'left'), right = structuredClone(done.images.find(image => image.angle === 'right'))
  await f.workflow.revise(product.id, '恢复主图同样的花瓣数量和细纤维', { ...product.request, photography: { ...defaultPhotography(), subject_height_ratio: 0.85 } }, left.id); await f.workflow.idle()
  done = await f.workflow.get(product.id); const edited = done.images.at(-1), request = f.queue.get(edited.taskId).request
  assert.equal(edited.parentImageId, left.id); assert.equal(edited.angle, 'left'); assert.equal(edited.visualRules.photography.subject_height_ratio, 0.6)
  assert.equal(request.feltContext.multiView.references.find(r => r.role === 'angle-correction').id, left.id)
  assert.deepEqual(JSON.parse(JSON.stringify(done.images.find(image => image.id === right.id))), JSON.parse(JSON.stringify(right)))
  assert.match(request.prompt, /恢复主图同样的花瓣/)
})

test('实际复核模型要求五项证据；漏项返回UNKNOWN，商品事实未填不影响纯视觉检查', async () => {
  const calls = []; let valid = false
  const models = createEtsyModels(async (_, options) => { calls.push(options); return JSON.stringify(report(valid ? {} : { viewChecks: undefined })) })
  const multiView = { anchor: { version: '1.0', imageId: 'master', photography: defaultPhotography(), profile: { components: ['body'], mixedMaterials: [], tones: [], scene: 'minimal' }, inheritedModules: {} }, angle: 'back', fixedDetails: '保留条纹', identity: { summary: '同一件商品', locks: ['条纹'], unseen: ['背面未见'] }, references: [{ id: 'master', image: 1, role: 'identity-anchor' }] }
  const args = [modelConfig, { ...facts, confirmed: false }, `data:image/png;base64,${pixel}`, [`data:image/png;base64,${pixel}`], [], new AbortController().signal, { angle: 'back', identity: multiView.identity, multiView }]
  const missing = await models.vision(...args); assert.equal(missing.status, 'UNKNOWN'); assert.equal(Object.values(missing.viewChecks).every(check => check.status === 'UNKNOWN'), true)
  valid = true; const passed = await models.vision(...args); assert.equal(passed.status, 'PASS')
  assert.match(calls[0].system, /主体整体占比/); assert.match(calls[0].system, /精致度是否退化/)
  assert.doesNotMatch(calls[0].system, /NEEDLE_FELT_ANALYSIS/)
  assert.equal(Object.values(normalizeViewChecks({})).every(check => check.status === 'UNKNOWN'), true)
})

test('某角度生图或检查失败不会卡住后续角度，失败只在用户重试后重发', async t => {
  let failImage = true, failReview = true
  const f = await setup(t, { generate: async request => {
    if (request.feltContext?.multiView?.angle === 'left' && failImage) { failImage = false; throw new Error('模拟单图失败') }
    return { images: [{ b64: pixel, mime: 'image/png' }] }
  }, vision: async () => { if (failReview) { failReview = false; throw new Error('模拟检查失败') }; return report() } })
  const { product, design } = await master(f)
  await f.workflow.generateViews(product.id, design.id, ['left', 'right', 'back'], 'failure-series', product.request); await f.workflow.idle()
  const done = await f.workflow.get(product.id), views = done.images.filter(image => image.kind === 'view')
  assert.equal(views[0].generation.status, 'failed'); assert.equal(views[1].quality.status, 'failed'); assert.equal(views[2].quality.status, 'completed')
  assert.equal(f.counts.generation, 4)
  await f.workflow.retry(product.id, 'generation', views[0].id, false, product.request); await f.workflow.idle()
  assert.equal((await f.workflow.get(product.id)).images.find(image => image.id === views[0].id).generation.status, 'completed'); assert.equal(f.counts.generation, 5)
})

test('重开完成项目不改写旧档案，不重发视角，保留锚点和检查记录', async t => {
  const f = await setup(t), { product, design } = await master(f)
  await f.workflow.generateViews(product.id, design.id, ['left', 'back'], 'persist-turntable', product.request); await f.workflow.idle(); f.workflow.dispose()
  const file = path.join(f.root, product.id, 'product.json'), before = await readFile(file)
  const second = fixture(f.root); t.after(() => second.workflow.dispose()); await second.workflow.ready; await second.workflow.idle()
  assert.deepEqual(await readFile(file), before); assert.equal(second.counts.generation, 0)
  const restored = await second.workflow.get(product.id)
  assert.equal(restored.finalDesigns[0].multiViewAnchor.imageId, design.imageId)
  assert.equal(restored.images.at(-1).visualRules.modules.multi_view_consistency_v1_0, '1.0')
})

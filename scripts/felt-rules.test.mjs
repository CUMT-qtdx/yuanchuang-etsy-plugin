// 只验证已采用规则的工程接线和稳定性，不做材质效果A/B实验，不请求真实模型。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { composeFeltPrompt, makeFeltContext, normalizeFeltProfile, feltAdapter, defaultPhotography, normalizePhotography, effectivePhotography, createEtsyModels, validateReferencePlan, ImageGenerationRuntime, exportProduct, DEFAULT_MATERIAL } from '../.etsy-test/host.js'
import { fixture, input, facts, pixel, modelConfig } from './etsy-fixture.mjs'
const url = `data:image/png;base64,${pixel}`
const angelProfile = { components: ['body', 'face', 'hair', 'wings', 'clothing'], mixedMaterials: ['bead-eyes', 'wire-glasses', 'paper', 'woven-ribbon'], tones: ['light', 'dark'], scene: 'minimal' }
const blueBoy = 'Keep the blue hat, face, body proportions, pose and red scarf exactly. Do not add wings or change the head size.'
const context = (overrides = {}) => makeFeltContext({ basePrompt: blueBoy, stage: 'generation', task: 'flat-to-felt', profile: { components: ['body', 'face', 'clothing'], mixedMaterials: [], tones: ['light'], scene: 'minimal' }, photography: defaultPhotography(), materialPreset: DEFAULT_MATERIAL, ...overrides })
const planResult = count => ({ name: '蓝帽小男孩', summary: '蓝帽人物和有翅膀的天使分别设计', keep: ['人物五官', '蓝帽与配色'], feltProfile: angelProfile, plans: Array.from({ length: count }, (_, i) => ({ name: `设计${i + 1}`, direction: `方向${i + 1}`, changes: [`设计变化${i + 1}`], prompt: `Make the same blue-hat boy in design ${i + 1}, keeping his face and pose. Keep the framing and character scale consistent with the reference.`, feltProfile: i === 0 ? angelProfile : { components: ['body', 'face'], mixedMaterials: [], tones: [], scene: 'minimal' } })) })
async function setup(t, options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'felt-integration-')), f = fixture(root, options)
  await f.workflow.ready
  t.after(async () => { f.workflow.dispose(); await f.workflow.idle(); await rm(root, { recursive: true, force: true }) })
  return { ...f, root }
}
function unzip(buffer) {
  const files = new Map()
  for (let pos = 0; buffer.readUInt32LE(pos) === 0x04034b50;) {
    const size = buffer.readUInt32LE(pos + 18), length = buffer.readUInt16LE(pos + 26), extra = buffer.readUInt16LE(pos + 28), start = pos + 30 + length + extra
    files.set(buffer.subarray(pos + 30, pos + 30 + length).toString(), buffer.subarray(start, start + size).toString()); pos = start + size
  }
  return files
}

test('两份规则原文完整保留，正式版本来源可追溯', async () => {
  const material = await readFile(new URL('../docs/felt-rules/source-v1.0.txt', import.meta.url))
  const photo = await readFile(new URL('../docs/felt-rules/photography-composition-source-v1.0.md', import.meta.url))
  assert.equal(material.toString().split(/\r?\n/).filter((_, i, a) => i < a.length - 1 || a[i]).length, 990)
  assert.equal(createHash('sha256').update(material).digest('hex'), '7686aa43b0551388f1de351fe314bafde31010d09d87a38ee0f9ec7c95413868')
  assert.equal(createHash('sha256').update(photo).digest('hex'), '22451fa4818acdc43c5fef005cd18e5ff49ca367c500e0299eb5e35de27e5f0b')
})

test('动态部件不复制样例；头发、翅膀和混材各自采用不同规则', () => {
  const angel = composeFeltPrompt(context({ profile: angelProfile }), 'gpt-image-2.5-flare')
  assert.ok(angel.ruleIds.includes('PART-hair')); assert.ok(angel.ruleIds.includes('PART-wings'))
  assert.match(angel.prompt, /directional wool strands/); assert.match(angel.prompt, /layered felt components/i)
  assert.match(angel.prompt, /tiny bead highlights/); assert.match(angel.prompt, /thin metal wire/); assert.match(angel.prompt, /thin paper/)
  const boy = composeFeltPrompt(context(), 'gpt-image-2.5-flare')
  assert.ok(!boy.ruleIds.includes('PART-wings')); assert.ok(!boy.ruleIds.includes('PART-hair'))
  assert.ok(!boy.ruleIds.includes('PART-curly-overlay'))
  assert.match(boy.prompt, /never add a part/i)
  const normalized = normalizeFeltProfile({ components: ['body', 'wings', 'invented-part'], mixedMaterials: ['paper', 'invented-material'], scene: 'unknown' })
  assert.deepEqual(normalized.components, ['body', 'wings']); assert.deepEqual(normalized.mixedMaterials, ['paper'])
})

test('GPT、Gemini、Grok和未知模型适配可独立选择，规则不会重复叠加', () => {
  const c = context({ profile: angelProfile })
  const gpt = composeFeltPrompt(c, 'gpt-image-2'), gemini = composeFeltPrompt(c, 'google/gemini-3-pro-image'), generic = composeFeltPrompt(c, 'future-image-model')
  assert.equal(gpt.adapter, 'gpt-image'); assert.equal(gemini.adapter, 'gemini'); assert.equal(generic.adapter, 'generic')
  assert.equal(feltAdapter('custom-alias', 'google-sub'), 'gemini'); assert.equal(feltAdapter('grok-imagine-image-2.0'), 'grok')
  assert.ok(gemini.prompt.startsWith('[NEEDLE_FELT_RULES:')); assert.ok(gpt.prompt.includes(blueBoy))
  assert.ok(gemini.prompt.length < gpt.prompt.length)
  assert.deepEqual(composeFeltPrompt(c, 'gpt-image-2'), gpt)
  for (const result of [gpt, gemini, generic]) {
    assert.equal((result.prompt.match(/\[NEEDLE_FELT_RULES:/g) ?? []).length, 1)
    assert.equal((result.prompt.match(/\[felt_photography_v1_0\]/g) ?? []).length, 1)
    assert.equal((result.prompt.match(/\[felt_composition_v1_0\]/g) ?? []).length, 1)
    assert.match(result.prompt, /Explicit user instructions outrank/)
    assert.ok(result.prompt.length < 12000)
  }
  assert.throws(() => makeFeltContext({ basePrompt: '', stage: 'generation', version: '99.0' }), /不支持/)
})

test('蓝帽人物自然桌面60%：允许重新取景，保留人物自身比例', () => {
  const result = composeFeltPrompt(context({ basePrompt: blueBoy + ' Keep the framing and character scale consistent with the reference.' }), 'gpt-image-2')
  assert.match(result.prompt, /occupy approximately 60%/); assert.match(result.prompt, /natural wooden tabletop/)
  assert.match(result.prompt, /not anatomy or internal character proportions/)
  assert.doesNotMatch(result.prompt, /Keep the framing and character scale consistent with the reference/)
  assert.equal(result.photography.aspect_ratio, '1:1')
})

test('仅材质转换保留原背景构图，不强制木桌和60%占比', () => {
  const settings = defaultPhotography('felt-conversion')
  const result = composeFeltPrompt(context({ task: 'felt-conversion', photography: settings, userRequirements: '仅修改材质，保持蓝帽、五官和姿势' }), 'gemini-image')
  assert.equal(result.photography.preserve_background, true)
  assert.equal(result.photography.framing_policy, 'preserve_reference')
  assert.match(result.prompt, /Preserve the source background/)
  assert.doesNotMatch(result.prompt, /on a realistic light oak|approximately 60%/)
  const overridden = effectivePhotography(defaultPhotography(), 'only change the material')
  assert.equal(overridden.framing_policy, 'preserve_reference'); assert.equal(overridden.preserve_background, true)
})

test('宽主体/组合保全宽度，背景与构图互不更改部件纤维密度', () => {
  const wide = composeFeltPrompt(context({ description: 'whale', photography: { ...defaultPhotography(), aspect_ratio: '16:9' } }), 'generic')
  assert.match(wide.prompt, /fit the full width/); assert.match(wide.prompt, /whole group bounding extent/)
  const white = composeFeltPrompt(context({ photography: { ...defaultPhotography(), photography_preset: 'white-studio', subject_height_ratio: 0.75 } }), 'gpt-image-2')
  assert.match(white.prompt, /pure white studio/); assert.match(white.prompt, /occupy approximately 75%/)
  assert.doesNotMatch(white.prompt, /on a realistic light oak/)
  assert.deepEqual(white.profile, wide.profile)
})

test('季节布景按主题生效，用户背景和占比文字优先，非法设置被拒绝', () => {
  const photo = { ...defaultPhotography(), photography_preset: 'seasonal-lifestyle' }
  const christmas = composeFeltPrompt(context({ photography: photo, profile: { components: ['body'], scene: 'christmas' } }), 'gpt-image-2')
  assert.match(christmas.prompt, /restrained Christmas home context/)
  const neutral = composeFeltPrompt(context({ photography: photo, profile: { components: ['body'], scene: 'minimal' } }), 'gpt-image-2')
  assert.match(neutral.prompt, /no holiday decorations/)
  const custom = composeFeltPrompt(context({ userRequirements: '背景改为蓝色背景，主体高度占75%' }), 'gpt-image-2')
  assert.match(custom.prompt, /background explicitly described by the user/)
  assert.equal(custom.photography.subject_height_ratio, 0.75)
  assert.doesNotMatch(custom.prompt, /on a realistic light oak/)
  assert.throws(() => normalizePhotography({ ...photo, subject_height_ratio: 1.1 }), /35%到90%/)
  const latest = composeFeltPrompt(context({ userRequirements: '保留原背景', latestInstruction: '背景改为纯蓝色背景，主体占45%' }), 'gpt-image-2')
  assert.equal(latest.photography.preserve_background, false); assert.equal(latest.photography.subject_height_ratio, 0.45)
  assert.match(latest.prompt, /背景改为纯蓝色/)
  assert.equal(effectivePhotography(defaultPhotography(), '画幅改成16:9，主体占45%').aspect_ratio, '16:9')
  assert.equal(effectivePhotography(defaultPhotography(), 'aspect ratio: 3:4').aspect_ratio, '3:4')
})

test('实际图片分析规划和设定卡加入规则，四/八方案不增加分析调用', async () => {
  const calls = []
  const models = createEtsyModels(async (_, options) => { calls.push(options); return JSON.stringify(options.system.includes('[ETSY_REFERENCE_PLAN]') ? planResult(8) : { summary: '白发天使', locks: ['头发方向', '翅膀三条线'], unseen: ['背面未知'], feltProfile: angelProfile }) })
  const plan = await models.plan(modelConfig, facts, url, 'gentle', new AbortController().signal, { count: 8, task: 'flat-to-felt', references: [{ dataUrl: url, role: 'subject', note: '保持五官' }, { dataUrl: url, role: 'material', note: '只取纤维质感' }], photography: defaultPhotography() })
  assert.equal(calls.length, 1); assert.equal(calls[0].content.length, 3)
  assert.match(calls[0].system, /NEEDLE_FELT_ANALYSIS:v1.0/); assert.match(calls[0].system, /occupy approximately 60%/)
  assert.equal(plan.visualRuleVersion, '1.0'); assert.equal(plan.plans.length, 8)
  assert.ok(plan.plans[0].feltProfile.components.includes('wings')); assert.ok(!plan.plans[1].feltProfile.components.includes('wings'))
  const identity = await models.identity(modelConfig, url, '保持姿势与配色', new AbortController().signal)
  assert.equal(identity.visualRuleVersion, '1.0'); assert.match(calls[1].system, /NEEDLE_FELT_ANALYSIS/)
  assert.ok(identity.feltProfile.components.includes('hair'))
})

test('已改背景的图片继续精修及多角度默认继承当前版本，原项目设置不覆盖它', async t => {
  const { workflow } = await setup(t)
  const p = await workflow.start(input({ count: 1, maxCalls: 50, photography: defaultPhotography() })); await workflow.idle()
  let product = await workflow.get(p.id)
  const photo = { ...defaultPhotography(), photography_preset: 'white-studio', subject_height_ratio: 0.75, aspect_ratio: '3:4' }
  await workflow.revise(p.id, '改成白底摄影展示', { ...product.request, photography: photo }, product.images[0].id); await workflow.idle()
  product = await workflow.get(p.id)
  await workflow.revise(p.id, '只改围巾颜色', product.request, product.images.at(-1).id); await workflow.idle()
  product = await workflow.get(p.id)
  const edited = product.images.at(-1)
  assert.deepEqual(edited.visualRules.photography, photo)
  await workflow.confirmDesign(p.id, edited.id, '保留全部细节'); await workflow.idle()
  product = await workflow.get(p.id)
  await workflow.generateViews(p.id, product.finalDesigns[0].id, ['back'], 'inherit-photo-view', product.request); await workflow.idle()
  product = await workflow.get(p.id)
  assert.deepEqual(product.images.at(-1).visualRules.photography, photo)
  assert.equal(product.photography.photography_preset, 'natural-tabletop')
})

test('API渠道实际HTTP图生图请求包含规则和全部参考图，快照与出站Prompt一致', async t => {
  const received = [], history = []
  const server = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk)
      const form = await new Request('http://localhost', { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body: Buffer.concat(chunks) }).formData()
      received.push({ url: req.url, prompt: form.get('prompt'), model: form.get('model'), size: form.get('size'), references: form.getAll('image[]').length })
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ b64_json: pixel }] }))
    } catch (error) { res.statusCode = 500; res.end(JSON.stringify({ error: String(error) })) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const runtime = new ImageGenerationRuntime(() => ({ defaultChannelId: 'api', channels: [{ id: 'api', name: '隔离测试', apiKey: 'test-only', apiUrl: `http://127.0.0.1:${server.address().port}/v1`, apiUrlFull: false, preset: '', auth: 'api-key', models: [{ alias: '员工模型', id: 'gpt-image-2' }] }] }), { append: async value => { history.push(value); return [] } })
  const result = await runtime.run({ ...input().generation, mode: 'edit', channelId: 'api', model: '员工模型', upstream: 'gpt-image-2', image: url, images: [url], feltContext: context({ multiReference: true, photography: { ...defaultPhotography(), aspect_ratio: '3:4' } }) })
  assert.equal(received.length, 1); assert.equal(received[0].url, '/v1/images/edits'); assert.equal(received[0].references, 2)
  assert.equal(received[0].model, 'gpt-image-2'); assert.equal(result.visualRules.adapter, 'gpt-image')
  // multipart表单按协议把换行规范为CRLF；只归一化换行，逐字核对提示词内容。
  assert.equal(received[0].prompt.replace(/\r\n/g, '\n'), result.visualRules.prompt)
  assert.equal(history[0].prompt, result.visualRules.prompt)
  assert.equal(result.visualRules.photography.aspect_ratio, '3:4'); assert.equal(received[0].size, '1024x1536')
  assert.match(received[0].prompt, /assigned role of each image/)
})

test('新项目的初图、精修、同图不同模型和多角度都带规则，原图与文案不覆盖', async t => {
  const planner = createEtsyModels(async () => JSON.stringify(planResult(3)))
  const { workflow, queue, counts, root } = await setup(t, { plan: (...args) => planner.plan(...args), identity: async () => ({ summary: '天使', locks: ['白色头发', '翅膀三条线'], unseen: [], feltProfile: angelProfile, visualRuleVersion: '1.0' }) })
  const p = await workflow.start(input({ count: 3, copyTiming: 'selected', maxCalls: 50, generation: { ...input().generation, model: 'gpt-image-2' }, photography: defaultPhotography() }), undefined, { creativity: 'gentle' }); await workflow.idle()
  let product = await workflow.get(p.id), original = structuredClone(product.images[0]), calls = product.calls.length
  assert.ok(product.images.every(image => image.visualRules.version === '2.0'))
  assert.equal(counts.planning, 1); assert.equal(counts.generation, 3)
  for (const image of product.images) assert.equal(queue.get(image.taskId).request.prompt, image.visualRules.prompt)
  const photo = { ...defaultPhotography(), photography_preset: 'white-studio', subject_height_ratio: 0.75 }
  await workflow.revise(p.id, '只将围巾改成蓝色', { ...product.request, model: 'gemini-3-pro-image', photography: photo }, original.id); await workflow.idle()
  product = await workflow.get(p.id); const edited = product.images.at(-1)
  assert.equal(edited.parentImageId, original.id); assert.equal(edited.visualRules.stage, 'refinement'); assert.equal(edited.visualRules.adapter, 'gemini')
  assert.equal(edited.visualRules.photography.subject_height_ratio, 0.75)
  assert.match(edited.visualRules.prompt, /只将围巾改成蓝色/)
  assert.deepEqual(product.images[0], original)
  await workflow.confirmDesign(p.id, edited.id, '翅膀保持条纹'); await workflow.idle()
  product = await workflow.get(p.id); const design = product.finalDesigns[0]
  await workflow.generateViews(p.id, design.id, ['back'], 'felt-back-view', { ...product.request, model: 'grok-imagine-image', photography: photo }); await workflow.idle()
  product = await workflow.get(p.id); const view = product.images.find(image => image.kind === 'view')
  assert.equal(view.visualRules.stage, 'multi-view'); assert.equal(view.visualRules.adapter, 'grok')
  assert.match(view.visualRules.prompt, /Stripes must remain stripes/)
  assert.ok(view.visualRules.profile.components.includes('wings'))
  assert.deepEqual(view.visualRules.ruleIds, ['multi_view_consistency_v1_0', 'hero_surface_continuity_v1_0'])
  assert.equal(counts.identity, 1); assert.equal(counts.copy, 1)
  const zip = unzip(await exportProduct(product, workflow.store)), trace = JSON.parse(zip.get('visual-rules.json'))
  assert.equal(trace.images.length, product.images.length)
  assert.equal(trace.images.at(-1).visualRules.modules.multi_view_consistency_v1_0, '1.0')
  assert.equal(trace.images.at(-1).visualRules.multiView.anchor.inheritedModules.felt_composition_v1_0, '1.0')
  const rawSaved = JSON.parse(await readFile(path.join(root, p.id, 'product.json'), 'utf8'))
  assert.equal(rawSaved.images.at(-1).visualRules.prompt, view.visualRules.prompt)
})

test('旧项目不被启动迁移重写，后续新精修启用规则并沿用旧图', async t => {
  const { workflow, root } = await setup(t)
  const p = await workflow.start(input({ count: 1 })); await workflow.idle(); workflow.dispose()
  const file = path.join(root, p.id, 'product.json'), old = JSON.parse(await readFile(file, 'utf8'))
  delete old.visualRuleVersion; delete old.photography; old.images.forEach(image => delete image.visualRules)
  await writeFile(file, JSON.stringify(old)); const bytes = await readFile(file)
  const restored = fixture(root); t.after(() => restored.workflow.dispose())
  await restored.workflow.ready; await restored.workflow.idle()
  assert.deepEqual(await readFile(file), bytes)
  const before = await restored.workflow.get(p.id), copy = structuredClone(before.copy)
  await restored.workflow.revise(p.id, 'only change the scarf colour', { ...before.request, model: 'gpt-image-2' }, before.images[0].id); await restored.workflow.idle()
  const done = await restored.workflow.get(p.id)
  assert.equal(done.images[0].visualRules, undefined)
  assert.equal(done.images.at(-1).visualRules.version, '2.0')
  assert.equal(done.images.at(-1).visualRules.photography.framing_policy, 'preserve_reference')
  assert.ok(done.copyVersions.length || done.imageCopies[before.images[0].id])
})

test('订阅运行时按实际渠道适配，真实下发与存档一致，普通高级工具不受影响', async () => {
  const wire = [], history = []
  let vendor = 'google-sub'
  const runtime = new ImageGenerationRuntime(() => ({ defaultChannelId: 'chosen', channels: [{ id: 'chosen', name: '模型渠道', apiKey: '', apiUrl: '', apiUrlFull: false, preset: '', auth: 'subscription', subscription: vendor, models: [{ alias: '员工模型', id: 'custom-name' }] }] }), { append: async value => { history.push(value); return [] } }, { generate: async value => { wire.push(value); return [{ b64_json: pixel }] } })
  const request = { ...input().generation, channelId: 'chosen', model: '员工模型', feltContext: context({ profile: angelProfile }) }
  const google = await runtime.run(request)
  assert.equal(google.visualRules.adapter, 'gemini')
  assert.equal(wire.at(-1).prompt, google.visualRules.prompt); assert.equal(history.at(-1).prompt, wire.at(-1).prompt)
  vendor = 'chatgpt-sub'; const gpt = await runtime.run(request)
  assert.equal(gpt.visualRules.adapter, 'gpt-image'); assert.equal((gpt.visualRules.prompt.match(/\[NEEDLE_FELT_RULES:/g) ?? []).length, 1)
  await runtime.run({ ...input().generation, prompt: 'advanced canvas: retain this exact prompt', model: '员工模型' })
  assert.equal(wire.at(-1).prompt, 'advanced canvas: retain this exact prompt')
})

test('重试与模型适配只添加一份规则，新增和移除部件影响对应局部规则', async t => {
  const { workflow, queue } = await setup(t, { failGeneration: index => index === 1 })
  const p = await workflow.start(input({ count: 1, maxCalls: 30, generation: { ...input().generation, model: 'gpt-image-2', materialPreset: DEFAULT_MATERIAL } })); await workflow.idle()
  let product = await workflow.get(p.id)
  await workflow.retry(p.id, 'generation', product.images[0].id, false, { ...product.request, model: 'gemini-3-pro-image' }); await workflow.idle()
  product = await workflow.get(p.id)
  const retried = queue.get(product.images[0].taskId).request
  assert.equal((retried.prompt.match(/\[NEEDLE_FELT_RULES:/g) ?? []).length, 1)
  assert.equal(product.images[0].visualRules.adapter, 'gemini')
  await workflow.revise(p.id, '添加分层翅膀，其他不变', product.request, product.images[0].id); await workflow.idle()
  product = await workflow.get(p.id); const winged = product.images.at(-1)
  assert.ok(winged.visualRules.ruleIds.includes('PART-wings'))
  await workflow.revise(p.id, '移除翅膀，其他不变', product.request, winged.id); await workflow.idle()
  assert.ok(!(await workflow.get(p.id)).images.at(-1).visualRules.ruleIds.includes('PART-wings'))
})

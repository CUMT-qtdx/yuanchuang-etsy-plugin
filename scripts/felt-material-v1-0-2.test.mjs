import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { composeFeltPrompt, makeFeltContext, defaultPhotography, CURRENT_MATERIAL, EXPERIMENTAL_MATERIAL, DEFAULT_MATERIAL, normalizeMaterialComponents, normalizeMaterialPreset, createEtsyModels, makeEtsyRoutes, ImageGenerationRuntime, stripMaterialRuleBlocks, resolveMaterialText, referenceGenerationPrompt, REALISTIC_NEEDLE_FELT_TEMPLATE_ID } from '../.etsy-test/host.js'
import { materialCases } from './felt-material-cases.mjs'
import { fixture, input, facts, pixel, modelConfig } from './etsy-fixture.mjs'

const hash = value => createHash('sha256').update(value).digest('hex')
const context = (sample, materialPreset, extra = {}) => makeFeltContext({ ...sample, materialPreset, stage: 'generation', task: 'felt-conversion', photography: defaultPhotography(), ...extra })
async function setup(t, options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'felt-material-')), f = fixture(root, options)
  await f.workflow.ready
  t.after(async () => { f.workflow.dispose(); await f.workflow.idle(); await rm(root, { recursive: true, force: true }) })
  return { ...f, root }
}

test('已发布 v1.0 文件与四组实际提示词保持逐字兼容', async () => {
  const baseline = JSON.parse(await readFile(new URL('./fixtures/felt-v1-baseline.json', import.meta.url), 'utf8'))
  assert.equal(hash(await readFile(new URL('../src/etsy/felt/library-v1.ts', import.meta.url))), baseline.librarySha256)
  for (const sample of materialCases) {
    const actual = composeFeltPrompt(context(sample, DEFAULT_MATERIAL), 'gpt-image-2.6-flare')
    assert.equal(hash(actual.prompt), baseline.prompts[sample.id])
    assert.equal(actual.modules.needle_felt_v1_0, '1.0')
    assert.equal(actual.modules.needle_felt_v1_0_2, undefined)
  }
})

for (const sample of materialCases) test(`${sample.id}：仅替换材质模块，摄影、构图和设计保持一致`, () => {
  const a = composeFeltPrompt(context(sample, DEFAULT_MATERIAL), 'gpt-image-2.6-flare')
  const b = composeFeltPrompt(context(sample, EXPERIMENTAL_MATERIAL), 'gpt-image-2.6-flare')
  assert.deepEqual(a.photography, b.photography)
  for (const tag of ['felt_photography_v1_0', 'felt_composition_v1_0']) {
    const line = prompt => prompt.split('\n').find(value => value.startsWith(`[${tag}]`))
    assert.equal(line(a.prompt), line(b.prompt))
  }
  assert.ok(b.prompt.includes(sample.basePrompt))
  assert.equal(b.modules.needle_felt_v1_0_2, '1.0.2')
  assert.equal(b.modules.needle_felt_v1_0, undefined)
  assert.match(b.prompt, /dense non-woven fiber structure/)
  assert.match(b.prompt, /no knitted rows/)
  assert.doesNotMatch(b.prompt, /Existing felt clothing:/)
  const categories = b.profile.materialComponents.map(row => row.category)
  assert.equal(categories.includes('woven_or_knitted_clothing'), sample.id === 'rabbit-blue-dress')
  assert.equal(b.profile.materialComponents.some(row => /装饰针脚|decorative stitches/.test(row.part)), sample.id === 'rabbit-blue-dress')
})

test('通用模板进入最终提示词且蓝棉布裙不再收到旧毛毡衣服规则', () => {
  const sample = materialCases[0]
  const plan = { id: 'plan-1', name: '蓝裙兔子', direction: '主体针毡、裙子保持真实布料', changes: ['只改主体材质'], prompt: sample.basePrompt }
  const reference = { name: '白兔系列', summary: '蓝裙白兔', keep: ['白兔大耳'], uncertainties: [], plans: [plan], strategyVersion: 2, materialPreset: EXPERIMENTAL_MATERIAL }
  const basePrompt = referenceGenerationPrompt(reference, plan, 'gentle', '')
  const final = composeFeltPrompt(context({ ...sample, basePrompt }, EXPERIMENTAL_MATERIAL), 'gpt-image-2.6-flare')
  assert.equal((final.prompt.match(new RegExp(`\\[${REALISTIC_NEEDLE_FELT_TEMPLATE_ID}\\]`, 'g')) ?? []).length, 1)
  assert.equal((final.prompt.match(/\[NEEDLE_FELT_RULES:/g) ?? []).length, 1)
  assert.match(final.prompt, /dense non-woven fiber structure/)
  assert.match(final.prompt, /real textile garments retain/)
  assert.doesNotMatch(final.prompt, /Existing felt clothing:|\{[A-Z][A-Z0-9_]*\}/)
  assert.doesNotMatch(final.prompt, /\[realistic-needle-felt-product-v1\][\s\S]*\[realistic-needle-felt-product-v1\]/)
})

test('未知衣服不猜成棉布，分类只保留实际部件且过滤未知类别', () => {
  const b = composeFeltPrompt(context({ basePrompt: 'A rabbit wearing a blue dress.', description: '蓝裙兔子', profile: { components: ['body', 'face', 'clothing'], mixedMaterials: [], tones: [], scene: 'minimal' } }, EXPERIMENTAL_MATERIAL), 'gpt-image-2')
  assert.ok(!b.profile.materialComponents.some(row => row.category === 'woven_or_knitted_clothing'))
  assert.match(b.prompt, /clothing material is unspecified/)
  const data = normalizeMaterialComponents([{ part: '蓝裙', category: 'woven_fabric_clothing', evidence: '参考图布裙' }, { part: '翅膀', category: 'invented' }, { category: 'felt_accessories' }])
  assert.deepEqual(data, [{ part: '蓝裙', region: 'clothing', category: 'woven_or_knitted_clothing', evidence: '参考图布裙' }])
  assert.throws(() => normalizeMaterialPreset('unknown'), /有效/)
})

test('所有模型适配保留防织纹和混材边界，重复组装不叠加规则', () => {
  for (const model of ['gpt-image-2.6-flare', 'gemini-3-pro-image', 'grok-imagine-image', 'custom-model']) {
    const c = context(materialCases[0], EXPERIMENTAL_MATERIAL), a = composeFeltPrompt(c, model)
    const again = composeFeltPrompt(makeFeltContext({ ...c, basePrompt: a.prompt }), model)
    assert.match(a.prompt, /no knitted rows/)
    assert.match(a.prompt, /real textile garments retain/)
    assert.equal((again.prompt.match(/\[needle_felt_v1_0_2\]/g) ?? []).length, 1)
  }
})

test('规划使用同一次分析返回分区分类，不改变四方向和调用次数', async () => {
  const calls = [], components = [{ part: '蓝色布裙', region: 'clothing', category: 'woven_or_knitted_clothing', evidence: '已明确为棉布裙' }]
  const model = createEtsyModels(async (_, request) => { calls.push(request); return JSON.stringify({ name: '兔子', summary: '白兔蓝裙', keep: ['兔子造型'], plans: Array.from({ length: 4 }, (_, i) => ({ name: `方向${i}`, direction: `独立方向${i}`, changes: ['保留蓝裙'], prompt: `Keep the white rabbit and blue cotton dress for design ${i}, with visible short wool fibers.`, feltProfile: { ...materialCases[0].profile, materialComponents: components } })) }) })
  const result = await model.plan(modelConfig, facts, `data:image/png;base64,${pixel}`, 'balanced', new AbortController().signal, { count: 4, task: 'felt-conversion', materialPreset: EXPERIMENTAL_MATERIAL, references: [] })
  assert.equal(calls.length, 1); assert.equal(result.plans.length, 4)
  assert.match(calls[0].system, /needle_felt_v1_0_2:analysis/)
  assert.match(calls[0].system, /woven_or_knitted_clothing/)
  assert.deepEqual(result.plans[0].feltProfile.materialComponents, components)
})

test('三个创作入口显式选择候选材质，精修、重试仍带材质规则，旧图不覆盖', async t => {
  const f = await setup(t, { failGeneration: index => index === 1 })
  for (const task of ['redesign', 'felt-conversion', 'flat-to-felt']) {
    const p = await f.workflow.start(input({ count: 1, creationTask: task, maxCalls: 30, generation: { ...input().generation, materialPreset: EXPERIMENTAL_MATERIAL } })); await f.workflow.idle()
    let product = await f.workflow.get(p.id)
    assert.equal(product.request.materialPreset, EXPERIMENTAL_MATERIAL)
    if (product.images[0].generation.status === 'failed') { await f.workflow.retry(p.id, 'generation', product.images[0].id); await f.workflow.idle(); product = await f.workflow.get(p.id) }
    const original = structuredClone(product.images[0])
    assert.equal(original.visualRules.materialPreset, EXPERIMENTAL_MATERIAL)
    assert.match(f.queue.get(original.taskId).request.prompt, /needle_felt_v1_0_2/)
    await f.workflow.revise(p.id, '只将主体改为压实羊毛毡，其他不变', product.request, original.id); await f.workflow.idle()
    product = await f.workflow.get(p.id)
    for (const key of ['files', 'visualRules', 'renderSettings', 'generation']) assert.deepEqual(product.images[0][key], original[key])
    assert.equal(product.images.at(-1).visualRules.materialPreset, EXPERIMENTAL_MATERIAL)
  }
})

test('新版主图的侧背面继续锁定主图，角度提示词没有混入重新转换或摄影重设', async t => {
  const f = await setup(t)
  const p = await f.workflow.start(input({ count: 1, maxCalls: 30, generation: { ...input().generation, materialPreset: EXPERIMENTAL_MATERIAL } })); await f.workflow.idle()
  let product = await f.workflow.get(p.id)
  await f.workflow.confirmDesign(p.id, product.images[0].id, '保留面部和装饰'); await f.workflow.idle()
  product = await f.workflow.get(p.id)
  await f.workflow.generateViews(p.id, product.finalDesigns[0].id, ['back'], 'felt-material-back', product.request); await f.workflow.idle()
  product = await f.workflow.get(p.id)
  const view = product.images.at(-1).visualRules
  assert.equal(view.multiView.anchor.inheritedModules.needle_felt_v1_0_2, '1.0.2')
  assert.doesNotMatch(view.prompt, /MATERIAL REFERENCE PRIORITY|subject_height_layout_v1_0/)
  assert.match(view.prompt, /Only turn the product/)
})

test('真实 HTTP 图生图传输使用新提示词，快照一致且只请求一张', async t => {
  const received = []
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const form = await new Request('http://127.0.0.1', { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body: Buffer.concat(chunks) }).formData()
    received.push({ prompt: String(form.get('prompt')).replace(/\r\n/g, '\n'), model: form.get('model'), n: form.get('n') })
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ b64_json: pixel }] }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)))
  const runtime = new ImageGenerationRuntime(() => ({ defaultChannelId: 'local', channels: [{ id: 'local', name: '离线模拟企业渠道', apiUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'mock-only', apiUrlFull: false, preset: '', auth: 'api-key', models: [{ alias: 'gpt-image-2.6-flare', id: 'gpt-image-2.6-flare' }] }] }), { append: async () => [] })
  const result = await runtime.run({ ...input().generation, model: 'gpt-image-2.6-flare', n: 1, feltContext: context(materialCases[0], EXPERIMENTAL_MATERIAL) })
  assert.equal(received.length, 1); assert.ok(received[0].n === null || received[0].n === '1'); assert.equal(result.images.length, 1)
  assert.equal(received[0].prompt, result.visualRules.prompt)
  assert.equal(result.visualRules.materialPreset, EXPERIMENTAL_MATERIAL)
})

test('商品路由保留材质选项并拒绝无效值，即使宿主通用解析器会丢弃自定义字段', async t => {
  const f = await setup(t)
  const routes = makeEtsyRoutes({ workflow: f.workflow, guard: () => true, parse: value => { const { materialPreset, ...rest } = value; return rest }, normalize: request => ({ ok: true, request }) })
  const server = createServer((req, res) => routes.find(route => route.path === req.url).handler(req, res))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)))
  const post = async body => (await fetch(`http://127.0.0.1:${server.address().port}/api/dsh-imagegen/etsy/start`, { method: 'POST', body: JSON.stringify(body) })).json()
  const a = input({ count: 1 }); a.generation.materialPreset = DEFAULT_MATERIAL
  const good = await post(a); assert.equal(good.ok, true); assert.equal(good.value.request.materialPreset, DEFAULT_MATERIAL)
  const bad = input({ count: 1 }); bad.generation.materialPreset = 'invalid'
  const denied = await post(bad); assert.equal(denied.ok, false)
  await f.workflow.idle(); assert.equal(f.counts.generation, 1)
})

test('新版默认使用 Studio 2 材质，显式旧版仍保持兼容', async t => {
  assert.equal(CURRENT_MATERIAL, 'needle_felt_v2_0')
  const f = await setup(t)
  for (const task of ['redesign', 'felt-conversion', 'flat-to-felt']) {
    const p = await f.workflow.start(input({ count: 1, creationTask: task })); await f.workflow.idle()
    const image = (await f.workflow.get(p.id)).images[0]
    assert.equal(image.visualRules.materialPreset, 'needle_felt_v2_0')
    assert.equal(image.visualRules.modules.needle_felt_v2_0, '2.0')
    assert.match(f.queue.get(image.taskId).request.prompt, /cohesive non-woven surface/)
  }
  const legacy = await f.workflow.start(input({ count: 1, generation: { ...input().generation, materialPreset: DEFAULT_MATERIAL } })); await f.workflow.idle()
  const image = (await f.workflow.get(legacy.id)).images[0]
  assert.equal(image.visualRules.materialPreset, DEFAULT_MATERIAL)
  assert.equal(image.visualRules.modules.needle_felt_v1_0, '1.0')
  assert.doesNotMatch(f.queue.get(image.taskId).request.prompt, /needle_felt_v1_0_2/)
})

test('失败重试切换材质真正传入队列，之后不指定版本仍继承该图片候选版', async t => {
  const f = await setup(t, { failGeneration: index => index <= 2 })
  const p = await f.workflow.start(input({ count: 1, maxCalls: 20, generation: { ...input().generation, materialPreset: DEFAULT_MATERIAL } })); await f.workflow.idle()
  let product = await f.workflow.get(p.id), image = product.images[0]
  assert.equal(image.visualRules.materialPreset, DEFAULT_MATERIAL)
  await f.workflow.retry(p.id, 'generation', image.id, false, { ...product.request, materialPreset: EXPERIMENTAL_MATERIAL }); await f.workflow.idle()
  product = await f.workflow.get(p.id); image = product.images[0]
  assert.equal(image.visualRules.materialPreset, EXPERIMENTAL_MATERIAL)
  assert.equal(f.queue.get(image.taskId).request.feltContext.materialPreset, EXPERIMENTAL_MATERIAL)
  await f.workflow.retry(p.id, 'generation', image.id); await f.workflow.idle()
  image = (await f.workflow.get(p.id)).images[0]
  assert.equal(image.generation.status, 'completed')
  assert.equal(image.visualRules.materialPreset, EXPERIMENTAL_MATERIAL)
  assert.equal(product.request.materialPreset, DEFAULT_MATERIAL, '项目默认不因单张实验重试被迁移')
})

test('五类材料分开且每类仅注入一次；无对应部件不注入松毛、毡片和织物规则', () => {
  const simple = composeFeltPrompt(context(materialCases[1], EXPERIMENTAL_MATERIAL), 'gpt-image-2.6-flare')
  for (const category of ['loose_wool_or_curly_fleece', 'flat_felt_sheet', 'woven_or_knitted_clothing', 'mixed_material_accessory']) assert.ok(!simple.ruleIds.includes(`MAT-${category}`))
  const profile = { components: ['body', 'face', 'clothing'], mixedMaterials: [], tones: [], scene: 'minimal', materialComponents: [
    { part: 'body', region: 'body', category: 'sculpted_needle_felt' },
    { part: 'head', region: 'face', category: 'sculpted_needle_felt' },
    { part: 'curly fleece patch', region: 'accessory', category: 'loose_wool_or_curly_fleece' },
    { part: 'cut felt petal', region: 'accessory', category: 'flat_felt_sheet' },
    { part: 'blue cotton dress', region: 'clothing', category: 'woven_or_knitted_clothing' },
    { part: 'bead eyes', region: 'accessory', category: 'mixed_material_accessory' },
  ] }
  const full = composeFeltPrompt(context({ profile, basePrompt: 'Preserve all existing shapes and poses.' }, EXPERIMENTAL_MATERIAL), 'gpt-image-2')
  for (const category of [...new Set(profile.materialComponents.map(row => row.category))]) assert.equal(full.ruleIds.filter(id => id === `MAT-${category}`).length, 1)
  assert.equal((full.prompt.match(/SCULPTED NEEDLE-FELTED WOOL:/g) ?? []).length, 1)
  assert.equal((full.prompt.match(/FACE: The identified/g) ?? []).length, 1)
  assert.match(full.prompt, /thin non-woven felt/)
})

test('错误主体分类保留原观察但目标改为针毡，衣服和珠眼不被同化', () => {
  const profile = { ...materialCases[0].profile, materialComponents: [
    { part: 'face', region: 'clothing', category: 'woven_or_knitted_clothing', observedMaterial: 'knitted jersey', evidence: '原图可见织纹' },
    { part: 'blue dress', region: 'clothing', category: 'woven_or_knitted_clothing' },
    { part: 'bead eyes', region: 'accessory', category: 'mixed_material_accessory' },
  ] }
  const result = composeFeltPrompt(context({ profile, basePrompt: 'Keep the face and dress shapes unchanged.' }, EXPERIMENTAL_MATERIAL), 'gpt-image-2')
  assert.equal(result.profile.materialComponents.find(row => row.part === 'face').category, 'sculpted_needle_felt')
  assert.equal(result.profile.materialComponents.find(row => row.part === 'face').observedMaterial, 'knitted jersey')
  assert.equal(result.profile.materialComponents.find(row => row.part === 'blue dress').category, 'woven_or_knitted_clothing')
  assert.ok(result.materialCorrections.some(change => change.field === 'profile'))
})

test('只改确定的主体材料短语，保留棉布裙、针织围巾、眼睛及同句姿态', () => {
  const profile = { ...materialCases[0].profile, materialComponents: [
    { part: 'blue dress', region: 'clothing', category: 'woven_or_knitted_clothing' },
    { part: 'knitted scarf', region: 'clothing', category: 'woven_or_knitted_clothing' },
  ] }
  const before = 'Create a knitted white rabbit doll with bead eyes. The head is sewn from knitted fabric. The face has horizontal textile rows, with a small pink nose and a calm expression. Keep the knitted scarf, blue cotton dress, two pockets and red ear-edge decorative stitches. The left paw holds the same strap. Use the same background and camera position.'
  const result = composeFeltPrompt(context({ profile, basePrompt: before }, EXPERIMENTAL_MATERIAL), 'gpt-image-2')
  assert.doesNotMatch(result.prompt, /knitted white rabbit doll|head is sewn from knitted fabric|face has horizontal textile rows/)
  for (const kept of ['bead eyes', 'small pink nose and a calm expression', 'knitted scarf, blue cotton dress, two pockets and red ear-edge decorative stitches', 'left paw holds the same strap', 'same background and camera position']) assert.ok(result.prompt.includes(kept))
  assert.equal(result.materialCorrections.filter(c => c.field === 'designBrief').length, 3)
})

test('明确棉布裙不会同时收到 felt dress；否定规则和中文五官姿态保留', () => {
  const profile = { ...materialCases[0].profile, materialComponents: [{ part: 'blue dress', region: 'clothing', category: 'woven_or_knitted_clothing' }] }
  const before = 'Keep the blue felt dress with its pockets. The dress is layered matte felt. Avoid knitted face texture. 针织脸部保留粉色鼻子和站立姿势。'
  const result = composeFeltPrompt(context({ profile, basePrompt: before }, EXPERIMENTAL_MATERIAL), 'gpt-image-2')
  assert.doesNotMatch(result.prompt, /blue felt dress|dress is layered matte felt/)
  assert.match(result.prompt, /blue textile dress/)
  assert.match(result.prompt, /Avoid knitted face texture/)
  assert.match(result.prompt, /针刺压实羊毛毡脸部保留粉色鼻子和站立姿势/)
})

test('重复版本块只保留选中版，不完整块或无法消除的冲突阻止组装', () => {
  const legacy = '[NEEDLE_FELT_RULES:v1.0]old rules[/NEEDLE_FELT_RULES]'
  const experimental = '[needle_felt_v1_0_2]stale rules[/needle_felt_v1_0_2]'
  const input = `Keep the same rabbit face and blue cotton dress.\n${legacy}\n${experimental}\n${legacy}`
  const result = composeFeltPrompt(context({ ...materialCases[0], basePrompt: input }, EXPERIMENTAL_MATERIAL), 'gpt-image-2')
  assert.equal((result.prompt.match(/\[NEEDLE_FELT_RULES:/g) ?? []).length, 1)
  assert.equal((result.prompt.match(/\[needle_felt_v1_0_2\]/g) ?? []).length, 1)
  assert.doesNotMatch(result.prompt, /old rules|stale rules|NEEDLE_FELT_RULES:v1.0;/)
  const reverted = composeFeltPrompt(context({ ...materialCases[0], basePrompt: input }, DEFAULT_MATERIAL), 'gpt-image-2')
  assert.equal(reverted.modules.needle_felt_v1_0, '1.0')
  assert.doesNotMatch(reverted.prompt, /old rules|stale rules|needle_felt_v1_0_2/)
  assert.throws(() => stripMaterialRuleBlocks('[needle_felt_v1_0]missing end'), /不完整/)
  assert.throws(() => resolveMaterialText('The head has unusually elaborate jersey texture.', 'designBrief', result.profile), /未能安全消除/)
  assert.throws(() => composeFeltPrompt(context(materialCases[0], EXPERIMENTAL_MATERIAL, { userRequirements: 'Keep a knitted face.' }), 'gpt-image-2'), /未改写用户要求/)
  assert.doesNotThrow(() => composeFeltPrompt(context(materialCases[0], EXPERIMENTAL_MATERIAL, { userRequirements: 'No knitted face. Preserve the knitted scarf.' }), 'gpt-image-2'))
  assert.throws(() => normalizeMaterialComponents([{ part: 'dress', category: 'flat_felt_sheet' }, { part: 'dress', category: 'woven_or_knitted_clothing' }]), /冲突/)
})

test('真实织物配件不再被误判为主体材质冲突，主体织纹扩散仍被拦截', () => {
  const profile = { ...materialCases[0].profile }
  // 报错原句形态：主体保留，另加一件燕麦色针织配件。
  const legitimate = [
    'Keep the same rabbit face but adds a soft oatmeal knitted scarf around the neck.',
    'Preserve the felt face but adds a soft oatmeal knitted cardigan and a ribbon.',
    'Keep the head but adds a soft oatmeal knitted bonnet with a small brim.',
    'The face is needle-felted and wearing a soft oatmeal knitted hat.',
    'Keep the body but adds a soft oatmeal knitted blanket beneath it.',
    'Keep the face but paired with a soft oatmeal knitted dress.',
  ]
  for (const sentence of legitimate) {
    assert.doesNotThrow(() => resolveMaterialText(sentence, 'designBrief', profile), sentence)
    assert.equal(resolveMaterialText(sentence, 'designBrief', profile).text, sentence, '合法混材描述不应被改写')
  }
  // 织纹明确回到主体，或主体本身就是织物，仍必须拦截。
  assert.throws(() => resolveMaterialText('The head has unusually elaborate jersey texture.', 'designBrief', profile), /未能安全消除/)
  assert.throws(() => resolveMaterialText('The face is covered with jersey rows across the whole head.', 'designBrief', profile), /未能安全消除/)
  assert.throws(() => resolveMaterialText('Keep a knitted face.', 'userRequirements', profile, true), /未改写用户要求/)
  // 端到端组装也不能再中断图像请求。
  assert.doesNotThrow(() => composeFeltPrompt(context({ ...materialCases[0], basePrompt: legitimate[0] }, EXPERIMENTAL_MATERIAL), 'gpt-image-2'))
})

test('多角度完整模式和侧背面直接模式均不重新注入候选材质', () => {
  const profile = materialCases[0].profile, anchor = { version: '1.0', imageId: 'hero', photography: defaultPhotography(), profile, inheritedModules: { needle_felt_v1_0_2: '1.0.2' } }
  const multiView = { anchor, angle: 'back', fixedDetails: '', identity: { summary: '蓝裙兔子', locks: ['白色针毡身体', '蓝色布裙'], unseen: [] }, references: [{ image: 1, id: 'hero', role: 'identity-anchor' }] }
  for (const surfaceStrategy of [undefined, 'hero-direct-v1']) {
    const a = composeFeltPrompt(context(materialCases[0], DEFAULT_MATERIAL, { stage: 'multi-view', multiView: { ...multiView, surfaceStrategy } }), 'gpt-image-2')
    const b = composeFeltPrompt(context(materialCases[0], EXPERIMENTAL_MATERIAL, { stage: 'multi-view', multiView: { ...multiView, surfaceStrategy } }), 'gpt-image-2')
    assert.equal(a.prompt, b.prompt)
    assert.doesNotMatch(b.prompt, /SCULPTED NEEDLE-FELTED WOOL|\[needle_felt_v1_0_2\]/)
  }
})

test('候选设定卡按主图观察分类，不把针毡目标强加给已批准角度', async () => {
  const calls = []
  const models = createEtsyModels(async (_, options) => { calls.push(options); return JSON.stringify({ summary: '蓝裙兔子', locks: ['同一姿势'], unseen: [], feltProfile: materialCases[0].profile }) })
  await models.identity(modelConfig, `data:image/png;base64,${pixel}`, '', new AbortController().signal, { materialPreset: EXPERIMENTAL_MATERIAL })
  assert.match(calls[0].system, /identity:r2/)
  assert.match(calls[0].system, /只记录已批准主图的真实可见材质/)
  assert.doesNotMatch(calls[0].system, /analysis:r2/)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { STUDIO_MATERIAL_V2, NEEDLE_FELT_CORE_V2, normalizeMaterialPlanV2, makeFeltContext, composeFeltPrompt, defaultPhotography, createEtsyModels, ImageGenerationRuntime, referenceGenerationPrompt, PLUGIN_VERSION } from '../.etsy-test/host.js'
import { fixture, input, facts, modelConfig, pixel } from './etsy-fixture.mjs'
const v2 = (brief, extra = {}) => makeFeltContext({ materialPreset: STUDIO_MATERIAL_V2, basePrompt: brief, stage: 'generation', photography: defaultPhotography(), ...extra })
const examples = [
  'Keep the same rabbit face but adds a soft oatmeal knitted scarf around the neck.',
  'The head is framed by a knitted halo.', 'The face sits beneath a knitted canopy.',
  'The body sits beside a knitted cushion.', 'The rabbit head carries a knitted garland.',
  'The body shows a knitted tassel.', 'The face is beside an embroidered velvet rosette.',
  '保留羊毛毡脸，旁边增加一顶亚麻遮阳篷。', 'A bunny with a lace stole and silk organza cravat.',
  'The wool creature carries a handwoven accessory named qz-unknown-991.',
]
async function setup(t, options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'studio-v2-')), f = fixture(root, options)
  await f.workflow.ready
  t.after(async () => { f.workflow.dispose(); await f.workflow.idle(); await rm(root, { recursive: true, force: true }) })
  return { ...f, root }
}

test('未知配件与合法混材全部原样送入，不靠名词或动词词表放行', () => {
  for (const brief of examples) for (const model of ['gpt-image-2.6-flare', 'gemini-image', 'grok-image']) {
    const result = composeFeltPrompt(v2(brief, { userRequirements: brief, latestInstruction: brief }), model)
    assert.ok(result.prompt.includes(`DESIGN:\n${brief}`))
    assert.ok(result.prompt.includes(`USER REQUIREMENTS: ${brief}`))
    assert.ok(result.prompt.includes(`LATEST EDIT: ${brief}`))
    assert.deepEqual(result.materialCorrections, undefined)
    assert.equal((result.prompt.match(/\[STUDIO_MATERIAL_V2\]/g) ?? []).length, 1)
    assert.doesNotMatch(result.prompt, /realistic-needle-felt-product-v1|NEEDLE_FELT_RULES|MATERIAL-ONLY REPAIR/)
  }
})

test('材料任意描述保留：只有协议字段校验，没有新词需要登记', () => {
  const plan = normalizeMaterialPlanV2({ parts: examples.map((name, i) => ({ part: `配件${i}`, material: name, treatment: 'retain' })) })
  assert.equal(plan.plan.parts.length, examples.length)
  for (let i = 0; i < examples.length; i++) assert.equal(plan.plan.parts[i].material, examples[i])
  const same = normalizeMaterialPlanV2({ parts: [{ part: 'halo', material: 'silk', treatment: 'retain' }, { part: 'halo', material: 'paper', treatment: 'retain' }] })
  assert.equal(same.plan.parts.length, 1); assert.equal(same.plan.parts[0].treatment, 'unspecified'); assert.equal(same.notes.length, 1)
})

test('方案只读一次分析，结构化材料唯一生效，不夹入模型原长稿或旧通用模板', async t => {
  let analyses = 0
  const planner = createEtsyModels(async (_, options) => {
    analyses++; assert.match(options.system, /STUDIO_V2_MATERIAL_PLAN/)
    assert.match(options.system, /眼睛、鼻头、珠类小件默认 retain，不归羊毛/)
    assert.match(options.system, /materialPlan/); assert.doesNotMatch(options.system, /建议90到180词/)
    return JSON.stringify({ name: '蓝裙兔', summary: '白兔', keep: ['白兔五官'], plans: Array.from({ length: 4 }, (_, i) => ({ name: `方案${i}`, direction: `独立方向${i}`, changes: ['保持识别点'],
      prompt: `This old verbose knitted doll prompt must not be used for proposal ${i}.`,
      designBrief: `A white rabbit wearing a blue pinafore with two pockets, a small bow and carrot charm, design ${i}.`,
      materialPlan: { parts: [{ part: 'blue dress', material: 'lightweight woven cotton with stitched pocket edges', treatment: 'retain' }, { part: 'rabbit body', material: 'wool', treatment: 'felt' }] } })) })
  })
  const f = await setup(t, { plan: (...args) => planner.plan(...args) })
  const p = await f.workflow.start(input({ count: 4, copyTiming: 'selected', autoCheck: false, references: [{ dataUrl: `data:image/png;base64,${pixel}`, role: 'subject', note: '' }] }), undefined, { creativity: 'balanced' }); await f.workflow.idle()
  const product = await f.workflow.get(p.id)
  assert.equal(analyses, 1); assert.equal(f.counts.generation, 4)
  for (const image of product.images) {
    assert.equal(image.visualRules.materialPreset, STUDIO_MATERIAL_V2)
    assert.match(image.visualRules.prompt, /lightweight woven cotton with stitched pocket edges/)
    assert.match(image.visualRules.prompt, /DESIGN:[\s\S]*PLANNED CHANGES[^:]*: 保持识别点/)
    assert.equal(image.visualRules.prompt.split('lightweight woven cotton with stitched pocket edges').length - 1, 1, '结构化材料在最终提示词中只组装一次')
    assert.match(image.visualRules.prompt, /计划变化优先于参考图保留措辞/)
    assert.equal(image.visualRules.profile.materialPlan.parts.find(part => part.part === 'blue dress').treatment, 'retain', '服装保留计划材料，不套用主体毡化处理')
    assert.doesNotMatch(image.visualRules.prompt, /old verbose knitted doll|Existing felt clothing|REALISTIC NEEDLE-FELTED WOOL PRODUCT TEMPLATE/)
    assert.equal(image.visualRules.profile.materialPlan.parts.length, 2)
    assert.equal(f.queue.get(image.taskId).request.prompt, image.visualRules.prompt)
  }
})

test('用户原文中的真实冲突也不会被静默重写或正则取消，留给明确的任务与材料描述', () => {
  const text = 'The head has jersey texture and the face is smooth.'
  const output = composeFeltPrompt(v2(text, { latestInstruction: text }), 'gpt-image-2')
  assert.ok(output.prompt.includes(text)); assert.equal(output.materialNotes.length, 0)
})

test('没有结构化材料的旧稿正常回退，源文字与参考身份完整保留', () => {
  const profile = { components: ['face'], materialComponents: [{ part: 'dress', category: 'flat_felt_sheet' }, { part: 'dress', category: 'woven_or_knitted_clothing' }] }
  const result = composeFeltPrompt(v2(examples[0], { profile }), 'gpt-image-2')
  assert.ok(result.prompt.includes(examples[0])); assert.match(result.prompt, /No additional part material has been confirmed/)
  assert.equal(result.profile.materialPlan.parts.length, 0)
})

test('摄影画幅保持原函数语义，材料内容不因切换图片模型而被改写', () => {
  const photo = { ...defaultPhotography(), photography_preset: 'custom', custom_background: '米色墙与石台', subject_height_ratio: 0.45, aspect_ratio: '3:4' }
  const a = composeFeltPrompt(v2(examples[0], { photography: photo }), 'gpt-image-2')
  const b = composeFeltPrompt(v2(examples[0], { photography: photo }), 'gemini-image')
  assert.deepEqual(a.photography, photo); assert.equal(a.prompt, b.prompt)
  assert.match(a.prompt, /45%/); assert.match(a.prompt, /3:4/); assert.match(a.prompt, /米色墙与石台/)
})

test('本机HTTP出站传输与快照完全一致，规划不增加额外调用', async t => {
  const received = []
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const form = await new Request('http://localhost', { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body: Buffer.concat(chunks) }).formData()
    received.push(String(form.get('prompt')).replace(/\r\n/g, '\n'))
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ b64_json: pixel }] }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)))
  const runtime = new ImageGenerationRuntime(() => ({ defaultChannelId: 'local', channels: [{ id: 'local', name: '本机免费测试', auth: 'api-key', apiKey: 'mock-only', apiUrl: `http://127.0.0.1:${server.address().port}/v1`, apiUrlFull: false, preset: '', models: [{ alias: 'gpt-image-2.6-flare', id: 'gpt-image-2.6-flare' }] }] }), { append: async () => [] })
  const result = await runtime.run({ ...input().generation, model: 'gpt-image-2.6-flare', n: 1, feltContext: v2(examples[2]) })
  assert.equal(received.length, 1); assert.equal(received[0], result.visualRules.prompt)
})

test('新项目修改和失败重试仍用v2，多角度继续继承主图不反复施加材料', async t => {
  const f = await setup(t, { failGeneration: index => index === 1 })
  const p = await f.workflow.start(input({ count: 1, maxCalls: 40 })); await f.workflow.idle()
  let product = await f.workflow.get(p.id)
  await f.workflow.retry(p.id, 'generation', product.images[0].id); await f.workflow.idle(); product = await f.workflow.get(p.id)
  const original = structuredClone(product.images[0])
  await f.workflow.revise(p.id, examples[4], product.request, original.id); await f.workflow.idle(); product = await f.workflow.get(p.id)
  assert.equal(product.images.at(-1).visualRules.materialPreset, STUDIO_MATERIAL_V2)
  assert.deepEqual(product.images[0].files, original.files)
  await f.workflow.confirmDesign(p.id, product.images.at(-1).id, '保持造型'); await f.workflow.idle(); product = await f.workflow.get(p.id)
  await f.workflow.generateViews(p.id, product.finalDesigns[0].id, ['back'], 'studio2-back', product.request); await f.workflow.idle()
  const view = (await f.workflow.get(p.id)).images.at(-1)
  assert.doesNotMatch(view.visualRules.prompt, /STUDIO_MATERIAL_V2/)
  assert.equal(view.visualRules.multiView.anchor.inheritedModules.needle_felt_v2_0, '2.0')
})

test('版本常量与包一致，v2不执行旧长模板且核心描述保持简短', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)))
  assert.equal(PLUGIN_VERSION, pkg.version); assert.match(PLUGIN_VERSION, /^2\.0\.0-etsy\.\d+$/)
  assert.ok(NEEDLE_FELT_CORE_V2.split(/\s+/).length < 140)
  const text = referenceGenerationPrompt({ strategyVersion: 2, materialPreset: STUDIO_MATERIAL_V2, keep: [], plans: [] }, { name: 'test', direction: 'test', changes: [], prompt: examples[0] }, 'gentle', '')
  assert.ok(text.includes(examples[0])); assert.doesNotMatch(text, /realistic-needle-felt-product-v1/)
})

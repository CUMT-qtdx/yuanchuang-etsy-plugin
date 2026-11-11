// 同一参考图、同一资料下捕获真实规划入口的请求，避免只测按钮标签。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createEtsyModels, referenceGenerationPrompt, EtsyStore, renderRealisticNeedleFeltTemplate, REALISTIC_NEEDLE_FELT_PRODUCT_TEMPLATE, REALISTIC_NEEDLE_FELT_TEMPLATE_ID, DEFAULT_MATERIAL, EXPERIMENTAL_MATERIAL, validateReferencePlan } from '../.etsy-test/host.js'
import { facts, modelConfig, pixel, fixture, input } from './etsy-fixture.mjs'

const result = {
  name: '小狗系列设计', summary: '以毛毡小狗为灵感设计四个方案', keep: ['小狗辨识特征', '毛毡纤维外观'],
  plans: ['姿态重塑', '角色重塑', '主题融合', '组合设计'].map((name, index) => ({ name, direction: `${name}方向`, changes: [`${name}为明确的新造型`, '改变主体轮廓'], changeAxes: ['pose', 'silhouette'], prompt: `Use the reference as inspiration. Create a new puppy design with a distinct body silhouette and new pose, concept number ${index + 1}.` })),
}
async function capture(mode, requirements = '保留垂耳，使用毛毡质感') {
  const calls = []
  const models = createEtsyModels(async (config, options) => { calls.push({ config, options }); return JSON.stringify(result) })
  const plan = await models.plan(modelConfig, { ...facts, requirements }, `data:image/png;base64,${pixel}`, mode, new AbortController().signal)
  assert.equal(calls.length, 1, '自检在同次规划中完成，不额外调用模型')
  return { request: calls[0].options, plan }
}

test('创意规划不再继承复现原图与固定构图的反推角色', async () => {
  for (const mode of ['gentle', 'balanced', 'bold']) {
    const { request } = await capture(mode)
    assert.doesNotMatch(request.system, /reverse-engineer|could use to reproduce it|first sets subject and composition/)
  }
})

test('大胆档四方案都要求主体设计变化，不沿用配色配饰固定四槽', async () => {
  const { request, plan } = await capture('bold')
  assert.match(request.system, /每个方案.*至少.*两个/)
  assert.match(request.system, /轮廓|姿态|比例/)
  assert.doesNotMatch(request.system, /四方向依次覆盖配色、服装配饰、主题变化、自由创意/)
  assert.match(request.system, /输出前.*自检/)
  assert.equal(plan.strategyVersion, 2)
  assert.equal(plan.creativity, 'bold')
  assert.deepEqual(plan.plans[0].changeAxes, ['pose', 'silhouette'])
})

test('三档分别明确同款、同系列、新设计，用户保留要求都传入规划', async () => {
  const gentle = await capture('gentle'), balanced = await capture('balanced'), bold = await capture('bold')
  assert.match(gentle.request.system, /同款/)
  assert.match(balanced.request.system, /同系列/)
  assert.match(bold.request.system, /重新设计/)
  for (const { request } of [gentle, balanced, bold]) {
    assert.match(request.system, /用户.*优先/)
    assert.match(request.content[0].text, /保留垂耳/)
    assert.equal(request.content[1].image_url.url, `data:image/png;base64,${pixel}`)
  }
})

test('同图三档的规划规则传到四张实际生图请求，调用数量和持久化保持一致', async t => {
  for (const mode of ['gentle', 'balanced', 'bold']) {
    const root = await mkdtemp(path.join(tmpdir(), 'etsy-creativity-flow-'))
    const plannerCalls = [], qualityContexts = []
    const planner = createEtsyModels(async (_, options) => { plannerCalls.push(options); return JSON.stringify(result) })
    const f = fixture(root, {
      plan: (...args) => planner.plan(...args),
      vision: async (_, __, ___, ____, _____, ______, context) => { qualityContexts.push(context); return { status: 'PASS', summary: '测试', issues: [], uncertainties: [], assessedAt: Date.now(), advisory: true, model: 'mock' } },
    })
    await f.workflow.ready
    t.after(async () => { f.workflow.dispose(); await f.workflow.idle(); await rm(root, { recursive: true, force: true }) })
    const created = await f.workflow.start(input({ count: 4, facts: { ...facts, requirements: '保留垂耳' } }), undefined, { creativity: mode }); await f.workflow.idle()
    const product = await f.workflow.get(created.id), requests = f.queue.list().map(task => task.request)
    assert.deepEqual(f.counts, { generation: 4, quality: 4, copy: 4, planning: 1 })
    assert.equal(plannerCalls.length, 1)
    assert.equal(product.referencePlan.strategyVersion, 2)
    assert.equal(product.referencePlan.creativity, mode)
    assert.equal(requests.length, 4)
    for (const request of requests) {
      assert.ok(request.prompt.includes(`[REFERENCE_DESIGN_V2:${mode}]`))
      assert.match(request.prompt, /保留垂耳/)
      assert.equal(request.mode, 'edit')
      assert.equal(request.image, `data:image/png;base64,${pixel}`)
    }
    if (mode === 'bold') assert.ok(requests.every(request => /at least two substantial subject-design changes/.test(request.prompt)))
    if (mode === 'gentle') assert.ok(requests.every(request => /Keep its pose, silhouette/.test(request.prompt)))
    assert.equal(qualityContexts.length, 4)
    assert.ok(qualityContexts.every(context => context.creativity === mode && context.plan.changes.length === 2))
    const stored = (await new EtsyStore(root).load())[0]
    assert.equal(stored.referencePlan.strategyVersion, 2)
    assert.deepEqual(stored.referencePlan.plans[0].changeAxes, ['pose', 'silhouette'])
  }
})

test('大胆方案失败重试沿用同档位；选定结果后局部修图不重新执行大胆重设计', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'etsy-creativity-retry-'))
  const planner = createEtsyModels(async () => JSON.stringify(result))
  const f = fixture(root, { plan: (...args) => planner.plan(...args), failGeneration: index => index === 1 })
  await f.workflow.ready
  t.after(async () => { f.workflow.dispose(); await f.workflow.idle(); await rm(root, { recursive: true, force: true }) })
  const p = await f.workflow.start(input({ count: 4, autoCheck: false }), undefined, { creativity: 'bold' }); await f.workflow.idle()
  const before = await f.workflow.get(p.id), failed = before.images.find(image => image.generation.status === 'failed')
  const originalPrompt = f.queue.get(failed.taskId).request.prompt
  await f.workflow.retry(p.id, 'generation', failed.id); await f.workflow.idle()
  const recovered = await f.workflow.get(p.id), retried = recovered.images.find(image => image.id === failed.id)
  assert.equal(f.queue.get(retried.taskId).request.prompt, originalPrompt)
  await f.workflow.revise(p.id, '把围巾改成蓝色，保持新姿态', recovered.request, retried.id); await f.workflow.idle()
  const child = (await f.workflow.get(p.id)).images.find(image => image.parentImageId === retried.id)
  const editedPrompt = f.queue.get(child.taskId).request.prompt
  assert.match(editedPrompt, /把围巾改成蓝色/)
  assert.match(editedPrompt, /existing redesigned silhouette/)
  assert.doesNotMatch(editedPrompt, /REFERENCE_DESIGN_V2|at least two substantial/)
})

test('旧项目的已保存提示词不被新档位规则重写', () => {
  const plan = { id: 'plan-1', ...result.plans[0] }
  assert.equal(referenceGenerationPrompt({ ...result, plans: [plan] }, plan, 'bold', ''), plan.prompt)
})

const templateSlots = {
  SUBJECT: 'a needle-felted white rabbit with tall ears',
  QUANTITY: 'one figurine',
  POSE: 'standing upright',
  CAMERA_VIEW: 'a straight front view',
  FACIAL_FEATURES: 'small dot eyes and a pale pink nose',
  COLOR_PALETTE: 'creamy white, pale blue and soft pink',
  SURFACE_TYPE: 'a light oak tabletop',
  BACKGROUND_STYLE: 'a warm-grey indoor wall',
  ASPECT_RATIO: '1:1',
  SUBJECT_HEIGHT_RATIO: '60%',
}

test('真实针毡模板一次替换全部槽位，值里的占位符不被二次替换', () => {
  const rendered = renderRealisticNeedleFeltTemplate({ ...templateSlots, SUBJECT: `${templateSlots.SUBJECT} and label {SUBJECT}` })
  for (const value of Object.values(templateSlots)) if (value !== templateSlots.SUBJECT) assert.ok(rendered.includes(value))
  assert.equal((rendered.match(/and label \{SUBJECT\}/g) ?? []).length, 1)
  assert.ok(!rendered.includes('\u0000R3_TEMPLATE_SLOT_'))
  assert.match(REALISTIC_NEEDLE_FELT_PRODUCT_TEMPLATE, /\{SUBJECT\}/)
  assert.throws(() => renderRealisticNeedleFeltTemplate({ ...templateSlots, SUBJECT: '' }), /缺少槽位/)
})

test('新版参考创作注入通用模板且只出现一次，旧版和旧策略不注入', () => {
  const plan = { id: 'plan-1', ...result.plans[0], templateSlots: {
    subject: templateSlots.SUBJECT, quantity: templateSlots.QUANTITY, pose: templateSlots.POSE,
    cameraView: templateSlots.CAMERA_VIEW, facialFeatures: templateSlots.FACIAL_FEATURES, colorPalette: templateSlots.COLOR_PALETTE,
  } }
  const reference = { ...result, plans: [plan], strategyVersion: 2, materialPreset: EXPERIMENTAL_MATERIAL }
  const prompt = referenceGenerationPrompt(reference, plan, 'balanced', '保留大耳')
  assert.equal((prompt.match(new RegExp(`\\[${REALISTIC_NEEDLE_FELT_TEMPLATE_ID}\\]`, 'g')) ?? []).length, 1)
  assert.ok(prompt.includes(plan.prompt)); assert.ok(prompt.includes('保留大耳'))
  for (const value of Object.values(templateSlots)) if (!['a light oak tabletop', 'a warm-grey indoor wall', '1:1', '60%'].includes(value)) assert.ok(prompt.includes(value))
  assert.doesNotMatch(prompt, /\{(?:SUBJECT|QUANTITY|POSE|CAMERA_VIEW|FACIAL_FEATURES|COLOR_PALETTE|SURFACE_TYPE|BACKGROUND_STYLE|ASPECT_RATIO|SUBJECT_HEIGHT_RATIO)\}/)
  assert.match(prompt, /planned subject changes above are explicit approved modifications/)
  const legacy = referenceGenerationPrompt({ ...reference, materialPreset: DEFAULT_MATERIAL }, plan, 'balanced', '')
  assert.doesNotMatch(legacy, new RegExp(`\\[${REALISTIC_NEEDLE_FELT_TEMPLATE_ID}\\]`))
  assert.ok(legacy.includes(plan.prompt))
  assert.equal(referenceGenerationPrompt({ ...reference, strategyVersion: undefined }, plan, 'bold', ''), plan.prompt)
})

test('四方案模板槽位独立保存，规划校验不串值', () => {
  const raw = structuredClone(result)
  raw.plans = raw.plans.map((plan, index) => ({ ...plan, templateSlots: {
    subject: `subject ${index + 1}`, quantity: `quantity ${index + 1}`, pose: `pose ${index + 1}`,
    cameraView: `view ${index + 1}`, facialFeatures: `face ${index + 1}`, colorPalette: `palette ${index + 1}`,
  } }))
  const validated = validateReferencePlan(raw, 4)
  assert.deepEqual(validated.plans.map(plan => plan.templateSlots.subject), ['subject 1', 'subject 2', 'subject 3', 'subject 4'])
  const prompts = validated.plans.map(plan => referenceGenerationPrompt({ ...validated, strategyVersion: 2, materialPreset: EXPERIMENTAL_MATERIAL }, plan, 'balanced', ''))
  for (let index = 0; index < 4; index++) {
    assert.ok(prompts[index].includes(`subject ${index + 1}`))
    assert.ok(!prompts.some((prompt, other) => other !== index && prompt.includes(`subject ${index + 1}`)))
  }
})

test('视觉检查接收当前设计意图，允许计划中的姿态轮廓变化', async () => {
  let captured
  const models = createEtsyModels(async (_, options) => { captured = options; return JSON.stringify({ status: 'PASS', summary: '测试', issues: [], uncertainties: [] }) })
  await models.vision(modelConfig, facts, `data:image/png;base64,${pixel}`, [`data:image/png;base64,${pixel}`], [], new AbortController().signal,
    { creativity: 'bold', plan: { id: 'plan-1', ...result.plans[0] }, editInstruction: '只改围巾' })
  assert.match(captured.content[0].text, /允许的设计变化/)
  assert.match(captured.content[0].text, /改变主体轮廓/)
  assert.match(captured.content[0].text, /只改围巾/)
})

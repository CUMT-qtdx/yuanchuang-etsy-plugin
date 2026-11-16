// 提示词整理回归：生图只用英文改动、优先级只说明一次、多角度不写死具体部件、方案数量不靠字符串替换。
import test from 'node:test'
import assert from 'node:assert/strict'
import { referencePlannerSystem, referenceGenerationPrompt, validateReferencePlan, englishList, identityCard, multiViewPrompt, firstPassSurfacePrompt, makeFeltContext, composeFeltPrompt, STUDIO_MATERIAL_V2, defaultPhotography, createEtsyModels } from '../.etsy-test/host.js'
import { modelConfig, pixel } from './etsy-fixture.mjs'

const han = /\p{Script=Han}/u
const reference = { name: '兔', summary: '', keep: ['白色长耳'], keepEn: ['white long ears'], uncertainties: [], strategyVersion: 2, creativity: 'balanced', materialPreset: STUDIO_MATERIAL_V2, plans: [] }
const plan = { id: 'plan-1', name: '坐姿', direction: '坐姿抱花', changes: ['站姿→坐姿', '加一束小雏菊'], changesEn: ['seated pose instead of standing', 'holding a small bouquet of daisies'], prompt: 'A white rabbit figurine.', designBrief: 'A white rabbit figurine sitting and hugging daisies.' }
const profile = { components: ['body'], mixedMaterials: [], tones: [], scene: 'minimal' }
const viewContext = identity => ({ anchor: { version: '1.0', imageId: 'a', photography: defaultPhotography('redesign', true), profile, inheritedModules: {} }, angle: 'back', fixedDetails: '', identity, references: [{ image: 1, id: 'a', role: 'identity-anchor' }] })

test('生图提示词使用英文改动和识别点；旧方案缺少英文时回退中文', () => {
  const prompt = referenceGenerationPrompt({ ...reference, plans: [plan] }, plan, 'balanced', '', STUDIO_MATERIAL_V2)
  assert.match(prompt, /PLANNED CHANGES[^:]*: seated pose instead of standing; holding a small bouquet of daisies/)
  assert.match(prompt, /Identity details: white long ears/)
  assert.doesNotMatch(prompt, han)
  const legacy = referenceGenerationPrompt({ ...reference, keepEn: undefined }, { ...plan, changesEn: undefined }, 'balanced', '', STUDIO_MATERIAL_V2)
  assert.match(legacy, /站姿→坐姿/); assert.match(legacy, /白色长耳/)
})

test('英文版本条数不一致或夹中文时不使用', () => {
  assert.deepEqual(englishList(['a', 'b'], ['甲', '乙']), ['a', 'b'])
  assert.equal(englishList(['a'], ['甲', '乙']), undefined)
  assert.equal(englishList(['a', '乙 b'], ['甲', '乙']), undefined)
  const raw = { name: 'x', summary: '', keep: ['甲'], keepEn: ['keep a'], plans: [1, 2].map(i => ({ name: `n${i}`, direction: `d${i}`, changes: ['改'], changesEn: i === 1 ? ['change one'] : ['中文'], prompt: `A complete English prompt for proposal number ${i} here.` })) }
  const result = validateReferencePlan(raw, 2)
  assert.deepEqual(result.keepEn, ['keep a'])
  assert.deepEqual(result.plans[0].changesEn, ['change one']); assert.equal(result.plans[1].changesEn, undefined)
})

test('最终 v2 提示词只有一处优先级说明且不含中文规则句', () => {
  const base = referenceGenerationPrompt({ ...reference, plans: [plan] }, plan, 'balanced', '', STUDIO_MATERIAL_V2)
  for (const stage of ['generation', 'refinement']) {
    const out = composeFeltPrompt(makeFeltContext({ basePrompt: base, stage, materialPreset: STUDIO_MATERIAL_V2, latestInstruction: stage === 'refinement' ? 'make the bow red' : undefined, profile }), 'gemini-nano-banana-2.1')
    assert.equal((out.prompt.match(/PRIORITY \(highest first\)/g) ?? []).length, 1)
    assert.doesNotMatch(out.prompt, han)
    assert.doesNotMatch(out.prompt, /planned changes win|take priority over|overrides earlier design|Except for the planned changes|edit overrides them/i)
  }
})

test('规划提示词按实际数量书写，单方案不要求多方案互相比较', () => {
  const one = referencePlannerSystem('balanced', { count: 1, task: 'redesign', references: [], materialPreset: STUDIO_MATERIAL_V2 })
  assert.match(one, /恰好1个方案/); assert.doesNotMatch(one, /四个|四张|1张是否有不同|1种颜色/)
  const six = referencePlannerSystem('bold', { count: 6, task: 'redesign', references: [], materialPreset: STUDIO_MATERIAL_V2 })
  assert.match(six, /恰好6个方案/); assert.match(six, /6张是否有不同的主要设计思路/); assert.doesNotMatch(six, /四个|四张/)
  assert.match(six, /changesEn/)
})

test('形象记录英文版只在中文记录未被修改时使用', () => {
  const locks = ['白色身体', '蓝色裙子']
  const spec = { summary: '白兔', locks, unseen: [], english: { summary: 'white rabbit', locks: ['white body', 'blue dress'], basis: JSON.stringify(locks) } }
  assert.deepEqual(identityCard(spec), { summary: 'white rabbit', locks: ['white body', 'blue dress'] })
  assert.deepEqual(identityCard({ ...spec, locks: ['白色身体', '红色裙子'] }), { summary: '白兔', locks: ['白色身体', '红色裙子'] })
})

test('定稿记录生成英文版并在多角度提示词中使用', async () => {
  const model = createEtsyModels(async (_, request) => { assert.match(request.system, /locksEn/); return JSON.stringify({ summary: '白兔蓝裙', summaryEn: 'white rabbit in a blue dress', locks: ['白色身体', '蓝色裙子'], locksEn: ['white body', 'blue dress'], unseen: [] }) })
  const spec = await model.identity(modelConfig, `data:image/png;base64,${pixel}`, '', new AbortController().signal, { materialPreset: STUDIO_MATERIAL_V2 })
  assert.equal(spec.english.summary, 'white rabbit in a blue dress')
  assert.match(multiViewPrompt(viewContext(spec)), /OBSERVED IDENTITY CARD: \{"summary":"white rabbit in a blue dress","locks":\["white body","blue dress"\]\}/)
})

test('多角度规则不写死具体商品部件或光线', () => {
  const context = viewContext({ summary: 'x', locks: ['x'], unseen: [] })
  for (const text of [multiViewPrompt(context), firstPassSurfacePrompt(context), multiViewPrompt({ ...context, materialRepair: true })]) {
    assert.doesNotMatch(text, /\bhat\b|collar|flower|petal|stripes|dots|window|wooden table/i)
  }
})

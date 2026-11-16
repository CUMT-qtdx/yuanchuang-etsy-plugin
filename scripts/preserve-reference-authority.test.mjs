// 复现任意读图误认被当成设计命令的通用路径，不使用特定配件禁词。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createEtsyModels, CURRENT_MATERIAL } from '../.etsy-test/host.js'
import { fixture, input, facts, modelConfig, pixel } from './etsy-fixture.mjs'

const guessed = 'UNVERIFIED_COMPONENT_FROM_ANALYSIS'
const guessedMaterial = 'UNVERIFIED_MATERIAL_FROM_ANALYSIS'
const guessedName = 'AI_ASSIGNED_ARCHETYPE'
const explicitUser = 'Apply the explicitly requested blue colour only to the existing marked region.'
const image = `data:image/png;base64,${pixel}`
function contaminatedPlan() {
  return { name: guessedName, summary: '读图误认样本', keep: ['模型误认了额外部件'], keepEn: [`An inferred extra attachment ${guessed}.`], uncertainties: [],
    plans: [{ name: '原款呈现', direction: `Keep ${guessed}`, changes: [`增加 ${guessed}`], changesEn: [`Add ${guessed}.`], prompt: `The object has an extra attachment ${guessed} that was inferred by the analysis.`, designBrief: `The object has an extra attachment ${guessed} that was inferred by the analysis.`, materialPlan: { parts: [{ part: guessed, material: guessedMaterial, treatment: 'retain' }] } }] }
}
const fakeReview = { status: 'UNKNOWN', summary: '模拟复核', issues: [], uncertainties: [] }
const poison = new RegExp(`${guessed}|${guessedMaterial}|${guessedName}`)
async function cleanup(root) {
  const resolved = await realpath(root)
  assert.equal(path.dirname(resolved).toLowerCase(), (await realpath(tmpdir())).toLowerCase())
  assert.ok(path.basename(resolved).startsWith('reference-authority-'))
  await rm(resolved, { recursive: true, force: true })
}

test('模型读图的部件误认和材料猜测不能进入原款模式实际生图请求', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'reference-authority-'))
  const planner = createEtsyModels(async () => JSON.stringify(contaminatedPlan()))
  const f = fixture(root, { plan: (...args) => planner.plan(...args) })
  await f.workflow.ready
  t.after(async () => { f.workflow.dispose(); await f.workflow.idle(); await cleanup(root) })
  const p = await f.workflow.start(input({ count: 1, autoCheck: false, copyTiming: 'selected', facts: { ...facts, name: '参考图设计 原款', requirements: explicitUser } }), undefined, { creativity: 'preserve' })
  await f.workflow.idle()
  const product = await f.workflow.get(p.id)
  assert.match(product.referencePlan.plans[0].designBrief, poison, '确认仍捕获到原始错误分析，未伪造正确读图')
  const request = f.queue.list()[0].request
  assert.doesNotMatch(request.prompt, poison)
  assert.match(request.prompt, /reference image|visual source/i)
  assert.ok(request.prompt.includes(explicitUser), '用户原始明确要求继续生效')
  assert.ok([request.image,...(request.images ?? [])].includes(image))
  assert.match(request.prompt, /needle-felted wool/)
})

test('原款复核独立比较原图，不把同一次错误规划当作已获准修改', async () => {
  let captured
  const reviewer = createEtsyModels(async (_, options) => { captured = options; return JSON.stringify(fakeReview) })
  await reviewer.vision(modelConfig, { ...facts, name: guessedName, requirements: explicitUser }, image, [image], [], new AbortController().signal,
    { creativity: 'preserve', materialPreset: CURRENT_MATERIAL, plan: { id: 'plan-1', ...contaminatedPlan().plans[0] }, designPreservation: { version: '1.0', locks: [guessed] } })
  assert.doesNotMatch(JSON.stringify(captured), poison)
  assert.ok(JSON.stringify(captured).includes(explicitUser))
  assert.match(captured.system, /原图|原始主体参考/)
})

test('旧失败任务重试升级为原图优先，不复用旧的误认锁和长简报', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'reference-authority-'))
  const planner = createEtsyModels(async () => JSON.stringify(contaminatedPlan()))
  const first = fixture(root, { plan: (...args) => planner.plan(...args), failGeneration: () => true })
  await first.workflow.ready
  const p = await first.workflow.start(input({ count: 1, autoCheck: false, copyTiming: 'selected' }), undefined, { creativity: 'preserve' })
  await first.workflow.idle();first.workflow.dispose()
  const file = path.join(root, p.id, 'product.json')
  const stored = JSON.parse(await readFile(file, 'utf8'))
  stored.images[0].visualRules.designPreservation = { version: '1.0', locks: [guessed] }
  stored.images[0].visualRules.prompt = `Legacy description ${guessed}`
  await writeFile(file, JSON.stringify(stored))
  const second = fixture(root)
  await second.workflow.ready
  t.after(async () => { second.workflow.dispose(); await second.workflow.idle(); await cleanup(root) })
  await second.workflow.retry(p.id, 'generation', stored.images[0].id)
  await second.workflow.idle()
  const request = second.queue.list()[0].request
  assert.doesNotMatch(request.prompt, poison)
  assert.equal(request.feltContext.designPreservation.version, '1.1')
})

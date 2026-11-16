import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createEtsyModels, validateReferencePlan, referencePlannerSystem, makeEtsyRoutes, EtsyStore, CURRENT_MATERIAL } from '../.etsy-test/host.js'
import { facts, fixture, input, modelConfig, pixel } from './etsy-fixture.mjs'

const image = `data:image/png;base64,${pixel}`
function originalPlan(count = 1) {
  return { name: '原款器物', summary: '保留原款结构并转换材质', keep: ['原有开口、把手、配色和组合关系'], keepEn: ['Keep the original opening, handle, colour regions and object arrangement.'], uncertainties: [],
    plans: Array.from({ length: count }, () => ({ name: '原款呈现', direction: '按原款转换材质', changes: [], changeAxes: [], designBrief: 'The original sculpted vessel with the same opening, curved handle, two colour regions and existing decorations, without changing the object design.', prompt: 'The original sculpted vessel with the same opening, curved handle and existing decorations.', materialPlan: { parts: [{ part: 'sculpted vessel', material: 'needle-felted wool', treatment: 'felt' }] } })) }
}
const checks = status => Object.fromEntries(['design', 'material', 'photography'].map(area => [area, { status, evidence: `${area}：原图与本次结果的模拟对比依据` }]))

test('原款规划允许同款多张和空改款清单，其它档位继续要求差异化', () => {
  const raw = { ...originalPlan(8), materialPreset: CURRENT_MATERIAL, creativity: 'preserve' }
  const plan = validateReferencePlan(raw, 8)
  assert.equal(plan.plans.length, 8)
  assert.deepEqual(plan.plans[0].changes, [])
  assert.equal(new Set(plan.plans.map(p => p.prompt)).size, 1)
  assert.throws(() => validateReferencePlan({ ...raw, keep: [] }, 8), /保留清单/)
  assert.throws(() => validateReferencePlan({ ...raw, creativity: 'balanced' }, 8), /变化说明|不同设计方向/)
})

test('原款规划完整保留任意商品，转换材质和立体化均不会重新要求改款', () => {
  for (const task of ['redesign', 'felt-conversion', 'flat-to-felt']) {
    const system = referencePlannerSystem('preserve', { count: 1, task, materialPreset: CURRENT_MATERIAL, references: [{ dataUrl: image, role: 'subject', note: '' }], previousDirections: ['先前原款'] })
    assert.match(system, /原款|保留/)
    assert.match(system, /材质/)
    assert.doesNotMatch(system, /至少改变两个|每个方案至少有一处|避免重复这些已做方向|每张是否达到当前档位的主体变化要求/)
    assert.doesNotMatch(system, /keep只列必要身份/)
    if (task === 'flat-to-felt') assert.match(system, /厚度|体积/)
  }
})

test('真实 HTTP 参考入口的四档均接受1张和8张，并正确传递preserve', async t => {
  const captured = []
  const routes = makeEtsyRoutes({ workflow: { async start(value, _, reference) { captured.push({ value, reference }); return { id: 'mock-product', creativity: reference.creativity, images: Array.from({ length: value.count }, () => ({})) } } }, guard: () => true, parse: value => value, normalize: request => ({ ok: true, request }) })
  const route = routes.find(r => r.path.endsWith('/reference'))
  const server = createServer((req, res) => { void route.handler(req, res) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const url = `http://127.0.0.1:${server.address().port}${route.path}`
  for (const creativity of ['preserve', 'gentle', 'balanced', 'bold']) {
    for (const count of [1, 8]) {
      const response = await fetch(url, { method: 'POST', body: JSON.stringify({ ...input({ count, maxCalls: 100 }), image, creativity, autoCheck: false, copyTiming: 'selected' }) })
      const body = await response.json()
      assert.equal(body.ok, true, JSON.stringify(body))
      assert.equal(body.value.images.length, count)
      assert.equal(body.value.creativity, creativity)
    }
  }
  for (const count of [0, 9]) {
    const body = await (await fetch(url, { method: 'POST', body: JSON.stringify({ ...input({ count, maxCalls: 100 }), image, creativity: 'preserve' }) })).json()
    assert.equal(body.ok, false)
    assert.match(body.message, /1 到 8/)
  }
  assert.equal(captured.length, 8)
})

test('原款模式贯穿规划、真实队列请求、分项检查、持久化和单张重试修正', async t => {
  for (const count of [1, 8]) {
    const root = await mkdtemp(path.join(tmpdir(), 'etsy-preserve-'))
    const planningCalls = [], reviewCalls = []
    const planner = createEtsyModels(async (_, options) => { planningCalls.push(options); return JSON.stringify(originalPlan(count)) })
    const reviewer = createEtsyModels(async (_, options) => { reviewCalls.push(options); return JSON.stringify({ status: 'PASS', summary: '模拟检查', issues: [], uncertainties: [], designPreservation: checks('PASS') }) })
    const f = fixture(root, { plan: (...args) => planner.plan(...args), vision: (...args) => reviewer.vision(...args), failGeneration: index => count === 1 && index === 1 })
    await f.workflow.ready
    t.after(async () => { f.workflow.dispose(); await f.workflow.idle(); await rm(root, { recursive: true, force: true }) })
    const created = await f.workflow.start(input({ count, copyTiming: 'selected', maxCalls: 100, creationTask: 'felt-conversion', facts: { ...facts, requirements: '按原款转换材质' } }), undefined, { creativity: 'preserve' })
    await f.workflow.idle()
    let product = await f.workflow.get(created.id)
    if (count === 1) {
      const failed = product.images[0]
      assert.equal(failed.generation.status, 'failed')
      const frozen = structuredClone(failed.visualRules.designPreservation)
      await f.workflow.retry(product.id, 'generation', failed.id)
      await f.workflow.idle()
      product = await f.workflow.get(product.id)
      assert.deepEqual(product.images[0].visualRules.designPreservation, frozen)
    }
    assert.equal(planningCalls.length, 1)
    assert.equal(product.creativity, 'preserve')
    assert.equal(product.referencePlan.creativity, 'preserve')
    assert.equal(product.images.length, count)
    assert.ok(product.images.every(p => p.generation.status === 'completed'))
    for (const task of f.queue.list()) {
      assert.match(task.request.prompt, /DESIGN_PRESERVATION_V1/)
      assert.match(task.request.prompt, /interlocked|needle-felted wool/)
      assert.doesNotMatch(task.request.prompt, /never return the reference unchanged|Create the planned product variation/)
      assert.equal(task.request.feltContext.designPreservation.version, '1.1')
      assert.equal(task.request.feltContext.designPreservation.source, 'reference-image')
      assert.deepEqual(task.request.feltContext.designPreservation.locks, [])
    }
    assert.ok(product.images.every(p => p.report.designPreservation.design.status === 'PASS'))
    assert.ok(reviewCalls.every(p => /同一原款/.test(p.content[0].text) && !/不得要求不同设计方案完全同款/.test(p.content[0].text)))
    const stored = (await new EtsyStore(root).load())[0]
    assert.deepEqual(stored.images[0].visualRules.designPreservation, product.images[0].visualRules.designPreservation)
    if (count === 1) {
      await f.workflow.revise(product.id, '按原款纠正把手连接，保留正确的毛毡和背景', product.request, product.images[0].id)
      await f.workflow.idle()
      const child = (await f.workflow.get(product.id)).images.find(p => p.parentImageId)
      const prompt = f.queue.get(child.taskId).request.prompt
      assert.ok(prompt.includes(`image ${child.visualRules.compositionGuide?.subjectImage ?? 2} is the original product design reference`))
      assert.match(prompt, /without restoring its old material/)
      assert.equal(child.visualRules.designPreservation.version, '1.1')
    }
  }
})

test('设计或材料分项有偏移时不能被总体PASS覆盖，缺少依据不能假设通过', async () => {
  for (const status of ['REVISE', 'REJECT', 'UNKNOWN']) {
    const values = checks('PASS'); values.design.status = status
    const model = createEtsyModels(async () => JSON.stringify({ status: 'PASS', summary: '模拟检查', issues: [], uncertainties: [], designPreservation: values }))
    const report = await model.vision(modelConfig, { ...facts, authenticityConfirmed: true }, image, [image], [], new AbortController().signal, { creativity: 'preserve', materialPreset: CURRENT_MATERIAL })
    assert.equal(report.status, status)
    assert.equal(report.designPreservation.design.status, status)
  }
  const model = createEtsyModels(async () => JSON.stringify({ status: 'PASS', summary: '模拟未返回检查', issues: [], uncertainties: [] }))
  const report = await model.vision(modelConfig, { ...facts, authenticityConfirmed: true }, image, [image], [], new AbortController().signal, { creativity: 'preserve', materialPreset: CURRENT_MATERIAL })
  assert.equal(report.status, 'UNKNOWN')
})

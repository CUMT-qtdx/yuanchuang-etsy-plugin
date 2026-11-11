// 多参考、数量、定稿与多角度使用本地固定结果，不消耗真实模型额度。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fixture, input, facts, pixel, modelConfig } from './etsy-fixture.mjs'
import { createEtsyModels, validateReferencePlan, exportProduct, productStages } from '../.etsy-test/host.js'
const dataUrl = `data:image/png;base64,${pixel}`
const references = [{ dataUrl, role: 'subject', note: '保留翅膀' }, { dataUrl, role: 'detail', note: '只参考条纹' }, { dataUrl, role: 'view', note: '背面结构' }]
const creationInput = overrides => input({ count: 3, maxCalls: 100, autoCheck: true, copyTiming: 'selected', references, creationTask: 'flat-to-felt', generation: { ...input().generation, image: dataUrl, images: [dataUrl, dataUrl] }, ...overrides })
async function setup(t, options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'etsy-v1-')), f = fixture(root, options)
  await f.workflow.ready
  t.after(async () => { f.workflow.dispose(); await f.workflow.idle(); await rm(root, { recursive: true, force: true }) })
  return { ...f, root }
}

test('3到8张探索均保留多参考和用途，默认不为淘汰候选调用文案', async t => {
  for (const count of [3, 8]) {
    const contexts = [], { workflow, queue, counts } = await setup(t, { plan: async (_, __, ___, ____, _____, options) => {
      contexts.push(options)
      return { name: '八方向设计', summary: '多参考设计', keep: ['翅膀'], uncertainties: [], strategyVersion: 2, creativity: 'bold', task: options.task, references: options.references.map(({ role, note }) => ({ role, note })), plans: Array.from({ length: options.count }, (_, i) => ({ id: `plan-${i + 1}`, name: `方案${i + 1}`, direction: `方向${i + 1}`, changes: ['不同轮廓'], prompt: `Create a new handmade character with a different silhouette number ${i + 1}.` })) }
    } })
    const p = await workflow.start(creationInput({ count }), undefined, { creativity: 'bold' }); await workflow.idle()
    const done = await workflow.get(p.id)
    assert.equal(done.images.length, count); assert.equal(counts.generation, count); assert.equal(counts.copy, 0)
    assert.equal(done.referenceFiles.length, 3); assert.deepEqual(done.designReferences.map(r => r.role), ['subject', 'detail', 'view'])
    assert.equal(contexts[0].count, count); assert.equal(contexts[0].task, 'flat-to-felt')
    assert.ok(queue.list().every(task => task.request.image === dataUrl && task.request.images.length === 2 && task.request.prompt.includes('flat-to-felt') === false))
    assert.ok(queue.list().every(task => task.request.prompt.includes('three-dimensional') && task.request.prompt.includes('只参考条纹')))
    assert.ok(!productStages(done).some(stage => ['queued', 'running'].includes(stage.status)))
  }
})

test('实际规划入口传全部参考、转换任务与指定数量，并带正式视觉规则', async () => {
  let captured
  const models = createEtsyModels(async (_, options) => { captured = options; return JSON.stringify({ name: '立体设计', summary: '立体转换', keep: ['主体'], plans: Array.from({ length: 8 }, (_, i) => ({ name: `款${i}`, direction: `方向${i}`, changes: ['立体轮廓'], prompt: `Create a distinct felt character concept number ${i} with a complete three-dimensional structure.` })) }) })
  const plan = await models.plan(modelConfig, facts, dataUrl, 'gentle', new AbortController().signal, { count: 8, task: 'flat-to-felt', references })
  assert.equal(plan.plans.length, 8); assert.equal(captured.content.length, 4)
  assert.match(captured.system, /恰好8个/); assert.match(captured.system, /立体化与毛毡转换是本次必做任务/)
  assert.match(captured.system, /NEEDLE_FELT_ANALYSIS:v1.0/)
  assert.throws(() => validateReferencePlan(plan, 3), /3个/)
})

test('下一轮保存关联和已做方向，前一组图片仍完整', async t => {
  const { workflow } = await setup(t)
  const a = await workflow.start(creationInput(), undefined, { creativity: 'balanced' }); await workflow.idle()
  const first = await workflow.get(a.id)
  const b = await workflow.start(creationInput({ count: 8, previousProjectId: a.id }), undefined, { creativity: 'bold' }); await workflow.idle()
  const second = await workflow.get(b.id)
  assert.equal(second.round, 2); assert.equal(second.previousProjectId, a.id)
  assert.deepEqual(second.previousDirections, first.referencePlan.plans.map(plan => plan.direction))
  assert.deepEqual((await workflow.get(a.id)).images, first.images)
})

test('定稿自动生成设定卡，只给主图文案，多角度使用固定主图和设定卡', async t => {
  const contexts = [], { workflow, queue, counts } = await setup(t, { vision: async (_, __, ___, refs, siblings, signal, context) => { contexts.push({ refs, siblings, context }); return { status: 'PASS', summary: '检查建议', issues: [], uncertainties: [], assessedAt: Date.now(), model: 'mock', advisory: true } } })
  const p = await workflow.start(creationInput(), undefined, { creativity: 'bold' }); await workflow.idle()
  const candidate = await workflow.get(p.id), master = candidate.images[1]
  await workflow.confirmDesign(p.id, master.id, '翅膀保持线条'); await workflow.idle()
  let done = await workflow.get(p.id), design = done.finalDesigns[0]
  assert.ok(design.spec); assert.equal(counts.identity, 1); assert.equal(counts.copy, 1)
  const confirmedCalls = done.calls.length
  await workflow.confirmDesign(p.id, master.id, '翅膀保持线条'); await workflow.idle()
  assert.equal((await workflow.get(p.id)).calls.length, confirmedCalls)
  await workflow.generateViews(p.id, design.id, ['left', 'back'], 'view-request-001', done.request); await workflow.idle()
  done = await workflow.get(p.id)
  const views = done.images.filter(image => image.kind === 'view')
  assert.equal(views.length, 2); assert.equal(counts.copy, 1); assert.equal(done.selectedImageId, master.id)
  const masterUrl = await workflow.store.dataUrl(p.id, master.files[0])
  for (const view of views) {
    const request = queue.get(view.taskId).request
    assert.equal(request.image, masterUrl); assert.match(request.prompt, /翅膀保持线条/); assert.match(request.prompt, /Stripes must remain stripes/)
    assert.equal(view.parentImageId, master.id); assert.equal(view.copyStage.status, 'skipped')
  }
  assert.equal(contexts.filter(x => x.context?.identity).length, 2)
  assert.ok(contexts.filter(x => x.context?.identity).every(x => x.siblings.length === 0))
  await workflow.generateViews(p.id, design.id, ['left', 'back'], 'view-request-001', done.request); await workflow.idle()
  assert.equal((await workflow.get(p.id)).images.length, done.images.length)
  await workflow.approveView(p.id, views[1].id, true)
  await workflow.generateViews(p.id, design.id, ['right'], 'view-request-002', done.request); await workflow.idle()
  const right = (await workflow.get(p.id)).images.find(image => image.angle === 'right')
  assert.equal(queue.get(right.taskId).request.images.length, 1, '首次侧面只补方向示意图，不叠加其他角度的材质')
  assert.equal((await workflow.get(p.id)).calls.filter(call => call.stage === 'identity').length, 1)
  assert.ok((await exportProduct(await workflow.get(p.id), workflow.store)).includes(Buffer.from('final-designs.json')))
})

test('设定卡可编辑并保留历史，旧角度标过期，后续角度和分支精修读新设定', async t => {
  const { workflow, queue } = await setup(t)
  const p = await workflow.start(creationInput({ autoCheck: false }), undefined, { creativity: 'balanced' }); await workflow.idle()
  const master = (await workflow.get(p.id)).images[0]
  await workflow.confirmDesign(p.id, master.id, ''); await workflow.idle()
  let done = await workflow.get(p.id), design = done.finalDesigns[0]
  await workflow.generateViews(p.id, design.id, ['back'], 'old-card-view', done.request); await workflow.idle()
  const oldView = (await workflow.get(p.id)).images.find(image => image.kind === 'view')
  await workflow.approveView(p.id, oldView.id, true)
  await workflow.editIdentity(p.id, design.id, { summary: '固定天使', locks: ['翅膀三条竖线'], unseen: [] }, 1)
  await assert.rejects(workflow.approveView(p.id, oldView.id, true), /旧设定卡/)
  await workflow.generateViews(p.id, design.id, ['back'], 'new-card-view', done.request); await workflow.idle()
  done = await workflow.get(p.id)
  const newView = done.images.filter(image => image.kind === 'view').at(-1)
  assert.equal(newView.identityRevision, 2); assert.match(queue.get(newView.taskId).request.prompt, /三条竖线/)
  assert.equal(done.finalDesigns[0].specHistory.length, 1)
  await workflow.revise(p.id, '只换裙子', done.request, master.id); await workflow.idle()
  done = await workflow.get(p.id); const child = done.images.filter(image => image.kind !== 'view').at(-1)
  assert.equal(child.parentImageId, master.id); assert.match(queue.get(child.taskId).request.prompt, /三条竖线/)
  await workflow.selectImage(p.id, master.id); assert.equal((await workflow.get(p.id)).selectedImageId, master.id)
  await workflow.revise(p.id, '修正翅膀纹样', done.request, newView.id); await workflow.idle()
  const repaired = (await workflow.get(p.id)).images.at(-1)
  assert.equal(repaired.kind, 'view'); assert.equal(repaired.parentImageId, newView.id); assert.equal(repaired.version, 2)
  assert.equal(repaired.angle, newView.angle); assert.equal(repaired.finalDesignId, design.id)
})

test('分析失败保留主图，显式重试；取消不派发多角度，调用预算不越界', async t => {
  let fail = true
  const { workflow, counts } = await setup(t, { identity: async () => { if (fail) throw new Error('测试分析失败'); return { summary: '主图', locks: ['条纹'], unseen: [] } } })
  const p = await workflow.start(creationInput({ autoCheck: false }), undefined, { creativity: 'balanced' }); await workflow.idle()
  const master = (await workflow.get(p.id)).images[0]
  await workflow.confirmDesign(p.id, master.id, ''); await workflow.idle()
  let done = await workflow.get(p.id), design = done.finalDesigns[0]
  assert.equal(design.planning.status, 'failed'); assert.equal(counts.generation, 3)
  fail = false
  await workflow.generateViews(p.id, design.id, ['back'], 'retry-identity', done.request); await workflow.idle()
  done = await workflow.get(p.id); assert.equal(done.finalDesigns[0].planning.status, 'completed')
  assert.equal(counts.identity, 2); assert.equal(done.images.filter(image => image.kind === 'view').length, 1)
  await workflow.cancel(p.id); await workflow.idle()
  assert.ok(!productStages(await workflow.get(p.id)).some(stage => ['running', 'queued'].includes(stage.status)))
})

test('重开后主设计、设定卡与角度恢复，不重复调用已完成任务', async t => {
  const { workflow, root } = await setup(t)
  const p = await workflow.start(creationInput(), undefined, { creativity: 'balanced' }); await workflow.idle()
  const master = (await workflow.get(p.id)).images[0]
  await workflow.confirmDesign(p.id, master.id, '条纹'); await workflow.idle()
  const before = await workflow.get(p.id), design = before.finalDesigns[0]
  await workflow.generateViews(p.id, design.id, ['back'], 'restore-test', before.request); await workflow.idle(); workflow.dispose()
  const second = fixture(root); await second.workflow.ready; await second.workflow.idle()
  t.after(() => second.workflow.dispose())
  const restored = await second.workflow.get(p.id)
  assert.equal(restored.finalDesigns[0].spec.locks.at(-1), '条纹')
  assert.equal(restored.images.filter(image => image.kind === 'view').length, 1)
  assert.deepEqual(second.counts, { generation: 0, quality: 0, copy: 0 })
})

test('单角度失败重试不重画成功角度，额度不足时不新增占位图', async t => {
  const { workflow, counts } = await setup(t, { failGeneration: index => index === 4 })
  const p = await workflow.start(creationInput({ autoCheck: false, maxCalls: 12 }), undefined, { creativity: 'balanced' }); await workflow.idle()
  const master = (await workflow.get(p.id)).images[0]
  await workflow.confirmDesign(p.id, master.id, '条纹'); await workflow.idle()
  let done = await workflow.get(p.id), design = done.finalDesigns[0]
  await workflow.generateViews(p.id, design.id, ['left', 'back'], 'two-angle-request', done.request); await workflow.idle()
  done = await workflow.get(p.id)
  const bad = done.images.find(image => image.kind === 'view' && image.generation.status === 'failed'), good = done.images.find(image => image.kind === 'view' && image.generation.status === 'completed')
  const files = [...good.files]
  await workflow.retry(p.id, 'generation', bad.id); await workflow.idle()
  done = await workflow.get(p.id)
  assert.deepEqual(done.images.find(image => image.id === good.id).files, files)
  assert.equal(done.images.find(image => image.id === bad.id).generation.status, 'completed')
  const length = done.images.length, calls = done.calls.length
  await assert.rejects(workflow.generateViews(p.id, design.id, ['front', 'right'], 'not-enough-budget', done.request), /额度不足/)
  assert.equal((await workflow.get(p.id)).images.length, length); assert.equal((await workflow.get(p.id)).calls.length, calls)
  await workflow.updateBudget(p.id, 30)
  assert.equal((await workflow.get(p.id)).calls.length, calls, '调整上限不触发模型调用')
  await assert.rejects(workflow.updateBudget(p.id, 101), /100/)
  await workflow.generateViews(p.id, design.id, ['front'], 'after-budget-update', done.request); await workflow.idle()
  assert.equal((await workflow.get(p.id)).images.length, length + 1)
  assert.equal(counts.identity, 1)
})

test('设定卡分析中取消后不派发生图，显式继续可完成', async t => {
  let first = true, entered
  const started = new Promise(resolve => { entered = resolve })
  const { workflow, counts } = await setup(t, { identity: async () => { if (first) { first = false; entered(); return new Promise(() => {}) } return { summary: '已确认小猫', locks: ['红围巾'], unseen: [] } } })
  const p = await workflow.start(creationInput({ autoCheck: false }), undefined, { creativity: 'balanced' }); await workflow.idle()
  const master = (await workflow.get(p.id)).images[0]
  await workflow.confirmDesign(p.id, master.id, ''); await started
  await workflow.cancel(p.id); await workflow.idle()
  let done = await workflow.get(p.id)
  assert.equal(counts.generation, 3); assert.equal(done.finalDesigns[0].planning.status, 'cancelled')
  assert.ok(!productStages(done).some(stage => ['queued', 'running'].includes(stage.status)))
  await workflow.generateViews(p.id, done.finalDesigns[0].id, ['back'], 'continue-after-cancel', done.request); await workflow.idle()
  done = await workflow.get(p.id); assert.equal(done.images.find(image => image.kind === 'view').generation.status, 'completed')
})

test('重启时未派发的角度继续，但已经派发的角度不自动重发', async t => {
  const { workflow, root } = await setup(t)
  const p = await workflow.start(creationInput({ autoCheck: false }), undefined, { creativity: 'balanced' }); await workflow.idle()
  const master = (await workflow.get(p.id)).images[0]
  await workflow.confirmDesign(p.id, master.id, ''); await workflow.idle()
  let done = await workflow.get(p.id), design = done.finalDesigns[0]
  await workflow.generateViews(p.id, design.id, ['left', 'back'], 'recovery-views', done.request); await workflow.idle(); workflow.dispose()
  const file = path.join(root, p.id, 'product.json'), saved = JSON.parse(await readFile(file, 'utf8'))
  const views = saved.images.filter(image => image.kind === 'view')
  views[0].generation = { status: 'queued', attempts: 0 }; views[0].quality = { status: 'queued', attempts: 0 }; views[0].files = []; delete views[0].taskId
  views[1].generation.status = 'running'; views[1].files = []; views[1].quality.status = 'queued'
  await writeFile(file, JSON.stringify(saved))
  const restored = fixture(root); t.after(() => restored.workflow.dispose())
  await restored.workflow.ready; await restored.workflow.idle()
  done = await restored.workflow.get(p.id)
  assert.equal(restored.counts.generation, 1)
  assert.equal(done.images.find(image => image.id === views[0].id).generation.status, 'completed')
  assert.equal(done.images.find(image => image.id === views[1].id).generation.status, 'unknown')
  assert.equal(done.images.find(image => image.id === views[1].id).quality.status, 'skipped')
})

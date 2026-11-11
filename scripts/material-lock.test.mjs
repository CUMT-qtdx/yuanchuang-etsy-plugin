// 材质基准、原图局部传递和矛盾判定回归；模型使用隔离结果。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { normalizeMaterialAppearance, createEtsyModels, exportProduct, productStages } from '../.etsy-test/host.js'
import { fixture, input, pixel, facts, modelConfig, materialAppearance, materialComparison } from './etsy-fixture.mjs'
import { mockDesignImage } from './mock-design-image.mjs'
async function setup(t, options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'material-lock-')), f = fixture(root, options); await f.workflow.ready
  t.after(async () => { f.workflow.dispose(); await f.workflow.idle(); await rm(root, { recursive: true, force: true }) }); return { ...f, root }
}
async function prepare(f) {
  const p = await f.workflow.start(input({ count: 1, autoCheck: false, maxCalls: 100, copyTiming: 'selected' })); await f.workflow.idle()
  let product = await f.workflow.get(p.id); await f.workflow.confirmDesign(p.id, product.images[0].id, '保留主体'); await f.workflow.idle()
  product = await f.workflow.get(p.id); return { product, design: product.finalDesigns[0] }
}
const sampleInputs = () => materialAppearance.regions.map((_, index) => ({ index, dataUrl: `data:image/png;base64,${mockDesignImage(index).toString('base64')}`, width: 320, height: 320 }))
test('材质区域只接受可见局部和合法坐标，不把整图或背景当成已确认材质', () => {
  assert.deepEqual(normalizeMaterialAppearance(materialAppearance), materialAppearance)
  assert.equal(normalizeMaterialAppearance({ summary: '只说真实', regions: [{ label: '全图', box: [0, 0, 1000, 1000], appearance: '粗纤维' }] }), undefined)
  assert.equal(normalizeMaterialAppearance({ summary: '身体', regions: [{ label: '身体', box: [900, 700, 200, 150], appearance: '短纤维' }] }), undefined)
})
test('已有局部保留作检查和修复，首次侧背面只发送完整主图，AI通过图不传播', async t => {
  const f = await setup(t), { product, design } = await prepare(f), original = structuredClone(product.images[0])
  await f.workflow.prepareMaterial(product.id, design.id); await f.workflow.idle()
  assert.equal(f.counts.material ?? 0, 0)
  await assert.rejects(f.workflow.attachMaterialSamples(product.id, design.id, 'wrong-master', sampleInputs()), /不一致/)
  const attached = await f.workflow.attachMaterialSamples(product.id, design.id, design.imageId, sampleInputs())
  const reference = attached.finalDesigns[0].materialReference
  assert.equal(reference.samples.length, 2)
  for (let i = 0; i < 2; i++) assert.deepEqual((await f.workflow.store.readImage(product.id, reference.samples[i].file)).data, mockDesignImage(i))
  await f.workflow.generateViews(product.id, design.id, ['left', 'right', 'back'], 'material-references', product.request); await f.workflow.idle()
  let done = await f.workflow.get(product.id), views = done.images.filter(image => image.kind === 'view')
  for (const image of views) {
    const request = f.queue.get(image.taskId).request
    assert.equal(request.images.length, image.angle === 'back' ? 0 : 1); assert.equal(request.feltContext.multiView.references[0].role, 'identity-anchor')
    assert.match(request.prompt, /hero_surface_continuity_v1_0/)
    assert.doesNotMatch(request.prompt, /loofah-like pores|OBSERVED HERO SURFACES/)
  }
  assert.deepEqual(done.images[0], original)
  const originalView = structuredClone(views[0])
  await f.workflow.revise(product.id, '只恢复主图材质', product.request, originalView.id, true); await f.workflow.idle()
  done = await f.workflow.get(product.id); const repaired = done.images.at(-1), sent = f.queue.get(repaired.taskId).request
  assert.equal(repaired.materialRepair, true); assert.equal(repaired.parentImageId, originalView.id)
  assert.equal(sent.feltContext.multiView.references[3].role, 'angle-correction'); assert.equal(sent.images.length, 3)
  assert.match(sent.prompt, /MATERIAL-ONLY REPAIR/); assert.match(sent.prompt, /Do not turn the current angle back/)
  assert.deepEqual(JSON.parse(JSON.stringify(done.images.find(image => image.id === originalView.id))), JSON.parse(JSON.stringify(originalView)))
  const zip = await exportProduct(done, f.workflow.store)
  assert.ok(zip.includes(Buffer.from(reference.samples[0].file))); assert.ok(zip.includes(Buffer.from('approved_material_lock_v1_0')))
  const calls = done.calls.length; await f.workflow.prepareMaterial(product.id, design.id); await f.workflow.attachMaterialSamples(product.id, design.id, design.imageId, sampleInputs())
  assert.equal((await f.workflow.get(product.id)).calls.length, calls)
})
test('旧设定卡仅首次补一次材质分析，并发准备不重复计费，重开保留样本', async t => {
  const f = await setup(t, { identity: async () => ({ summary: '主设计', locks: ['帽子'], unseen: [] }) }), { product, design } = await prepare(f)
  await Promise.all([f.workflow.prepareMaterial(product.id, design.id), f.workflow.prepareMaterial(product.id, design.id)]); await f.workflow.idle()
  assert.equal(f.counts.material, 1); assert.equal((await f.workflow.get(product.id)).calls.filter(call => call.stage === 'material').length, 1)
  await f.workflow.attachMaterialSamples(product.id, design.id, design.imageId, sampleInputs()); await f.workflow.idle(); f.workflow.dispose()
  const file = path.join(f.root, product.id, 'product.json'), bytes = await readFile(file), restored = fixture(f.root)
  t.after(() => restored.workflow.dispose()); await restored.workflow.ready; await restored.workflow.idle()
  assert.deepEqual(await readFile(file), bytes); assert.equal(restored.counts.material ?? 0, 0)
})
test('材质分析失败不触发生图、不无限重试，取消保留原图且清理在途状态', async t => {
  const f = await setup(t, { identity: async () => ({ summary: '主设计', locks: ['帽子'], unseen: [] }), material: async () => { throw new Error('模拟材质识别失败') } }), { product, design } = await prepare(f)
  await f.workflow.prepareMaterial(product.id, design.id); await f.workflow.idle()
  const failed = await f.workflow.get(product.id)
  assert.equal(failed.finalDesigns[0].materialPlanning.status, 'failed'); assert.equal(f.counts.generation, 1); assert.equal(f.counts.material, 1)
  await f.workflow.cancel(product.id); assert.ok(!productStages(await f.workflow.get(product.id)).some(stage => ['running', 'queued'].includes(stage.status)))
})
test('材质检测缺证据不能PASS，问题列表矛盾和任一DRIFT均强制降为需修正', async () => {
  const viewChecks = Object.fromEntries(['identity', 'composition', 'material', 'accessories', 'photography'].map(key => [key, { status: 'PASS', evidence: '相似' }]))
  const multiView = { anchor: {}, identity: {}, references: [], angle: 'back' }
  const args = [modelConfig, facts, `data:image/png;base64,${pixel}`, [`data:image/png;base64,${pixel}`], [], new AbortController().signal, { multiView }]
  let raw = { status: 'PASS', summary: '均通过', issues: [], uncertainties: [], viewChecks }
  const model = createEtsyModels(async () => JSON.stringify(raw))
  let result = await model.vision(...args); assert.equal(result.status, 'UNKNOWN'); assert.equal(result.viewChecks.material.status, 'UNKNOWN')
  raw = { ...raw, materialComparison: materialComparison() }; result = await model.vision(...args); assert.equal(result.status, 'PASS')
  raw.materialComparison.surface = { status: 'DRIFT', evidence: '主图细短，待检图卷曲网状' }; result = await model.vision(...args); assert.equal(result.status, 'REVISE'); assert.equal(result.viewChecks.material.status, 'REVISE')
  raw.materialComparison = materialComparison(); raw.issues = [{ area: 'material', problem: '帽边粗化', evidence: '粗线圈', suggestion: '恢复主图' }]
  result = await model.vision(...args); assert.equal(result.viewChecks.material.status, 'REVISE')
})

// 首次角度直接生成的回归：模型分工与参考来源必须从工作流入口到运行时保持一致。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { chooseSurfaceModel, composeFeltPrompt, ImageGenerationRuntime } from '../.etsy-test/host.js'
import { fixture, input, pixel } from './etsy-fixture.mjs'
async function setup(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'first-pass-material-')), f = fixture(root)
  await f.workflow.ready; t.after(async () => { f.workflow.dispose(); await f.workflow.idle(); await rm(root, { recursive: true, force: true }) })
  const created = await f.workflow.start(input({ count: 1, maxCalls: 100, autoCheck: false, copyTiming: 'selected', generation: { ...input().generation, model: 'gpt-image-2.5-flare', channelId: 'gpt' } }))
  await f.workflow.idle(); const product = await f.workflow.get(created.id)
  await f.workflow.confirmDesign(product.id, product.images[0].id, '帽檐保留三条线'); await f.workflow.idle()
  const final = await f.workflow.get(product.id)
  return { ...f, product: final, design: final.finalDesigns[0] }
}
test('侧背面默认跟随当前GPT，尊重明确保存的选择，不自动预选Grok', () => {
  const groups = [{ id: 'gpt', name: '主图', models: ['gpt-image-2.5-flare'] }, { id: 'grok', name: '现有渠道', models: ['grok-imagine-image-2.0'] }]
  const current = { channelId: 'gpt', model: 'gpt-image-2.5-flare' }
  assert.deepEqual(chooseSurfaceModel(groups, current), current)
  assert.deepEqual(chooseSurfaceModel(groups, current, current), current)
  assert.deepEqual(chooseSurfaceModel(groups.slice(0, 1), current), current)
  assert.deepEqual(chooseSurfaceModel(groups, {channelId:'removed',model:'old'}, undefined, current), current, '请求缓存无效时跟随目录中的当前GPT，不能只在下拉框显示GPT')
})
test('一次多角度的侧背面用独立模型和单主图，斜侧面不改变；每角度仅一次生图', async t => {
  const { workflow, queue, counts, product, design } = await setup(t)
  const sideRequest = { ...product.request, channelId: 'grok', model: 'grok-imagine-image-2.0', upstream: 'grok-imagine-image-2.0' }
  await workflow.generateViews(product.id, design.id, ['left', 'right', 'back', 'three-quarter'], 'first-pass-model-route', product.request, false, sideRequest)
  await workflow.idle(); const done = await workflow.get(product.id), views = done.images.filter(image => image.kind === 'view')
  assert.equal(counts.generation, 5); assert.equal(counts.quality, 4)
  assert.deepEqual(done.images[0], product.images[0]); assert.equal(done.request.model, 'gpt-image-2.5-flare')
  assert.equal(done.finalDesigns[0].sideBackModel.channelId, 'grok')
  for (const view of views) {
    const request = queue.get(view.taskId).request
    if (view.angle === 'three-quarter') { assert.equal(request.model, product.request.model); assert.equal(view.visualRules.modules.approved_material_lock_v1_0, '1.0') }
    else {
      assert.equal(request.model, sideRequest.model); assert.equal(request.images.length, view.angle === 'back' ? 0 : 1)
      assert.equal(view.visualRules.modules.hero_surface_continuity_v1_0, '1.0'); assert.equal(request.feltContext.multiView.references[0].id, design.imageId)
      assert.match(request.prompt, /帽檐保留三条线/); assert.doesNotMatch(request.prompt, /OBSERVED HERO SURFACES|loofah|material-detail/)
      assert.ok(request.prompt.length < 4500, '朝向约束仍保持有限长度，不堆入整个设定卡或材质词库')
    }
  }
})
test('重做侧面从主图直出，只修材质仍使用原角度作为父图和后备流程', async t => {
  const { workflow, queue, product, design } = await setup(t)
  await workflow.generateViews(product.id, design.id, ['left'], 'first-pass-redo-seed', product.request); await workflow.idle()
  let done = await workflow.get(product.id); const view = done.images.at(-1)
  await workflow.revise(product.id, '按主图重新拍这个侧面', { ...product.request, model: 'grok-imagine-image-2.0', channelId: 'grok' }, view.id, false, true); await workflow.idle()
  done = await workflow.get(product.id); const redo = done.images.at(-1), req = queue.get(redo.taskId).request
  assert.equal(redo.parentImageId, view.id); assert.equal(req.images.length, 1); assert.equal(redo.viewRestart, true)
  assert.equal(redo.visualRules.modules.hero_surface_continuity_v1_0, '1.0')
  assert.deepEqual(done.finalDesigns[0].sideBackModel, { model: 'grok-imagine-image-2.0', channelId: 'grok' })
  await workflow.revise(product.id, '只恢复主图材质', product.request, redo.id, true); await workflow.idle()
  done = await workflow.get(product.id); const repair = done.images.at(-1), sent = queue.get(repair.taskId).request
  assert.equal(repair.parentImageId, redo.id); assert.equal(repair.materialRepair, true)
  assert.match(sent.prompt, /MATERIAL-ONLY REPAIR/); assert.equal(sent.feltContext.multiView.references[1].id, redo.id)
})
test('运行时不会把首次直出重新拼回旧材质词或丢失手动设定卡', async t => {
  const { workflow, queue, product, design } = await setup(t)
  await workflow.editIdentity(product.id, design.id, { summary: design.spec.summary, locks: ['左手不持物', '帽子三条线'], unseen: ['背面未知'] }, 1)
  await workflow.generateViews(product.id, design.id, ['back'], 'first-pass-runtime', product.request); await workflow.idle()
  const view = (await workflow.get(product.id)).images.at(-1), request = queue.get(view.taskId).request, wire = []
  const runtime = new ImageGenerationRuntime(() => ({ defaultChannelId: 'gpt', channels: [{ id: 'gpt', name: 'mock', apiKey: '', apiUrl: '', apiUrlFull: false, preset: '', auth: 'subscription', subscription: 'grok-sub', models: [{ alias: request.model, id: 'grok-imagine-image-2.0' }] }] }), { append: async () => [] }, { generate: async value => { wire.push(value); return [{ b64_json: pixel }] } })
  const result = await runtime.run(request)
  assert.equal(result.visualRules.modules.hero_surface_continuity_v1_0, '1.0')
  assert.match(wire[0].prompt, /帽子三条线/); assert.equal(wire[0].referenceImages.length, 1)
  assert.equal(wire[0].prompt, result.visualRules.prompt)
  assert.doesNotMatch(wire[0].prompt, /OBSERVED IDENTITY CARD|OBSERVED HERO SURFACES/)
})

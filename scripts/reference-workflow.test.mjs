import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fixture, input, facts, pixel } from './etsy-fixture.mjs'
import { EtsyStore, validateReferencePlan, selectedCopy, exportProduct, productStages } from '../.etsy-test/host.js'

async function setup(t, options) {
  const root = await mkdtemp(path.join(tmpdir(), 'reference-flow-'))
  const f = fixture(root, options); await f.workflow.ready
  t.after(async () => { f.workflow.dispose(); await f.workflow.idle(); await rm(root, { recursive: true, force: true }) })
  return { ...f, root }
}
const referenceInput = overrides => input({ count: 4, generation: { ...input().generation, prompt: '' }, ...overrides })
test('空提示词参考图：四张图分别自动准备文案，重复完成事件不重复计费', async t => {
  const { workflow, counts, queue, root } = await setup(t)
  const request = referenceInput()
  const created = await workflow.start(request, undefined, { creativity: 'balanced' })
  await workflow.idle()
  const product = await workflow.get(created.id)
  assert.equal(product.planning.status, 'completed'); assert.equal(product.referencePlan.plans.length, 4)
  assert.deepEqual(counts, { generation: 4, quality: 4, copy: 4, planning: 1 })
  assert.equal(Object.keys(product.imageCopies).length, 4)
  assert.ok(product.images.every(image => image.copyStage.status === 'completed'))
  assert.deepEqual(new Set(product.calls.filter(call => call.stage === 'copy').map(call => call.target)), new Set(product.images.map(image => image.id)))
  assert.equal(new Set(queue.list().map(task => task.request.prompt)).size, 4)
  assert.ok(queue.list().every(task => task.request.mode === 'edit' && task.request.image.startsWith('data:image/png;')))
  assert.ok(queue.list().every(task => task.request.model === 'mock-image'), '文字规划模型不能替换生图模型')
  assert.equal(product.referenceFiles.length, 1); assert.equal(product.copyImageId, product.selectedImageId)
  const cached = await new EtsyStore(root).load(); assert.equal(cached[0].referencePlan.plans.length, 4)
  await workflow.start(request, undefined, { creativity: 'balanced' }); await workflow.idle()
  assert.equal(counts.planning, 1); assert.equal(counts.generation, 4)
  assert.equal(counts.copy, 4)
  const zip = await exportProduct(product, new EtsyStore(root))
  assert.ok(product.images.every(image => zip.includes(Buffer.from(`listings/${image.id}.txt`))))
})
test('四份文案提前完成，快速切图只读缓存，后台并发保持上限', async t => {
  let active = 0, maxActive = 0
  const seen = []
  const { workflow, counts } = await setup(t, { copy: async (config, f, signal, context) => {
    active++; maxActive = Math.max(maxActive, active); seen.push(context?.imageId)
    await new Promise(resolve => setTimeout(resolve, 30)); active--
    return { titles: [], description: 'mock selected copy', tags: [], factsUsed: {}, humanConfirmation: [], attributes: {}, sellingPoints: [], deliveryNotes: '', selectedTitle: 0, reviewRequired: true }
  } })
  const initial = await workflow.start(referenceInput(), undefined, { creativity: 'balanced' }); await workflow.idle()
  let product = await workflow.get(initial.id)
  const first = product.images.find(image => image.id === product.selectedImageId), others = product.images.filter(image => image.id !== first.id)
  await workflow.selectImage(product.id, others[0].id); await workflow.idle()
  assert.equal((await workflow.get(product.id)).copyImageId, others[0].id)
  const before = counts.copy
  await workflow.selectImage(product.id, first.id); await workflow.idle(); assert.equal(counts.copy, before)
  await Promise.all([workflow.selectImage(product.id, others[1].id), workflow.selectImage(product.id, others[2].id)])
  await workflow.idle(); product = await workflow.get(product.id)
  assert.equal(product.copyImageId, others[2].id); assert.ok(maxActive <= 3 && maxActive > 1)
  assert.equal(counts.copy, 4); assert.equal(new Set(seen).size, 4)
})
test('自然语言修改为新图准备独立文案，原图及人工稿保留且有最新修改上下文', async t => {
  const contexts = []
  const { workflow, queue, counts } = await setup(t, { copy: async (config, f, signal, context) => {
    contexts.push(context)
    return { titles: [], description: context?.editInstruction ? 'Updated blue scarf design' : context?.imageId || 'original', tags: [], factsUsed: {}, humanConfirmation: [], attributes: {}, sellingPoints: [], deliveryNotes: '', selectedTitle: 0, reviewRequired: true }
  } })
  const initial = await workflow.start(referenceInput(), undefined, { creativity: 'bold' }); await workflow.idle()
  const before = await workflow.get(initial.id), parent = before.images.find(image => image.id === before.selectedImageId)
  const originalCopy = structuredClone(before.imageCopies[parent.id])
  await workflow.revise(before.id, '围巾改成蓝色', before.request); await workflow.idle()
  const after = await workflow.get(before.id), child = after.images.find(image => image.parentImageId === parent.id)
  assert.equal(after.images.length, 5); assert.equal(child.version, 2)
  assert.equal(after.selectedImageId, child.id); assert.equal(after.copyImageId, child.id)
  assert.equal(after.pendingSelection, undefined); assert.ok(after.images.find(image => image.id === parent.id).files.length)
  assert.equal(counts.copy, 5)
  assert.equal(after.copy.description, 'Updated blue scarf design')
  assert.deepEqual(after.imageCopies[parent.id], originalCopy)
  assert.equal(contexts.find(context => context.imageId === child.id).parentImageId, parent.id)
  const request = queue.get(child.taskId).request
  assert.match(request.prompt, /围巾改成蓝色/); assert.equal(request.mode, 'edit'); assert.equal(request.images.length, 1)
})
test('切到正在准备或失败的图片立即清空旧稿，乱序完成不覆盖当前选择', async t => {
  const gates = new Map(), seen = []
  const { workflow, counts } = await setup(t, { copy: async (config, facts, signal, context) => {
    seen.push(context.imageId)
    return new Promise((resolve, reject) => gates.set(context.imageId, { resolve: () => resolve({ titles: [], description: context.imageId, tags: [], factsUsed: {}, humanConfirmation: [], attributes: {}, sellingPoints: [], deliveryNotes: '', selectedTitle: 0, reviewRequired: true }), reject }))
  } })
  const created = await workflow.start(referenceInput(), undefined, { creativity: 'balanced' })
  for (let i = 0; i < 150 && gates.size < 2; i++) await new Promise(resolve => setTimeout(resolve, 5))
  const [first, second] = [...gates.keys()]
  await workflow.selectImage(created.id, second)
  assert.equal(selectedCopy(await workflow.get(created.id)), undefined)
  gates.get(first).resolve()
  await new Promise(resolve => setTimeout(resolve, 25))
  assert.equal((await workflow.get(created.id)).copy, undefined)
  gates.get(second).reject(new Error('mock unconfirmed materials'))
  for (let i = 0; i < 150 && gates.size < 4; i++) await new Promise(resolve => setTimeout(resolve, 5))
  for (const [id, gate] of gates) if (![first, second].includes(id)) gate.resolve()
  await workflow.idle()
  const failed = await workflow.get(created.id)
  assert.equal(failed.copyStage.status, 'failed'); assert.equal(failed.copy, undefined)
  assert.equal(Object.keys(failed.imageCopies).length, 3)
  const beforeCalls = counts.copy
  await workflow.selectImage(created.id, first)
  assert.equal((await workflow.get(created.id)).copy.description, first)
  await workflow.selectImage(created.id, second); await workflow.idle()
  assert.equal((await workflow.get(created.id)).copy, undefined)
  assert.equal(counts.copy, beforeCalls, '点击失败图片不能自动重复收费')
})
test('逐图文案失败可单独重试，严格遵守每张图重试次数与总调用上限', async t => {
  const { workflow, counts } = await setup(t, { copy: async () => { throw new Error('copy failed') } })
  const created = await workflow.start(referenceInput({ autoCheck: false, maxCalls: 11 }), undefined, { creativity: 'balanced' }); await workflow.idle()
  let p = await workflow.get(created.id)
  assert.equal(p.calls.length, 9)
  const id = p.images[0].id
  await workflow.selectImage(p.id, id)
  await workflow.retry(p.id, 'copy', id); await workflow.idle()
  await workflow.retry(p.id, 'copy', id); await workflow.idle()
  p = await workflow.get(p.id)
  assert.equal(p.images[0].copyStage.attempts, 3)
  assert.equal(p.calls.length, 11); assert.equal(counts.copy, 6)
  await assert.rejects(workflow.retry(p.id, 'copy', id), /耗尽/)
})
test('重开后逐图结果恢复，不重发已完成及结果不明的文案任务', async t => {
  const { workflow, root } = await setup(t)
  const created = await workflow.start(referenceInput(), undefined, { creativity: 'balanced' }); await workflow.idle()
  const p = await workflow.get(created.id), uncertain = p.images[1]
  uncertain.copyStage.status = 'running'; delete p.imageCopies[uncertain.id]
  p.calls.find(call => call.stage === 'copy' && call.target === uncertain.id).status = 'running'
  await writeFile(path.join(root, p.id, 'product.json'), JSON.stringify(p))
  workflow.dispose()
  const recovered = fixture(root); await recovered.workflow.ready; await recovered.workflow.idle()
  const restored = await recovered.workflow.get(p.id)
  assert.equal(restored.images[1].copyStage.status, 'unknown')
  assert.equal(Object.keys(restored.imageCopies).length, 3)
  await recovered.workflow.selectImage(p.id, uncertain.id)
  assert.equal((await recovered.workflow.get(p.id)).copy, undefined)
  assert.deepEqual(recovered.counts, { generation: 0, quality: 0, copy: 0 })
  recovered.workflow.dispose()
})
test('历史旧项目不会在升级时自动补跑，显式补齐后切图直接读取', async t => {
  const { workflow, root } = await setup(t)
  const created = await workflow.start(referenceInput(), undefined, { creativity: 'balanced' }); await workflow.idle()
  const saved = await workflow.get(created.id), current = saved.selectedImageId
  delete saved.copyMode
  saved.imageCopies = { [current]: saved.imageCopies[current] }
  saved.images.forEach(image => { delete image.copyStage; delete image.copyFactsRevision })
  await writeFile(path.join(root, saved.id, 'product.json'), JSON.stringify(saved))
  workflow.dispose()
  const recovered = fixture(root); await recovered.workflow.ready; await recovered.workflow.idle()
  assert.equal(recovered.counts.copy, 0)
  await recovered.workflow.prepareCopies(saved.id); await recovered.workflow.idle()
  assert.equal(recovered.counts.copy, 3)
  assert.equal(Object.keys((await recovered.workflow.get(saved.id)).imageCopies).length, 4)
  for (const image of saved.images) await recovered.workflow.selectImage(saved.id, image.id)
  assert.equal(recovered.counts.copy, 3)
  recovered.workflow.dispose()
})
test('首图的文案在其余图片仍生成时开始，图文阶段并行推进', async t => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const { workflow, counts } = await setup(t, { generate: async (request, index) => { if (index > 1) await gate; return { images: [{ b64: pixel, mime: 'image/png' }] } } })
  const created = await workflow.start(referenceInput(), undefined, { creativity: 'balanced' })
  for (let i = 0; i < 150 && counts.copy === 0; i++) await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(counts.copy, 1)
  assert.ok((await workflow.get(created.id)).images.some(image => image.generation.status === 'running'))
  release(); await workflow.idle()
  assert.equal(counts.copy, 4)
})
test('人工编辑稿按图片保留，商品资料更新后旧缓存失效并独立重备四份', async t => {
  const { workflow, counts } = await setup(t)
  const created = await workflow.start(referenceInput(), undefined, { creativity: 'balanced' }); await workflow.idle()
  let product = await workflow.get(created.id)
  const first = product.selectedImageId, second = product.images.find(image => image.id !== first).id
  const titles = product.copy.titles.map((title, index) => index === 0 ? { ...title, title: 'Employee Selected Cat Design' } : title)
  await workflow.editCopy(product.id, { titles }, product.revision, { imageId: first, baseCopy: JSON.stringify(product.imageCopies[first].copy), factsRevision: product.factsRevision ?? 1 })
  await workflow.selectImage(product.id, second); await workflow.selectImage(product.id, first)
  product = await workflow.get(product.id)
  assert.equal(product.copy.titles[0].title, 'Employee Selected Cat Design')
  assert.equal(counts.copy, 4)
  const edited = await workflow.editFacts(product.id, { ...product.facts, name: 'Updated cat concept' }, product.revision)
  assert.equal(selectedCopy(edited), undefined)
  await workflow.idle(); product = await workflow.get(product.id)
  assert.equal(counts.copy, 8)
  assert.ok(product.images.every(image => product.imageCopies[image.id].factsRevision === 2))
  assert.ok(product.images.some(image => image.copyVersions?.some(copy => copy.titles[0].title === 'Employee Selected Cat Design')))
})
test('文案并行请求可以取消，取消后未派发图片文案不再收费', async t => {
  const { workflow, counts } = await setup(t, { copy: async () => new Promise(() => {}) })
  const created = await workflow.start(referenceInput(), undefined, { creativity: 'balanced' })
  for (let i = 0; i < 150 && counts.copy < 2; i++) await new Promise(resolve => setTimeout(resolve, 5))
  await workflow.cancel(created.id); const callsAtCancel = counts.copy; await workflow.idle()
  const product = await workflow.get(created.id)
  assert.ok(product.images.every(image => !['queued', 'running'].includes(image.copyStage.status)))
  assert.equal(counts.copy, callsAtCancel)
  assert.equal(selectedCopy(product), undefined)
})
test('分析失败不生成占位图、不调用文案', async t => {
  const { workflow, counts } = await setup(t, { plan: async () => { throw new Error('mock analysis failed') } })
  const created = await workflow.start(referenceInput(), undefined, { creativity: 'balanced' }); await workflow.idle()
  const product = await workflow.get(created.id)
  assert.equal(product.planning.status, 'failed'); assert.equal(counts.generation, 0); assert.equal(counts.copy, 0)
  assert.ok(product.images.every(image => image.generation.status === 'skipped'))
  assert.ok(!productStages(product).some(stage => ['queued', 'running'].includes(stage.status)))
})
test('缺少分析配置时逐图文案明确跳过，仍允许配置模型或删除项目', async t => {
  const { workflow, counts } = await setup(t, { models: { vision: { model: '', apiUrl: '', apiKey: '' }, copy: { model: '', apiUrl: '', apiKey: '' } } })
  const created = await workflow.start(referenceInput(), undefined, { creativity: 'balanced' }); await workflow.idle()
  const product = await workflow.get(created.id)
  assert.ok(!productStages(product).some(stage => ['queued', 'running'].includes(stage.status)))
  let changed = false
  await workflow.configureModels(async () => { changed = true })
  assert.equal(changed, true)
  await workflow.remove(product.id)
  assert.equal(counts.copy, 0)
})
test('分析过程中取消，不继续派发 GPT 生图和文案', async t => {
  let started
  const entered = new Promise(resolve => { started = resolve })
  const { workflow, counts } = await setup(t, { plan: async () => { started(); return new Promise(() => {}) } })
  const created = await workflow.start(referenceInput(), undefined, { creativity: 'balanced' })
  await entered; await workflow.cancel(created.id); await workflow.idle()
  const product = await workflow.get(created.id)
  assert.equal(product.planning.status, 'cancelled'); assert.equal(product.copyStage.status, 'cancelled')
  assert.equal(counts.generation, 0); assert.equal(counts.copy, 0)
})
test('参考图流程也严格使用同一个调用账本，预算用完不额外分析或文案', async t => {
  const { workflow, counts } = await setup(t)
  const created = await workflow.start(referenceInput({ maxCalls: 5 }), undefined, { creativity: 'balanced' })
  await workflow.idle(); const product = await workflow.get(created.id)
  assert.equal(product.calls.length, 5)
  assert.deepEqual(counts, { generation: 4, quality: 0, copy: 0, planning: 1 })
  assert.match(product.copyStage.error, /上限/)
})
test('分析结构必须四方向，不能把同一提示词复制四次', () => {
  assert.throws(() => validateReferencePlan({ plans: [] }), /四个/)
  assert.throws(() => validateReferencePlan({ plans: Array.from({ length: 4 }, () => ({ name: '重复', direction: '重复', changes: ['变色'], prompt: 'same prompt repeated with enough letters to pass length check' })) }), /不同/)
})

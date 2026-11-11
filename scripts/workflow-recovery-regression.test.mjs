import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { makeEtsyRoutes, validateCopy } from '../.etsy-test/host.js'
import { fixture, input, pixel, copyValue } from './etsy-fixture.mjs'

async function setup(t, options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'etsy-recovery-regression-'))
  const f = fixture(root, options)
  await f.workflow.ready
  t.after(async () => { f.workflow.dispose(); await f.workflow.idle(); await rm(root, { recursive: true, force: true }) })
  return { ...f, root }
}
const binding = (product, imageId) => ({ imageId, factsRevision: product.factsRevision ?? 1, baseCopy: JSON.stringify(product.imageCopies[imageId].copy) })

test('跨窗口保存绑定原图，另一个窗口切图不改写其他图片', async t => {
  const { workflow } = await setup(t)
  const initial = await workflow.start(input({ count: 4 }), undefined, { creativity: 'balanced' })
  await workflow.idle()
  const before = await workflow.get(initial.id), [a, b] = before.images
  const previousB = structuredClone(before.imageCopies[b.id])
  const bound = binding(before, a.id)
  await workflow.selectImage(before.id, b.id)
  const result = await workflow.editCopy(before.id, { description: 'A cheerful cat with a bright red scarf.' }, before.revision, bound)
  assert.deepEqual(result.imageCopies[b.id], previousB)
  assert.match(result.imageCopies[a.id].copy.description, /bright red scarf/)
  assert.equal(result.selectedImageId, b.id)
  assert.deepEqual(result.copy, previousB.copy)
  await assert.rejects(workflow.editCopy(before.id, { description: 'A stale cat description.' }, result.revision, bound), /已更新|冲突/)
  await assert.rejects(workflow.editCopy(before.id, { description: 'An unbound cat description.' }, result.revision), /图片|绑定/)
})

test('文案启动时写盘失败会退出 running，显式重试可以完成', async t => {
  const { workflow, counts } = await setup(t)
  const save = workflow.store.save.bind(workflow.store)
  let inject = true
  workflow.store.save = async product => {
    if (inject && product.calls.some(call => call.stage === 'copy' && call.status === 'running')) {
      inject = false; throw new Error('测试注入：ENOSPC')
    }
    return save(product)
  }
  const p = await workflow.start(input({ count: 1, autoCheck: false }))
  await workflow.idle()
  const failed = await workflow.get(p.id)
  assert.equal(counts.copy, 0)
  assert.equal(failed.copyStage.status, 'failed')
  assert.ok(failed.calls.every(call => call.status !== 'running'))
  await workflow.configureModels(async () => {})
  await workflow.retry(p.id, 'copy'); await workflow.idle()
  assert.equal((await workflow.get(p.id)).copyStage.status, 'completed')
})

test('图片归档失败收敛后续阶段，单图重试保留其他成功结果', async t => {
  const { workflow, counts } = await setup(t, { generate: async (_, index) => ({ images: [{ mime: 'image/png', b64: index === 1 ? Buffer.from('invalid').toString('base64') : pixel }] }) })
  const p = await workflow.start(input({ count: 2, autoCheck: false }))
  await workflow.idle()
  const failed = await workflow.get(p.id), bad = failed.images.find(i => i.generation.status === 'failed')
  assert.equal(bad.quality.status, 'skipped')
  const successful = failed.images.find(i => i.generation.status === 'completed')
  const savedFiles = structuredClone(successful.files)
  await workflow.configureModels(async () => {})
  await workflow.retry(p.id, 'generation', bad.id); await workflow.idle()
  const final = await workflow.get(p.id)
  assert.equal(final.images.find(i => i.id === bad.id).generation.status, 'completed')
  assert.equal(final.images.find(i => i.id === bad.id).generation.attempts, 2)
  assert.deepEqual(final.images.find(i => i.id === successful.id).files, savedFiles)
  assert.equal(counts.generation, 3)
})

test('生图中断恢复没有假排队，结果不明必须显式确认再重试', async t => {
  const { workflow, root } = await setup(t)
  const p = await workflow.start(input({ count: 1, autoCheck: false }))
  await workflow.idle(); workflow.dispose()
  const file = path.join(root, p.id, 'product.json'), saved = JSON.parse(await readFile(file, 'utf8'))
  saved.images[0].generation.status = 'running'; saved.images[0].quality.status = 'queued'; saved.images[0].files = []
  saved.copyStage.status = 'queued'; delete saved.copy; delete saved.imageCopies; delete saved.selectedImageId
  saved.calls.find(c => c.stage === 'generation').status = 'running'
  await writeFile(file, JSON.stringify(saved))
  const recovery = fixture(root); t.after(() => recovery.workflow.dispose())
  await recovery.workflow.ready; await recovery.workflow.idle()
  const restored = await recovery.workflow.get(p.id)
  assert.equal(restored.images[0].generation.status, 'unknown')
  assert.equal(restored.images[0].quality.status, 'skipped')
  await recovery.workflow.configureModels(async () => {})
  await assert.rejects(recovery.workflow.retry(p.id, 'generation', restored.images[0].id), /确认|核对/)
  assert.equal(recovery.counts.generation, 0)
  await recovery.workflow.retry(p.id, 'generation', restored.images[0].id, true)
  await recovery.workflow.idle()
  assert.equal(recovery.counts.generation, 1)
  assert.equal((await recovery.workflow.get(p.id)).images[0].generation.status, 'completed')
})

test('停止后可浏览成功图片、保存资料，并显式继续准备文案', async t => {
  const { workflow, counts } = await setup(t)
  const p = await workflow.start(input({ count: 4, autoCheck: false }), undefined, { creativity: 'balanced' })
  await workflow.idle()
  const stopped = await workflow.cancel(p.id), beforeCalls = stopped.calls.length
  const selected = await workflow.selectImage(p.id, stopped.images[1].id)
  assert.equal(selected.selectedImageId, stopped.images[1].id)
  const edited = await workflow.editFacts(p.id, { ...selected.facts, name: 'Updated cat name' }, selected.revision)
  await workflow.idle()
  assert.ok(edited.images.every(image => image.copyStage.status !== 'queued' && image.copyStage.status !== 'running'))
  await workflow.configureModels(async () => {})
  await workflow.retry(p.id, 'copy', edited.images[1].id)
  await workflow.idle()
  const done = await workflow.get(p.id)
  assert.equal(done.images[1].copyStage.status, 'completed')
  assert.equal(done.calls.length, beforeCalls + 1)
  assert.equal(counts.copy, 5)
})

test('停止后显式改图保留累计调用账本，额度不足不新增空白版本', async t => {
  const { workflow } = await setup(t)
  const p = await workflow.start(input({ count: 4, autoCheck: false }), undefined, { creativity: 'balanced' })
  await workflow.idle()
  const stopped = await workflow.cancel(p.id)
  await workflow.revise(p.id, 'Change the scarf to blue', input().generation)
  await workflow.idle()
  const done = await workflow.get(p.id)
  assert.equal(done.images.length, stopped.images.length + 1)
  assert.ok(done.calls.length > stopped.calls.length)
  assert.deepEqual(done.calls.slice(0, stopped.calls.length), stopped.calls)
})

test('改图显式绑定父图，其他窗口切图不改变修改目标', async t => {
  const { workflow } = await setup(t)
  const p = await workflow.start(input({ count: 4, autoCheck: false }), undefined, { creativity: 'balanced' })
  await workflow.idle()
  const before = await workflow.get(p.id), [a, b] = before.images
  await workflow.selectImage(p.id, b.id)
  const started = await workflow.revise(p.id, 'Change the scarf to blue', input().generation, a.id)
  const child = started.images.at(-1)
  assert.equal(child.parentImageId, a.id)
  await workflow.idle()
})

test('额度耗尽的改图请求不新增空白版本，不丢掉原图', async t => {
  const { workflow } = await setup(t)
  const p = await workflow.start(input({ count: 4, maxCalls: 9, autoCheck: false }), undefined, { creativity: 'balanced' })
  await workflow.idle()
  const before = await workflow.get(p.id)
  await assert.rejects(workflow.revise(p.id, 'Change the scarf to blue', input().generation), /额度/)
  const after = await workflow.get(p.id)
  assert.deepEqual(after.images, before.images)
  assert.equal(after.calls.length, before.calls.length)
})

test('规划启动写盘失败不留下排队图片或 running 调用', async t => {
  const { workflow, counts } = await setup(t)
  const save = workflow.store.save.bind(workflow.store)
  let inject = true
  workflow.store.save = async product => {
    if (inject && product.calls.some(call => call.stage === 'planning' && call.status === 'running')) { inject = false; throw new Error('测试注入：planning ENOSPC') }
    return save(product)
  }
  const p = await workflow.start(input({ count: 4, autoCheck: false }), undefined, { creativity: 'balanced' })
  await workflow.idle()
  const result = await workflow.get(p.id)
  assert.equal(result.planning.status, 'failed')
  assert.equal(counts.generation, 0)
  assert.ok(result.images.every(image => image.quality.status !== 'queued' && image.copyStage.status !== 'queued'))
  assert.ok(result.calls.every(call => call.status !== 'running'))
  await workflow.configureModels(async () => {})
})

test('部分文案补齐只替换坏字段，保留已合格正文和标题', async t => {
  let repair = false
  const { workflow } = await setup(t, { copy: async (_, facts) => {
    const value = copyValue(facts)
    if (!repair) value.titles[3].title = '纯中文坏标题'
    else value.description = 'A completely different replacement description.'
    return validateCopy(value, facts, { mode: 'generated' })
  } })
  const p = await workflow.start(input({ count: 4, autoCheck: false }), undefined, { creativity: 'balanced' })
  await workflow.idle()
  const before = await workflow.get(p.id), image = before.images[0], previous = before.imageCopies[image.id].copy
  assert.ok(previous.fieldIssues.some(issue => issue.field === 'titles.3'))
  repair = true; await workflow.retry(p.id, 'copy', image.id); await workflow.idle()
  const after = (await workflow.get(p.id)).imageCopies[image.id].copy
  assert.equal(after.description, previous.description)
  assert.deepEqual(after.titles[0], previous.titles[0])
  assert.ok(after.titles[3].title)
  assert.ok(!after.fieldIssues?.some(issue => issue.field === 'titles.3'))
})

test('真实 HTTP 导出绑定指定图片且不改共享选择，失败返回正常 JSON', async t => {
  const { workflow } = await setup(t)
  const p = await workflow.start(input({ count: 4, autoCheck: false }), undefined, { creativity: 'balanced' })
  await workflow.idle()
  let state = await workflow.get(p.id)
  const [a, b] = state.images
  await workflow.editCopy(p.id, { description: 'A bright red scarf cat chosen for export.' }, state.revision, binding(state, a.id))
  state = await workflow.get(p.id)
  await workflow.editCopy(p.id, { description: 'A blue scarf cat shown in the other window.' }, state.revision, binding(state, b.id))
  await workflow.selectImage(p.id, b.id)
  const routes = makeEtsyRoutes({ workflow, guard: () => true, parse: body => body, normalize: request => ({ ok: true, request }) })
  const errors = []
  const server = createServer(async (req, res) => {
    const route = routes.find(route => route.path === new URL(req.url, 'http://localhost').pathname)
    try { await route.handler(req, res) } catch (error) { errors.push(error.message); res.destroy() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}/api/dsh-imagegen/etsy`
  const response = await fetch(`${base}/export?id=${p.id}&imageId=${a.id}`)
  assert.equal(response.status, 200)
  const bytes = Buffer.from(await response.arrayBuffer()), entries = new Map()
  for (let offset = 0; bytes.readUInt32LE(offset) === 0x04034b50;) {
    const size = bytes.readUInt32LE(offset + 18), length = bytes.readUInt16LE(offset + 26), extra = bytes.readUInt16LE(offset + 28)
    const name = bytes.subarray(offset + 30, offset + 30 + length).toString('utf8'), start = offset + 30 + length + extra
    entries.set(name, bytes.subarray(start, start + size)); offset = start + size
  }
  assert.match(entries.get('listing.txt').toString('utf8'), /bright red scarf cat chosen for export/)
  assert.doesNotMatch(entries.get('listing.txt').toString('utf8'), /blue scarf cat/)
  assert.equal((await workflow.get(p.id)).selectedImageId, b.id)
  const failed = await fetch(`${base}/export?id=missing-project`)
  assert.equal(failed.status, 400)
  assert.equal((await failed.json()).ok, false)
  assert.deepEqual(errors, [])
})

test('文案编辑写盘失败仅回滚编辑字段，不断开另一张图的运行调用引用', async t => {
  let release, started
  const gate = new Promise(resolve => { release = resolve })
  const entered = new Promise(resolve => { started = resolve })
  const { workflow } = await setup(t, { copy: async (_, facts, __, context) => {
    if (context?.plan?.id === 'plan-2') { started(); await gate }
    return validateCopy(copyValue(facts), facts)
  } })
  const p = await workflow.start(input({ count: 4, autoCheck: false }), undefined, { creativity: 'balanced' })
  await entered
  let state
  for (let attempt = 0; attempt < 100; attempt++) {
    state = await workflow.get(p.id)
    if (state.images[0].copyStage.status === 'completed') break
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  const [a, b] = state.images
  assert.equal(a.copyStage.status, 'completed')
  assert.equal(b.copyStage.status, 'running')
  const originalCopy = structuredClone(state.imageCopies[a.id].copy)
  const save = workflow.store.save.bind(workflow.store)
  let inject = true
  workflow.store.save = async product => {
    if (inject && product.imageCopies?.[a.id]?.copy.description.includes('A newly edited bright cat')) { inject = false; throw new Error('测试注入：编辑保存失败') }
    return save(product)
  }
  try {
    await assert.rejects(workflow.editCopy(p.id, { description: 'A newly edited bright cat.' }, state.revision, binding(state, a.id)), /编辑保存失败/)
    assert.deepEqual((await workflow.get(p.id)).imageCopies[a.id].copy, originalCopy)
  } finally { release() }
  await workflow.idle()
  const done = await workflow.get(p.id)
  assert.equal(done.images[1].copyStage.status, 'completed')
  assert.equal(done.calls.findLast(call => call.stage === 'copy' && call.target === b.id).status, 'completed')
  assert.ok(done.calls.every(call => call.status !== 'running'))
})

test('重试失败图片使用当前明确选择的模型，同时保留原方案提示词', async t => {
  const requests = []
  const { workflow } = await setup(t, { generate: async (request, index) => {
    requests.push(request)
    if (index === 1) throw new Error('测试：第一张失败')
    return { images: [{ mime: 'image/png', b64: pixel }] }
  } })
  const p = await workflow.start(input({ count: 1, autoCheck: false }))
  await workflow.idle()
  const before = await workflow.get(p.id)
  await workflow.retry(p.id, 'generation', before.images[0].id, false, { ...input().generation, model: 'chosen-image-model', channelId: 'chosen-channel', prompt: '不应替换原方案', size: '1024x1024' })
  await workflow.idle()
  assert.equal(requests.at(-1).model, 'chosen-image-model')
  assert.equal(requests.at(-1).channelId, 'chosen-channel')
  assert.equal(requests.at(-1).feltContext.basePrompt, before.request.prompt)
  assert.match(requests.at(-1).prompt, /STUDIO_MATERIAL_V2/)
  assert.equal(requests.at(-1).size, '1024x1024')
})

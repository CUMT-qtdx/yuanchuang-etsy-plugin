// 复现并锁定真实队列与商品工作流的排队、执行、取消边界。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fixture, input, pixel } from './etsy-fixture.mjs'
import { imageGenerationBudgetMs } from '../src/engine.ts'
import { ImageGenerationRuntime } from '../.etsy-test/host.js'
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

async function setup(t, options) {
  const root = await mkdtemp(path.join(tmpdir(), 'etsy-budget-'))
  const f = fixture(root, options)
  await f.workflow.ready
  t.after(async () => { await f.workflow.idle(); f.workflow.dispose(); await rm(root, { recursive: true, force: true }) })
  return f
}

test('八张并发四张：每张执行两秒、预算三秒，后四张排队后仍全部完成', async t => {
  const f = await setup(t, { generationDelay: 1, generate: async () => { await wait(2000); return { images: [{ b64: pixel, mime: 'image/png' }] } } })
  const p = await f.workflow.start(input({ count: 8, autoCheck: false, timeoutMs: 1000 }))
  await f.workflow.idle()
  const product = await f.workflow.get(p.id)
  assert.deepEqual(product.images.map(i => i.generation.status), Array(8).fill('completed'))
  assert.equal(f.counts.generation, 8)
  const tasks = f.queue.list()
  assert.ok(tasks.some(task => task.startedAt - task.createdAt > 1500), '实际覆盖超过1.5秒的排队等待')
  for (const image of product.images) {
    assert.equal(image.generation.startedAt, f.queue.get(image.taskId).startedAt, '保存的是实际执行开始时间')
    assert.equal(image.files.length, 1)
  }
})

test('真正执行超过预算仍取消，不归档晚到结果，也不自动重发', async t => {
  let aborted = false, finished = false
  const f = await setup(t, { generate: async (_request, _index, signal) => {
    signal.addEventListener('abort', () => { aborted = true }, { once: true })
    await wait(3350); finished = true
    return { images: [{ b64: pixel, mime: 'image/png' }] }
  } })
  const p = await f.workflow.start(input({ count: 1, autoCheck: false, timeoutMs: 1000 }))
  await wait(3600); await f.workflow.idle()
  const image = (await f.workflow.get(p.id)).images[0]
  assert.equal(aborted, true); assert.equal(finished, true)
  assert.equal(image.generation.status, 'unknown'); assert.equal(image.files.length, 0)
  assert.match(image.generation.error, /不自动重发/)
  assert.equal(f.counts.generation, 1)
})

test('工作流使用实际适配器的更长预算，而不是提前按旧三秒预算取消', async t => {
  const f = await setup(t, { executionBudget: () => 4200, generate: async () => { await wait(3350); return { images: [{ b64: pixel, mime: 'image/png' }] } } })
  const p = await f.workflow.start(input({ count: 1, autoCheck: false, timeoutMs: 1000 }))
  await f.workflow.idle()
  assert.equal((await f.workflow.get(p.id)).images[0].generation.status, 'completed')
})

test('手工停止同时取消排队和运行中的任务，晚到结果不会改变停止状态', async t => {
  const f = await setup(t, { generate: async () => { await wait(120); return { images: [{ b64: pixel, mime: 'image/png' }] } } })
  const p = await f.workflow.start(input({ count: 8, autoCheck: false, timeoutMs: 1000 }))
  await f.workflow.cancel(p.id); await wait(160); await f.workflow.idle()
  const product = await f.workflow.get(p.id)
  assert.equal(product.cancelled, true)
  assert.ok(product.images.every(i => i.generation.status === 'cancelled' && i.files.length === 0))
  assert.equal(f.counts.generation, 4)
})

test('真实运行适配器按实际渠道提供覆盖请求与下载的预算', () => {
  const native = { id: 'native', apiUrl: 'https://native.mock', apiKey: 'mock', protocol: 'gemini-native', models: [] }
  const images = { id: 'images', apiUrl: 'https://images.mock/v1', apiKey: 'mock', protocol: 'images', models: [] }
  const runtime = new ImageGenerationRuntime(() => ({ channels: [images, native], defaultChannelId: 'images' }), { append: async () => [] })
  assert.equal(runtime.queue.executionBudgetMs({ channelId: 'native' }), 435000)
  assert.equal(runtime.queue.executionBudgetMs({ channelId: 'images' }), 555000)
  assert.equal(runtime.queue.executionBudgetMs({}), 555000)
  assert.equal(imageGenerationBudgetMs({ apiUrl: 'https://native.mock/v1beta/models/gemini-3.1-flash-image:generateContent', protocol: 'auto' }), 435000)
})

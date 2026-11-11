import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EtsyWorkflow, EtsyStore, GenerationTaskQueue, liveEtsyModels, makeRoutes, parseProductStart } from '../.etsy-test/host.js'
import { facts, input, copyValue, pixel, modelConfig } from './etsy-fixture.mjs'

test('生产模型适配器：真实 HTTP 传输形状、多图视觉和文案 JSON 校验（本地 Mock 服务）', async t => {
  const received = []
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    received.push({ path: req.url, authorization: req.headers.authorization, body })
    const vision = Array.isArray(body.messages[1].content)
    const result = vision ? { status: 'PASS', summary: '未发现明显异常', issues: [], uncertainties: [] } : copyValue()
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const root = await mkdtemp(path.join(tmpdir(), 'etsy-http-'))
  const config = { apiUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'private-http-key', model: 'test-chat-vision' }
  const queue = new GenerationTaskQueue(async () => ({ images: [{ b64: pixel, mime: 'image/png' }] }), 4)
  const workflow = new EtsyWorkflow({ queue, models: () => ({ vision: config, copy: config }), store: new EtsyStore(root), client: liveEtsyModels })
  t.after(async () => { workflow.dispose(); await workflow.idle(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) })
  const product = await workflow.start(input({ count: 1 }))
  await workflow.idle()
  const final = await workflow.get(product.id)
  assert.equal(final.images[0].quality.status, 'completed')
  assert.equal(final.copyStage.status, 'completed')
  assert.equal(received.length, 2)
  assert.ok(received.every(call => call.path === '/v1/chat/completions' && call.authorization === 'Bearer private-http-key'))
  const visual = received.find(call => Array.isArray(call.body.messages[1].content))
  assert.equal(visual.body.messages[1].content.filter(part => part.type === 'image_url').length, 2)
  assert.ok(!JSON.stringify(final).includes('private-http-key'))
})
test('路由拒绝坏参数，保留原有普通生图路由，并拦截图片路径越界', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'etsy-routes-'))
  const queue = new GenerationTaskQueue(async () => ({ images: [{ b64: pixel, mime: 'image/png' }] }))
  const workflow = new EtsyWorkflow({ queue, store: new EtsyStore(root), models: () => ({ vision: modelConfig, copy: modelConfig }) })
  await workflow.ready
  const routes = makeRoutes({ settings: { describe: () => [], mutate: async () => {} }, resolve: () => ({ apiUrl: '', apiKey: '' }), runtime: { queue }, etsy: workflow })
  assert.ok(routes.some(route => route.path === '/api/dsh-imagegen/tasks/submit'))
  assert.ok(routes.some(route => route.path === '/api/dsh-imagegen/etsy/start'))
  await assert.rejects(workflow.store.readImage('../', '../../.credentials.yaml'), /无效/)
  assert.throws(() => parseProductStart({ ...input(), count: 9 }, input().generation), /1 到 8/)
  assert.throws(() => parseProductStart({ ...input(), maxCalls: 0 }, input().generation), /调用上限/)
  assert.throws(() => parseProductStart({ ...input(), requestKey: '../../x' }, input().generation), /标识/)
  assert.throws(() => parseProductStart({ ...input(), facts: { ...facts, type: 'unknown' } }, input().generation), /商品类型/)
  workflow.dispose(); await rm(root, { recursive: true, force: true })
})

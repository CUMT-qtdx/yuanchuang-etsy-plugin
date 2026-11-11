import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fixture, input, pixel } from './etsy-fixture.mjs'
import { makeEtsyRoutes, etsyCall, EtsyRouteError, readLocalNames, writeLocalName, clearLocalName, withLocalName } from '../.etsy-test/host.js'

const setup = async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'etsy-rename-'))
  const f = fixture(root)
  await f.workflow.ready
  t.after(async () => { f.workflow.dispose(); await f.workflow.idle(); await rm(root, { recursive: true, force: true }) })
  return { ...f, root }
}

test('重命名只改显示名，不触碰资料、文案、图片与版本计数', async t => {
  const f = await setup(t)
  const created = await f.workflow.start(input({ count: 2 }))
  await f.workflow.idle()
  const before = await f.workflow.get(created.id)
  const counts = { ...f.counts }
  const renamed = await f.workflow.rename(created.id, '  蓝帽兔子 · 客户A  ')
  assert.equal(renamed.displayName, '蓝帽兔子 · 客户A')
  assert.equal(renamed.facts.name, before.facts.name, '商品资料名称不能被改名覆盖')
  assert.deepEqual(renamed.facts, before.facts)
  assert.equal(renamed.factsRevision, before.factsRevision, '不得递增资料版本，否则文案缓存失效')
  assert.equal(renamed.revision, before.revision, '改名不占用编辑版本号')
  assert.deepEqual(renamed.copyStage, before.copyStage)
  assert.deepEqual(renamed.copy, before.copy)
  assert.deepEqual(renamed.images, before.images)
  assert.deepEqual(f.counts, counts, '改名不得触发任何模型调用')
  assert.equal((await f.workflow.list())[0].displayName, '蓝帽兔子 · 客户A')
})

test('重命名持久化到磁盘，重新打开工作流仍然生效', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'etsy-rename-persist-'))
  const first = fixture(root); await first.workflow.ready
  const created = await first.workflow.start(input({ count: 1 }))
  await first.workflow.idle()
  await first.workflow.rename(created.id, '春季系列 01')
  first.workflow.dispose(); await first.workflow.idle()
  const second = fixture(root); await second.workflow.ready
  const loaded = await second.workflow.get(created.id)
  assert.equal(loaded.displayName, '春季系列 01')
  assert.equal(loaded.facts.name, created.facts.name)
  const disk = JSON.parse(await readFile(path.join(root, created.id, 'product.json'), 'utf8'))
  assert.equal(disk.displayName, '春季系列 01')
  second.workflow.dispose(); await second.workflow.idle()
  t.after(async () => rm(root, { recursive: true, force: true }))
})

test('重命名拒绝空名、超长名、控制字符和无效 ID', async t => {
  const f = await setup(t)
  const created = await f.workflow.start(input({ count: 1 }))
  await f.workflow.idle()
  await assert.rejects(f.workflow.rename(created.id, '   '), /请输入创作名称/)
  await assert.rejects(f.workflow.rename(created.id, '字'.repeat(81)), /80 字/)
  await assert.rejects(f.workflow.rename(created.id, 'abc\u0000def'), /控制字符/)
  await assert.rejects(f.workflow.rename('../escape', '正常名称'), /无效商品 ID/)
  await assert.rejects(f.workflow.rename('missing-id', '正常名称'), /找不到商品项目/)
  assert.equal((await f.workflow.get(created.id)).displayName, undefined, '失败时不写入任何字段')
})

test('HTTP 重命名动作可用，列表与导出快照包含显示名', async t => {
  const f = await setup(t)
  const routes = makeEtsyRoutes({ workflow: f.workflow, guard: () => true, parse: value => value, normalize: request => ({ ok: true, request }) })
  const server = createServer(async (req, res) => {
    const route = routes.find(item => item.kind === 'exact' && item.path === req.url)
    if (!route) { res.statusCode = 404; res.end(); return }
    await route.handler(req, res)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const post = async (action, body) => (await fetch(`http://127.0.0.1:${server.address().port}/api/dsh-imagegen/etsy/${action}`, { method: 'POST', body: JSON.stringify(body) })).json()
  const created = await f.workflow.start(input({ count: 1 }))
  await f.workflow.idle()
  const result = await post('rename', { id: created.id, name: '秋季新品 · 羊毛毡兔' })
  assert.equal(result.ok, true)
  assert.equal(result.value.displayName, '秋季新品 · 羊毛毡兔')
  const list = await post('list', {})
  assert.equal(list.value[0].displayName, '秋季新品 · 羊毛毡兔')
  const bad = await post('rename', { id: created.id, name: '' })
  assert.equal(bad.ok, false)
  assert.match(bad.message, /请输入创作名称/)
})

test('参考图创作支持 2 到 8 张，1 张仍被拒绝', async t => {
  const f = await setup(t)
  const routes = makeEtsyRoutes({ workflow: f.workflow, guard: () => true, parse: value => value, normalize: request => ({ ok: true, request }) })
  const server = createServer(async (req, res) => {
    const route = routes.find(item => item.kind === 'exact' && item.path === req.url)
    if (!route) { res.statusCode = 404; res.end(); return }
    await route.handler(req, res)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const post = async count => (await fetch(`http://127.0.0.1:${server.address().port}/api/dsh-imagegen/etsy/reference`, { method: 'POST', body: JSON.stringify({
    requestKey: crypto.randomUUID(), count, maxCalls: 100, autoCheck: false, copyTiming: 'selected',
    references: [{ dataUrl: `data:image/png;base64,${pixel}`, role: 'subject', note: '' }],
    facts: { name: '测试', type: 'unspecified' }, generation: { model: 'mock-image', channelId: 'mock', mode: 'edit', prompt: 'test', size: 'auto', quality: 'auto', n: 1, detail: '' },
  }) })).json()
  const one = await post(1)
  assert.equal(one.ok, false); assert.match(one.message, /2 到 8 张/)
  const two = await post(2)
  assert.equal(two.ok, true, two.message)
  assert.equal(two.value.images.length, 2)
  await f.workflow.idle()
})

test('接口返回纯文本 not found 时给出可读提示，不再抛 JSON 解析错误', async t => {
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response('not found', { status: 404 })
  t.after(() => { globalThis.fetch = original })
  await assert.rejects(etsyCall('rename', { id: 'abc', name: '新名字' }), error => {
    assert.ok(error instanceof EtsyRouteError, '应识别为路由未就绪')
    assert.equal(error.action, 'rename')
    assert.equal(error.status, 404)
    assert.match(error.message, /重启 DeepSeek Harness/)
    assert.doesNotMatch(error.message, /Unexpected token/)
    return true
  })
})

test('etsyCall 兼容 401 回退页、HTML 错误页与正常/失败 JSON 响应', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  globalThis.fetch = async () => new Response('unauthorized', { status: 401 })
  await assert.rejects(etsyCall('rename'), EtsyRouteError)
  globalThis.fetch = async () => new Response('<html>502 Bad Gateway</html>', { status: 502 })
  await assert.rejects(etsyCall('rename'), /无法识别的响应（HTTP 502）/)
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, value: { displayName: '新名字' } }), { headers: { 'content-type': 'application/json' } })
  assert.deepEqual(await etsyCall('rename'), { displayName: '新名字' })
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, message: '请输入创作名称' }), { headers: { 'content-type': 'application/json' } })
  await assert.rejects(etsyCall('rename'), /请输入创作名称/)
})

test('本机名称可读写、清除、过滤脏数据，且只覆盖显示名', async t => {
  const data = new Map()
  const stub = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }
  Object.defineProperty(globalThis, 'localStorage', { value: stub, configurable: true, writable: true })
  t.after(() => { delete globalThis.localStorage })
  const product = { id: 'abc-123', facts: { name: '原名' }, images: [], revision: 7 }
  assert.deepEqual(readLocalNames(), {})
  writeLocalName(product.id, '  蓝帽兔子 · 客户A  ')
  assert.deepEqual(readLocalNames(), { 'abc-123': '蓝帽兔子 · 客户A' })
  const named = withLocalName(product)
  assert.equal(named.displayName, '蓝帽兔子 · 客户A')
  assert.equal(named.facts.name, '原名', '商品资料名称不能被本机显示名覆盖')
  assert.equal(named.revision, 7, '版本号不能被改名影响')
  assert.equal(product.displayName, undefined, '不得就地修改原对象')
  assert.equal(withLocalName(named), named, '名称一致时不产生新对象，避免每秒刷新触发多余渲染')
  clearLocalName('abc-123')
  assert.equal(withLocalName(product).displayName, undefined)
  data.set('etsy-creation-display-names', '{broken json')
  assert.deepEqual(readLocalNames(), {})
  data.set('etsy-creation-display-names', JSON.stringify({ '../evil': '越权', numeric: 5, ok: '有效名称' }))
  assert.deepEqual(readLocalNames(), { ok: '有效名称' })
})

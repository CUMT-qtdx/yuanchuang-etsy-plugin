// 在真实Chrome工作台中控制读图时序，覆盖空白页重开、历史切换和新项目连续操作。
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { fixture, input } from './etsy-fixture.mjs'
import { mockDesignImage } from './mock-design-image.mjs'
import { makeEtsyRoutes } from '../.etsy-test/host.js'
const { chromium } = createRequire('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/package.json')('playwright')
const root = await mkdtemp(path.join(tmpdir(), 'reference-isolation-'))
const evidence = process.env.ETSY_TEST_EVIDENCE || path.resolve('output/playwright/reference-isolation')
await mkdir(evidence, { recursive: true })
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const a = mockDesignImage(0), b = mockDesignImage(1), errors = [], scenarios = []
const f = fixture(root, { generate: async request => ({ images: [{ b64: request.image.split(',')[1], mime: 'image/png' }] }) })
await f.workflow.ready
async function seed(bytes) {
  const value = input({ count: 2, copyTiming: 'selected', generation: { ...input().generation, image: 'data:image/png;base64,' + bytes.toString('base64') } })
  const p = await f.workflow.start(value, undefined, { creativity: 'balanced' }); await f.workflow.idle(); return p
}
const pa = await seed(a), pb = await seed(b), countsBefore = structuredClone(f.counts)
const routes = makeEtsyRoutes({ workflow: f.workflow, guard: () => true, parse: body => body, normalize: request => ({ ok: true, request }) })
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname
    if (pathname.endsWith('/model-choices')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, value: { writable: false, imageGroups: [{ id: 'mock', name: '隔离Gemini渠道', models: ['mock-image'] }], image: { channelId: 'mock', model: 'mock-image' }, analysis: { provider: 'mock', model: 'mock' }, analysisLabel: '隔离分析', analysisModels: [], warnings: [] } })); return }
    const route = routes.find(r => r.kind === 'exact' && r.path === pathname)
    if (route) { await route.handler(req, res); return }
    if (pathname === '/preview.js') { res.setHeader('content-type', 'text/javascript'); res.end(await readFile(new URL('../.reference-preview/preview.js', import.meta.url))); return }
    res.setHeader('content-type', 'text/html;charset=utf-8')
    res.end('<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;display:flex}#history-host{width:225px;height:100vh;flex-shrink:0;border-right:1px solid #ddd}#root{position:relative;height:100vh;flex:1;min-width:0}:root{--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#f6f7f9;--dsw-alias-border-l1:#ddd;--dsw-alias-label-primary:#282b32;--dsw-alias-label-secondary:#6f7783}</style><aside id="history-host"></aside><div id="root"></div><script src="/preview.js"></script>')
  } catch (error) { errors.push(error.message); res.statusCode = 500; res.end('隔离服务错误') }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = 'http://127.0.0.1:' + server.address().port
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(base); await page.getByLabel('参考图片', { exact: true }).waitFor({ state: 'attached' })
  // 内部仍用原生FileReader读取真实文件，外层延迟交付，以稳定覆盖取消时的LOADING状态。
  await page.evaluate(() => {
    const Native = FileReader
    window.__reads = { started: 0, aborted: 0, completed: 0 }
    window.FileReader = class extends Native {
      readAsDataURL(file) {
        if (!file.name.startsWith('延迟')) return super.readAsDataURL(file)
        this.pendingState = Native.LOADING; window.__reads.started++
        Object.defineProperty(this, 'readyState', { get: () => this.pendingState })
        this.inner = new Native()
        this.inner.onload = () => { this.delivery = setTimeout(() => {
          this.pendingState = Native.DONE
          Object.defineProperty(this, 'result', { value: this.inner.result })
          window.__reads.completed++; this.onload?.(new ProgressEvent('load'))
        }, 800) }
        this.inner.readAsDataURL(file)
      }
      abort() {
        if (this.pendingState === undefined) return super.abort()
        clearTimeout(this.delivery); this.pendingState = Native.DONE; window.__reads.aborted++
        if (this.inner.readyState === Native.LOADING) this.inner.abort()
        this.onload = null; this.inner.onload = null
        this.onabort?.(new ProgressEvent('abort'))
      }
    }
  })
  async function fresh() {
    await page.getByRole('button', { name: '新创作', exact: true }).click()
    await page.locator('[data-reference-studio][data-current-project="new"]').waitFor()
  }
  async function select(id) {
    await page.locator(`[data-creation-project="${id}"]`).click()
    await page.locator(`[data-reference-studio][data-current-project="${id}"]`).waitFor()
  }
  async function upload(bytes, name) { await page.getByLabel('参考图片', { exact: true }).setInputFiles({ name, mimeType: 'image/png', buffer: bytes }) }
  async function referenceHash() {
    const src = await page.locator('[data-reference-item="0"] img').getAttribute('src')
    return hash(src.startsWith('data:') ? Buffer.from(src.split(',')[1], 'base64') : await (await page.request.get(new URL(src, base).href)).body())
  }
  await fresh(); await upload(a, '延迟A.png')
  await page.getByRole('button', { name: '读取中…', exact: true }).waitFor()
  await fresh(); await page.waitForTimeout(950)
  assert.equal(await page.locator('[data-reference-item]').count(), 0)
  await upload(b, 'B.png'); await page.getByRole('button', { name: '更换参考图 1', exact: true }).waitFor()
  assert.equal(await referenceHash(), hash(b))
  scenarios.push('空白页读取A时再次新创作，旧A不进入新页，新B可正常上传')

  await fresh(); await upload(a, '延迟历史A.png'); await select(pb.id); await page.waitForTimeout(950)
  assert.equal(await referenceHash(), hash(b)); scenarios.push('读取A时切换到B历史项目，B参考图保持不变')

  await page.getByRole('button', { name: '更换参考图 1', exact: true }).click(); await upload(a, '延迟替换A.png')
  assert.equal(await page.getByRole('button', { name: '移除参考图 1', exact: true }).isDisabled(), true)
  await fresh(); await page.waitForTimeout(950)
  assert.equal(await page.locator('[data-reference-item]').count(), 0); scenarios.push('历史项目换图时新创作，新页保持空白')

  await upload(a, '延迟连续A.png'); await fresh(); await fresh(); await upload(b, '连续B.png'); await page.waitForTimeout(950)
  assert.equal(await referenceHash(), hash(b)); scenarios.push('连续两次新创作后立刻上传B，旧A不覆盖B')

  await select(pa.id); await page.getByRole('button', { name: '更换参考图 1', exact: true }).click(); await upload(b, '延迟B.png')
  await select(pb.id); await select(pa.id); await page.waitForTimeout(950)
  assert.equal(await referenceHash(), hash(a)); scenarios.push('A读图时切到B再回A，仍恢复A已保存的参考图')

  assert.deepEqual(errors, []); assert.deepEqual(f.counts, countsBefore)
  const reads = await page.evaluate(() => window.__reads)
  assert.equal(reads.aborted, 5); assert.equal(reads.completed, 0)
  // 读取尚未进入LOADING而卸载时没有可取消的I/O，也必须丢弃随后到达的旧回调。
  await page.evaluate(() => {
    const previous = FileReader.prototype.readAsDataURL
    FileReader.prototype.readAsDataURL = function(file) {
      if (file.name === '尚未启动A.png') setTimeout(() => previous.call(this, file), 250)
      else previous.call(this, file)
    }
  })
  await fresh(); await upload(a, '尚未启动A.png'); await fresh(); await page.waitForTimeout(600)
  assert.equal(await page.locator('[data-reference-item]').count(), 0)
  await upload(b, '回调后B.png'); await page.getByRole('button', { name: '更换参考图 1', exact: true }).waitFor()
  assert.equal(await referenceHash(), hash(b))
  scenarios.push('尚未进入LOADING时卸载，随后到达的旧回调被丢弃，新上传B正常')
  await page.screenshot({ path: path.join(evidence, 'reference-isolation-passed.png') })
  const report = { passed: true, version: '2.0.10-etsy', scenarios, reads, unexpectedModelCalls: 0, paidModelCalls: 0, pageErrors: errors }
  await writeFile(path.join(evidence, 'reference-isolation-result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2))
} finally {
  await browser.close(); await f.workflow.idle(); f.workflow.dispose(); await new Promise(resolve => server.close(resolve))
  if (path.dirname(root) === tmpdir() && path.basename(root).startsWith('reference-isolation-')) await rm(root, { recursive: true, force: true })
}

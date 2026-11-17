// 真实 Chrome 下载与真实商品路由联测，模型使用隔离夹具，不调用实际生图服务。
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { fixture, input } from './etsy-fixture.mjs'
import { makeRoutes } from '../.etsy-test/host.js'
import { source, addMetadata, c2paPng } from './metadata-fixtures.mjs'
import { cleanImageMetadata } from '../src/metadata/aimeta.ts'
import { readZipDirectory, readZipEntry } from '../src/zip.ts'
const packageRoot = process.env.PLAYWRIGHT_PACKAGE_ROOT
assert.ok(packageRoot, '请通过 PLAYWRIGHT_PACKAGE_ROOT 指定已安装 Playwright 的 node_modules 目录')
const { chromium } = createRequire(path.join(packageRoot, 'playwright/package.json'))('playwright')
const record = process.env.ETSY_QA_OUTPUT || 'E:/etsy/维护记录/图片导出元数据_20261117'
await fs.mkdir(record, { recursive: true })
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'metadata-export-'))
const files = new Map()
for (const [name, format] of [['base.jpg', 'jpeg'], ['base.png', 'png'], ['base.webp', 'webp']]) files.set(name, addMetadata(await source(name), format))
files.set('c2pa.png', c2paPng(await source('base.png'), false)); files.set('partial.png', c2paPng(await source('base.png'), true))
files.set('broken.png', (await source('base.png')).subarray(0, 34))
const names = ['base.jpg', 'base.png', 'base.webp']
const f = fixture(temp, { generate: async (_request, index) => { const name = names[(index - 1) % names.length]; return { images: [{ b64: Buffer.from(files.get(name)).toString('base64'), mime: name.endsWith('jpg') ? 'image/jpeg' : `image/${name.split('.').at(-1)}` }] } } })
await f.workflow.ready
const created = await f.workflow.start(input({ count: 3, generation: { ...input().generation, image: `data:image/png;base64,${Buffer.from(files.get('base.png')).toString('base64')}` } }), undefined, { creativity: 'balanced' })
await f.workflow.idle()
const product = await f.workflow.get(created.id)
const before = new Map(await Promise.all([...product.referenceFiles, ...product.images.flatMap(im => im.files)].map(async name => [name, (await f.workflow.store.readImage(product.id, name)).data])))
const routes = makeRoutes({ settings: { describe: () => [], mutate: async () => {} }, resolve: () => ({ apiUrl: 'https://mock.invalid/v1', apiKey: 'mock-key' }), runtime: { queue: f.queue }, etsy: f.workflow })
let browser
const errors = [], downloads = []
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname
  if (pathname === '/missing') { res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ message: '测试图片不存在' })); return }
  if (pathname.startsWith('/image/')) { const bytes = files.get(pathname.slice(7)); res.writeHead(bytes ? 200 : 404, { 'content-type': pathname.endsWith('.jpg') ? 'image/jpeg' : pathname.endsWith('.webp') ? 'image/webp' : 'image/png' }); res.end(bytes); return }
  if (pathname === '/preview.js') { res.setHeader('content-type', 'text/javascript'); res.end(await fs.readFile(new URL('../.metadata-preview/preview.js', import.meta.url))); return }
  const route = routes.find(r => r.kind === 'exact' && r.path === pathname)
  if (route) { try { await route.handler(req, res) } catch (e) { res.statusCode = 500; res.end(String(e)) }; return }
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.end('<!doctype html><html><meta charset="utf-8"><style>body{margin:0;font-family:system-ui;background:#f5f7fa}main{margin:30px;max-width:600px}button,a{padding:5px;color:#1e518b}#root{height:100vh}:root{--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#f6f7f9;--dsw-alias-border-l1:#e4e7ed;--dsw-alias-label-primary:#282b32;--dsw-alias-label-secondary:#6f7783}</style><div id="root"></div><script src="/preview.js"></script></html>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true })
  page.on('pageerror', e => errors.push(e.message)); page.on('download', d => downloads.push(d))
  await page.goto(`${origin}/?id=${product.id}`)
  for (const name of names) {
    const event = page.waitForEvent('download'); await page.getByRole('link', { name: `下载 ${name}`, exact: true }).click()
    const download = await event; const saved = path.join(record, `浏览器单张-${name}`); await download.saveAs(saved)
    assert.deepEqual(new Uint8Array(await fs.readFile(saved)), (await cleanImageMetadata(files.get(name))).data)
  }
  const prior = downloads.length
  await page.getByRole('button', { name: '批量下载三张', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[data-export-notice]')?.textContent.includes('已下载 3 张'))
  assert.equal(downloads.length - prior, 3)
  for (const [i, download] of downloads.slice(prior).entries()) {
    const saved = path.join(record, `浏览器批量-${names[i]}`); await download.saveAs(saved)
    assert.deepEqual(new Uint8Array(await fs.readFile(saved)), (await cleanImageMetadata(files.get(names[i]))).data)
  }
  const zipEvent = page.waitForEvent('download'); await page.getByRole('button', { name: '下载商品 ZIP', exact: true }).click()
  const zipDownload = await zipEvent, zipFile = path.join(record, '浏览器商品导出.zip'); await zipDownload.saveAs(zipFile)
  const zip = await fs.readFile(zipFile), entries = readZipDirectory(zip), reports = JSON.parse(readZipEntry(zip, entries.find(x => x.name === '图片元数据处理报告.json')).toString())
  assert.equal(reports.images.length, before.size)
  for (const [name, original] of before) { const bytes = readZipEntry(zip, entries.find(x => x.name === `images/${name}`)); assert.deepEqual(new Uint8Array(bytes), (await cleanImageMetadata(original)).data); assert.deepEqual((await f.workflow.store.readImage(product.id, name)).data, original) }
  for (const [label, key, status] of [['下载 C2PA 原文件', 'c2pa.png', '未清理'], ['下载 C2PA 部分清理文件', 'partial.png', '部分清理']]) {
    const event = page.waitForEvent('download'); await page.getByRole('link', { name: label, exact: true }).click()
    const download = await event; const saved = path.join(record, `浏览器-${key}`); await download.saveAs(saved)
    assert.deepEqual(new Uint8Array(await fs.readFile(saved)), (await cleanImageMetadata(files.get(key))).data)
    await page.waitForFunction(s => document.querySelector('[data-export-notice]')?.textContent.includes(s), status)
  }
  await page.screenshot({ path: path.join(record, 'C2PA部分清理状态.png'), fullPage: true })
  for (const label of ['下载损坏图片', '下载不存在图片', '批次全部失败']) {
    const count = downloads.length; await page.getByText(label, { exact: true }).click()
    await page.waitForFunction(() => document.querySelector('[data-export-notice]')?.textContent.startsWith('导出失败'))
    assert.equal(downloads.length, count)
  }
  const mixedStart = downloads.length
  await page.getByRole('button', { name: '批次含失败图片', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[data-export-notice]')?.textContent.includes('已下载 2 张，2 张未导出'))
  assert.equal(downloads.length - mixedStart, 2)
  assert.match(await page.locator('[data-export-notice]').innerText(), /bad.png/)
  assert.match(await page.locator('[data-export-notice]').innerText(), /missing.png/)
  for (const [i, download] of downloads.slice(mixedStart).entries()) {
    const name = ['base.png', 'base.webp'][i], saved = path.join(record, `部分失败批量-${name}`)
    await download.saveAs(saved); assert.deepEqual(new Uint8Array(await fs.readFile(saved)), (await cleanImageMetadata(files.get(name))).data)
  }
  await page.screenshot({ path: path.join(record, '批量部分失败状态.png'), fullPage: true })
  const signedStart = downloads.length, signedEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: '凭证保护与失败混合', exact: true }).click()
  const signedDownload = await signedEvent, signedFile = path.join(record, '混合批次-C2PA.png'); await signedDownload.saveAs(signedFile)
  await page.waitForFunction(() => document.querySelector('[data-export-notice]')?.textContent.includes('已下载 1 张，1 张未导出'))
  assert.equal(downloads.length - signedStart, 1); assert.deepEqual(new Uint8Array(await fs.readFile(signedFile)), files.get('c2pa.png'))
  assert.match(await page.locator('[data-export-notice]').innerText(), /未清理 1 张/)
  const canvasEvent = page.waitForEvent('download'); await page.getByRole('button', { name: '画布文件节点下载', exact: true }).click(); await canvasEvent
  // 真正的创作区、原图弹层与现有 ZIP 按钮。
  await page.goto(`${origin}/studio`)
  await page.waitForSelector('[data-creation-lightbox]', { state: 'detached' })
  const single = page.getByRole('link', { name: '下载原图', exact: true }).first()
  await single.waitFor({ timeout: 15000 })
  const realSingle = page.waitForEvent('download'); await single.click(); await realSingle
  await page.getByRole('button', { name: '查看大图', exact: true }).first().click()
  const lightboxEvent = page.waitForEvent('download'); await page.locator('[data-creation-download]').click(); await lightboxEvent
  await page.screenshot({ path: path.join(record, '创作预览导出状态.png'), fullPage: true })
  await page.getByRole('button', { name: '关闭图片预览', exact: true }).click()
  const realZip = page.waitForEvent('download'); await page.getByRole('link', { name: '导出图片与文案', exact: true }).click(); await realZip
  assert.deepEqual(errors, [])
  // 真实 ZIP 路由分别覆盖部分失败、全部失败；先损坏一张再移除另一张隔离测试图片。
  const [victim, missing] = [...before.keys()]
  await fs.writeFile(path.join(f.workflow.store.directory(product.id), victim), files.get('broken.png'))
  await fs.unlink(path.join(f.workflow.store.directory(product.id), missing))
  await page.goto(`${origin}/?id=${product.id}`)
  const mixedZipEvent = page.waitForEvent('download'); await page.getByRole('button', { name: '下载商品 ZIP', exact: true }).click()
  const mixedZipDownload = await mixedZipEvent, mixedZipFile = path.join(record, '部分失败商品导出.zip'); await mixedZipDownload.saveAs(mixedZipFile)
  await page.waitForFunction(() => document.querySelector('[data-export-notice]')?.textContent.includes('2 张未导出'))
  assert.match(await page.locator('[data-export-notice]').innerText(), new RegExp(victim.replaceAll('.', '\\.')))
  assert.match(await page.locator('[data-export-notice]').innerText(), /原图文件不存在/)
  const mixedZip = await fs.readFile(mixedZipFile), mixedEntries = readZipDirectory(mixedZip)
  assert.equal(mixedEntries.filter(e => e.name.startsWith('images/')).length, before.size - 2)
  assert.ok(!mixedEntries.some(e => e.name === `images/${victim}` || e.name === `images/${missing}`))
  const mixedReport = JSON.parse(readZipEntry(mixedZip, mixedEntries.find(e => e.name === '图片元数据处理报告.json')).toString())
  assert.deepEqual(mixedReport.summary, { total: before.size, exported: before.size - 2, failed: 2 })
  await page.screenshot({ path: path.join(record, 'ZIP部分失败状态.png'), fullPage: true })
  for (const name of before.keys()) await fs.writeFile(path.join(f.workflow.store.directory(product.id), name), files.get('broken.png'))
  const count = downloads.length
  await page.getByRole('button', { name: '下载商品 ZIP', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[data-export-notice]')?.textContent.includes('全部 4 张图片导出失败'))
  assert.equal(downloads.length, count)
  const response = await fetch(`${origin}/api/dsh-imagegen/etsy/export?id=${product.id}`)
  assert.equal(response.status, 400); assert.match((await response.json()).message, /未生成 ZIP/)
  const result = { passed: true, browser: 'Chrome', singleFormats: names, batchImages: 3, zipImageCount: reports.images.length, originalBytesUnchanged: true, creationDownload: true, previewDownload: true, creationZip: true, canvasFileDownload: true, c2paPartialAndUncleanedStatus: true, corruptSingleNoDownload: true, mixedBatchExportsGoodImages: 2, mixedBatchReportsFailures: 2, mixedZipExportsGoodImages: before.size - 2, mixedZipReportsFailures: 2, c2paNotClassifiedAsFailure: true, allFailedBatchNoDownload: true, allFailedZipNoDownload: true, zipFailureReturnsJson: true, runtimeErrors: errors, realModelCalls: 0 }
  await fs.writeFile(path.join(record, '浏览器与ZIP验收.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2))
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve)); f.workflow.dispose(); await f.workflow.idle()
  assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(temp).startsWith('metadata-export-'))
  await fs.rm(temp, { recursive: true, force: true })
}

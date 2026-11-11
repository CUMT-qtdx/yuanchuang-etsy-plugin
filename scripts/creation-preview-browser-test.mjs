// 使用隔离项目验证图片先于文案可预览、单图下载原始字节，以及预览不修改当前选图。
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fixture, input, copyValue } from './etsy-fixture.mjs'
import { mockDesignImage } from './mock-design-image.mjs'
import { makeEtsyRoutes, validateCopy } from '../.etsy-test/host.js'
const runtime = createRequire('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/package.json')
const { chromium } = runtime('playwright'), sharp = runtime('sharp')
const root = await mkdtemp(path.join(tmpdir(), 'etsy-preview-'))
const evidence = process.env.ETSY_TEST_EVIDENCE || 'E:/etsy/audit/2026-11-08/image-preview/verification'
await mkdir(evidence, { recursive: true })
let releaseCopy, failImage = false
const copyGate = new Promise(resolve => { releaseCopy = resolve })
const sizes = [[1600, 1200], [1000, 1600], [320, 320], [2000, 800]]
const previewImages = await Promise.all(sizes.map(([width, height], index) => sharp(mockDesignImage(index)).resize(width, height, { fit: 'contain', background: '#f7f6f2' }).png().toBuffer()))
const f = fixture(root, { generate: async (_, index) => ({ images: [{ b64: previewImages[index - 1].toString('base64'), mime: 'image/png' }] }), copy: async (_, facts) => { await copyGate; return validateCopy(copyValue(facts), facts) } })
await f.workflow.ready
const product = await f.workflow.start(input({ count: 4, autoCheck: false }), undefined, { creativity: 'balanced' })
for (let i = 0; i < 100 && !(await f.workflow.get(product.id)).images.every(image => image.files.length); i++) await new Promise(resolve => setTimeout(resolve, 10))
const saved = await f.workflow.get(product.id)
assert.ok(saved.images.every(image => image.files.length))
assert.ok(saved.images.some(image => image.copyStage.status === 'running'))
const original = await f.workflow.store.readImage(product.id, saved.images[0].files[0])
const routes = makeEtsyRoutes({ workflow: f.workflow, guard: () => true, parse: body => body, normalize: request => ({ ok: true, request }) })
let mutations = 0
const errors = []
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname
    if (req.method === 'POST' && !['list', 'get', 'model-choices'].some(name => pathname.endsWith('/' + name))) mutations++
    if (pathname.endsWith('/model-choices')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, value: { writable: false, imageGroups: [], image: { channelId: 'mock', model: 'mock-image' }, analysis: { provider: 'mock', model: 'mock' }, analysisLabel: '预览测试', defaultAnalysisLabel: '预览测试', analysisModels: [], warnings: [] } })); return }
    if (failImage && pathname.endsWith('/image')) { res.writeHead(404, { 'cache-control': 'no-store' }); res.end('测试图片不可读'); return }
    const route = routes.find(route => route.kind === 'exact' && route.path === pathname)
    if (route) { await route.handler(req, res); return }
    if (pathname === '/preview.js') { res.setHeader('content-type', 'text/javascript'); res.end(await readFile(new URL('../.reference-preview/preview.js', import.meta.url))); return }
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end('<!doctype html><html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;display:flex}#history-host{width:225px;height:100vh;flex-shrink:0;border-right:1px solid #ddd}#root{position:relative;height:100vh;flex:1;min-width:0}:root{--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#f6f7f9;--dsw-alias-border-l1:#ddd;--dsw-alias-label-primary:#282b32;--dsw-alias-label-secondary:#6f7783;--dsw-alias-label-tertiary:#8b94a1}</style><aside id="history-host"></aside><div id="root"></div><script src="/preview.js"></script></html>')
  } catch (error) { errors.push(String(error)); if (!res.headersSent) res.statusCode = 500; res.end('测试服务错误') }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true })
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  const card = page.locator(`[data-creation-image="${saved.images[0].id}"]`)
  await card.locator('img').waitFor()
  const before = { ...f.counts }, selected = (await f.workflow.get(product.id)).selectedImageId
  await card.locator('img').click()
  const dialog = page.getByRole('dialog', { name: '创作图片预览', exact: true })
  await dialog.waitFor()
  await page.waitForFunction(() => { const image = document.querySelector('[data-creation-full-image]'); return image?.complete && image.naturalWidth > 0 && image.getBoundingClientRect().width > 0 })
  const geometry = await dialog.boundingBox()
  assert.ok(Math.abs(geometry.x + geometry.width / 2 - 720) < 2)
  assert.ok(Math.abs(geometry.y + geometry.height / 2 - 500) < 2)
  await page.screenshot({ path: path.join(evidence, 'centered-image-preview.png') })
  const zoom = await dialog.locator('[data-creation-zoom]').innerText()
  await dialog.getByRole('button', { name: '放大图片', exact: true }).click()
  assert.notEqual(await dialog.locator('[data-creation-zoom]').innerText(), zoom)
  await dialog.getByRole('button', { name: '适应窗口', exact: true }).click()
  assert.equal(await dialog.locator('[data-creation-zoom]').innerText(), zoom)
  await dialog.locator('[data-creation-full-image]').dblclick()
  assert.notEqual(await dialog.locator('[data-creation-zoom]').innerText(), zoom)
  await dialog.locator('[data-creation-full-image]').dblclick()
  assert.equal(await dialog.locator('[data-creation-zoom]').innerText(), zoom)
  const firstSource = await dialog.locator('img').getAttribute('src')
  const waitForFittedImage = async (width, height) => page.waitForFunction(({ width, height }) => {
    const image = document.querySelector('[data-creation-full-image]'), stage = document.querySelector('[data-creation-viewer-stage]')
    if (!image || !stage || image.naturalWidth !== width || image.naturalHeight !== height) return false
    const a = image.getBoundingClientRect(), b = stage.getBoundingClientRect()
    return a.width > 0 && a.height > 0 && a.width <= b.width && a.height <= b.height && a.x >= b.x && a.y >= b.y
  }, { width, height })
  await page.keyboard.press('ArrowRight')
  await waitForFittedImage(...sizes[1])
  assert.notEqual(await dialog.locator('img').getAttribute('src'), firstSource)
  await page.keyboard.press('ArrowLeft')
  await waitForFittedImage(...sizes[0])
  assert.equal(await dialog.locator('img').getAttribute('src'), firstSource)
  await dialog.getByRole('button', { name: '下一张图片', exact: true }).click()
  await dialog.getByRole('button', { name: '上一张图片', exact: true }).click()
  for (let i = 0; i < 8; i++) { await dialog.getByRole('button', { name: '下一张图片', exact: true }).click(); await waitForFittedImage(...sizes[(i + 1) % 4]) }
  const downloadEvent = page.waitForEvent('download')
  await dialog.getByRole('link', { name: '下载这张原图', exact: true }).click()
  const download = await downloadEvent
  assert.match(download.suggestedFilename(), /方案1_版本1_1\.png$/)
  const output = path.join(evidence, 'downloaded-original.png'); await download.saveAs(output)
  assert.deepEqual(await readFile(output), original.data, '单图下载必须与存储原文件逐字节一致')
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' })
  assert.equal(await card.getByRole('button', { name: '查看大图：配色', exact: true }).evaluate(element => element === document.activeElement), true)
  const directEvent = page.waitForEvent('download')
  await card.getByRole('link', { name: '下载原图', exact: true }).click()
  const direct = await directEvent, directPath = path.join(evidence, 'downloaded-card-original.png'); await direct.saveAs(directPath)
  assert.deepEqual(await readFile(directPath), original.data)
  await card.getByRole('button', { name: '查看大图', exact: true }).click(); await dialog.waitFor()
  await page.locator('[data-creation-lightbox]').click({ position: { x: 2, y: 2 } }); await dialog.waitFor({ state: 'hidden' })
  await card.getByRole('button', { name: '查看大图', exact: true }).focus(); await page.keyboard.press('Enter'); await dialog.waitFor()
  await dialog.getByRole('link', { name: '下载这张原图', exact: true }).focus(); await page.keyboard.press('Tab')
  assert.equal(await dialog.getByRole('button', { name: '关闭图片预览', exact: true }).evaluate(element => element === document.activeElement), true)
  for (const viewport of [{ width: 700, height: 600 }, { width: 480, height: 800 }]) {
    await page.setViewportSize(viewport)
    await page.waitForFunction(() => { const image = document.querySelector('[data-creation-full-image]'), stage = document.querySelector('[data-creation-viewer-stage]'); if (!image || !stage) return false; const a = image.getBoundingClientRect(), b = stage.getBoundingClientRect(); return a.width > 0 && a.width <= b.width && a.height <= b.height })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    const box = await dialog.boundingBox(); assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1)
  }
  await page.screenshot({ path: path.join(evidence, 'narrow-image-preview.png') })
  await dialog.getByRole('button', { name: '关闭图片预览', exact: true }).click()
  assert.equal((await f.workflow.get(product.id)).selectedImageId, selected)
  assert.deepEqual(f.counts, before)
  assert.equal(mutations, 0, '预览和下载只读图片，不切换共享选择也不调用模型')
  releaseCopy(); await f.workflow.idle()
  await page.reload(); await card.getByRole('button', { name: '查看大图', exact: true }).click(); await dialog.waitFor()
  await page.waitForFunction(() => document.querySelector('[data-creation-full-image]')?.naturalWidth > 0)
  await dialog.getByRole('button', { name: '关闭图片预览', exact: true }).click()
  failImage = true
  await page.route('**/api/dsh-imagegen/etsy/image?**', route => route.continue())
  await card.getByRole('button', { name: '查看大图', exact: true }).click()
  await dialog.getByRole('alert').waitFor()
  await dialog.getByRole('button', { name: '关闭图片预览', exact: true }).click()
  assert.deepEqual(errors, [])
  const report = { passed: true, browser: 'Google Chrome', beforeCopyCompleted: true, centeredModal: true, zoomAndFit: true, arrowNavigation: true, escapeBackdropAndClose: true, keyboardFocusRestored: true, originalBytesDownloaded: true, cardDownload: true, independentOfSelection: true, noExtraModelCalls: true, persistedImagesAfterReload: true, imageReadFailureVisible: true, responsiveViewports: 3, imageDimensions: sizes, repeatedCachedNavigation: true, pageErrors: errors }
  await writeFile(path.join(evidence, 'creation-preview-browser.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2))
} finally { releaseCopy(); await browser.close(); f.workflow.dispose(); await f.workflow.idle(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) }

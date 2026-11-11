// 真实 Chrome + 隔离后端验证自动保存、冲突恢复、失败输入保留与导出。
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fixture, input, copyValue } from './etsy-fixture.mjs'
import { makeEtsyRoutes, validateCopy } from '../.etsy-test/host.js'
import { mockDesignImage } from './mock-design-image.mjs'
const { chromium } = createRequire('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/package.json')('playwright')
const root = await mkdtemp(path.join(tmpdir(), 'etsy-studio-save-'))
const evidence = path.resolve(process.env.ETSY_TEST_EVIDENCE || 'E:/etsy/audit/2026-11-07/fix-five/verification')
await mkdir(evidence, { recursive: true })
let partial = false, releaseEdit, holdEdit = false, held = false
const f = fixture(root, { generate: async (_, index) => ({ images: [{ b64: mockDesignImage(index).toString('base64'), mime: 'image/png' }] }), copy: async (_, facts, __, context) => {
  const raw = copyValue(facts)
  raw.description = `${context.plan.name === '配色' ? 'Red' : 'Blue'} scarf cat figure.`
  if (partial && !context.repair) raw.titles[0].title = 'Cute Кот Cat Figure'
  return validateCopy(raw, facts, { mode: 'generated' })
} })
await f.workflow.ready
const initial = await f.workflow.start(input({ count: 4, autoCheck: false }), undefined, { creativity: 'balanced' }); await f.workflow.idle()
const product = await f.workflow.get(initial.id), [imageA, imageB] = product.images
await f.workflow.selectImage(product.id, imageA.id)
const routes = makeEtsyRoutes({ workflow: f.workflow, guard: () => true, parse: body => body, normalize: request => ({ ok: true, request }) })
const errors = [], requestOrder = []
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname
    if (pathname.endsWith('/model-choices')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, value: { writable: false, imageGroups: [], image: { channelId: 'mock', model: 'mock-image' }, analysis: { provider: 'mock', model: 'mock' }, analysisLabel: '隔离测试', defaultAnalysisLabel: '隔离测试', analysisModels: [], warnings: [] } })); return }
    if (pathname.endsWith('/revise')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: false, message: '测试：调用额度已耗尽' })); return }
    if (pathname.endsWith('/edit')) {
      requestOrder.push('edit')
      if (holdEdit) { holdEdit = false; held = true; await new Promise(resolve => { releaseEdit = resolve }) }
    }
    if (pathname.endsWith('/export')) requestOrder.push('export')
    const route = routes.find(route => route.kind === 'exact' && route.path === pathname)
    if (route) { await route.handler(req, res); return }
    if (pathname === '/preview.js') { res.setHeader('content-type', 'text/javascript'); res.end(await readFile(new URL('../.reference-preview/preview.js', import.meta.url))); return }
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end('<!doctype html><html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;display:flex}#history-host{width:225px;height:100vh;flex-shrink:0;border-right:1px solid #ddd}#root{height:100vh;flex:1;min-width:0}:root{--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#f6f7f9;--dsw-alias-border-l1:#ddd;--dsw-alias-label-primary:#282b32;--dsw-alias-label-secondary:#6f7783;--dsw-alias-label-tertiary:#8b94a1}</style><aside id="history-host"></aside><div id="root"></div><script src="/preview.js"></script></html>')
  } catch (error) { errors.push(String(error)); if (!res.headersSent) res.statusCode = 500; res.end('测试服务失败') }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const url = `http://127.0.0.1:${server.address().port}`
async function until(predicate, label) { for (let i = 0; i < 200; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 25)) } throw new Error(label) }
function unzip(zip) { const files = new Map(); for (let offset = 0; zip.readUInt32LE(offset) === 0x04034b50;) { const size = zip.readUInt32LE(offset + 18), n = zip.readUInt16LE(offset + 26), extra = zip.readUInt16LE(offset + 28), start = offset + 30 + n + extra; files.set(zip.subarray(offset + 30, offset + 30 + n).toString(), zip.subarray(start, start + size).toString()); offset = start + size } return files }
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, acceptDownloads: true })
  await context.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.__copiedText = text } }, configurable: true }) })
  const a = await context.newPage(), b = await context.newPage()
  for (const page of [a, b]) { page.on('pageerror', e => errors.push(e.message)); await page.goto(url); await page.waitForSelector('[data-title-index]') }
  await a.getByRole('tab', { name: '商品文案', exact: true }).click(); await a.getByRole('button', { name: '编辑文字', exact: true }).click()
  holdEdit = true
  await a.getByLabel('英文商品文案', { exact: true }).fill('Red scarf cat figure edited in the first window.')
  await until(() => held, '未收到自动保存请求')
  await b.locator(`[data-creation-image="${imageB.id}"]`).getByRole('button', { name: '选择方案 2', exact: true }).click()
  releaseEdit()
  await until(async () => (await f.workflow.get(product.id)).imageCopies[imageA.id].copy.description.includes('first window'), '原图片保存失败')
  const saved = await f.workflow.get(product.id)
  assert.match(saved.imageCopies[imageA.id].copy.description, /Red/)
  assert.equal(saved.imageCopies[imageB.id].copy.description, 'Blue scarf cat figure.')
  await b.getByRole('tab', { name: '商品文案', exact: true }).click()
  await b.getByRole('button', { name: '编辑文字', exact: true }).click()
  held = false; holdEdit = true
  await b.getByLabel('英文商品文案', { exact: true }).fill('First local edit for a blue scarf cat.')
  await until(() => held, '未捕获串行保存')
  await b.getByLabel('英文商品文案', { exact: true }).fill('Second local edit for a blue scarf cat.')
  releaseEdit()
  await until(async () => (await f.workflow.get(product.id)).imageCopies[imageB.id].copy.description.includes('Second local'), '保存期间新输入未提交')
  await until(async () => (await b.locator('[data-reference-copy]').innerText()).includes('已保存'), '保存未结束')
  const instruction = '把围巾改为蓝色，其他保持不变'
  await b.getByLabel('修改要求', { exact: true }).fill(instruction)
  await b.getByRole('button', { name: '修改这张图', exact: true }).click()
  await b.getByText('测试：调用额度已耗尽', { exact: true }).waitFor()
  assert.equal(await b.getByLabel('修改要求', { exact: true }).inputValue(), instruction)
  // 导出必须先保存，并使用规范化后的同一张图文案。
  requestOrder.length = 0
  await b.getByLabel('英文商品文案', { exact: true }).fill('A charming design concept with a blue scarf.')
  const downloadPromise = b.waitForEvent('download')
  await b.getByRole('link', { name: '导出图片与文案', exact: true }).click()
  const download = await downloadPromise, downloadPath = path.join(evidence, 'latest-copy-export.zip')
  await download.saveAs(downloadPath)
  const exported = unzip(await readFile(downloadPath)).get('listing.txt')
  assert.match(exported, /A charming design with a blue scarf/)
  assert.ok(requestOrder.indexOf('edit') >= 0 && requestOrder.indexOf('edit') < requestOrder.indexOf('export'))
  await b.getByRole('button', { name: '复制整套文案', exact: true }).click()
  assert.equal(await b.evaluate(() => window.__copiedText), exported)
  // 同图冲突保留本地草稿，提供载入最新稿及恢复草稿入口。
  await b.getByLabel('英文商品文案', { exact: true }).fill('Local draft that must survive a conflict.')
  const before = await f.workflow.get(product.id)
  await f.workflow.editCopy(product.id, { description: 'Remote version from another window.' }, before.revision, { imageId: imageB.id, baseCopy: JSON.stringify(before.imageCopies[imageB.id].copy), factsRevision: before.factsRevision ?? 1 })
  await b.getByText(/尚未保存：.*文案已更新/).waitFor()
  assert.equal(await b.getByLabel('英文商品文案', { exact: true }).inputValue(), 'Local draft that must survive a conflict.')
  await b.getByRole('button', { name: '保留草稿并载入最新', exact: true }).click()
  await until(async () => (await b.getByLabel('英文商品文案', { exact: true }).inputValue()).includes('Remote version'), '没有载入最新稿')
  await b.getByRole('button', { name: '恢复本地草稿', exact: true }).click()
  await until(async () => (await f.workflow.get(product.id)).imageCopies[imageB.id].copy.description.includes('Local draft'), '草稿恢复后不能保存')
  await b.screenshot({ path: path.join(evidence, 'studio-edit-fixed.png'), fullPage: true })
  // 一个坏标题不隐藏正文，并可补齐该标题而保留原正文。
  partial = true
  const partialProject = await f.workflow.start(input({ count: 4, autoCheck: false }), undefined, { creativity: 'balanced' }); await f.workflow.idle()
  const c = await context.newPage()
  await c.addInitScript(id => localStorage.setItem('etsy-reference-current', id), partialProject.id)
  await c.goto(url); await c.waitForSelector('[data-copy-field-issues]')
  assert.equal(await c.locator('[data-title-index]').filter({ hasText: /待补齐/ }).count(), 1)
  const prior = await f.workflow.get(partialProject.id), priorDescription = prior.copy.description
  await c.getByRole('button', { name: '补齐未完成项', exact: true }).click()
  await until(async () => {
    const current = await f.workflow.get(partialProject.id)
    return current.copyStage.status === 'completed' && !!current.copy && !current.copy.fieldIssues?.length && !!current.copy.titles[0].title
  }, '未完成标题没有补齐')
  assert.equal((await f.workflow.get(partialProject.id)).copy.description, priorDescription)
  await c.waitForFunction(() => {
    const title = document.querySelector('[data-title-index="0"]')
    return title && !title.textContent.includes('待补齐') && document.querySelector('[data-selected="true"] [data-image-copy-state]')?.getAttribute('data-image-copy-state') === 'completed'
  })
  await c.locator('[data-reference-copy]').scrollIntoViewIfNeeded()
  await c.screenshot({ path: path.join(evidence, 'partial-copy-fixed.png'), fullPage: true })
  assert.deepEqual(errors, [])
  const report = { passed: true, chrome: true, modelsAreMock: true, crossImageSaveIsolated: true, typingDuringSavePreserved: true, failedRevisionKeepsInput: true, exportWaitsForSave: true, copiedTextEqualsExport: true, conflictDraftRecoverable: true, partialCopyCanBeRepaired: true, pageErrors: errors }
  await writeFile(path.join(evidence, 'studio-edit-regression.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2))
} finally { releaseEdit?.(); await browser.close(); f.workflow.dispose(); await f.workflow.idle(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) }

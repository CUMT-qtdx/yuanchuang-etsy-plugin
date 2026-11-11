import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fixture, copyValue } from './etsy-fixture.mjs'
import { mockDesignImage } from './mock-design-image.mjs'
import { makeEtsyRoutes, validateCopy } from '../.etsy-test/host.js'
const { chromium } = createRequire('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/package.json')('playwright')
const root = await mkdtemp(path.join(tmpdir(), 'v1-browser-'))
const evidence = process.env.ETSY_TEST_EVIDENCE || 'E:/etsy/audit/2026-11-09/creation-v1/verification'
await mkdir(evidence, { recursive: true })
const errors = []
const f = fixture(root, { generate: async (_, index) => ({ images: [{ b64: mockDesignImage((index - 1) % 4).toString('base64'), mime: 'image/png' }] }), copy: async (_, facts) => {
  const raw = copyValue(); raw.description = 'A playful animal with a soft handmade appearance.'; raw.factsUsed = {}; raw.tags = ['animal design']; raw.titles = raw.titles.map(row => ({ ...row, title: row.title.replace(/Wool|wool/g, 'Soft') }))
  return validateCopy(raw, facts, { mode: 'generated' })
} })
await f.workflow.ready
const routes = makeEtsyRoutes({ workflow: f.workflow, guard: () => true, parse: body => body, normalize: request => ({ ok: true, request }) })
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname
    if (pathname.endsWith('/model-choices')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, value: { writable: false, imageGroups: [], image: { channelId: 'mock', model: 'mock-image' }, analysis: { provider: 'mock', model: 'mock' }, analysisLabel: '隔离Mock', defaultAnalysisLabel: '隔离Mock', analysisModels: [], warnings: [] } })); return }
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, acceptDownloads: true }); page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByLabel('参考图片', { exact: true }).setInputFiles([0, 1, 2].map(i => ({ name: `reference-${i}.png`, mimeType: 'image/png', buffer: mockDesignImage(i) })))
  await page.locator('[data-reference-item="2"]').waitFor()
  await page.getByLabel('参考图 2 用途').selectOption('detail')
  await page.getByLabel('参考图 2 说明').fill('翅膀使用条纹')
  await page.getByLabel('参考图 3 用途').selectOption('view')
  await page.getByLabel('创作任务', { exact: true }).selectOption('flat-to-felt')
  const slider = page.getByRole('slider', { name: '探索图片数量', exact: true })
  await slider.fill('8')
  assert.equal(await page.locator('[data-design-plan]').count(), 8)
  await page.screenshot({ path: path.join(evidence, 'creation-settings.png') })
  await page.getByRole('button', { name: '生成 8 个方案', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('[data-design-plan] img').length === 8)
  await f.workflow.idle()
  let project = (await f.workflow.list())[0]
  assert.equal(project.images.length, 8); assert.equal(project.referenceFiles.length, 3); assert.equal(project.creationTask, 'flat-to-felt'); assert.equal(f.counts.copy, 0)
  await page.locator('[data-design-plan]').nth(1).getByRole('button', { name: '选择方案 2', exact: true }).click()
  await page.getByLabel('修改要求', { exact: true }).fill('保持翅膀条纹，围巾改蓝色')
  await page.getByRole('button', { name: '修改这张图', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('[data-design-plan] img').length === 9)
  await f.workflow.idle()
  await page.getByLabel('固定形象细节').fill('翅膀保持三条竖线')
  await page.getByRole('button', { name: '确定为主设计', exact: true }).click()
  await page.getByText('形象设定（辅助信息）· 第1版', { exact: true }).waitFor()
  await f.workflow.idle(); project = await f.workflow.get(project.id)
  assert.equal(f.counts.copy, 1); assert.equal(f.counts.identity, 1)
  const masterId = project.finalDesigns[0].imageId
  await page.getByText('形象设定（辅助信息）· 第1版', { exact: true }).click()
  await page.getByRole('button', { name: '编辑设定卡', exact: true }).click()
  await page.getByLabel('设定卡固定细节').fill('翅膀始终三条竖线\n围巾固定蓝色')
  await page.getByRole('button', { name: '保存设定卡', exact: true }).click()
  await page.getByText('形象设定（辅助信息）· 第2版', { exact: true }).waitFor()
  await page.getByLabel('斜侧面', { exact: true }).uncheck()
  await page.getByLabel('右侧', { exact: true }).uncheck()
  await page.getByRole('button', { name: '生成 2 张多角度图片', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('[data-angle-image] img').length === 2)
  await f.workflow.idle()
  assert.equal(await page.locator('[data-design-plan]').count(), 9)
  project = await f.workflow.get(project.id)
  assert.equal(project.selectedImageId, masterId)
  const views = page.locator('[data-angle-image]')
  await views.nth(1).getByRole('button', { name: '核对一致', exact: true }).click()
  await views.nth(1).getByText('✓ 已核对一致', { exact: true }).waitFor()
  await views.nth(0).getByRole('button', { name: '调整', exact: true }).click()
  await page.getByLabel('角度修正要求').fill('不要圆点，翅膀恢复三条竖线')
  await page.getByRole('button', { name: '修正这个角度', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('[data-angle-image] img').length === 3)
  await f.workflow.idle()
  await views.last().getByRole('button', { name: /大图/ }).click()
  await page.getByRole('dialog', { name: '创作图片预览' }).waitFor()
  await page.keyboard.press('Escape')
  await page.locator('[data-final-design]').scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(evidence, 'final-design-and-views.png') })
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('link', { name: '导出图片与文案', exact: true }).click()
  const download = await downloadEvent; await download.saveAs(path.join(evidence, 'final-design-export.zip'))
  assert.ok((await readFile(path.join(evidence, 'final-design-export.zip'))).includes(Buffer.from('final-designs.json')))
  await slider.fill('3')
  await page.getByRole('button', { name: '再生成 3 张', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('[data-design-plan] img').length === 3)
  await f.workflow.idle()
  const projects = await f.workflow.list(); assert.equal(projects.length, 2); assert.equal(projects.find(p => p.round === 2).previousProjectId, project.id)
  const roundId = projects.find(p => p.round === 2).id
  const counts = { ...f.counts }
  await page.reload(); await page.waitForFunction(id => document.querySelector('[data-reference-studio]')?.getAttribute('data-current-project') === id, roundId)
  await page.locator(`[data-creation-project="${project.id}"]`).click()
  await page.waitForSelector('[data-angle-image]')
  assert.deepEqual(f.counts, counts)
  for (const size of [{ width: 900, height: 900 }, { width: 600, height: 900 }]) {
    await page.setViewportSize(size)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  }
  await page.screenshot({ path: path.join(evidence, 'narrow-creation-v1.png') })
  assert.deepEqual(errors, [])
  const report = { passed: true, browser: 'Google Chrome', mockModels: true, multipleReferences: true, rolesSaved: true, slider3To8: true, conversionTask: true, selectedCopyOnly: true, masterIdentityCardEditable: true, angleGeneration: true, angleApprovalAndRefinement: true, versionHistoryPreserved: true, roundHistory: true, previewAndExport: true, reloadNoExtraCalls: true, counts, pageErrors: errors }
  await writeFile(path.join(evidence, 'creation-v1-browser.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2))
} catch (error) {
  const page = browser.contexts()[0]?.pages()[0]
  if (page) { await page.screenshot({ path: path.join(evidence, 'browser-failure.png') }); await writeFile(path.join(evidence, 'browser-failure.txt'), (await page.locator('body').innerText()).slice(0, 16000)) }
  throw error
} finally { await browser.close(); f.workflow.dispose(); await f.workflow.idle(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) }

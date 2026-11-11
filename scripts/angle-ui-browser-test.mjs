// 复现只有设定卡、尚无角度请求的真实使用状态，验证清晰的生图入口和就地反馈。
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fixture, input } from './etsy-fixture.mjs'
import { makeEtsyRoutes } from '../.etsy-test/host.js'
import { mockDesignImage } from './mock-design-image.mjs'
const { chromium } = createRequire('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/package.json')('playwright')
const evidence = process.env.ETSY_TEST_EVIDENCE || 'E:/etsy/audit/2026-11-09/angle-ui/verification'
const root = await mkdtemp(path.join(tmpdir(), 'etsy-angle-ui-')); await mkdir(evidence, { recursive: true })
let releaseSubmit, holdSubmit = false, submissionHeld = false, rejectNext = false, releaseSecond, rejectModelSave = false
let viewCalls = 0, viewPosts = 0
const secondGate = new Promise(resolve => { releaseSecond = resolve })
const errors = []
const f = fixture(root, { generate: async (request, index) => {
  if (request.feltContext?.stage === 'multi-view') {
    viewCalls++
    if (viewCalls === 1) throw new Error('测试：左侧图片生成失败，请重试')
    if (viewCalls === 2) await secondGate
  }
  return { images: [{ b64: mockDesignImage((index - 1) % 4).toString('base64'), mime: 'image/png' }] }
} })
await f.workflow.ready
const created = await f.workflow.start(input({ count: 3, maxCalls: 100, autoCheck: false, copyTiming: 'selected' }), undefined, { creativity: 'balanced' }); await f.workflow.idle()
const initial = await f.workflow.get(created.id), master = initial.images[0]
await f.workflow.confirmDesign(initial.id, master.id, '条纹保持一致'); await f.workflow.idle()
const before = await f.workflow.get(initial.id), initialCounts = { ...f.counts }
assert.equal(before.finalDesigns[0].requests.length, 0)
const routes = makeEtsyRoutes({ workflow: f.workflow, guard: () => true, parse: body => body, normalize: request => ({ ok: true, request }) })
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname
    if (pathname.endsWith('/model-choices')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, value: { writable: false, imageGroups: [{ id: 'mock', name: '模拟主图', models: ['mock-image'] }, { id: 'gpt', name: '模拟GPT', models: ['gpt-image-2.5-flare'] }], image: { channelId: 'mock', model: 'mock-image' }, analysis: { provider: 'mock', model: 'mock' }, analysisLabel: '隔离Mock', defaultAnalysisLabel: '隔离Mock', analysisModels: [], warnings: [] } })); return }
    if (pathname.endsWith('/set-view-model') && rejectModelSave) { rejectModelSave = false; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: false, message: '测试：模型选择保存失败' })); return }
    if (pathname.endsWith('/generate-views')) {
      viewPosts++
      if (rejectNext) { rejectNext = false; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: false, message: '测试：调用额度不足，请调整当前项目上限' })); return }
      if (holdSubmit) { holdSubmit = false; submissionHeld = true; await new Promise(resolve => { releaseSubmit = resolve }) }
    }
    const route = routes.find(route => route.kind === 'exact' && route.path === pathname)
    if (route) { await route.handler(req, res); return }
    if (pathname === '/preview.js') { res.setHeader('content-type', 'text/javascript'); res.end(await readFile(new URL('../.reference-preview/preview.js', import.meta.url))); return }
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end('<!doctype html><html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;display:flex}#history-host{width:225px;height:100vh;flex-shrink:0;border-right:1px solid #ddd}#root{position:relative;height:100vh;flex:1;min-width:0}:root{--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#f6f7f9;--dsw-alias-border-l1:#ddd;--dsw-alias-label-primary:#282b32;--dsw-alias-label-secondary:#6f7783;--dsw-alias-label-tertiary:#8b94a1}</style><aside id="history-host"></aside><div id="root"></div><script src="/preview.js"></script></html>')
  } catch (error) { errors.push(String(error)); if (!res.headersSent) res.statusCode = 500; res.end('隔离服务错误') }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ channel: 'chrome', headless: true })
async function until(condition) { for (let i = 0; i < 160; i++) { if (await condition()) return; await new Promise(resolve => setTimeout(resolve, 25)) } throw new Error('测试状态等待超时') }
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, acceptDownloads: true }); page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  const panel = page.locator('[data-final-design]'), card = panel.locator('[data-identity-card]')
  await panel.getByRole('heading', { name: '多角度图片', exact: true }).waitFor()
  await panel.scrollIntoViewIfNeeded()
  assert.equal(await panel.locator('[data-angle-placeholder]').count(), 4)
  assert.equal(await card.evaluate(element => element.open), false)
  assert.match(await panel.locator('[data-angle-status]').innerText(), /尚未生成/)
  assert.equal(await panel.getByRole('button', { name: '生成 4 张多角度图片', exact: true }).isEnabled(), true)
  assert.deepEqual(f.counts, initialCounts, '打开主图设定不应自动产生付费生图请求')
  assert.equal(viewPosts, 0)
  assert.match(await panel.locator('[data-view-direction-hint]').innerText(), /左侧图脸朝右.*右侧图脸朝左/)
  const selector = page.getByLabel('侧面背面模型', { exact: true })
  await selector.selectOption(JSON.stringify(['gpt', 'gpt-image-2.5-flare']))
  await until(async () => (await f.workflow.get(initial.id)).finalDesigns[0].sideBackModel?.model === 'gpt-image-2.5-flare')
  await page.reload(); await panel.getByRole('heading', { name: '多角度图片', exact: true }).waitFor()
  await page.waitForFunction(() => document.querySelector('[aria-label="侧面背面模型"]')?.value.includes('gpt-image-2.5-flare'))
  rejectModelSave = true
  await selector.selectOption(JSON.stringify(['mock', 'mock-image']))
  await panel.locator('[data-angle-action-error]').waitFor()
  await page.waitForFunction(() => document.querySelector('[aria-label="侧面背面模型"]')?.value.includes('gpt-image-2.5-flare'))
  assert.deepEqual(f.counts, initialCounts, '切换、刷新及保存失败不触发生图')
  await panel.screenshot({ path: path.join(evidence, 'angles-ready.png') })
  await panel.getByLabel('斜侧面', { exact: true }).uncheck(); await panel.getByLabel('右侧', { exact: true }).uncheck()
  assert.equal(await panel.locator('[data-angle-placeholder]').count(), 2)
  rejectNext = true
  await panel.getByRole('button', { name: '生成 2 张多角度图片', exact: true }).click()
  await panel.locator('[data-angle-action-error]').waitFor()
  assert.match(await panel.locator('[data-angle-action-error]').innerText(), /额度不足/)
  assert.deepEqual(f.counts, initialCounts)
  await panel.screenshot({ path: path.join(evidence, 'angles-local-error.png') })
  await card.locator('summary').click()
  holdSubmit = true
  await panel.getByRole('button', { name: '生成 2 张多角度图片', exact: true }).click()
  await until(() => submissionHeld)
  assert.equal(await panel.getByRole('button', { name: '正在提交图片任务…', exact: true }).isDisabled(), true)
  assert.match(await panel.locator('[data-angle-status]').innerText(), /正在提交/)
  const posted = viewPosts
  await page.waitForTimeout(200)
  assert.equal(viewPosts, posted)
  releaseSubmit()
  await panel.locator('[data-angle-image]').nth(1).waitFor()
  await panel.getByText('测试：左侧图片生成失败，请重试', { exact: true }).waitFor()
  assert.equal(await card.evaluate(element => element.open), false)
  await panel.screenshot({ path: path.join(evidence, 'angles-generating.png') })
  releaseSecond(); await f.workflow.idle()
  await page.waitForFunction(() => document.querySelectorAll('[data-angle-image] img').length === 1)
  await panel.getByRole('button', { name: '重试', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('[data-angle-image] img').length === 2)
  await f.workflow.idle()
  assert.equal(await panel.locator('[data-angle-placeholder]').count(), 0)
  assert.equal(await panel.getByRole('button', { name: '所选角度已有结果', exact: true }).isDisabled(), true)
  assert.equal(viewPosts, 2, '第一次被拒、第二次成功，不重复提交')
  assert.equal(viewCalls, 3, '两张生图加一次失败重试')
  assert.equal((await f.workflow.get(before.id)).selectedImageId, master.id)
  await panel.getByRole('button', { name: '查看左侧大图', exact: true }).click()
  await page.getByRole('dialog', { name: '创作图片预览' }).waitFor(); await page.keyboard.press('Escape')
  await panel.screenshot({ path: path.join(evidence, 'angles-completed.png') })
  const counts = { ...f.counts }
  await page.reload(); await panel.waitFor(); await page.waitForFunction(() => document.querySelectorAll('[data-angle-image] img').length === 2)
  assert.deepEqual(f.counts, counts)
  await page.setViewportSize({ width: 620, height: 950 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await panel.screenshot({ path: path.join(evidence, 'angles-narrow.png') })
  assert.deepEqual(errors, [])
  const result = { passed: true, mockModels: true, viewDirectionHint: true, modelChoicePersists: true, failedModelSaveRollsBack: true, noAutomaticGeneration: true, masterThumbnail: true, ungeneratedSlotsVisible: true, imageCountButton: true, localSubmissionAndErrors: true, imageProgressAndFailureVisible: true, retryGeneratesImage: true, specBelowImagesAndCollapsed: true, noDuplicateCharge: true, previewAndReload: true, narrowLayout: true, pageErrors: errors }
  await writeFile(path.join(evidence, 'angle-ui-browser.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2))
} catch (error) {
  const page = browser.contexts()[0]?.pages()[0]
  if (page) { await page.screenshot({ path: path.join(evidence, 'angle-ui-failure.png') }); await writeFile(path.join(evidence, 'angle-ui-failure.txt'), (await page.locator('body').innerText()).slice(0, 16000)) }
  throw error
} finally { releaseSubmit?.(); releaseSecond(); await browser.close(); f.workflow.dispose(); await f.workflow.idle(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) }

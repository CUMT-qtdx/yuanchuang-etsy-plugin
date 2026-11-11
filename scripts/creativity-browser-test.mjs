// 三档通过同一参考图走实际界面与工作流；模型和图片使用隔离合成结果。
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fixture } from './etsy-fixture.mjs'
import { mockDesignImage } from './mock-design-image.mjs'
import { createEtsyModels, makeEtsyRoutes, validateCopy } from '../.etsy-test/host.js'
const { chromium } = createRequire('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/package.json')('playwright')
const evidence = process.env.ETSY_TEST_EVIDENCE || 'E:/etsy/audit/2026-11-08/creativity-modes/verification'
await mkdir(evidence, { recursive: true })
const root = await mkdtemp(path.join(tmpdir(), 'etsy-creativity-browser-'))
const titles = { gentle: ['同款配色', '局部细节', '小配饰', '轻主题点缀'], balanced: ['服饰改款', '表情动作', '主题造型', '系列搭配'], bold: ['轮廓与姿态', '角色重塑', '主题融合', '组合设计'] }
const labels = { gentle: '小幅调整', balanced: '适度改款', bold: '大胆创作' }
const captures = [], requests = [], errors = []
const models = createEtsyModels(async (_, options) => {
  const mode = options.system.includes('（bold）') ? 'bold' : options.system.includes('（gentle）') ? 'gentle' : 'balanced'
  captures.push({ mode, system: options.system, reference: options.content[1].image_url.url })
  return JSON.stringify({ name: `${labels[mode]}测试创作`, summary: '隔离测试规划', keep: ['小狗辨识度', '手工外观'], uncertainties: [], plans: titles[mode].map((name, i) => ({ name, direction: `${name}变化`, changes: [`原方案改成${name}`, '保留小狗辨识度'], changeAxes: mode === 'bold' ? ['pose', 'silhouette'] : ['palette', 'accessories'], prompt: `Use the reference for a distinct ${mode} puppy design concept ${i + 1}. Show a clearly readable subject with a soft handmade appearance and a clean product background.` })) })
})
const f = fixture(root, { plan: (...args) => models.plan(...args), generate: async (request, i) => { requests.push(request); return { images: [{ b64: mockDesignImage(i % 4).toString('base64'), mime: 'image/png' }] } }, copy: async (_, facts) => validateCopy({ titles: ['Style', 'Palette', 'Character', 'Outfit', 'Theme'].map(word => ({ title: `Playful Puppy ${word}`, titleZh: '可爱小狗设计', strategy: word, explanationZh: '清楚描述设计', keywords: ['puppy'] })), description: 'A playful puppy with a cheerful expression.', tags: ['puppy design'], sellingPoints: [], humanConfirmation: [], factsUsed: {} }, facts, { mode: 'generated' }) })
await f.workflow.ready
const routes = makeEtsyRoutes({ workflow: f.workflow, guard: () => true, parse: body => body, normalize: request => ({ ok: true, request }) })
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname
    if (pathname.endsWith('/model-choices')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, value: { writable: false, imageGroups: [], image: { channelId: 'mock', model: 'mock-image' }, analysis: { provider: 'mock', model: 'mock' }, analysisLabel: '隔离规划测试', defaultAnalysisLabel: '隔离规划测试', analysisModels: [], warnings: [] } })); return }
    const route = routes.find(route => route.kind === 'exact' && route.path === pathname)
    if (route) { await route.handler(req, res); return }
    if (pathname === '/preview.js') { res.setHeader('content-type', 'text/javascript'); res.end(await readFile(new URL('../.reference-preview/preview.js', import.meta.url))); return }
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end('<!doctype html><html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;display:flex}#history-host{width:225px;height:100vh;flex-shrink:0;border-right:1px solid #ddd}#root{position:relative;height:100vh;flex:1;min-width:0}:root{--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#f6f7f9;--dsw-alias-border-l1:#ddd;--dsw-alias-label-primary:#282b32;--dsw-alias-label-secondary:#6f7783;--dsw-alias-label-tertiary:#8b94a1}</style><aside id="history-host"></aside><div id="root"></div><script src="/preview.js"></script></html>')
  } catch (error) { errors.push(String(error)); if (!res.headersSent) res.statusCode = 500; res.end('测试服务失败') }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  for (const mode of ['gentle', 'balanced', 'bold']) {
    await page.getByRole('button', { name: '新创作', exact: true }).click()
    await page.getByRole('radio', { name: new RegExp(labels[mode]) }).click()
    assert.deepEqual(await page.locator('[data-design-plan] h4').allTextContents(), titles[mode])
    await page.getByLabel('参考图片', { exact: true }).setInputFiles({ name: 'same-reference.png', mimeType: 'image/png', buffer: mockDesignImage(0) })
    await page.getByLabel('补充想法（可不填）').fill('保留垂耳')
    await page.screenshot({ path: path.join(evidence, `mode-${mode}-before.png`) })
    await page.getByRole('button', { name: '生成 4 个方案', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('[data-design-plan] img').length === 4)
    await f.workflow.idle()
    const product = (await f.workflow.list()).find(p => p.creativity === mode)
    assert.ok(product)
    assert.equal(product.referencePlan.strategyVersion, 2)
    assert.ok(f.queue.list().filter(task => task.request.projectId === product.id).every(task => task.request.prompt.includes(`[REFERENCE_DESIGN_V2:${mode}]`)))
    const advanced = page.getByText('商品资料与高级选项', { exact: true })
    if (!await advanced.evaluate(element => element.parentElement.open)) await advanced.click()
    const promptDetails = page.getByText('查看自动分析与提示词', { exact: true })
    if (!await promptDetails.evaluate(element => element.parentElement.open)) await promptDetails.click()
    assert.equal(await promptDetails.locator('..').getByText(new RegExp(`REFERENCE_DESIGN_V2:${mode}`)).count(), 4)
  }
  assert.equal(new Set(captures.map(call => call.reference)).size, 1, '三档必须使用完全相同的参考图')
  assert.equal(captures.length, 3)
  assert.equal(requests.length, 12)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  assert.deepEqual(errors, [])
  const report = { passed: true, browser: 'Google Chrome', modelsAreMock: true, sameReferenceForAllModes: true, modes: ['gentle', 'balanced', 'bold'], planningCalls: 3, imageRequests: 12, modeReachesEveryImage: true, actualPromptVisible: true, pageErrors: errors }
  await writeFile(path.join(evidence, 'creativity-browser.json'), JSON.stringify(report, null, 2))
  await writeFile(path.join(evidence, 'captured-planning.json'), JSON.stringify(captures.map(({ mode, system }) => ({ mode, system })), null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally { await browser.close(); f.workflow.dispose(); await f.workflow.idle(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) }

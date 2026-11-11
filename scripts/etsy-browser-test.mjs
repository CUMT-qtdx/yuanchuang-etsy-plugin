import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fixture, facts, modelConfig, copyValue } from './etsy-fixture.mjs'
import { makeRoutes, validateCopy, validateQuality } from '../.etsy-test/host.js'
const runtime = createRequire('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/package.json')
const { chromium } = runtime('playwright')
const root = await mkdtemp(path.join(tmpdir(), 'etsy-browser-'))
const context = fixture(root, { vision: async () => {
  await new Promise(resolve => setTimeout(resolve, 400))
  return validateQuality({ status: 'REVISE', summary: '红围巾位置需要复核', issues: [{ area: '围巾', problem: '可能与参考位置不同', suggestion: '保持主体并调整围巾位置', evidence: 'Mock 视觉观察，仅用于测试' }], uncertainties: [] }, facts, true, modelConfig.model)
} })
await context.workflow.ready
const routes = makeRoutes({ settings: { describe: () => [], mutate: async () => {} },
  resolve: () => ({ apiUrl: modelConfig.apiUrl, apiKey: modelConfig.apiKey }),
  resolveChannels: () => ({ channels: [{ id: 'mock', name: 'Mock', preset: '', apiUrl: modelConfig.apiUrl, apiKey: modelConfig.apiKey, models: [{ alias: 'mock-image', id: 'mock-image' }] }], defaultChannelId: 'mock' }),
  runtime: { queue: context.queue }, etsy: context.workflow,
})
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname
    const route = routes.find(route => route.kind === 'exact' && route.path === pathname)
    if (route) { await route.handler(req, res); return }
    if (pathname === '/preview.js') { res.setHeader('content-type', 'text/javascript'); res.end(await readFile(new URL('../.etsy-preview/preview.js', import.meta.url))); return }
    if (pathname === '/__counts') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(context.counts)); return }
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end('<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;font-family:"Microsoft YaHei",sans-serif}#root{height:100vh;position:relative}:root{--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#f7f7f9;--dsw-alias-border-l1:#e6e7eb;--dsw-alias-label-primary:#25262c;--dsw-alias-label-secondary:#606575;--dsw-alias-label-tertiary:#818694}</style><div id="root"></div><script src="/preview.js"></script></html>')
  } catch (error) { res.statusCode = 500; res.end(String(error)) }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
let browser
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  const errors = [], leakedSecrets = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('response', async response => { if (response.headers()['content-type']?.includes('application/json') && (await response.text()).includes(modelConfig.apiKey)) leakedSecrets.push(response.url()) })
  await page.goto(base)
  await page.getByLabel('商品名称', { exact: true }).fill(facts.name)
  await page.getByLabel('已确认材料／数字媒介').fill(facts.materials)
  await page.getByLabel('已确认尺寸／分辨率').fill(facts.dimensions)
  await page.getByText('以上非空商品参数已人工核实').check()
  await page.getByLabel('商品图片数量').selectOption('6')
  await page.getByRole('button', { name: '生成商品', exact: true }).click()
  await page.locator('[data-etsy-image] img').first().waitFor()
  assert.ok(await page.locator('[data-etsy-workbench]').isVisible())
  await page.waitForFunction(() => document.querySelectorAll('[data-etsy-quality]').length === 6)
  await page.getByLabel('英文标题 5', { exact: true }).waitFor()
  assert.equal(await page.getByLabel(/英文标题 [1-5]/).count(), 5)
  assert.ok((await page.getByLabel('英文商品描述').inputValue()).length > 0)
  assert.equal((await page.request.get(`${base}/__counts`)).ok(), true)
  assert.deepEqual(context.counts, { generation: 6, quality: 6, copy: 1 })
  await page.reload()
  await page.getByLabel('英文标题 5', { exact: true }).waitFor()
  assert.equal(await page.locator('[data-etsy-quality]').count(), 6)
  assert.deepEqual(context.counts, { generation: 6, quality: 6, copy: 1 })
  await page.getByLabel('英文商品描述').fill('Employee edited description with confirmed product information.')
  await page.waitForFunction(() => document.body.textContent.includes('已保存'))
  for (let i = 0; i < 80 && !(await context.workflow.list())[0].copy.description.includes('Employee edited description with confirmed product information.'); i++) await new Promise(resolve => setTimeout(resolve, 30))
  assert.ok((await context.workflow.list())[0].copy.description.includes('Employee edited description with confirmed product information.'))
  const product = (await context.workflow.list())[0]
  const response = await page.request.get(`${base}/api/dsh-imagegen/etsy/export?id=${product.id}`)
  assert.equal(response.status(), 200)
  const output = new URL('../docs/development/', import.meta.url)
  await mkdir(output, { recursive: true })
  await writeFile(new URL('mock-product.zip', output), await response.body())
  await page.screenshot({ path: path.resolve(new URL('etsy-workbench-mock.png', output).pathname.replace(/^\/(.:)/, '$1')), fullPage: true })
  await page.setViewportSize({ width: 680, height: 900 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, '窄窗口不出现横向溢出')
  // 同一宿主路由表保留普通生图接口。
  const ordinary = await page.request.post(`${base}/api/dsh-imagegen/tasks/submit`, { data: { mode: 'text', model: 'mock-image', prompt: 'ordinary regression', size: 'auto', quality: 'auto', n: 1 } })
  const ordinaryBody = await ordinary.json()
  assert.equal(ordinaryBody.ok, true)
  assert.deepEqual(errors, []); assert.deepEqual(leakedSecrets, [])
  await context.workflow.idle()
  const report = { passed: true, browser: 'Google Chrome headless', sixIndependentChecks: true, fiveTitlesAndDescriptionInSameComponent: true, copyCallsPerProduct: 1, refreshWithoutExtraCalls: true, automaticSave: true, exportedZip: true, ordinaryGenerationRoute: true, noPageErrors: true, noSecretInResponses: true, counts: context.counts }
  await writeFile(new URL('browser-test.json', output), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser?.close(); context.workflow.dispose(); await context.workflow.idle(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true })
}

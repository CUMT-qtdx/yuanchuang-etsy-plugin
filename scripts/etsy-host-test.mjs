import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pixel, copyValue } from './etsy-fixture.mjs'
import { mockDesignImage } from './mock-design-image.mjs'
const runtime = createRequire('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/package.json')
const { chromium } = runtime('playwright')
const home = 'E:/etsy/development/host-test-data'
// 每次只清理此脚本拥有的隔离 Mock 商品；严格核对目标，不能指向日常桌面数据。
const testProducts = path.resolve(home, 'dsh-imagegen', 'etsy-products')
if (testProducts !== path.resolve('E:/etsy/development/host-test-data/dsh-imagegen/etsy-products')) throw new Error('隔离测试清理路径不匹配')
await rm(testProducts, { recursive: true, force: true })
const evidence = path.resolve('docs/development')
const counts = { generation: 0, quality: 0, copy: 0 }
const mock = createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk)
  res.setHeader('content-type', 'application/json')
  if (req.url === '/v1/chat/completions') {
    const body = JSON.parse(Buffer.concat(chunks).toString())
    const system = body.messages[0].content
    const planning = system.includes('[ETSY_REFERENCE_PLAN]')
    const copying = system.includes('Etsy 英文商品文案助手')
    const vision = !planning && !copying
    if (planning) counts.planning = (counts.planning ?? 0) + 1
    else counts[vision ? 'quality' : 'copy']++
    const plans = { name: '参考图四方案', summary: 'Mock 图片分析', keep: ['主体轮廓'], uncertainties: ['实物参数待确认'], plans: ['配色', '服饰', '主题', '创新'].map((name, i) => ({ name, direction: `${name}方向`, changes: [`${name}变化`], prompt: `Use the original reference to create a distinctive ${name} variation ${i + 1} of the animal concept, preserving its handmade visual appearance and avoiding text.` })) }
    const result = planning ? plans : vision ? { status: 'UNKNOWN', summary: 'Mock 接口只证明流程，不判断真实图片质量', issues: [], uncertainties: ['测试图片不代表实物'] } : { ...copyValue(), titles: copyValue().titles.map(row => ({ ...row, title: row.title.replaceAll('Wool', 'Felt') })), tags: ['felt cat', 'cat figure'], factsUsed: {}, description: 'A felt-style concept. Physical product details require human confirmation.' }
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }))
  } else if (req.url?.startsWith('/v1/images/')) {
    counts.generation++; res.end(JSON.stringify({ data: [{ b64_json: mockDesignImage(counts.generation - 1).toString('base64') }] }))
  } else if (req.url === '/v1/models') res.end(JSON.stringify({ data: [{ id: 'mock-image' }, { id: 'mock-text' }] }))
  else { res.statusCode = 404; res.end('{}') }
})
await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve))
const endpoint = `http://127.0.0.1:${mock.address().port}/v1`
await mkdir(evidence, { recursive: true })
await writeFile(`${home}/profiles/web/cordis.patch.yml`, JSON.stringify([
  { id: 'imagegen', config: { channels: [{ id: 'mock', preset: '', name: 'Mock 测试接口', apiUrl: endpoint, apiUrlFull: false, models: [{ alias: 'mock-image', id: 'mock-image' }] }], channelSecrets: { mock: 'mock-host-key' }, defaultChannelId: 'mock', defaultModel: 'mock-image', promptApiUrl: endpoint, promptApiKey: 'mock-host-key', promptModel: 'mock-text', etsyVisionModel: 'mock-vision', etsyCopyModel: 'mock-text' } },
  { id: 'locale', config: { preference: 'zh' } },
  { id: 'ui-settings-general', config: { welcomeNoticeVersion: '2026-09-28.1' } },
], null, 2))
const host = spawn(process.execPath, ['E:/etsy/poc/dickpy/npm-cache/_npx/b5e10b118beccd0f/node_modules/@deepseek-ai/dsh/lib/bin.js', 'web', '--port', '0', '--no-open'], { env: { ...process.env, DSH_HOME: home, DEEPSEEK_API_KEY: 'mock-boot-key' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
let output = '', browser
host.stdout.on('data', value => { output += value }); host.stderr.on('data', value => { output += value })
try {
  let target
  for (let i = 0; i < 600; i++) {
    const clean = output.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    const urls = clean.match(/http:\/\/127\.0\.0\.1:\d+\/[^\s<>]*/g) ?? []
    target = urls.find(url => url.includes('?')) ?? urls.at(-1)
    if (target) break
    if (host.exitCode !== null) throw new Error('DSH 宿主提前退出，见私密启动日志')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  if (!target) throw new Error('未得到 DSH 测试宿主地址')
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1560, height: 1100 } }), errors = [], secretLeaks = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('response', async response => { if (response.headers()['content-type']?.includes('application/json')) { try { if ((await response.text()).includes('mock-host-key')) secretLeaks.push(new URL(response.url()).pathname) } catch {} } })
  await page.goto(target)
  if (process.argv.includes('--reference')) {
    await page.locator('[data-dsh-imagegen-tab="image"]').click({ timeout: 45000 })
    await page.locator('[data-reference-studio]').waitFor()
    assert.equal(await page.getByRole('button', { name: '高级工具', exact: true }).isVisible(), true)
    await page.getByLabel('参考图片', { exact: true }).setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: mockDesignImage(0) })
    await page.getByRole('button', { name: '生成四个方案', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('[data-design-plan] img').length === 4, null, { timeout: 45000 })
    await page.waitForFunction(() => document.querySelectorAll('[data-title-index]').length === 5)
    await page.waitForFunction(() => document.querySelectorAll('[data-image-copy-state="completed"]').length === 4)
    assert.deepEqual(counts, { generation: 4, quality: 4, copy: 4, planning: 1 })
    await page.reload(); await page.locator('[data-dsh-imagegen-tab="image"]').click()
    await page.waitForFunction(() => document.querySelectorAll('[data-title-index]').length === 5)
    assert.deepEqual(counts, { generation: 4, quality: 4, copy: 4, planning: 1 })
    await page.screenshot({ path: path.join(evidence, 'reference-dsh-host-mock.png'), fullPage: true })
    await page.getByRole('button', { name: '高级工具', exact: true }).click()
    await page.getByRole('tab', { name: '无限画布', exact: true }).click(); await page.locator('[data-canvas-workspace]').waitFor()
    await page.getByRole('tab', { name: /电商模式/ }).click(); await page.locator('[data-ecommerce-results]').waitFor()
    const pluginVersion = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version
    const report = { passed: true, hostVersion: '0.2.1-rc.5', pluginVersion, environment: '真实 DSH 宿主，模型为 Mock', referenceNoPrompt: true, fourDistinctPlans: true, samePageCopy: true, refreshRestored: true, advancedToolsPreserved: true, counts, pageErrors: errors }
    await writeFile(path.join(evidence, 'reference-dsh-host-test.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2))
  } else {
  await page.locator('[data-dsh-imagegen-tab="image"]').click({ timeout: 45000 })
  await page.getByRole('button', { name: '高级工具', exact: true }).click()
  const panel = page.locator('[data-dsh-imagegen-view]')
  await panel.locator('textarea').first().fill('羊毛毡猫，红围巾，主体比例自然')
  await panel.getByRole('button', { name: 'Etsy 商品工作台', exact: true }).click()
  await page.getByRole('button', { name: '视觉／文案模型', exact: true }).click()
  const visionFields = page.getByRole('group', { name: '视觉质检', exact: true })
  await visionFields.getByLabel('模型 ID', { exact: true }).fill('mock-vision')
  await visionFields.getByLabel('API Key（仅更新时填写）', { exact: true }).fill('mock-host-key')
  await page.getByRole('button', { name: '保存到 DSH 宿主配置', exact: true }).click()
  await page.getByText('独立模型配置', { exact: true }).waitFor({ state: 'hidden' })
  if (!await page.getByLabel('商品名称', { exact: true }).isVisible()) await page.getByText('商品资料与生成设置', { exact: true }).click()
  await page.getByLabel('商品名称', { exact: true }).fill('DSH 集成测试商品')
  await page.getByLabel('商品图片数量').selectOption('6')
  const previousId = await page.getByLabel('商品项目').inputValue()
  await page.getByRole('button', { name: '生成商品', exact: true }).click()
  await page.waitForFunction(before => document.querySelector('select[aria-label="商品项目"]')?.value !== before, previousId)
  await page.waitForFunction(() => document.querySelectorAll('[data-etsy-quality]').length === 6, null, { timeout: 45000 })
  await page.getByLabel('英文标题 5', { exact: true }).waitFor()
  assert.deepEqual(counts, { generation: 6, quality: 6, copy: 1 })
  await page.reload()
  await page.locator('[data-dsh-imagegen-tab="image"]').click()
  await page.getByRole('button', { name: '高级工具', exact: true }).click()
  await page.getByRole('button', { name: 'Etsy 商品工作台', exact: true }).click()
  await page.getByLabel('英文标题 5', { exact: true }).waitFor()
  assert.equal(await page.locator('[data-etsy-quality]').count(), 6)
  assert.deepEqual(counts, { generation: 6, quality: 6, copy: 1 })
  await page.screenshot({ path: path.join(evidence, 'dsh-host-etsy-mock.png'), fullPage: true })
  await page.getByRole('button', { name: '返回普通生图', exact: true }).click()
  await page.getByText('无限画布', { exact: true }).first().click()
  await page.locator('[data-canvas-workspace]').waitFor()
  await page.getByRole('tab', { name: /电商模式/ }).click()
  await page.locator('[data-ecommerce-results]').waitFor()
  await page.getByRole('button', { name: 'Etsy 商品工作台', exact: true }).click()
  await page.locator('[data-etsy-workbench]').waitFor()
  assert.deepEqual(counts, { generation: 6, quality: 6, copy: 1 }, '浏览原有工作区不会启动额外模型调用')
  assert.deepEqual(secretLeaks, [])
  const pluginVersion = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version
  const report = { passed: true, hostVersion: '0.2.1-rc.5', pluginVersion, environment: '真实 DSH 宿主和原始 ImageGenPanel，模型为本地 Mock HTTP 接口', counts, sameDshPage: true, refreshRestored: true, hostSettingsWritePassed: true, hostSettingsSecretsRedacted: true, originalCanvasAndEcommerceSmoke: true, pageErrors: errors }
  await writeFile(path.join(evidence, 'dsh-host-test.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  }
} catch (error) {
  if (browser) {
    const page = browser.contexts()[0]?.pages()[0]
    if (page) { await page.screenshot({ path: path.join(evidence, 'dsh-host-failure.png'), fullPage: true }); await writeFile(path.join(evidence, 'dsh-host-failure.txt'), (await page.locator('body').innerText()).slice(0, 14000)) }
  }
  throw error
} finally {
  await writeFile(`${home}/host-test.private.log`, output)
  await browser?.close(); host.kill(); await new Promise(resolve => mock.close(resolve))
}

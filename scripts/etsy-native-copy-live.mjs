// 真实桌面验收：复用已有图片，质检和文案各调用一次，不重新生图。
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
const runtime = createRequire('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/package.json')
const { chromium } = runtime('playwright')
const evidence = 'E:/etsy/desktop-evidence', root = 'E:/etsy/development/live-test-data'
const prior = JSON.parse(await fs.readFile(`${root}/live-test-result.json`, 'utf8'))
const remaining = 3 - prior.calls.length
if (remaining < 1) throw new Error('用户批准的本轮调用次数已耗尽')
try { await fs.access(`${root}/native-copy-attempt.private.json`); throw new Error('已有文案验收尝试，禁止自动重复调用') } catch (error) { if (error.code !== 'ENOENT') throw error }
const session = JSON.parse((await fs.readFile(`${evidence}/desktop-development-session.json`, 'utf8')).replace(/^\uFEFF/, ''))
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${session.DebugPort}`)
const page = browser.contexts().flatMap(context => context.pages()).find(page => page.url().startsWith('dsh-app://app'))
if (!page) throw new Error('未找到真实 DSH 桌面页面')
const api = (action, body = {}) => page.evaluate(async ({ action, body }) => {
  const response = await fetch(`/api/dsh-imagegen/etsy/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const value = await response.json()
  if (!value.ok) throw new Error(value.message || '商品接口失败')
  return value.value
}, { action, body })
const bytes = await fs.readFile('E:/etsy/desktop-data/dsh-imagegen/images/71a9ed6c-e07f-4e7a-92b5-9f6fbdec29ce-0.png')
const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20)
if (remaining < 2) throw new Error('剩余额度不足以执行质检和文案，停止')
await fs.writeFile(`${root}/native-copy-attempt.private.json`, JSON.stringify({ startedAt: new Date().toISOString(), priorAttempts: prior.calls.length, approvedTotal: 3, newMaximum: remaining, action: 'existing-image-quality-and-copy', automaticQuality: true }, null, 2))
const created = await api('adopt', { requestKey: `native-${crypto.randomUUID()}`, count: 1, maxCalls: remaining, autoCheck: true,
  image: { b64: bytes.toString('base64'), mime: 'image/png' },
  facts: { name: 'Needle-Felt Dog Digital Concept', type: 'digital_illustration', materials: 'AI-generated digital illustration depicting a needle-felt appearance; not a physical felt product', dimensions: `${width} x ${height} pixels`, packaging: '1 PNG concept image for internal design review; no physical packaging', processing: '', delivery: 'Digital concept image for internal review only; no physical item or shipping promise', personalization: '', confirmed: true, authenticityConfirmed: false,
    requirements: 'Digital concept poster of a tan and white needle-felt style dog with upright ears and glossy dark eyes. Promotional words in the image do not prove material composition, safety, skin-friendliness, comfort or production method. Do not repeat those claims as product facts.' },
})
let current = created
for (let attempt = 0; attempt < 90; attempt++) {
  current = await api('get', { id: created.id })
  if (!['queued', 'running'].includes(current.copyStage.status) && !['queued', 'running'].includes(current.images[0].quality.status)) break
  await new Promise(resolve => setTimeout(resolve, 2000))
}
await page.locator('[data-dsh-imagegen-tab="image"]').click()
await page.getByRole('tab', { name: '普通生图', exact: true }).click()
await page.getByRole('button', { name: 'Etsy 商品工作台', exact: true }).click()
await page.getByLabel('商品项目', { exact: true }).selectOption(current.id)
const summary = { checkedAt: new Date().toISOString(), nativeDesktop: true, pluginVersion: '1.15.4-etsy.7', id: current.id,
  imageSource: 'existing-generated-image', imageGenerationCallsThisStep: 0, quality: { stage: current.images[0].quality, report: current.images[0].report },
  copy: current.copyStage, titles: current.copy?.titles.length ?? 0, tags: current.copy?.tags.length ?? 0,
  calls: current.calls.map(({ stage, model, status }) => ({ stage, model, status })), priorAttempts: prior.calls.length,
  totalAttempts: prior.calls.length + current.calls.length, approvedMaximum: 3 }
await fs.writeFile(`${root}/native-copy-result.json`, JSON.stringify(summary, null, 2))
await page.screenshot({ path: `${evidence}/etsy-native-copy-live.png`, fullPage: true })
console.log(JSON.stringify(summary, null, 2))
process.exit(0)

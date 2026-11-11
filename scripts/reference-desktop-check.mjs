// 桌面只读验收：不上传参考图、不点击生成、不调用模型。
import { readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const { chromium } = createRequire('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/package.json')('playwright')
const root = 'E:/etsy/desktop-evidence', meta = JSON.parse((await readFile(`${root}/reference-desktop-session.json`, 'utf8')).replace(/^\uFEFF/, ''))
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${meta.DebugPort}`)
const page = browser.contexts().flatMap(context => context.pages()).find(page => page.url().startsWith('dsh-app://app'))
if (!page) throw new Error('未找到桌面 DSH 页面')
const calls = () => page.evaluate(async () => { const r = await fetch('/api/dsh-imagegen/etsy/list', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); const p = await r.json(); return p.value.reduce((sum, product) => sum + product.calls.length, 0) })
const before = await calls()
await page.locator('[data-dsh-imagegen-tab="image"]').click()
await page.locator('[data-reference-studio]').waitFor()
assert.equal(await page.locator('[data-design-plan]').count(), 4)
assert.equal(await page.getByRole('button', { name: '生成四个方案', exact: true }).isDisabled(), true)
assert.equal(await page.getByLabel('补充想法（可不填）').inputValue(), '')
assert.equal(await page.getByRole('button', { name: '高级工具', exact: true }).isVisible(), true)
assert.equal(await page.locator('[data-simple="true"] > aside').isVisible(), false)
const after = await calls(); assert.equal(after, before)
await page.screenshot({ path: `${root}/reference-studio-native.png`, fullPage: true })
const result = { checkedAt: new Date().toISOString(), pluginVersion: meta.Version, nativeDesktop: true, defaultSimpleMode: true, fourPlanSlots: true, noRequiredPrompt: true, emptyReferenceCannotGenerate: true, oldSidebarHiddenInSimpleMode: true, inferenceCallDelta: after - before, screenshot: `${root}/reference-studio-native.png` }
await writeFile(`${root}/reference-native-check.json`, JSON.stringify(result, null, 2))
const idle = await page.evaluate(async () => {
  const response = await fetch('/api/dsh-imagegen/etsy/list', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  const products = (await response.json()).value
  const active = products.some(product => [product.planning, product.copyStage, ...product.images.flatMap(image => [image.generation, image.quality])].some(stage => stage && ['running', 'queued'].includes(stage.status)))
  const studio = document.querySelector('[data-reference-studio]')
  const uploaded = [...(studio?.querySelectorAll('img') ?? [])].some(image => image.alt === '参考图预览' && image.src.startsWith('data:'))
  const notes = [...(studio?.querySelectorAll('input') ?? [])].find(input => input.getAttribute('aria-label') === '补充想法（可不填）')?.value
  return !active && !uploaded && !notes && !document.body.textContent?.includes('有未保存修改')
})
await writeFile(`${root}/reference-reload-idle.json`, JSON.stringify({ idle, checkedAt: new Date().toISOString() }))
console.log(JSON.stringify({ ...result, safeToLeaveDebugSession: idle }, null, 2)); process.exit(0)

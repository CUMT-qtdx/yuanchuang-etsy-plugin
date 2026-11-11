// 修复后的桌面只读核对：只读取商品、切换展示页签和刷新，不触发模型请求。
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

const id = process.argv.find(value => value.startsWith('--product='))?.slice(10)
if (!id || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('请指定 --product=商品ID')
const evidence = 'E:/etsy/desktop-evidence'
const read = async file => JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''))
const session = await read(`${evidence}/copy-hotfix-desktop-session.json`)
const baseline = await read(`${evidence}/copy-hotfix-baseline.private.json`)
const recovery = await read(`${evidence}/copy-recovery-result.json`)
assert.equal(recovery.productId, id)
const { chromium } = createRequire('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/package.json')('playwright')
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${session.DebugPort}`)
try {
  const page = browser.contexts().flatMap(context => context.pages()).find(page => page.url().startsWith('dsh-app://app'))
  if (!page) throw new Error('未找到 DSH 桌面页面')
  const products = async () => page.evaluate(async () => {
    const response = await fetch('/api/dsh-imagegen/etsy/list', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    if (!response.ok) throw new Error('商品读取失败')
    return (await response.json()).value
  })
  const before = await products()
  assert.equal(before.reduce((sum, p) => sum + p.calls.length, 0), baseline.calls)
  const product = before.find(product => product.id === id)
  assert.ok(product?.copy)
  assert.equal(product.copyStage.status, 'completed')
  assert.equal(product.copyStage.error, undefined)
  assert.equal(product.copyImageId, product.selectedImageId)
  await page.locator('[data-dsh-imagegen-tab="image"]').click()
  await page.locator('[data-reference-studio]').waitFor()
  await page.getByLabel('创作历史', { exact: true }).selectOption(id)
  const panel = page.locator('[data-reference-copy]')
  await panel.locator('[data-title-index]').first().waitFor()
  assert.equal(await panel.locator('[data-title-index]').count(), 5)
  assert.ok(JSON.stringify(await panel.locator('[data-title-index]').allTextContents()) === JSON.stringify(product.copy.titles.map(title => title.title)), '界面标题应与恢复文案一致')
  assert.equal(await panel.getByText('首张设计完成后，文案会自动出现在这里。', { exact: true }).count(), 0)
  assert.ok(!(await panel.innerText()).includes('模型引用了未经确认或不一致'))
  await page.screenshot({ path: `${evidence}/copy-hotfix-native.png`, fullPage: true })
  await panel.getByRole('button', { name: '描述', exact: true }).click()
  assert.ok((await panel.locator('[data-copy-description]').innerText()).trim() === product.copy.description.trim(), '描述应完整显示')
  await panel.getByRole('button', { name: '标签', exact: true }).click()
  const tagText = await panel.innerText()
  assert.ok(product.copy.tags.every(tag => tagText.includes(tag)), '全部标签应显示')
  await page.reload()
  await page.locator('[data-dsh-imagegen-tab="image"]').click()
  await page.locator('[data-reference-studio]').waitFor()
  await panel.locator('[data-title-index]').first().waitFor()
  assert.equal(await panel.locator('[data-title-index]').count(), 5)
  const after = await products()
  assert.equal(after.reduce((sum, p) => sum + p.calls.length, 0), baseline.calls)
  const base = 'E:/etsy/desktop-data/dsh-imagegen'
  const logCount = (await fs.readdir(path.join(base, 'etsy-model-calls'))).filter(file => file.endsWith('.json')).length
  assert.equal(logCount, baseline.modelLogFiles)
  const original = await read(path.join(recovery.backup, 'product.json'))
  assert.ok(JSON.stringify(original.facts) === JSON.stringify(product.facts), '原始商品资料应保留')
  assert.equal(product.images.length, original.images.length)
  const files = new Set([...original.referenceFiles, ...original.images.flatMap(image => image.files)])
  const sha = data => createHash('sha256').update(data).digest('hex')
  for (const file of files) assert.equal(sha(await fs.readFile(path.join(base, 'etsy-products', id, file))), sha(await fs.readFile(path.join(recovery.backup, file))))
  const result = { checkedAt: new Date().toISOString(), pluginVersion: session.Version, nativeDesktop: true, titles: product.copy.titles.length, tags: product.copy.tags.length, descriptionVisible: true, staleErrorAbsent: true, refreshRestored: true, selectedImageMatchesCopy: true, imageVersions: product.images.length, originalAssetFilesPreserved: files.size, originalFactsPreserved: true, inferenceCallDelta: 0, modelLogDelta: 0, screenshot: `${evidence}/copy-hotfix-native.png` }
  await fs.writeFile(`${evidence}/copy-hotfix-verification.json`, JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} finally {
  // CDP 连接关闭只断开本测试，桌面程序继续运行。
  await browser.close()
}

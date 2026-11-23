// 用真实浏览器验证居中弹窗自动提示、取消继续使用、一键立即更新、校验失败拦截、忙任务保护与重启交接。
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const { chromium } = createRequire('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/package.json')('playwright')
const evidence = new URL('../../evidence/', import.meta.url)
await fs.mkdir(evidence, { recursive: true })

let progress = { phase: 'idle', receivedBytes: 0, totalBytes: 8388608, updatedAt: Date.now() }
let busy = true
let downloads = 0
let restarts = 0
let corrupt = true
let latestVersion = '2.1.5-etsy'
const requests = []
const errors = []

const server = createServer(async (req, res) => {
  if (req.url === '/preview.js') {
    res.setHeader('content-type', 'text/javascript')
    res.end(await fs.readFile(new URL('../.update-preview/preview.js', import.meta.url)))
    return
  }
  if (req.url.startsWith('/api/')) {
    requests.push(req.url)
    res.setHeader('content-type', 'application/json')
    const reply = x => res.end(JSON.stringify(x))
    if (req.url.endsWith('/check')) {
      return reply({
        ok: true,
        update: {
          currentVersion: '2.1.4-etsy',
          latestVersion,
          updateAvailable: true,
          releaseNotes: '## 更新内容\n\n1. 左侧「我的创作」栏支持滚轮滚动与分组整理。\n2. 新增毛毡小挂饰内置提示词与悬挂／平铺预设。',
          releaseUrl: `https://github.com/CUMT-qtdx/yuanchuang-etsy-plugin/releases/tag/v${latestVersion}`,
        },
      })
    }
    if (req.url.endsWith('/download')) {
      downloads++
      progress = { ...progress, phase: 'downloading', version: latestVersion, receivedBytes: 2097152, message: '正在下载新版安装器' }
      setTimeout(() => {
        progress = corrupt
          ? { ...progress, phase: 'failed', message: '安装器 SHA-256 校验失败，未执行任何安装' }
          : { ...progress, phase: 'ready', receivedBytes: 8388608, message: '已下载并校验，正在准备重启更新' }
      }, 650)
      return reply({ ok: true, progress })
    }
    if (req.url.endsWith('/status')) return reply({ ok: true, progress })
    if (req.url.endsWith('/apply')) {
      if (busy) return reply({ ok: false, message: '还有生图、分析或文案任务进行中，请完成后再更新' })
      restarts++
      return reply({ ok: true, updatedVersion: latestVersion, restartRequired: true })
    }
    return reply({ ok: false, message: 'unknown' })
  }
  res.setHeader('content-type', 'text/html')
  res.end('<!doctype html><meta charset="utf-8"><body style="margin:0"><div id="root"></div><script src="/preview.js"></script></body>')
})

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const viewport = { width: 1120, height: 760 }
  const page = await browser.newPage({ viewport })
  page.on('pageerror', e => errors.push(e.message))

  // 1. 首次打开自动在界面正中央弹出更新对话框，且背景工作台保持可见
  await page.goto('http://127.0.0.1:' + server.address().port)
  await page.getByRole('button', { name: '插件更新', exact: true }).filter({ hasText: '发现新版 2.1.5-etsy' }).waitFor()
  const dialog = page.getByRole('dialog', { name: '发现新版本 2.1.5-etsy' })
  await dialog.waitFor()
  const box = await dialog.boundingBox()
  assert.ok(box, '更新弹窗应有可见尺寸')
  const centerX = box.x + box.width / 2
  const centerY = box.y + box.height / 2
  assert.ok(Math.abs(centerX - viewport.width / 2) < 12, `弹窗应水平居中，实际 centerX=${centerX}`)
  assert.ok(Math.abs(centerY - viewport.height / 2) < 12, `弹窗应垂直居中，实际 centerY=${centerY}`)
  await page.screenshot({ path: fileURLToPath(new URL('update-auto-open.png', evidence)) })

  // 2. 点击「取消」直接关闭弹窗回到工作台，且刷新后同一版本不重复弹窗
  await page.getByRole('button', { name: '取消', exact: true }).click()
  assert.equal(await dialog.count(), 0, '点击取消后应关闭弹窗')
  await page.reload()
  await page.getByRole('button', { name: '插件更新', exact: true }).filter({ hasText: '发现新版 2.1.5-etsy' }).waitFor()
  await page.waitForTimeout(200)
  assert.equal(await dialog.count(), 0, '同一版本取消后刷新不应重复自动弹出')

  // 3. 发布更新的版本后，再次首次打开应重新自动居中弹出
  latestVersion = '2.1.6-etsy'
  await page.reload()
  await page.getByRole('button', { name: '插件更新', exact: true }).filter({ hasText: '发现新版 2.1.6-etsy' }).waitFor()
  const dialog2 = page.getByRole('dialog', { name: '发现新版本 2.1.6-etsy' })
  await dialog2.waitFor()

  // 4. 点击「立即更新」→ 校验失败时拦截并不触发重启
  await page.getByRole('button', { name: '立即更新', exact: true }).click()
  await page.getByRole('progressbar', { name: '更新下载进度' }).waitFor()
  await page.screenshot({ path: fileURLToPath(new URL('update-downloading.png', evidence)) })
  await page.getByText('安装器 SHA-256 校验失败，未执行任何安装', { exact: true }).waitFor()
  assert.equal(restarts, 0)

  // 5. 再次点击「立即更新」→ 下载校验通过后自动尝试安装 → 被忙任务拦截保留在弹窗内提示
  corrupt = false
  await page.getByRole('button', { name: '立即更新', exact: true }).click()
  await page.getByText('还有生图、分析或文案任务进行中，请完成后再更新', { exact: true }).waitFor()
  assert.equal(restarts, 0)
  await page.screenshot({ path: fileURLToPath(new URL('update-busy-protection.png', evidence)) })

  // 6. 忙任务结束后直接点「立即更新」→ 复用已校验安装包直接重启（不重复下载）
  busy = false
  await page.getByRole('button', { name: '立即更新', exact: true }).click()
  await page.getByText('正在退出 DSH 并安装新版，请稍候', { exact: true }).waitFor()
  assert.equal(restarts, 1)
  assert.equal(downloads, 2)
  assert.deepEqual(errors, [])

  await fs.writeFile(
    new URL('update-browser-result.json', evidence),
    JSON.stringify({
      passed: true,
      centeredModal: { centerX, centerY, width: box.width, height: box.height },
      autoOpenOncePerVersion: true,
      cancelReturnsToPlatform: true,
      oneClickUpdateNow: true,
      corruptFileRejected: true,
      busyTaskBlocksRestart: true,
      restartHandoffs: restarts,
      downloads,
      requests,
    }, null, 2),
  )
  console.log('居中更新弹窗浏览器验收全部通过')
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}

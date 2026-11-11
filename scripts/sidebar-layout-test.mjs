// 模拟真实宿主的横向 flex 历史容器，校验创作侧栏能占满可用宽度。
// 不访问实际 DSH 数据，不上传图片，不调用模型。
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const { chromium } = createRequire('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/package.json')('playwright')
const finished = { status: 'completed', attempts: 1 }
const projects = ['陶瓷花盆四方案创作', '小兔胸针配色设计'].map((name, index) => ({
  id: `layout-project-${index}`, source: 'generated', facts: { name }, createdAt: 1794018000000 - index * 3600000,
  copyStage: finished, images: Array.from({ length: 5 }, (_, number) => ({ id: `image-${number}`, files: [`image-${number}.png`], generation: finished, quality: finished, ...(number === 4 ? { parentImageId: 'image-0' } : {}) })),
}))
const preview = await readFile(new URL('../.reference-preview/preview.js', import.meta.url))
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;display:flex;font:13px/1.5 "Microsoft YaHei",system-ui,sans-serif;color:#28332d}
:root{--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#f6f7f9;--dsw-alias-border-l1:#e4e7ed;--dsw-alias-label-primary:#282b32;--dsw-alias-label-secondary:#6f7783;--dsw-alias-label-tertiary:#8b94a1}
#sidebar{width:272px;flex:0 0 var(--sidebar-width,272px);height:100vh;display:flex;flex-direction:column;background:#f7f9f8;padding-top:14px}
#brand{font-size:18px;font-weight:700;margin:0 14px 13px}#session{margin:0 12px 10px;padding:11px 0;border:1px solid #dce2de;border-radius:10px;background:white;text-align:center}
#region{position:relative;flex:1;min-height:0}#history-host{position:absolute;inset:0;display:flex;min-width:0;min-height:0;padding:6px 4px;overflow:hidden;background:white}
#root{height:100vh;position:relative;flex:1;min-width:0}#notice{position:fixed;bottom:10px;left:14px;background:#fff;padding:3px 5px;border:1px solid #e3e7e4;border-radius:5px;color:#68756e;font-size:10px;z-index:999}
</style><aside id="sidebar"><div id="brand">DSH 宿主布局模拟</div><div id="session">＋ 新会话</div><div id="region"><div id="history-host" data-dsh-imagegen-history-host></div></div></aside><div id="root"></div><div id="notice">合成项目 · 侧栏宽度验收</div><script src="/preview.js"></script></html>`
const server = createServer((req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname
  if (pathname === '/preview.js') { res.setHeader('content-type', 'text/javascript'); res.end(preview); return }
  if (pathname === '/api/dsh-imagegen/etsy/list') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, value: projects })); return }
  if (pathname === '/api/dsh-imagegen/etsy/model-choices') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, value: { writable: false, imageGroups: [], image: { channelId: '', model: '' }, analysis: { provider: '', model: '' }, analysisLabel: 'Mock', defaultAnalysisLabel: 'Mock', analysisModels: [], warnings: [] } })); return }
  res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const evidence = new URL('../docs/development/', import.meta.url)
await mkdir(evidence, { recursive: true })
let browser
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } }), errors = [], measures = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.locator('[data-creation-project]').first().waitFor()
  const measure = () => page.evaluate(() => {
    const host = document.querySelector('[data-dsh-imagegen-history-host]'), nav = document.querySelector('[data-creation-history]')
    const number = value => Number.parseFloat(value) || 0, rect = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width } }
    const hs = getComputedStyle(host), ns = getComputedStyle(nav), hb = rect(host), nb = rect(nav)
    const buttons = [...nav.querySelectorAll('[data-creation-project]')], search = nav.querySelector('[aria-label="搜索创作"]'), create = nav.querySelector('[aria-label="新创作"]'), list = buttons[0].parentElement
    return { host: hb, nav: nb, availableWidth: host.clientWidth - number(hs.paddingLeft) - number(hs.paddingRight), navContentLeft: nb.left + number(ns.paddingLeft), navContentRight: nb.right - number(ns.paddingRight), create: rect(create), search: rect(search), list: rect(list), cards: buttons.map(rect), documentOverflow: document.documentElement.scrollWidth > innerWidth }
  })
  // 仅在合成页复现旧版缺少伸展规则的状态，便于确认是水平方向问题。
  const oldStyle = await page.addStyleTag({ content: '[data-creation-history]{width:auto!important;flex:0 1 auto!important;min-width:0!important;max-width:none!important}' })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
  const before = await measure()
  assert.ok(before.availableWidth - before.nav.width > 25, '模拟旧样式应复现侧栏未铺满的空白')
  await page.locator('#sidebar').screenshot({ path: fileURLToPath(new URL('sidebar-width-before-simulated.png', evidence)) })
  await oldStyle.evaluate(element => element.remove())
  for (const viewportWidth of [1280, 1440]) for (const sidebarWidth of [216, 272, 320]) {
    await page.setViewportSize({ width: viewportWidth, height: 820 })
    await page.locator('#sidebar').evaluate((element, width) => element.style.setProperty('--sidebar-width', `${width}px`), sidebarWidth)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
    const result = await measure()
    assert.ok(Math.abs(result.nav.width - result.availableWidth) <= 1, `视口 ${viewportWidth} / 侧栏 ${sidebarWidth}: 创作导航需占满宿主可用宽度，实际 ${result.nav.width}，预期 ${result.availableWidth}`)
    for (const box of [result.create, result.search, result.list, ...result.cards]) {
      assert.ok(Math.abs(box.left - result.navContentLeft) <= 1, '新创作、搜索和全部历史卡片左边界对齐')
      assert.ok(Math.abs(box.right - result.navContentRight) <= 1, '新创作、搜索和全部历史卡片右边界对齐')
    }
    assert.equal(result.documentOverflow, false)
    measures.push({ viewportWidth, sidebarWidth, ...result })
  }
  await page.setViewportSize({ width: 1280, height: 820 })
  await page.locator('#sidebar').evaluate(element => element.style.setProperty('--sidebar-width', '272px'))
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)))
  await page.locator('#sidebar').screenshot({ path: fileURLToPath(new URL('sidebar-width-after.png', evidence)) })
  assert.deepEqual(errors, [])
  const report = { passed: true, modelCalls: 0, data: '仅合成项目', hostLayout: '真实宿主一致的横向 flex + 6px 4px padding', baselineSimulated: true, before, measures }
  await writeFile(new URL('sidebar-layout-test.json', evidence), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ passed: true, scenarios: measures.length, beforeNavWidth: before.nav.width, beforeAvailableWidth: before.availableWidth, allEdgesAligned: true, modelCalls: 0 }, null, 2))
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)) }

/** Run after building scripts/gallery-preview.config.ts. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url), runtime = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? createRequire(`${process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES}/.gallery-test.cjs`) : require
const { chromium } = runtime('playwright')
const tokens = `${process.env.GALLERY_FONT ? '@font-face{font-family:PreviewCJK;src:url(/font)}' : ''}:root{--dsw-font-family:PreviewCJK,system-ui,sans-serif;--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#fafafa;--dsw-alias-bg-layer-2:#f2f2f5;--dsw-alias-border-l1:#e5e5e9;--dsw-alias-border-l2:#d9d9df;--dsw-alias-label-primary:#25252b;--dsw-alias-label-secondary:#5e6069;--dsw-alias-label-tertiary:#8a8c96;--dsw-alias-brand-primary:#33343a}*{box-sizing:border-box}html,body,#root{margin:0;height:100%;font-family:var(--dsw-font-family)}button,input{font-family:inherit}.fixture{height:100%;display:flex;flex-direction:column}.header{height:60px;flex:none;display:flex;align-items:center;gap:60px;padding:0 24px;border-bottom:1px solid #eee;font-size:13px}.stage{position:relative;display:flex;flex:1;min-height:0;gap:20px;padding:20px}.filters{flex:none;width:190px;padding:18px 8px;font-size:12px;line-height:2.5;color:#6a6b73}hr{border:0;border-top:1px solid #eee;margin:24px 0}@media(max-width:760px){.filters,.header span{display:none}.stage{padding:10px}.header{height:56px}}`
const server = createServer((req, res) => {
  if (req.url === '/preview.js') { res.setHeader('content-type', 'text/javascript'); res.end(readFileSync(new URL('../.gallery-preview/preview.js', import.meta.url))); return }
  if (req.url === '/font' && process.env.GALLERY_FONT) { res.end(readFileSync(process.env.GALLERY_FONT)); return }
  if (req.url?.startsWith('/sample/')) { const i = Number(req.url.split('/').pop().split('.')[0]); res.setHeader('content-type', 'image/svg+xml'); res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="650"><rect width="600" height="650" fill="${['#e8e2d7', '#d4dcd9', '#e5d9c5'][i % 3]}"/><circle cx="450" cy="180" r="170" fill="#fff" opacity=".25"/><ellipse cx="300" cy="510" rx="130" ry="20" fill="#a5a293" opacity=".25"/><rect x="230" y="230" width="140" height="270" rx="20" fill="#faf7ef"/><rect x="247" y="180" width="106" height="70" rx="8" fill="#687565"/><text x="300" y="365" text-anchor="middle" fill="#687565" font-family="serif" font-size="36">pure.</text></svg>`); return }
  res.setHeader('content-type', 'text/html'); res.end(`<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${tokens}</style><div id="root"></div><script src="/preview.js"></script></html>`)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await chromium.launch({ headless: true, ...process.env.GALLERY_CHROMIUM_PATH ? { executablePath: process.env.GALLERY_CHROMIUM_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {} })
  const page = await browser.newPage({ viewport: { width: 1560, height: 900 } }), errors = []
  page.on('pageerror', error => errors.push(error.message))
  const url = `http://127.0.0.1:${server.address().port}`
  const sort = page.getByRole('button', { name: '排序', exact: true })
  await page.goto(`${url}/?legacy=1`); await sort.waitFor()
  assert.equal(await sort.evaluate(el => el.getBoundingClientRect().width > el.parentElement.getBoundingClientRect().width * .9), true, 'reproduce the full-row sort bug')
  await page.goto(url); await sort.waitFor(); await page.evaluate(() => document.fonts.ready)
  const folder = new URL('../docs/images/', import.meta.url); mkdirSync(folder, { recursive: true })
  for (const viewport of [{ width: 1560, height: 900 }, { width: 1100, height: 700 }, { width: 900, height: 500 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    assert.equal(await sort.evaluate(el => el.getBoundingClientRect().width <= 138), true, 'sort stays compact')
    assert.equal(await page.locator('[data-template-library-trigger]').evaluate(el => { const a = el.getBoundingClientRect(), b = el.offsetParent.getBoundingClientRect(); return Math.abs(a.y + a.height / 2 - b.y - b.height / 2) < 1 }), true, 'template entry is vertically centered in its workspace')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal page overflow')
    const toolbar = page.locator('[class*="galleryToolbarActions"]')
    assert.equal(await toolbar.evaluate(el => { const r = el.getBoundingClientRect(); return [...el.children].every(child => { const b = child.getBoundingClientRect(); return b.x >= r.x - 1 && b.right <= r.right + 1 }) }), true, 'all toolbar actions remain within the available width')
    if (viewport.width === 1560) {
      assert.equal(await toolbar.evaluate(el => (() => { const centers = [...el.children].map(child => { const r = child.getBoundingClientRect(); return r.y + r.height / 2 }); return Math.max(...centers) - Math.min(...centers) < 2 })()), true, 'wide desktop toolbar is a single aligned row')
      await page.screenshot({ path: new URL('gallery-layout-181-desktop.png', folder).pathname })
    }
    if (viewport.width === 390) await page.screenshot({ path: new URL('gallery-layout-181-mobile.png', folder).pathname })
  }
  await sort.click(); await page.getByRole('option', { name: '最早发布', exact: true }).click()
  assert.equal(await sort.textContent(), '最早发布', 'sort selection still works')
  assert.equal(await sort.evaluate(el => el === document.activeElement), true, 'sort focus returns after selection')
  const grid = page.locator('[class*="galleryMasonry"]')
  await grid.evaluate(el => { el.scrollTop = el.scrollHeight })
  assert.equal(await grid.evaluate(el => el.scrollTop > 0), true, 'gallery content remains scrollable')
  assert.deepEqual(errors, [])
  console.log('PASS gallery layout: full-row bug reproduced, compact aligned toolbar, sorting/focus, scrolling, desktop/narrow/mobile and vertically centered template entry')
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)) }

/** Build first: pnpm exec tsdown --config scripts/generation-preview.config.ts */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const runtime = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? createRequire(`${process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES}/.generation-test.cjs`) : require
const { chromium } = runtime('playwright')
const tokens = `${process.env.GENERATION_FONT ? '@font-face{font-family:PreviewCJK;src:url(/font)}' : ''}:root{--dsw-alias-bg-layer-1:#fcfcfd;--dsw-alias-border-l1:#e9e9ee;--dsw-alias-label-primary:#25262a;--dsw-alias-label-secondary:#575b65;--dsw-alias-label-tertiary:#858b98}.fixture[data-dark=true]{--dsw-alias-bg-layer-1:#1b1e26;--dsw-alias-border-l1:#343844;--dsw-alias-label-primary:#e8ebf2;--dsw-alias-label-secondary:#d0d5e2;--dsw-alias-label-tertiary:#a0a9bc}*{box-sizing:border-box}html,body,#root{margin:0;height:100%;font-family:PreviewCJK,system-ui,sans-serif}.fixture{height:100%;display:flex;flex-direction:column;gap:14px;padding:18px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}header{display:flex;flex-wrap:wrap;align-items:center;gap:10px;font-size:12px}select{max-width:110px;padding:4px}main{flex:1;min-height:0}label{display:flex;align-items:center}`
const server = createServer((req, res) => {
  if (req.url === '/font' && process.env.GENERATION_FONT) { res.end(readFileSync(process.env.GENERATION_FONT)); return }
  if (req.url === '/preview.js') { res.setHeader('content-type', 'text/javascript'); res.end(readFileSync(new URL('../.generation-preview/preview.js', import.meta.url))); return }
  res.setHeader('content-type', 'text/html'); res.end(`<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${tokens}</style><div id="root"></div><script src="/preview.js"></script></html>`)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await chromium.launch({ headless: true, ...process.env.GENERATION_CHROMIUM_PATH ? { executablePath: process.env.GENERATION_CHROMIUM_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {} })
  const page = await browser.newPage({ viewport: { width: 1000, height: 820 } }), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  const field = page.locator('[data-generation-animation]')
  await field.waitFor()
  await page.evaluate(() => document.fonts.ready)
  assert.equal(await field.locator('circle').count(), 475)
  // Inspect computed motion in Chromium, not only the presence of keyframes.
  const frames = []
  for (const time of [0, 1100]) {
    frames.push(await field.locator('circle').first().evaluate((dot, t) => {
      dot.getAnimations()[0].pause(); dot.getAnimations()[0].currentTime = t
      return getComputedStyle(dot).transform
    }, time))
  }
  assert.notEqual(frames[0], frames[1], 'dots actually change scale over time')
  for (const mode of ['文生图', '图生图']) {
    await page.getByLabel('模式', { exact: true }).selectOption(mode)
    for (const viewport of [{ width: 1000, height: 820 }, { width: 390, height: 780 }, { width: 800, height: 360 }]) {
      await page.setViewportSize(viewport)
      for (const state of ['submitting', 'queued', 'running']) {
        await page.getByLabel('状态', { exact: true }).selectOption(state)
        assert.ok(await field.isVisible())
        assert.ok(!(await field.textContent()).includes('%'))
        assert.equal(await field.evaluate(el => {
          const parent = el.closest('main').getBoundingClientRect(), child = el.getBoundingClientRect(), badge = el.lastElementChild.getBoundingClientRect()
          return child.height > 50 && child.left >= parent.left && child.right <= parent.right && child.bottom <= parent.bottom && badge.left >= parent.left && badge.bottom <= parent.bottom && document.documentElement.scrollWidth <= innerWidth
        }), true, `${mode} ${state} ${viewport.width}x${viewport.height}: field and badge fit`)
      }
      for (const state of ['completed', 'failed', 'cancelled']) {
        await page.getByLabel('状态', { exact: true }).selectOption(state)
        assert.equal(await field.count(), 0, 'terminal states release the animated SVG')
      }
    }
  }
  await page.setViewportSize({ width: 1000, height: 820 })
  await page.getByLabel('状态', { exact: true }).selectOption('running')
  await page.getByLabel('深色', { exact: true }).check()
  assert.equal(await field.evaluate(el => getComputedStyle(el.lastElementChild).backgroundColor), 'rgb(27, 30, 38)')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(await field.locator('circle').first().evaluate(el => getComputedStyle(el).animationName), 'none', 'reduced motion makes the dot field static')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const folder = new URL('../docs/images/', import.meta.url)
  mkdirSync(folder, { recursive: true })
  await page.screenshot({ path: new URL('generation-dots-dark.png', folder).pathname })
  await page.getByLabel('深色', { exact: true }).uncheck()
  await page.screenshot({ path: new URL('generation-dots-light.png', folder).pathname })
  if (process.env.GENERATION_FRAME_DIR) {
    mkdirSync(process.env.GENERATION_FRAME_DIR, { recursive: true })
    for (let frame = 0; frame < 40; frame++) {
      await field.evaluate((el, t) => { for (const animation of el.getAnimations({ subtree: true })) { animation.pause(); animation.currentTime = t } }, frame * 120)
      await field.screenshot({ path: `${process.env.GENERATION_FRAME_DIR}/${String(frame).padStart(3, '0')}.png` })
    }
  }
  for (const mode of ['文生图', '图生图']) {
    await page.getByLabel('模式', { exact: true }).selectOption(mode)
    for (const count of [2, 4]) {
      await page.getByLabel('对比模型数', { exact: true }).selectOption(String(count))
      for (const viewport of [{ width: 1000, height: 820 }, { width: 390, height: 780 }, { width: 800, height: 360 }]) {
        await page.setViewportSize(viewport)
        for (const state of ['queued', 'running']) {
          await page.getByLabel('状态', { exact: true }).selectOption(state)
          assert.equal(await field.count(), count, 'every pending model gets its own animation')
          assert.equal(await field.evaluateAll(fields => fields.every(el => {
            const svg = el.querySelector('svg').getBoundingClientRect(), card = el.closest('article').getBoundingClientRect()
            return svg.width > 100 && svg.height > 100 && svg.x >= card.x && svg.right <= card.right && svg.bottom <= card.bottom
          })), true, `${mode}, ${count} models, ${viewport.width}: nonzero dot area fits every card`)
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
        }
        for (const state of ['completed', 'failed', 'cancelled']) {
          await page.getByLabel('状态', { exact: true }).selectOption(state)
          assert.equal(await field.count(), 0, 'terminal comparison models stop animating')
        }
      }
    }
  }
  await page.setViewportSize({ width: 1000, height: 820 })
  await page.setViewportSize({ width: 1280, height: 820 })
  await page.getByLabel('状态', { exact: true }).selectOption('mixed')
  assert.equal(await field.count(), 2, 'mixed results keep only queued and running models animated')
  assert.equal(await page.locator('[data-task-status="completed"] img').count(), 1)
  await page.locator('main').screenshot({ path: new URL('comparison-generation-dots.png', folder).pathname })
  await page.getByLabel('深色', { exact: true }).check()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(await field.locator('circle').first().evaluate(el => getComputedStyle(el).animationName), 'none')
  await page.locator('main').screenshot({ path: new URL('comparison-generation-dots-dark.png', folder).pathname })
  assert.deepEqual(errors, [])
  console.log('PASS generation animation: single and 2/4-model text/edit comparison, mixed results, live motion, terminal states, desktop/mobile/short viewport, dark and reduced motion')
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)) }

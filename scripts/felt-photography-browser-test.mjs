// 摄影与构图界面到服务端派发的端到端测试，模型全部为本地Mock。
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
const sharp = createRequire('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/package.json')('sharp')
const root = await mkdtemp(path.join(tmpdir(), 'felt-photo-ui-')), evidence = process.env.ETSY_TEST_EVIDENCE || 'E:/etsy/audit/2026-11-09/felt-rules/verification'
await mkdir(evidence, { recursive: true })
const planning = []
const models = createEtsyModels(async (_, options) => {
  planning.push(options)
  return JSON.stringify({ name: '蓝帽男孩', summary: '圆润蓝帽男孩', keep: ['蓝帽', '五官', '动作'], feltProfile: { components: ['body', 'face', 'clothing'], mixedMaterials: [], tones: ['light'], scene: 'minimal' }, plans: Array.from({ length: 3 }, (_, i) => ({ name: `蓝帽方案${i + 1}`, direction: `方向${i + 1}`, changes: ['保留五官与动作'], prompt: `Use the blue-hat boy reference for the complete felt product design ${i + 1}. Preserve his face, body proportions, pose and clothing.`, feltProfile: { components: ['body', 'face', 'clothing'], mixedMaterials: [], tones: ['light'], scene: 'minimal' } })) })
})
const f = fixture(root, { plan: (...args) => models.plan(...args), generate: async (_, i) => ({ images: [{ b64: mockDesignImage(i % 4).toString('base64'), mime: 'image/png' }] }), copy: async (_, facts) => validateCopy({ titles: ['Pose', 'Scarf', 'Palette', 'Figure', 'Design'].map((word, i) => ({ title: `Blue Hat Boy ${word}`, titleZh: '蓝帽男孩', strategy: word, explanationZh: '主体与细节', keywords: [] })), description: 'A cheerful boy in a blue hat.', tags: ['blue hat boy'], sellingPoints: [], humanConfirmation: [], factsUsed: {} }, facts, { mode: 'generated' }) })
await f.workflow.ready
const routes = makeEtsyRoutes({ workflow: f.workflow, guard: () => true, parse: body => body, normalize: request => ({ ok: true, request }) })
const errors = []
let staleRename = false
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname
    // 模拟宿主进程仍加载旧路由表：/rename 返回纯文本 404，而不是插件约定的 JSON。
    if (staleRename && pathname.endsWith('/rename')) { res.statusCode = 404; res.end('not found'); return }
    if (pathname.endsWith('/model-choices')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, value: { writable: false, imageGroups: [{ id: 'mock', name: '主图模型', models: ['gpt-image-2'] }, { id: 'mock-grok', name: '侧背面模型', models: ['grok-imagine-image-2.0'] }], image: { channelId: 'mock', model: 'gpt-image-2' }, analysis: { provider: 'mock', model: 'mock' }, analysisLabel: 'Mock', defaultAnalysisLabel: 'Mock', analysisModels: [], warnings: [] } })); return }
    const route = routes.find(route => route.kind === 'exact' && route.path === pathname)
    if (route) { await route.handler(req, res); return }
    if (pathname === '/preview.js') { res.setHeader('content-type', 'text/javascript'); res.end(await readFile(new URL('../.reference-preview/preview.js', import.meta.url))); return }
    res.setHeader('content-type', 'text/html; charset=utf-8'); res.end('<!doctype html><html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;display:flex}#history-host{width:225px;height:100vh;flex-shrink:0;border-right:1px solid #ddd}#root{position:relative;height:100vh;flex:1;min-width:0}:root{--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#f6f7f9;--dsw-alias-border-l1:#ddd;--dsw-alias-label-primary:#282b32;--dsw-alias-label-secondary:#6f7783;--dsw-alias-label-tertiary:#8b94a1}</style><aside id="history-host"></aside><div id="root"></div><script src="/preview.js"></script></html>')
  } catch (error) { errors.push(String(error)); if (!res.headersSent) res.statusCode = 500; res.end('测试服务错误') }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, acceptDownloads: true }); page.on('pageerror', e => errors.push(e.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByText('元创 Etsy Studio', { exact: true }).waitFor()
  assert.match(await page.locator('[data-studio-version]').innerText(), /2\.0\.0-etsy\.7/)
  assert.equal(await page.getByLabel('材质规则', { exact: true }).count(), 0, '材质版本下拉已移除')
  assert.match(await page.locator('[data-felt-material-default]').innerText(), /针刺羊毛毡/)
  assert.equal(f.counts.generation, 0, '仅查看界面不能触发生图')
  const photo = page.locator('[data-photography-controls]')
  await page.getByLabel('创作任务', { exact: true }).selectOption('flat-to-felt')
  assert.equal(await page.getByRole('checkbox', { name: '保留原图背景', exact: true }).count(), 0, '只保留一个背景选择入口')
  await page.getByLabel('摄影背景', { exact: true }).selectOption('custom')
  await page.getByLabel('自定义摄影背景', { exact: true }).fill('浅蓝墙和灰色石台，不要木纹')
  await page.getByLabel('摄影背景', { exact: true }).selectOption('preserve-original')
  assert.equal(await page.getByLabel('摄影背景', { exact: true }).inputValue(), 'preserve-original')
  assert.equal(await page.getByLabel('构图方式', { exact: true }).inputValue(), 'preserve_reference')
  await page.getByLabel('摄影背景', { exact: true }).selectOption('natural-tabletop')
  await page.getByLabel('构图方式', { exact: true }).selectOption('override_reference')
  await page.getByLabel('图片画幅', { exact: true }).selectOption('1:1')
  assert.equal(await page.getByLabel('主体高度占比', { exact: true }).inputValue(), '60')
  await page.getByRole('slider', { name: '探索图片数量', exact: true }).fill('3')
  await page.getByLabel('参考图片', { exact: true }).setInputFiles({ name: 'boy-reference.png', mimeType: 'image/png', buffer: mockDesignImage(0) })
  await page.getByLabel('补充想法（可不填）').fill('保留蓝帽、五官、头身比例和姿势')
  await page.screenshot({ path: path.join(evidence, 'photography-controls.png') })
  await page.getByRole('button', { name: '生成 3 个方案', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('[data-design-plan] img').length === 3); await f.workflow.idle()
  let product = (await f.workflow.list())[0]
  assert.equal(product.photography.photography_preset, 'natural-tabletop')
  assert.ok(product.images.every(image => image.visualRules.photography.subject_height_ratio === 0.6 && image.visualRules.prompt.includes('natural wooden tabletop')))
  assert.equal(f.counts.planning, 1); assert.equal(f.counts.copy, 0)
  await page.getByLabel('摄影背景', { exact: true }).selectOption('white-studio')
  await page.getByRole('button', { name: '近景 · 75%', exact: true }).click()
  await page.getByLabel('修改要求', { exact: true }).fill('只调整摄影，保留人物的全部设计细节')
  await page.getByRole('button', { name: '修改这张图', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('[data-design-plan] img').length === 4); await f.workflow.idle()
  product = await f.workflow.get(product.id)
  const edited = product.images.at(-1)
  assert.equal(edited.visualRules.photography.photography_preset, 'white-studio'); assert.equal(edited.visualRules.photography.subject_height_ratio, 0.75)
  assert.match(edited.visualRules.prompt, /pure white studio/)
  await page.getByRole('button', { name: '确定为主设计', exact: true }).click()
  await page.getByText('形象设定（辅助信息）· 第1版', { exact: true }).waitFor(); await f.workflow.idle()
  assert.match(await page.locator('[data-view-anchor]').innerText(), /75%/)
  await page.waitForFunction(() => document.querySelector('[aria-label="侧面背面模型"]')?.value.includes('gpt-image-2'))
  assert.match(await page.getByLabel('侧面背面模型', { exact: true }).inputValue(), /gpt-image-2/)
  await page.getByLabel('摄影背景', { exact: true }).selectOption('custom')
  await page.getByLabel('自定义摄影背景', { exact: true }).fill('红色墙和黑色石台')
  await page.getByRole('button', { name: '小 · 45%', exact: true }).click()
  for (const label of ['斜侧面', '左侧', '右侧']) await page.getByLabel(label, { exact: true }).uncheck()
  await page.getByRole('button', { name: '生成 1 张多角度图片', exact: true }).click()
  await page.waitForSelector('[data-angle-image] img'); await f.workflow.idle()
  product = await f.workflow.get(product.id)
  const back = product.images.find(image => image.kind === 'view')
  assert.equal(back.visualRules.stage, 'multi-view'); assert.equal(back.visualRules.photography.photography_preset, 'white-studio')
  assert.equal(back.visualRules.photography.subject_height_ratio, 0.75, '多角度不读取后来改动的探索区摄影设置')
  assert.equal(back.visualRules.modules.multi_view_consistency_v1_0, '1.0')
  assert.equal(back.visualRules.modules.hero_surface_continuity_v1_0, '1.0')
  assert.equal(back.renderSettings.model, 'gpt-image-2')
  assert.equal(f.queue.get(back.taskId).request.images.length, 0)
  assert.equal(product.finalDesigns[0].materialReference, undefined, '首次背面不依赖局部裁剪或二次材质分析')
  await page.getByRole('button', { name: '只修材质', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('[data-angle-image] img').length === 2); await f.workflow.idle()
  product = await f.workflow.get(product.id)
  const repaired = product.images.at(-1)
  assert.equal(repaired.materialRepair, true); assert.equal(repaired.parentImageId, back.id)
  assert.match(repaired.visualRules.prompt, /MATERIAL-ONLY REPAIR/)
  assert.equal(repaired.visualRules.modules.approved_material_lock_v1_0, '1.0')
  assert.deepEqual(product.images.find(image => image.id === back.id), back)
  const reference = product.finalDesigns[0].materialReference
  assert.equal(reference.samples.length, 2)
  const heroFile = await f.workflow.store.readImage(product.id, edited.files[0])
  const sourceMeta = await sharp(heroFile.data).metadata()
  for (const sample of reference.samples) {
    const [x, y, w, h] = sample.region.box, left = Math.round(x / 1000 * sourceMeta.width), top = Math.round(y / 1000 * sourceMeta.height)
    const width = Math.min(sourceMeta.width - left, Math.round(w / 1000 * sourceMeta.width)), height = Math.min(sourceMeta.height - top, Math.round(h / 1000 * sourceMeta.height))
    const expected = await sharp(heroFile.data).extract({ left, top, width, height }).removeAlpha().raw().toBuffer()
    const actual = await sharp((await f.workflow.store.readImage(product.id, sample.file)).data).removeAlpha().raw().toBuffer()
    assert.deepEqual(actual, expected, '材质样本必须逐像素来自主图，不允许放大、锐化或重画')
  }
  await page.locator('[data-material-samples] > summary').click()
  await page.locator('[data-material-samples]').screenshot({ path: path.join(evidence, 'material-samples.png') })
  await page.getByText('商品资料与高级选项', { exact: true }).click()
  await page.locator('[data-visual-rules-status] > summary').click()
  assert.match(await page.locator('[data-felt-material-default]').innerText(), /针刺羊毛毡/)
  await page.locator('[data-visual-rules-status] > details').first().locator('summary').click()
  assert.match(await page.locator('[data-visual-rules-status]').innerText(), /needle_felt_v2_0/)
  assert.equal(await page.locator('[data-visual-rules-status] pre').count(), 6)
  const before = { ...f.counts }
  const downloadPromise = page.waitForEvent('download'); await page.getByRole('link', { name: '导出图片与文案', exact: true }).click()
  const download = await downloadPromise; await download.saveAs(path.join(evidence, 'visual-rules-export.zip'))
  assert.ok((await readFile(path.join(evidence, 'visual-rules-export.zip'))).includes(Buffer.from('visual-rules.json')))
  await page.reload(); await page.waitForSelector('[data-design-plan] img')
  await photo.locator('summary').click()
  assert.equal(await page.getByLabel('摄影背景', { exact: true }).inputValue(), 'white-studio', '重开后跟随当前选图的摄影设置，避免继续精修退回初始背景')
  assert.equal(await page.getByLabel('主体高度占比', { exact: true }).inputValue(), '75')
  assert.deepEqual(f.counts, before)
  assert.match(await page.getByLabel('侧面背面模型', { exact: true }).inputValue(), /gpt-image-2/)
  await page.getByRole('button', { name: '新创作', exact: true }).click()
  assert.equal(await page.getByLabel('材质规则', { exact: true }).count(), 0, '新创作也不再提供旧版材质切换')
  await page.getByLabel('创作任务', { exact: true }).selectOption('felt-conversion')
  assert.equal(await page.getByLabel('摄影背景', { exact: true }).inputValue(), 'preserve-original')
  assert.equal(await page.getByLabel('构图方式', { exact: true }).inputValue(), 'preserve_reference')
  await page.getByLabel('参考图片', { exact: true }).setInputFiles({ name: 'same-reference.png', mimeType: 'image/png', buffer: mockDesignImage(0) })
  await page.getByRole('slider', { name: '探索图片数量', exact: true }).fill('3')
  await page.getByLabel('补充想法（可不填）').fill('仅修改材质，保留原背景、构图和蓝帽人物')
  await page.getByRole('button', { name: '生成 3 个方案', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('[data-design-plan] img').length === 3); await f.workflow.idle()
  const preserved = (await f.workflow.list()).find(item => item.id !== product.id)
  assert.equal(preserved.request.materialPreset, 'needle_felt_v2_0')
  assert.ok(preserved.images.every(image => image.visualRules.modules.needle_felt_v2_0 === '2.0' && !image.visualRules.modules.needle_felt_v1_0))
  assert.ok(preserved.images.every(image => image.visualRules.photography.preserve_background && image.visualRules.photography.framing_policy === 'preserve_reference' && !image.visualRules.prompt.includes('approximately 60%')))
  await page.getByLabel('摄影背景', { exact: true }).selectOption('custom')
  await page.getByLabel('自定义摄影背景', { exact: true }).fill('雾蓝墙和灰色石台，左侧自然光，不加木桌')
  await page.getByLabel('修改要求', { exact: true }).fill('背景改为雾蓝墙和灰色石台，保留主体')
  await page.getByRole('button', { name: '修改这张图', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('[data-design-plan] img').length === 4); await f.workflow.idle()
  const custom = (await f.workflow.get(preserved.id)).images.at(-1)
  assert.match(custom.visualRules.prompt, /雾蓝墙和灰色石台/)
  await page.reload(); await page.waitForSelector('[data-design-plan] img'); await photo.locator('summary').click()
  assert.equal(await page.getByLabel('材质规则', { exact: true }).count(), 0, '重开后仍固定针刺羊毛毡')
  assert.equal(await page.getByLabel('自定义摄影背景', { exact: true }).inputValue(), '雾蓝墙和灰色石台，左侧自然光，不加木桌')
  // 宿主未重启、rename 路由缺失时，重命名仍应立刻生效；重启后自动同步到创作档案。
  staleRename = true
  const historyItem = page.locator('[data-creation-project]').first()
  const renamedId = await historyItem.getAttribute('data-creation-project')
  await historyItem.click({ button: 'right' })
  await page.getByRole('menuitem', { name: '重新命名', exact: true }).click()
  await page.getByLabel('创作名称', { exact: true }).fill('蘑菇精灵羊毛毡改款三案 gemini')
  await page.getByRole('button', { name: '保存名称', exact: true }).click()
  await page.getByRole('dialog', { name: '重新命名' }).waitFor({ state: 'hidden' })
  assert.match(await page.locator('[data-creation-project]').first().innerText(), /蘑菇精灵羊毛毡改款三案 gemini/, '旧路由下仍能立即重命名')
  assert.match(await page.getByText(/名称已在本机生效/).innerText(), /重启宿主/)
  assert.equal((await f.workflow.get(renamedId)).displayName, undefined, '兜底阶段不写入服务端档案')
  staleRename = false
  await page.reload(); await page.waitForSelector('[data-design-plan] img')
  let synced = false
  for (let attempt = 0; attempt < 40 && !synced; attempt++) {
    synced = (await f.workflow.get(renamedId)).displayName === '蘑菇精灵羊毛毡改款三案 gemini'
    if (!synced) await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.ok(synced, '模拟宿主重启后，本机名称应自动同步到创作档案')
  await page.setViewportSize({ width: 620, height: 1000 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: path.join(evidence, 'photography-narrow.png') })
  assert.deepEqual(errors, [])
  const report = { passed: true, mockModels: true, singleRealisticWoolTemplate: true, materialSelectorRemoved: true, realisticTemplateAlwaysActive: true, materialSamplesMatchSourcePixels: true, materialOnlyRepairPreservesParent: true, singleBackgroundSelector: true, customBackgroundPersists: true, multiViewLocksMasterDespiteGlobalChanges: true, foldedSimpleControls: true, taskDefaults: true, naturalTabletop60: true, onlyMaterialPreservesBackgroundAndFraming: true, actualPromptVisible: true, exportIncludesTrace: true, savedProjectRestoresSettings: true, noExtraCallsForViewing: true, narrowLayout: true, renameFallbackWorksOnStaleHost: true, renameSyncsAfterHostRestart: true, pageErrors: errors }
  await writeFile(path.join(evidence, 'felt-photography-browser.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2))
} catch(error) { const page=browser.contexts()[0]?.pages()[0]; if(page) { await page.screenshot({path:path.join(evidence,'photography-failure.png')}); await writeFile(path.join(evidence,'photography-failure.txt'),(await page.locator('body').innerText()).slice(0,16000)) } throw error }
finally { await browser.close(); f.workflow.dispose(); await f.workflow.idle(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) }

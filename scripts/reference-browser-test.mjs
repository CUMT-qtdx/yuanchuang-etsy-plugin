import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { fixture, modelConfig } from './etsy-fixture.mjs'
import { makeRoutes, validateCopy, EtsyHostModel, createStudioModelControls, resolveEtsyModels } from '../.etsy-test/host.js'
import { mockDesignImage } from './mock-design-image.mjs'
const { chromium } = createRequire('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/package.json')('playwright')
const root = await mkdtemp(path.join(tmpdir(), 'reference-browser-'))
let failCopy = false
let addedProvider = false, modelRevision = 1
const modelSettings = { defaultChannelId: 'mock', defaultModel: 'mock-image' }, taskModels = { vision: modelConfig, copy: modelConfig }
const imageChannels = { defaultChannelId: 'mock', channels: ['mock', 'mock-alt'].map((id, index) => ({ id, name: index ? 'Mock alternative' : 'Mock', preset: '', apiUrl: 'https://mock.invalid/v1', apiKey: 'private-mock-key', models: [{ alias: index ? 'mock-image-alt' : 'mock-image', id: index ? 'mock-image-alt' : 'mock-image' }] })) }
const modelHost = new EtsyHostModel(() => path.join(root, 'mock-model-logs'))
modelHost.attach({ selection: { currentSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }) }, llm: {
  listProviders: () => [{ id: 'deepseek-account', name: 'DeepSeek' }, { id: 'other-provider', name: 'Other provider' }, ...(addedProvider ? [{ id: 'new-provider', name: 'New provider' }] : [])],
  listModels: async provider => [{ id: provider === 'deepseek-account' ? 'deepseek-flash' : 'other-vision', name: provider === 'deepseek-account' ? 'DeepSeek Mock' : 'Vision Mock', inputModalities: ['text', 'image'] }, { id: 'text-only', name: 'Text only Mock', inputModalities: ['text'] }],
  resolveModelInfo: async (provider, model) => ({ inputModalities: model === 'text-only' ? ['text'] : ['text', 'image'] }),
  async *stream() { throw new Error('模型设置验收不应发起推理') },
}, attachments: { async saveImage() { throw new Error('读取模型列表不应上传图片') } } })
const modelControls = createStudioModelControls({ settings: () => modelSettings, revision: () => modelRevision, writable: () => true, channels: () => imageChannels, host: modelHost,
  resolved: () => taskModels, busy: async () => false, mutate: async (ops, expected) => { assert.equal(expected, modelRevision); for (const op of ops) modelSettings[op.path[0]] = op.value; modelRevision++; Object.assign(taskModels, resolveEtsyModels(modelSettings, modelConfig, modelHost)) },
})
const f = fixture(root, { models: taskModels, generate: async (request, index) => ({ images: [{ b64: mockDesignImage(index - 1).toString('base64'), mime: 'image/png' }] }), copy: async (config, facts, signal, context) => {
  if (failCopy) throw new Error('模型引用了未经确认或不一致的商品事实：name')
  const direction = { 'plan-1': 'Color', 'plan-2': 'Accessory', 'plan-3': 'Theme', 'plan-4': 'Freeform' }[context?.plan?.id] || 'Animal'
  const base = `${context?.editInstruction ? 'Updated ' : ''}${direction} ${facts.type.startsWith('digital_') ? 'Digital Animal Concept' : 'Animal Design Concept'}`
  return validateCopy({ titles: ['Design', 'Palette', 'Character', 'Style', 'Theme'].map(strategy => ({ title: `${base} - ${strategy}`, titleZh: '可爱动物设计', strategy, explanationZh: `突出${strategy}，为待确认的设计草稿`, keywords: ['animal concept'] })), description: 'An animal design with a soft felt-style appearance. A cheerful expression adds a friendly touch. Rounded shapes complete the playful look. Physical details require confirmation.', tags: ['animal concept', 'felt style'], sellingPoints: ['Soft visual texture'], factsUsed: { name: facts.name }, humanConfirmation: ['请确认实际材料和制作方式'] }, facts)
} })
await f.workflow.ready
const routes = makeRoutes({ settings: { describe: () => [], mutate: async () => {} }, resolve: () => ({ apiUrl: 'https://mock.invalid/v1', apiKey: 'private-mock-key' }), resolveChannels: () => imageChannels, runtime: { queue: f.queue }, etsy: f.workflow, etsyModelControls: modelControls })
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname
  const route = routes.find(route => route.kind === 'exact' && route.path === pathname)
  if (route) { try { await route.handler(req, res) } catch (error) { res.statusCode = 500; res.end(String(error)) } return }
  if (pathname === '/preview.js') { res.setHeader('content-type', 'text/javascript'); res.end(await readFile(new URL('../.reference-preview/preview.js', import.meta.url))); return }
  res.setHeader('content-type', 'text/html; charset=utf-8'); res.end('<!doctype html><html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;display:flex}#history-host{width:225px;flex-shrink:0;height:100vh;border-right:1px solid #e4e7ed}#root{position:relative;height:100vh;flex:1;min-width:0}:root{--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#f6f7f9;--dsw-alias-border-l1:#e4e7ed;--dsw-alias-label-primary:#282b32;--dsw-alias-label-secondary:#6f7783;--dsw-alias-label-tertiary:#8b94a1}</style><aside id="history-host"></aside><div id="root"></div><div style="position:fixed;bottom:4px;right:14px;z-index:90;background:#fff;padding:3px;font-size:11px;color:#667">Mock 流程验收 · 图片为合成测试图</div><script src="/preview.js"></script></html>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } }), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.locator('[data-studio-models] summary').click()
  const analysisPicker = page.getByLabel('规划／检查／文案模型', { exact: true })
  await analysisPicker.waitFor()
  await page.waitForFunction(() => !document.querySelector('select[aria-label="规划／检查／文案模型"]').disabled)
  assert.equal(await analysisPicker.locator('option:disabled').count(), 2)
  const otherAnalysis = JSON.stringify(['other-provider', 'other-vision'])
  await analysisPicker.selectOption(otherAnalysis)
  await page.waitForFunction(() => document.querySelector('[data-studio-models] summary')?.textContent.includes('other-provider/other-vision'))
  assert.equal(modelSettings.etsyAnalysisProvider, 'other-provider')
  addedProvider = true
  await page.getByRole('button', { name: '刷新模型列表', exact: true }).click()
  await analysisPicker.locator('optgroup[label="New provider"]').waitFor({ state: 'attached' })
  assert.ok(await page.getByText('元创电子商务-Etsy生图平台', { exact: true }).isVisible())
  assert.equal(await page.getByLabel('创作任务', { exact: true }).count(), 1)
  assert.equal(await page.getByRole('radio', { name: /适度改款/ }).getAttribute('aria-checked'), 'true')
  await page.getByRole('radio', { name: '小幅调整', exact: true }).click()
  assert.equal(await page.getByText('做同款变化：保留姿态和轮廓，换配色或小配饰。', { exact: true }).isVisible(), true)
  await page.getByRole('radio', { name: /适度改款/ }).click()
  assert.equal(await page.getByText('GPT 出图 · DeepSeek 分析与文案', { exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: '生成 4 个方案' }).isDisabled(), true)
  await page.getByText('商品资料与高级选项', { exact: true }).click()
  if (!await page.getByText('商品资料与高级选项', { exact: true }).evaluate(element => element.parentElement.open)) await page.getByText('商品资料与高级选项', { exact: true }).click()
  await page.getByLabel('每张自动准备文案', { exact: true }).check()
  await page.getByLabel('参考图片', { exact: true }).setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: mockDesignImage(0) })
  assert.equal(await page.getByLabel('补充想法（可不填）').inputValue(), '')
  await page.getByRole('button', { name: '生成 4 个方案', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('[data-design-plan] img').length === 4)
  await page.waitForFunction(() => document.querySelectorAll('[data-title-index]').length === 5)
  await f.workflow.idle()
  assert.deepEqual(f.counts, { generation: 4, quality: 4, copy: 4, planning: 1 })
  await page.waitForFunction(() => document.querySelectorAll('[data-image-copy-state="completed"]').length === 4)
  assert.equal((await f.workflow.list())[0].facts.type, 'unspecified')
  assert.equal(await page.locator('[data-creation-project]').count(), 1)
  assert.equal(await page.locator('[data-title-translation]').count(), 5)
  assert.ok((await page.locator('[data-title-translation]').allTextContents()).every(text => text === '可爱动物设计'))
  assert.ok((await page.locator('[data-title-index]').allTextContents()).every(text => /[A-Za-z]/.test(text) && !/[\p{Script=Han}]/u.test(text) && !/draft|concept|visual reference/i.test(text)), '五个公开标题为英文且无内部草稿定位词')
  assert.equal(await page.getByRole('tab', { name: '商品文案', exact: true }).isVisible(), true)
  assert.ok(await page.getByRole('tab', { name: '商品文案', exact: true }).evaluate(element => parseFloat(getComputedStyle(element).fontSize) >= 15 && parseFloat(getComputedStyle(element).borderTopWidth) >= 1))
  await page.getByRole('tab', { name: '商品文案', exact: true }).click()
  const copyText = await page.locator('[data-copy-description]').innerText()
  assert.ok(!copyText.includes('Physical details require confirmation'))
  assert.ok(!/[\p{Script=Han}]/u.test(copyText) && !/to be confirmed|before ordering|design draft/i.test(copyText), '商品文案只显示公开英文内容')
  assert.equal([...copyText.matchAll(/\p{Extended_Pictographic}/gu)].length, 0, '不向模型未提供的正文强行添加表情')
  assert.ok(copyText.includes('A cheerful expression adds a friendly touch.'))
  const readHeight = await page.locator('[data-copy-description]').evaluate(element => element.getBoundingClientRect().height)
  await page.getByRole('button', { name: '编辑文字', exact: true }).click()
  const editor = page.getByLabel('英文商品文案', { exact: true })
  assert.ok(await editor.evaluate((element, height) => element.clientHeight >= height && element.scrollHeight <= element.clientHeight + 1, readHeight), '进入编辑不缩成小框')
  const longCopy = Array(22).fill('This design remains a visual concept for review.').join('\n')
  await editor.fill(longCopy)
  await page.waitForFunction(() => { const element = document.querySelector('textarea[aria-label="英文商品文案"]'); return element && element.clientHeight > 500 && element.scrollHeight <= element.clientHeight + 1 })
  await page.waitForFunction(() => document.querySelector('[data-reference-copy]')?.textContent.includes('已保存'))
  await mkdir(new URL('../docs/development/', import.meta.url), { recursive: true })
  await page.locator('[data-reference-copy]').screenshot({ path: path.resolve(new URL('../docs/development/editor-mock.png', import.meta.url).pathname.replace(/^\/(.:)/, '$1')) })
  await editor.fill(copyText)
  await page.waitForFunction(() => document.querySelector('[data-reference-copy]')?.textContent.includes('已保存'))
  await page.getByRole('tab', { name: '标题', exact: true }).click()
  assert.ok((await f.workflow.list())[0].calls.filter(call => call.stage !== 'generation').every(call => call.model === 'other-provider/other-vision'))
  await page.locator('[data-studio-models]').scrollIntoViewIfNeeded()
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.getByRole('button', { name: /^生图／修图模型:/ }).click()
  await page.getByRole('menuitemradio', { name: 'Mock alternative', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'mock-image-alt', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[data-studio-models] summary')?.textContent.includes('生图：mock-image-alt'))
  assert.equal(modelSettings.defaultModel, 'mock-image-alt')
  assert.ok(await page.getByLabel('英文标题 1', { exact: true }).evaluate(element => element.tagName === 'TEXTAREA' && element.scrollHeight <= element.clientHeight + 1))
  await page.getByRole('tab', { name: '标签', exact: true }).click()
  const tagsEditor = page.getByLabel('SEO 标签', { exact: true })
  assert.ok(await tagsEditor.evaluate(element => element.clientHeight >= 180 && element.scrollHeight <= element.clientHeight + 1))
  await page.getByRole('button', { name: '收起编辑', exact: true }).click()
  await page.getByRole('tab', { name: '标题', exact: true }).click()
  assert.equal(await page.locator('[data-design-plan]').count(), 4)
  assert.ok(await page.locator('[data-design-plan] img').evaluateAll(images => images.every(image => image.naturalWidth === 320)))
  assert.ok(await page.getByText('配色', { exact: true }).count())
  await page.getByRole('button', { name: '选择方案 2', exact: true }).click(); await f.workflow.idle()
  await f.workflow.idle(); assert.equal(f.counts.copy, 4)
  await page.waitForFunction(() => document.querySelector('[data-title-index="0"]')?.textContent.includes('Accessory'))
  assert.equal(await page.getByText('Color Animal Design Concept - Design', { exact: true }).count(), 0, '不能显示上一张图的标题')
  await page.getByLabel('修改要求').fill('围巾改成蓝色')
  await page.getByRole('button', { name: '修改这张图', exact: true }).click()
  for (let i = 0; i < 100 && f.counts.generation < 5; i++) await new Promise(resolve => setTimeout(resolve, 20))
  await f.workflow.idle()
  let product = (await f.workflow.list())[0]
  assert.equal(product.images.length, 5); assert.equal(product.copyImageId, product.selectedImageId)
  assert.equal(product.calls.filter(call => call.stage === 'generation').at(-1).model, 'mock-image-alt', '旧项目修图应使用刚选择的新图片模型')
  const firstProductId = product.id
  await page.waitForFunction(() => document.querySelectorAll('[data-creation-image] img').length === 5)
  assert.equal(await page.locator('[data-creation-project]').count(), 1)
  assert.match(await page.locator(`[data-creation-project="${firstProductId}"]`).innerText(), /5 张图片 · 1 张修改/)
  assert.deepEqual(f.counts, { generation: 5, quality: 5, copy: 5, planning: 1 })
  await page.waitForFunction(() => document.querySelector('[data-title-index="0"]')?.textContent.includes('Updated Accessory'))
  await page.reload(); await page.waitForFunction(() => document.querySelectorAll('[data-title-index]').length === 5)
  await page.waitForFunction(expected => document.querySelector('select[aria-label="规划／检查／文案模型"]')?.value === expected, otherAnalysis)
  assert.equal(await page.locator('[data-design-plan]').count(), 5)
  assert.deepEqual(f.counts, { generation: 5, quality: 5, copy: 5, planning: 1 })
  const folder = new URL('../docs/development/', import.meta.url); await mkdir(folder, { recursive: true })
  await page.screenshot({ path: path.resolve(new URL('reference-studio-mock.png', folder).pathname.replace(/^\/(.:)/, '$1')), fullPage: true })
  await page.setViewportSize({ width: 680, height: 900 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  const successfulCounts = { ...f.counts }
  // 模拟后处理失败，验证保留图片、明确失败状态及刷新后恢复，避免继续显示等待首图。
  failCopy = true
  await page.getByRole('button', { name: '新创作', exact: true }).click()
  if (!await page.getByText('商品资料与高级选项', { exact: true }).evaluate(element => element.parentElement.open)) await page.getByText('商品资料与高级选项', { exact: true }).click()
  await page.getByLabel('每张自动准备文案', { exact: true }).check()
  await page.waitForTimeout(2200)
  assert.equal(await page.locator('[data-reference-studio]').getAttribute('data-current-project'), 'new')
  assert.equal(await page.locator('[data-design-plan] img').count(), 0)
  assert.equal(await page.getByLabel('补充想法（可不填）').inputValue(), '')
  await page.reload()
  await page.waitForTimeout(1200)
  assert.equal(await page.locator('[data-reference-studio]').getAttribute('data-current-project'), 'new')
  assert.equal(await page.getByRole('button', { name: '生成 4 个方案', exact: true }).isDisabled(), true)
  if (!await page.getByText('商品资料与高级选项', { exact: true }).evaluate(element => element.parentElement.open)) await page.getByText('商品资料与高级选项', { exact: true }).click()
  await page.getByLabel('每张自动准备文案', { exact: true }).check()
  await page.getByLabel('参考图片', { exact: true }).setInputFiles({ name: 'failure-reference.png', mimeType: 'image/png', buffer: mockDesignImage(0) })
  await page.getByRole('button', { name: '生成 4 个方案', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[data-copy-state="failed"]') && document.querySelectorAll('[data-design-plan] img').length === 4)
  await f.workflow.idle()
  const failedPanel = page.locator('[data-reference-copy]')
  assert.match(await failedPanel.innerText(), /文案未完成，图片和版本已保留/)
  assert.equal(await failedPanel.locator('[data-title-index]').count(), 0)
  assert.equal(await failedPanel.getByText('首张设计完成后，文案会自动出现在这里。', { exact: true }).count(), 0)
  const failureCounts = { ...f.counts }
  assert.equal(await page.locator('[data-creation-project]').count(), 2)
  const failedProductId = (await f.workflow.list()).find(value => value.id !== firstProductId).id
  await page.locator(`[data-creation-project="${firstProductId}"]`).click()
  await page.waitForFunction(() => document.querySelectorAll('[data-title-index]').length === 5)
  assert.equal(await page.locator('[data-creation-image]').count(), 5)
  assert.deepEqual(f.counts, failureCounts)
  await page.getByLabel('搜索创作', { exact: true }).fill('不存在的名称')
  assert.equal(await page.locator('[data-creation-project]').count(), 0)
  await page.getByLabel('搜索创作', { exact: true }).fill('')
  await page.locator(`[data-creation-project="${failedProductId}"]`).click()
  await page.reload()
  await page.waitForSelector('[data-copy-state="failed"]')
  assert.equal(await page.locator('[data-design-plan] img').count(), 4)
  assert.deepEqual(f.counts, failureCounts)
  await page.locator(`[data-creation-project="${failedProductId}"]`).click({ button: 'right' })
  await page.getByRole('menuitem', { name: '删除本次创作', exact: true }).click()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  assert.equal(await page.locator('[data-creation-project]').count(), 2)
  await page.locator(`[data-creation-project="${failedProductId}"]`).click({ button: 'right' })
  await page.getByRole('menuitem', { name: '删除本次创作', exact: true }).click()
  await page.getByRole('button', { name: '确认删除', exact: true }).click()
  await page.getByRole('alertdialog').waitFor({ state: 'hidden' })
  assert.equal(await page.locator('[data-creation-project]').count(), 1)
  assert.equal(await page.locator('[data-reference-studio]').getAttribute('data-current-project'), 'new')
  await assert.rejects(readFile(path.join(root, failedProductId, 'product.json')), { code: 'ENOENT' })
  await page.reload()
  await page.locator(`[data-creation-project="${firstProductId}"]`).waitFor()
  assert.equal(await page.locator(`[data-creation-project="${failedProductId}"]`).count(), 0)
  assert.deepEqual(f.counts, failureCounts)
  assert.deepEqual(errors, [])
  const report = { passed: true, brandingUpdated: true, groupedCreationHistory: true, modifiedImagesStayInSameGroup: true, newCreationSurvivesPollingAndReload: true, historySwitchWithoutModelCalls: true, searchableHistory: true, deliveryTypeUnspecifiedByDefault: true, creativityHelpVisible: true, largeBorderedCopyTabs: true, shortLineCopyWithEmojis: true, emptyPromptAndNotes: true, referenceUpload: true, fourDistinctPlans: true, fiveTitlesAutomaticallyVisible: true, selectionUpdatesCopy: true, naturalLanguageEdit: true, oldVersionsRetained: true, refreshRestored: true, narrowWindow: true, failedCopyStateVisible: true, failedCopyPreservesImages: true, failedCopyRefreshDoesNotRetry: true, modelCalls: successfulCounts, failureScenarioModelCalls: failureCounts, modelsAreMock: true }
  Object.assign(report, { editorAutoGrowsWithoutInnerScroll: true, titleAndTagsEditorsExpanded: true, contextMenuDeletion: true, deletionCancelPreservesProject: true, deletionRemovesDiskFiles: true, deletedProjectAbsentAfterReload: true })
  Object.assign(report, { twoModelSelectors: true, analysisProviderSwitchPersisted: true, newProviderAppearsAfterRefresh: true, imageModelUsedForRevision: true, modelSelectionDoesNotInfer: true })
  Object.assign(report, { fourCopiesPreparedAutomatically: true, selectingPreparedImageDoesNotCallModels: true, noOtherImageCopyDuringFailure: true, modifiedImageHasOwnCopy: true })
  Object.assign(report, { publicEnglishTitlesWithoutInternalStatus: true, chineseTranslationsVisible: true, publicCopyWithoutInternalReviewNotes: true })
  await writeFile(new URL('reference-browser-test.json', folder), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2))
} finally { await browser?.close(); f.workflow.dispose(); await f.workflow.idle(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) }

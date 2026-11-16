// 实际 React 界面与本地模拟工作流联测，不调用任何真实模型。
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { makeRoutes, createStudioModelControls, resolveEtsyModels, EtsyHostModel, PLUGIN_VERSION } from '../.etsy-test/host.js'
import { fixture, modelConfig } from './etsy-fixture.mjs'
import { mockDesignImage } from './mock-design-image.mjs'

const { chromium } = createRequire('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/package.json')('playwright')
const root = await mkdtemp(path.join(tmpdir(), 'preserve-browser-'))
const output = path.resolve(process.env.ETSY_QA_OUTPUT || 'E:/etsy/维护记录/2.1.2-etsy_本地测试')
await mkdir(output, { recursive: true })
const modelSettings = { defaultChannelId: 'mock', defaultModel: 'mock-image' }
const taskModels = { vision: modelConfig, copy: modelConfig }
const channels = { defaultChannelId: 'mock', channels: [{ id: 'mock', name: '隔离测试渠道', preset: '', apiUrl: 'https://mock.invalid/v1', apiKey: 'mock-key', models: [{ alias: 'mock-image', id: 'mock-image' }] }] }
const host = new EtsyHostModel(() => path.join(root, 'model-logs'))
host.attach({ selection: { currentSelection: () => ({ provider: 'mock-provider', model: 'mock-analysis' }) }, llm: {
  listProviders: () => [{ id: 'mock-provider', name: '模拟分析' }],
  listModels: async () => [{ id: 'mock-analysis', name: '模拟分析', inputModalities: ['text', 'image'] }],
  resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }),
  async *stream() { throw Error('浏览器流程测试不应调用实际推理') },
}, attachments: { async saveImage() { throw Error('不应向模型上传素材') } } })
const controls = createStudioModelControls({ settings: () => modelSettings, revision: () => 1, writable: () => true, channels: () => channels, host, resolved: () => taskModels, busy: async () => false, mutate: async () => 1 })
const f = fixture(root, {
  models: taskModels,
  plan: async (_, __, ___, creativity, ____, options) => ({
    name: '模拟原款器物', summary: '模拟保留原款结构并转换材质', keep: ['原有把手、轮廓和纹样'], keepEn: ['Original handle, silhouette and decorative motifs.'], strategyVersion: 2, creativity,
    plans: Array.from({ length: options.count }, (_, index) => ({ id: `plan-${index+1}`, name: '原款呈现', direction: '保留原款', changes: [], designBrief: 'The same original sculpted vessel with its complete curved handle, silhouette, proportions and decorative motifs, using the requested target material.', prompt: 'The same original sculpted vessel with its complete curved handle and silhouette.' }))
  }),
  generate: async () => ({ images: [{ b64: mockDesignImage(0).toString('base64'), mime: 'image/png' }] }),
  vision: async () => ({ status: 'PASS', summary: '模拟检查：用于验证界面显示', issues: [], uncertainties: [], assessedAt: Date.now(), advisory: true, model: 'mock-analysis', designPreservation: Object.fromEntries(['design','material','photography'].map(area => [area, { status: 'PASS', evidence: `${area}：仅本地流程模拟，非真实成图质量结论` }])) }),
})
await f.workflow.ready
const routes = makeRoutes({ settings: { describe: () => [], mutate: async () => {} }, resolve: () => ({ apiUrl: 'https://mock.invalid', apiKey: 'mock-key' }), resolveChannels: () => channels, runtime: { queue: f.queue }, etsy: f.workflow, etsyModelControls: controls })
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname
  const route = routes.find(r => r.kind === 'exact' && r.path === pathname)
  if (route) { try { await route.handler(req, res) } catch (error) { res.statusCode=500;res.end(String(error)) } return }
  if (pathname === '/preview.js') { res.setHeader('content-type','text/javascript');res.end(await readFile(new URL('../.reference-preview/preview.js',import.meta.url)));return }
  res.setHeader('content-type','text/html; charset=utf-8')
  res.end('<!doctype html><html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;display:flex}#history-host{width:225px;flex-shrink:0;height:100vh;border-right:1px solid #e4e7ed}#root{position:relative;height:100vh;flex:1;min-width:0}:root{--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#f6f7f9;--dsw-alias-border-l1:#e4e7ed;--dsw-alias-label-primary:#282b32;--dsw-alias-label-secondary:#6f7783}</style><aside id="history-host"></aside><div id="root"></div><script src="/preview.js"></script></html>')
})
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
let browser
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } })
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  const slider=page.getByLabel('生成图片数量',{exact:true})
  await slider.waitFor()
  const displayedVersion=await page.locator('[data-studio-version]').innerText()
  if(process.env.EXPECT_RELEASE_LABEL==='1')assert.equal(displayedVersion,PLUGIN_VERSION)
  for (const name of ['原封不动','小幅调整','适度改款','大胆创作']) {
    await page.getByRole('radio',{name:new RegExp(name)}).click()
    assert.equal(await slider.getAttribute('min'),'1')
    assert.equal(await slider.getAttribute('max'),'8')
    await slider.focus();await slider.press('End');assert.equal(await slider.inputValue(),'8')
    await slider.press('Home');assert.equal(await slider.inputValue(),'1')
  }
  await page.getByRole('radio',{name:'原封不动',exact:true}).click()
  assert.equal(await slider.inputValue(),'1')
  const buttons=await page.getByRole('radiogroup',{name:'改动幅度'}).getByRole('radio').evaluateAll(els=>els.map(e=>({top:Math.round(e.getBoundingClientRect().top),width:e.getBoundingClientRect().width})))
  assert.equal(new Set(buttons.map(b=>b.top)).size,2)
  await page.getByLabel('创作任务',{exact:true}).selectOption('felt-conversion')
  assert.equal(await page.getByText('按原造型转换主体材质，保留部件、配件与纹样。',{exact:true}).isVisible(),true)
  await page.getByLabel('摄影背景',{exact:true}).selectOption('white-studio')
  await page.getByLabel('图片画幅',{exact:true}).selectOption('1:1')
  await page.getByLabel('构图方式',{exact:true}).selectOption('override_reference')
  await page.getByRole('button',{name:'小 · 45%',exact:true}).click()
  await page.locator('[data-composition-preview]').waitFor()
  await page.getByLabel('参考图片',{exact:true}).setInputFiles({name:'mock-reference.png',mimeType:'image/png',buffer:mockDesignImage(0)})
  await page.getByRole('button',{name:'生成 1 张',exact:true}).click()
  await page.waitForFunction(()=>document.querySelectorAll('[data-design-plan] img').length===1)
  await page.locator('[data-design-preservation-review]').waitFor({state:'attached'})
  await page.getByText('检查建议',{exact:true}).click()
  await page.locator('[data-design-preservation-review]').waitFor()
  await f.workflow.idle()
  const product=(await f.workflow.list())[0]
  assert.equal(product.creativity,'preserve');assert.equal(product.images.length,1)
  assert.equal(product.creationTask,'felt-conversion')
  assert.equal(product.images[0].visualRules.photography.photography_preset,'white-studio')
  assert.equal(product.images[0].visualRules.compositionTarget.heightRatio,0.45)
  assert.equal(product.images[0].visualRules.compositionGuide.image,1)
  assert.match(f.queue.get(product.images[0].taskId).request.prompt,/DESIGN_PRESERVATION_V1/)
  await page.reload()
  await page.waitForFunction(()=>document.querySelector('[role="radio"][aria-checked="true"]')?.textContent==='原封不动')
  assert.equal(await slider.inputValue(),'1')
  assert.equal(await page.getByLabel('摄影背景',{exact:true}).inputValue(),'white-studio')
  assert.equal(await page.getByLabel('主体高度占比',{exact:true}).inputValue(),'45')
  await page.getByLabel('摄影背景',{exact:true}).selectOption('home-lifestyle')
  await page.getByRole('button',{name:'细节 · 85%',exact:true}).click()
  await page.getByRole('button',{name:'再生成 1 张',exact:true}).click()
  await page.waitForFunction(()=>document.querySelectorAll('[data-creation-project]').length===2)
  await f.workflow.idle()
  await page.waitForFunction(()=>document.querySelectorAll('[data-design-plan] img').length===1)
  const next=(await f.workflow.list())[0]
  assert.equal(next.images[0].visualRules.photography.photography_preset,'home-lifestyle')
  assert.equal(next.images[0].visualRules.compositionTarget.heightRatio,0.85)
  await page.screenshot({path:path.join(output,'实际界面_原款模式.png'),fullPage:true})
  await page.setViewportSize({width:1100,height:900})
  const bounds=await page.getByRole('radiogroup',{name:'改动幅度'}).evaluate(e=>({width:e.clientWidth,scrollWidth:e.scrollWidth}))
  assert.ok(bounds.scrollWidth<=bounds.width+1)
  await page.screenshot({path:path.join(output,'实际界面_窄侧栏.png'),fullPage:true})
  assert.deepEqual(errors,[])
  const report={passed:true,displayedVersion,allModesOneToEight:true,modeCountRemembered:true,twoRowLayout:true,originalDesignWithMaterialConversion:true,singleImageSubmitted:true,preservationReviewRendered:true,projectRestored:true,narrowRailFits:true,white45ThenHome85:true,photographySelectionPersists:true,compositionPreviewVisible:true,layoutGuideSubmitted:true,runtimeErrors:errors,modelCallsAreMock:true,counts:f.counts}
  await writeFile(path.join(output,'浏览器联测.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
} finally {
  await browser?.close();f.workflow.dispose();await f.workflow.idle();await new Promise(resolve=>server.close(resolve))
  const resolved = await realpath(root)
  assert.equal(path.dirname(resolved).toLowerCase(), (await realpath(tmpdir())).toLowerCase())
  assert.ok(path.basename(resolved).startsWith('preserve-browser-'))
  await rm(resolved,{recursive:true,force:true})
}

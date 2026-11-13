// 对照 rc.1 的直接工作区与 rc.3 的真实嵌套网格，验证列表、页脚和模式切换。
// 仅用合成项目；不读取真实渠道、不调用模型、不进行安装。
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const { chromium } = createRequire('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/package.json')('playwright')
const preview = await fs.readFile(new URL('../.sidebar-compat-preview/preview.js', import.meta.url))
const notes = await fs.readFile(new URL('../docs/releases/v2.1.1-etsy.md', import.meta.url), 'utf8')
const done = { status: 'completed', attempts: 1 }
const projects = Array.from({ length: 32 }, (_, i) => ({ id: `project-${i}`, source: 'generated', createdAt: 1794000000000-i*60000, facts: { name: `合成创作 ${i+1}` }, images: [{ id: `image-${i}`, files: ['image.png'], generation: done, quality: done }], copyStage: done }))
function html(host) {
  const region = '<div class="host_regionArea"><div data-native-workspaces>工作区与会话</div></div>'
  const middle = host === 'rc3' ? `<div class="host_scrollRegion"><div class="host_scrollArea"><nav class="host_panelList">插件 · 自动化任务 · 更多</nav>${region}</div><span class="host_scrollFade"></span></div>` : `<nav class="host_panelList">插件 · 自动化任务</nav>${region}`
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>
  *{box-sizing:border-box}body{margin:0;display:flex;font:13px/1.5 'Microsoft YaHei',sans-serif;color:#28372e}:root{--dsw-alias-bg-base:#f7faf8;--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#f4f7f5;--dsw-alias-border-l1:#dce5df;--dsw-alias-label-primary:#24362a;--dsw-alias-label-secondary:#66756b}
  .dshDesktopSidebarSurface{height:100vh;flex:0 0 var(--sidebar-width,272px);background:#f7f9f8}.dshDesktopUpstreamSidebar{height:100%}.host_root{height:100%;display:flex;flex-direction:column;padding:14px 10px 0;min-height:0}.host_logoRow{height:34px;flex:none;font-size:18px;font-weight:bold}.host_newSessionRow{flex:none}.host_newSession{height:32px;width:100%;border:1px solid #dce5df;border-radius:8px;background:white}.host_panelList{flex:none;padding:10px 0}.host_footArea{flex:none;height:48px;display:flex;align-items:center}.host_regionArea{position:relative;flex:1;min-height:0}.host_root>.host_regionArea{overflow:hidden}
  /* 下列关键网格来自 rc.3 官方 SidebarRoot：scrollRegion 包住 scrollArea，regionArea 在第4行。 */
  .host_scrollRegion{margin-top:4px;position:relative;flex:1;min-height:0;display:flex;flex-direction:column;container-type:size}.host_scrollArea{flex:1;min-height:0;display:grid;grid-template-columns:4px minmax(0,1fr) 8px;grid-template-rows:8px max-content 2px max-content;align-content:start;margin-left:-4px;overflow-x:hidden;overflow-y:auto}.host_scrollArea::before,.host_scrollArea::after{content:'';grid-column:2;pointer-events:none}.host_scrollArea::before{grid-row:1}.host_scrollArea::after{grid-row:3}.host_scrollArea>.host_panelList{grid-column:2;grid-row:2}.host_scrollArea>.host_regionArea{grid-column:2;grid-row:4;display:flex;flex-direction:column}.host_scrollFade{position:absolute;bottom:0}
  #root{height:100vh;flex:1;min-width:0;position:relative}
  </style><aside class="dshDesktopSidebarSurface"><div class="dshDesktopUpstreamSidebar"><div class="host_root"><div class="host_logoRow">DeepSeek Harness</div><div class="host_newSessionRow"><button class="host_newSession" aria-label="新会话">新会话</button></div>${middle}<div class="host_footArea"><button data-account-avatar>本机账号</button></div></div></div></aside><main id="root"></main><script src="/preview.js"></script></html>`
}
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  if (url.pathname === '/preview.js') { res.setHeader('content-type','text/javascript');res.end(preview);return }
  if (url.pathname.startsWith('/api/')) {
    res.setHeader('content-type','application/json')
    const reply = value => res.end(JSON.stringify(value))
    if (url.pathname.endsWith('/etsy/list')) return reply({ok:true,value:projects})
    if (url.pathname.endsWith('/model-choices')) return reply({ok:true,value:{writable:false,imageGroups:[],image:{channelId:'mock',model:'mock-image'},analysis:{provider:'',model:''},analysisLabel:'隔离测试',defaultAnalysisLabel:'隔离测试',analysisModels:[],warnings:[]}})
    if (url.pathname.endsWith('/update/check')) return reply({ok:true,update:{currentVersion:'2.1.1-etsy',latestVersion:'2.1.1-etsy',updateAvailable:false,releaseNotes:notes}})
    if (url.pathname.endsWith('/update/status')) return reply({ok:true,progress:{phase:'idle',receivedBytes:0,totalBytes:0,updatedAt:Date.now()}})
    return reply({ok:false,message:'测试未提供此操作'})
  }
  res.setHeader('content-type','text/html; charset=utf-8');res.end(html(url.searchParams.get('host') || 'rc3'))
})
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
const out = new URL('../output/sidebar-compat/',import.meta.url);await fs.mkdir(out,{recursive:true})
const browser = await chromium.launch({channel:'chrome',headless:true})
const scenarios=[],errors=[]
try {
  const page = await browser.newPage({viewport:{width:1280,height:820}});page.on('pageerror',e=>errors.push(e.message))
  const base = `http://127.0.0.1:${server.address().port}`
  await page.goto(base+'/?host=rc3');await page.locator('[data-creation-project]').first().waitFor()
  // 用旧选择器精确复现：滚动区连同全部创作一起消失，页脚上移。
  const old = await page.addStyleTag({content:"html[data-dsh-imagegen-active] [data-dsh-imagegen-sidebar-root] > [class*='scrollRegion']{display:none!important}"})
  assert.equal(await page.locator('[data-creation-history]').isVisible(),false)
  const before = await page.locator('[data-account-avatar]').boundingBox();assert.ok(before.y<250)
  await page.screenshot({path:fileURLToPath(new URL('rc3-before-reproduced.png',out))});await old.evaluate(node=>node.remove())
  for (const host of ['rc1','rc3']) for (const width of [1280,1440]) for (const sidebarWidth of [216,272,320]) {
    await page.setViewportSize({width,height:820});await page.goto(base+'/?host='+host)
    await page.locator('.dshDesktopSidebarSurface').evaluate((node,value)=>node.style.setProperty('--sidebar-width',value+'px'),sidebarWidth)
    const history=page.locator('[data-creation-history]');await history.waitFor({state:'visible'})
    assert.equal(await page.locator('[data-creation-project]').count(),32)
    const box=await history.boundingBox(),avatar=await page.locator('[data-account-avatar]').boundingBox();assert.ok(box.height>450,host+' 创作列表有完整可用高度');assert.ok(avatar.y>760,host+' 头像保持底部')
    await page.getByLabel('搜索创作',{exact:true}).fill('合成创作 32');assert.equal(await page.locator('[data-creation-project]:visible').count(),1);await page.getByLabel('搜索创作',{exact:true}).fill('')
    await page.getByRole('button',{name:'会话',exact:true}).click();assert.equal(await history.isVisible(),false);assert.equal(await page.locator('[data-native-workspaces]').isVisible(),true);const chatAvatar=await page.locator('[data-account-avatar]').boundingBox();assert.ok(Math.abs(chatAvatar.y-avatar.y)<1,'切换模式不移动头像')
    await page.getByRole('button',{name:'生图',exact:true}).click();await history.waitFor({state:'visible'});assert.equal(await page.locator('[data-creation-project]').count(),32)
    scenarios.push({host,width,sidebarWidth,historyHeight:Math.round(box.height),avatarY:Math.round(avatar.y),allProjects:32})
  }
  await page.setViewportSize({width:1280,height:820});await page.goto(base+'/?host=rc3');await page.locator('[data-creation-history]').waitFor({state:'visible'});await page.screenshot({path:fileURLToPath(new URL('rc3-after.png',out))})
  await page.getByRole('button',{name:'插件更新',exact:true}).click();const panel=page.getByRole('dialog',{name:'插件版本更新'});await panel.getByRole('heading',{name:'更新内容',exact:true}).waitFor();assert.equal(await panel.locator('li').count(),4)
  const text=await panel.innerText();for(const forbidden of ['下载唯一附件','后续仍然每版','版本顺序','旧版第一次','31 项','199 项','Source code','首次使用的电脑','**'])assert.ok(!text.includes(forbidden),'弹窗不包含维护说明：'+forbidden)
  await page.screenshot({path:fileURLToPath(new URL('update-notes-after.png',out))});assert.deepEqual(errors,[])
  const report={passed:true,baselineReproduced:true,scenarios,releaseNotesClean:true,modelCalls:0};await fs.writeFile(new URL('result.json',out),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,scenarios:scenarios.length,projectRowsPerScenario:32,avatarBottomAndStable:true,releaseNotesClean:true,modelCalls:0},null,2))
} finally {await browser.close();await new Promise(resolve=>server.close(resolve))}

// 验收红框位置的真实渲染、分辨率保存、首次生成和精修/重试/多角度请求。模型均为隔离模拟。
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { fixture, pixel } from './etsy-fixture.mjs'
import { mockDesignImage } from './mock-design-image.mjs'
import { makeEtsyRoutes } from '../.etsy-test/host.js'
const {chromium}=createRequire('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/package.json')('playwright')
const root=await mkdtemp(path.join(tmpdir(),'resolution-v9-'))
const evidence=process.env.ETSY_TEST_EVIDENCE||path.resolve('output/playwright/resolution-v9')
await mkdir(evidence,{recursive:true})
const received=[],dispatched=[],errors=[];let failAt=-1
const f=fixture(root,{failGeneration:i=>i===failAt,generate:async(request,i)=>{dispatched.push({model:request.model,quality:request.quality,size:request.size});return {images:[{b64:mockDesignImage(i%4).toString('base64'),mime:'image/png'}]}}})
await f.workflow.ready
const routes=makeEtsyRoutes({workflow:f.workflow,guard:()=>true,parse:body=>body,normalize:request=>({ok:true,request})})
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1')
  if(url.pathname.endsWith('/model-choices')){res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,value:{writable:false,imageGroups:[{id:'mock',name:'隔离渠道',models:['mock-image']}],image:{channelId:'mock',model:'mock-image'},analysis:{provider:'mock',model:'mock'},analysisLabel:'隔离分析',analysisModels:[],warnings:[]}}));return}
  const route=routes.find(r=>r.kind==='exact'&&r.path===url.pathname)
  if(route){const chunks=[];for await(const chunk of req)chunks.push(chunk);const raw=Buffer.concat(chunks);let data;try{data=JSON.parse(raw)}catch{};received.push({path:url.pathname,quality:data?.generation?.quality});req[Symbol.asyncIterator]=async function*(){yield raw};await route.handler(req,res);return}
  if(url.pathname==='/preview.js'){res.setHeader('content-type','text/javascript');res.end(await readFile(new URL('../.reference-preview/preview.js',import.meta.url)));return}
  res.setHeader('content-type','text/html;charset=utf-8');res.end('<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;display:flex}#history-host{width:225px;height:100vh;flex-shrink:0;border-right:1px solid #ddd}#root{position:relative;height:100vh;flex:1;min-width:0}:root{--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#f6f7f9;--dsw-alias-border-l1:#ddd;--dsw-alias-label-primary:#282b32;--dsw-alias-label-secondary:#6f7783}</style><aside id="history-host"></aside><div id="root"></div><script src="/preview.js"></script>')
 }catch(e){errors.push(e.message);res.statusCode=500;res.end('隔离服务错误')}
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const base='http://127.0.0.1:'+server.address().port
const browser=await chromium.launch({channel:'chrome',headless:true})
try{
 const page=await browser.newPage({viewport:{width:1280,height:820}});page.on('pageerror',e=>errors.push(e.message))
 await page.goto(base);await page.getByLabel('输出分辨率',{exact:true}).waitFor()
 const resolution=page.getByLabel('输出分辨率',{exact:true})
 assert.equal(await resolution.inputValue(),'2k','首次默认使用 2K')
 assert.deepEqual(await resolution.locator('option').allTextContents(),['1K','2K','4K'])
 const taskBox=await page.getByLabel('创作任务',{exact:true}).boundingBox(),resolutionBox=await resolution.boundingBox()
 assert.ok(Math.abs(taskBox.y-resolutionBox.y)<3&&resolutionBox.x>taskBox.x,'任务与分辨率应按红框并排')
 await resolution.selectOption('2k');await page.reload();await resolution.waitFor();assert.equal(await resolution.inputValue(),'2k','重开空白工作台保留选择')
 await page.getByRole('slider',{name:'探索图片数量',exact:true}).fill('2')
 await page.getByLabel('参考图片',{exact:true}).setInputFiles({name:'mock.png',mimeType:'image/png',buffer:mockDesignImage(0)})
 await page.getByLabel('补充想法（可不填）').fill('分辨率验收，保留原设计')
 await page.screenshot({path:path.join(evidence,'resolution-2k-layout.png')})
 await page.getByRole('button',{name:'生成 2 个方案',exact:true}).click()
 await page.waitForFunction(()=>document.querySelectorAll('[data-design-plan] img').length===2);await f.workflow.idle()
 let product=(await f.workflow.list())[0]
 assert.equal(product.request.quality,'2k');assert.ok(product.images.every(i=>i.renderSettings.quality==='2k'))
 assert.ok(dispatched.slice(0,2).every(r=>r.quality==='2k'))
 await resolution.selectOption('4k');await page.getByLabel('修改要求',{exact:true}).fill('保持角色，仅提高输出分辨率')
 await page.getByRole('button',{name:'修改这张图',exact:true}).click()
 await page.waitForFunction(()=>document.querySelectorAll('[data-design-plan] img').length===3);await f.workflow.idle()
 product=await f.workflow.get(product.id);assert.equal(product.images.at(-1).renderSettings.quality,'4k');assert.equal(dispatched.at(-1).quality,'4k')
 await page.reload();await resolution.waitFor();await page.waitForFunction(()=>document.querySelectorAll('[data-design-plan] img').length===3)
 assert.equal(await resolution.inputValue(),'4k','重开按当前选图恢复分辨率')
 // 单独从实际 HTTP 路由验证重试和多角度，避免遗漏原有后端覆盖问题。
 const image=product.images.at(-1);const generation={...product.request,quality:'1k'}
 const confirmed=await page.request.post(base+'/api/dsh-imagegen/etsy/confirm-design',{data:{id:product.id,imageId:image.id,notes:'固定设计'}})
 const confirmation=await confirmed.json();assert.equal(confirmation.ok,true,JSON.stringify(confirmation));await f.workflow.idle()
 product=await f.workflow.get(product.id);const design=product.finalDesigns.find(d=>d.imageId===image.id)
 const views=await page.request.post(base+'/api/dsh-imagegen/etsy/generate-views',{data:{id:product.id,designId:design.id,angles:['back'],requestKey:'resolution-view-test',generation}})
 assert.equal((await views.json()).ok,true);await f.workflow.idle();product=await f.workflow.get(product.id)
 const back=product.images.find(i=>i.kind==='view');assert.equal(back.renderSettings.quality,'1k')
 // 制造一次隔离失败，再通过真实“重试这张图”按钮验证最新档位。
 failAt=f.counts.generation+1
 await resolution.selectOption('2k');await page.getByRole('button',{name:/再生成\s*2\s*张/}).click()
 await page.getByRole('button',{name:'重试这张图',exact:true}).waitFor();await f.workflow.idle()
 const nextProduct=(await f.workflow.list()).find(p=>p.id!==product.id);const failed=nextProduct.images.find(i=>i.generation.status==='failed');assert.ok(failed)
 await resolution.selectOption('4k')
 const retryResponse=page.waitForResponse(r=>r.url().endsWith('/api/dsh-imagegen/etsy/retry')&&r.request().method()==='POST')
 await page.getByRole('button',{name:'重试这张图',exact:true}).click();assert.equal((await(await retryResponse).json()).ok,true);await f.workflow.idle()
 const retried=await f.workflow.get(nextProduct.id);assert.equal(retried.images.find(i=>i.id===failed.id).renderSettings.quality,'4k')
 // 原型号只支持 1K 时，禁用高分辨率，并在恢复旧项目后仍保持合法值。
 await page.goto(base+'/?model=gemini-3.1-flash-lite-image');await resolution.waitFor();
 try { await page.waitForFunction(()=>{const select=document.querySelector('[aria-label="输出分辨率"]');return select?.value==='1k'&&select.querySelector('option[value="2k"]')?.disabled&&select.querySelector('option[value="4k"]')?.disabled},{},{timeout:5000}) }
 catch(e){console.log('Lite 页面诊断：'+JSON.stringify(await page.evaluate(()=>({url:location.href,value:document.querySelector('[aria-label="输出分辨率"]')?.value,options:[...document.querySelectorAll('[aria-label="输出分辨率"] option')].map(o=>({v:o.value,disabled:o.disabled})),hints:[...document.querySelectorAll('[data-task-resolution-row]~small')].map(x=>x.textContent)}))));await page.screenshot({path:path.join(evidence,'resolution-lite-debug.png')});throw e}
 assert.equal(await resolution.locator('option[value="2k"]').evaluate(option=>option.disabled),true);assert.equal(await resolution.locator('option[value="4k"]').evaluate(option=>option.disabled),true)
 // 不支持参数的 Chat 渠道在界面提示，不消耗规划或生图额度。
 await page.goto(base+'/?model=gemini-3.1-flash-image&protocol=chat');await resolution.waitFor();await resolution.selectOption('2k')
 await page.getByText('该 Chat 渠道不传分辨率；2K / 4K 请在模型选择中使用 Gemini 原生渠道。',{exact:true}).waitFor()
 const callsBefore=f.counts.generation,plansBefore=f.counts.planning
 await page.getByRole('button',{name:/再生成\s*2\s*张/}).click();await page.waitForTimeout(100)
 assert.equal(f.counts.generation,callsBefore);assert.equal(f.counts.planning,plansBefore)
 await page.screenshot({path:path.join(evidence,'resolution-chat-hint.png')})
 assert.deepEqual(errors,[])
 const report={passed:true,layout:'任务与分辨率并排',firstGeneration2K:true,revision4K:true,retry4K:true,reloadRestoresResolution:true,multiViewResolutionOverride:true,liteOnly1K:true,chatExplicitHint:true,chatBlockedBeforeBillableWork:true,received,dispatched}
 await writeFile(path.join(evidence,'resolution-flow-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}finally{
 await browser.close();await f.workflow.idle();await new Promise(resolve=>server.close(resolve));assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(root).startsWith('resolution-v9-'));await rm(root,{recursive:true,force:true})
}

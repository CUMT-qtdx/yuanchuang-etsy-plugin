// 用真实浏览器验证自动提示、下载进度、失败提示、忙任务保护和重启交接按钮。
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
const {chromium}=createRequire('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/package.json')('playwright')
const evidence=new URL('../../evidence/',import.meta.url);await fs.mkdir(evidence,{recursive:true})
let progress={phase:'idle',receivedBytes:0,totalBytes:8388608,updatedAt:Date.now()},busy=true,downloads=0,restarts=0,corrupt=true
const requests=[],errors=[]
const server=createServer(async(req,res)=>{
 if(req.url==='/preview.js'){res.setHeader('content-type','text/javascript');res.end(await fs.readFile(new URL('../.update-preview/preview.js',import.meta.url)));return}
 if(req.url.startsWith('/api/')){
  requests.push(req.url);res.setHeader('content-type','application/json');const reply=x=>res.end(JSON.stringify(x))
  if(req.url.endsWith('/check'))return reply({ok:true,update:{currentVersion:'2.1.1-etsy',latestVersion:'2.1.2-etsy',updateAvailable:true,releaseNotes:'新增界面能力',releaseUrl:'https://github.com/CUMT-qtdx/yuanchuang-etsy-plugin/releases/tag/v2.1.2-etsy'}})
  if(req.url.endsWith('/download')){downloads++;progress={...progress,phase:'downloading',version:'2.1.2-etsy',receivedBytes:2097152};setTimeout(()=>{progress=corrupt?{...progress,phase:'failed',message:'安装器 SHA-256 校验失败，未执行任何安装'}:{...progress,phase:'ready',receivedBytes:8388608,message:'已下载并校验，点击重启并更新'}},650);return reply({ok:true,progress})}
  if(req.url.endsWith('/status'))return reply({ok:true,progress})
  if(req.url.endsWith('/apply')){if(busy)return reply({ok:false,message:'还有生图、分析或文案任务进行中，请完成后再更新'});restarts++;return reply({ok:true,updatedVersion:'2.1.2-etsy',restartRequired:true})}
  return reply({ok:false,message:'unknown'})
 }
 res.setHeader('content-type','text/html');res.end('<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/preview.js"></script>')
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({channel:'chrome',headless:true})
try{
 const page=await browser.newPage({viewport:{width:1120,height:760}});page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept())
 await page.goto('http://127.0.0.1:'+server.address().port)
 await page.getByRole('button',{name:'插件更新',exact:true}).filter({hasText:'发现新版 2.1.2-etsy'}).waitFor()
 await page.getByRole('button',{name:'插件更新',exact:true}).click();await page.getByRole('button',{name:'下载更新',exact:true}).click()
 await page.getByRole('progressbar',{name:'更新下载进度'}).waitFor();await page.screenshot({path:new URL('update-downloading.png',evidence).pathname.replace(/^\/([A-Za-z]:)/,'$1')})
 await page.getByText('安装器 SHA-256 校验失败，未执行任何安装',{exact:true}).waitFor();assert.equal(restarts,0)
 corrupt=false;await page.getByRole('button',{name:'下载更新',exact:true}).click();await page.getByRole('button',{name:'重启并更新',exact:true}).waitFor()
 await page.getByRole('button',{name:'重启并更新',exact:true}).click();await page.getByText('还有生图、分析或文案任务进行中，请完成后再更新',{exact:true}).waitFor();assert.equal(restarts,0)
 await page.screenshot({path:new URL('update-busy-protection.png',evidence).pathname.replace(/^\/([A-Za-z]:)/,'$1')})
 busy=false;await page.getByRole('button',{name:'重启并更新',exact:true}).click();await page.getByText('正在重启并安装，请稍候',{exact:true}).waitFor();assert.equal(restarts,1);assert.equal(downloads,2);assert.deepEqual(errors,[])
 await fs.writeFile(new URL('update-browser-result.json',evidence),JSON.stringify({passed:true,automaticNewVersionNotice:true,downloadProgress:true,corruptFileRejected:true,busyTaskBlocksRestart:true,explicitRestartButton:true,restartHandoffs:restarts,requests},null,2));console.log('更新按钮浏览器验收全部通过')
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}

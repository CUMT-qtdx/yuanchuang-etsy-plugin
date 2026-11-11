/** Verify actual image pixels at all four corners survive the studio preview.
 * Build: pnpm exec tsdown --config scripts/result-preview.config.ts
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync,readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require=createRequire(import.meta.url),runtime=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?createRequire(`${process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES}/.result-test.cjs`):require
const {chromium}=runtime('playwright'),sharp=runtime('sharp')
const sizes=[[600,1800],[1800,600],[1200,1200]],colors=[[238,51,51],[34,187,85],[34,119,221],[255,204,51]]
const samples=await Promise.all(sizes.map(([w,h])=>sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#e5e7ea"/><rect width="20%" height="20%" fill="#ee3333"/><rect x="80%" width="20%" height="20%" fill="#22bb55"/><rect y="80%" width="20%" height="20%" fill="#2277dd"/><rect x="80%" y="80%" width="20%" height="20%" fill="#ffcc33"/><text x="50%" y="50%" text-anchor="middle" font-size="${Math.min(w,h)/10}" font-family="sans-serif" fill="#555">FULL IMAGE</text></svg>`)).png().toBuffer()))
const css=`${process.env.RESULT_PREVIEW_FONT?'@font-face{font-family:PreviewCJK;src:url(/font)}':''}:root{--dsw-font-family:PreviewCJK,system-ui,sans-serif;--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#f8f8fa;--dsw-alias-bg-layer-2:#f0f0f3;--dsw-alias-border-l1:#dddde3;--dsw-alias-border-l2:#cfcfd6;--dsw-alias-label-primary:#28282b;--dsw-alias-label-tertiary:#85858d;--dsw-alias-label-secondary:#66666d;--dsw-alias-brand-primary:#333}html,body,#root{height:100%;margin:0}body{font-family:PreviewCJK,system-ui,sans-serif}select{font-family:inherit;padding:5px;max-width:100px}header{font-size:12px}@media(max-width:600px){header{gap:6px!important;padding:0 10px!important}header strong{font-size:10px}}
`
const server=createServer((req,res)=>{
 if(req.url==='/preview.js'){res.setHeader('content-type','text/javascript');res.end(readFileSync(new URL('../.result-preview/preview.js',import.meta.url)));return}
 if(req.url==='/font'&&process.env.RESULT_PREVIEW_FONT){res.end(readFileSync(process.env.RESULT_PREVIEW_FONT));return}
 if(req.url?.startsWith('/sample/')){res.setHeader('content-type','image/png');res.end(samples[Number(req.url.split('/').pop().split('.')[0])]);return}
 res.setHeader('content-type','text/html');res.end(`<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/preview.js"></script></html>`)
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
let browser
try{
 browser=await chromium.launch({headless:true,...process.env.RESULT_CHROMIUM_PATH?{executablePath:process.env.RESULT_CHROMIUM_PATH,args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage']}:{} })
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message))
 const url=`http://127.0.0.1:${server.address().port}`
 async function complete(){await page.waitForFunction(()=>[...document.querySelectorAll('[data-result-preview-grid] img')].every(image=>image.complete&&image.naturalWidth>0));await page.evaluate(()=>document.fonts.ready)}
 async function cornersVisible(){
  await complete();const bounds=await page.locator('[data-result-preview-grid] img').evaluateAll(images=>images.map(image=>{const r=image.getBoundingClientRect(),s=Math.min(r.width/image.naturalWidth,r.height/image.naturalHeight),w=image.naturalWidth*s,h=image.naturalHeight*s;return{x:r.x+(r.width-w)/2,y:r.y+(r.height-h)/2,w,h}}))
  const {data,info}=await sharp(await page.screenshot()).removeAlpha().raw().toBuffer({resolveWithObject:true})
  return bounds.every(r=>[[.1,.1],[.9,.1],[.1,.9],[.9,.9]].every(([x,y],i)=>{const px=Math.floor(r.x+r.w*x),py=Math.floor(r.y+r.h*y);if(px<0||py<0||px>=info.width||py>=info.height)return false;const offset=(py*info.width+px)*info.channels;return colors[i].every((value,k)=>Math.abs(data[offset+k]-value)<12)}))
 }
 await page.goto(`${url}/?legacy=1`);assert.equal(await cornersVisible(),false,'old cover behavior reproduces missing image edges')
 await page.goto(url);await complete()
 const folder=new URL('../docs/images/',import.meta.url);mkdirSync(folder,{recursive:true})
 let cases=0
 for(const mode of ['文生图','图生图']){
  await page.getByLabel('模式',{exact:true}).selectOption(mode)
  for(const viewport of [{width:1280,height:900},{width:900,height:440},{width:480,height:800}]){
   await page.setViewportSize(viewport)
   for(const count of [1,2,4]){
    await page.getByLabel('图片数量',{exact:true}).selectOption(String(count))
    for(const variant of [0,1,2]){
     await page.getByLabel('图片方向',{exact:true}).selectOption(String(variant))
     assert.equal(await cornersVisible(),true,`${mode}, ${viewport.width}x${viewport.height}, ${count} images, variant ${variant}: all four corners visible`)
     const fits=await page.locator('[data-result-preview-grid] img').evaluateAll(images=>images.every(image=>{const imageBox=image.getBoundingClientRect(),card=image.closest('figure').getBoundingClientRect();return imageBox.top>=card.top&&imageBox.bottom<=card.bottom&&imageBox.left>=card.left&&imageBox.right<=card.right}))
     assert.equal(fits,true,'image never overflows its card');cases+=1
    }
   }
  }
 }
 await page.setViewportSize({width:1280,height:900});await page.getByLabel('图片数量',{exact:true}).selectOption('1');await page.getByLabel('图片方向',{exact:true}).selectOption('0');await complete();await page.screenshot({path:new URL('result-preview-fit-portrait.png',folder).pathname})
 await page.getByLabel('图片方向',{exact:true}).selectOption('1');await complete();await page.screenshot({path:new URL('result-preview-fit-landscape.png',folder).pathname})
 assert.deepEqual(errors,[])
 console.log(`PASS result preview: old crop reproduced; all four image corners visible in ${cases} text/edit, tall/wide/square, single/multiple and viewport combinations`)
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}

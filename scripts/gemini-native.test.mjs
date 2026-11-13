// 覆盖真实原生请求契约、下载鉴权边界和旧协议回归，不调用付费上游。
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateImage } from '../src/engine.ts'
import { resolveChannelProtocol, isChannelProtocolPreference } from '../src/protocol.ts'
import { listImageModels } from '../src/prompt-enhancer.ts'
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZdQAAAAASUVORK5CYII='
const config={apiUrl:'https://creative.example',apiKey:'native-test-key',protocol:'gemini-native'}
const request={model:'gemini-3-pro-image',prompt:'几何图测试',mode:'edit',image:'data:image/png;base64,'+png,size:'1:1',quality:'2k',detail:'auto',n:2}
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}})}
test('原生协议只在显式选择或明确 generateContent URL 时启用',()=>{
 assert.equal(isChannelProtocolPreference('gemini-native'),true)
 assert.equal(resolveChannelProtocol('https://creative.example','gemini-native'),'gemini-native')
 assert.equal(resolveChannelProtocol('https://creative.example/v1beta/models/gemini-3-pro-image:generateContent','auto'),'gemini-native')
 assert.equal(resolveChannelProtocol('https://old.example/v1','auto'),'images')
 assert.equal(resolveChannelProtocol('https://old.example/v1/chat/completions','auto'),'chat-completions')
})
test('原生图生图透传画幅、清晰度、张数和参考图；同时解析下载链接与 Base64',async()=>{
 const calls=[];const signed='https://cdn.example/image.jpg?signature=a%2Fb&expires=123'
 globalThis.fetch=async(url,options={})=>{
  calls.push({url,options})
  if(options.method==='POST')return json({candidates:[{content:{parts:[{thought:true,inlineData:{data:png}},{fileData:{mimeType:'image/png',fileUri:signed}}]}},{content:{parts:[{inlineData:{mimeType:'image/png',data:png}}]}}]})
  assert.equal(url,signed)
  assert.equal(new Headers(options.headers).has('authorization'),false)
  assert.equal(new Headers(options.headers).has('x-goog-api-key'),false)
  return new Response(Buffer.from(png,'base64'),{headers:{'content-type':'image/png'}})
 }
 const result=await generateImage(config,request)
 assert.equal(calls[0].url,'https://creative.example/v1beta/models/gemini-3-pro-image:generateContent')
 const sent=JSON.parse(calls[0].options.body)
 assert.equal(new Headers(calls[0].options.headers).get('x-goog-api-key'),config.apiKey)
 assert.equal(sent.contents[0].parts[1].inlineData.data,png)
 assert.deepEqual(sent.generationConfig,{responseModalities:['TEXT','IMAGE'],imageConfig:{aspectRatio:'1:1',imageSize:'2K'},candidateCount:2})
 assert.equal(result.images.length,2);assert.equal(calls.length,2)
 assert.equal(result.images[0].mime,'image/png')
})
test('版本前缀和完整原生地址不会重复拼接',async()=>{
 const urls=[];globalThis.fetch=async url=>{urls.push(url);return json({candidates:[{content:{parts:[{inlineData:{data:png,mimeType:'image/png'}}]}}]})}
 for(const base of ['https://creative.example/v1','https://creative.example/v1beta'])await generateImage({...config,apiUrl:base},{...request,n:1})
 const exact='https://creative.example/v1beta/models/gemini-3-pro-image:generateContent'
 await generateImage({...config,apiUrl:exact,apiUrlFull:true},{...request,n:1})
 assert.deepEqual(urls,[exact,exact,exact])
})
test('上游 502 保留正文和实际 URL，不自动重试生成',async()=>{
 let count=0;globalThis.fetch=async()=>{count++;return json({error:{type:'upstream_error',message:'当前服务拥挤，请重试。'}},502)}
 await assert.rejects(generateImage(config,request),e=>e.code==='upstream-rejected'&&e.message.includes('HTTP 502')&&e.message.includes('当前服务拥挤'))
 assert.equal(count,1)
})
test('1K 限制与缺少参考图会在联网前明确拒绝',async()=>{
 globalThis.fetch=async()=>{throw Error('不应联网')}
 await assert.rejects(generateImage(config,{...request,model:'gemini-3.1-flash-lite-image'}),e=>e.code==='unsupported-resolution')
 await assert.rejects(generateImage(config,{...request,image:undefined}),e=>e.code==='edit-image-missing')
})
test('原生模型检测兼容 OpenAI 目录与 Google name 结构',async()=>{
 const urls=[];globalThis.fetch=async url=>{urls.push(url);return String(url).includes('/v1/models')?json({error:{message:'not found'}},404):json({models:[{name:'models/gemini-3-pro-image',supportedGenerationMethods:['generateContent']},{name:'models/gemini-nano-banana-2.1'}]})}
 assert.deepEqual(await listImageModels(config),['gemini-3-pro-image','gemini-nano-banana-2.1'])
 assert.deepEqual(urls,['https://creative.example/v1/models','https://creative.example/v1beta/models'])
})
test('原生入口同时兼容文生图及 HTTP 200 内嵌错误',async()=>{
 let body;globalThis.fetch=async(_url,options)=>{body=JSON.parse(options.body);return json({error:{code:400,message:'resolution 1K only',status:'INVALID_ARGUMENT'}})}
 await assert.rejects(generateImage(config,{...request,mode:'generate',image:undefined,n:1}),e=>e.code==='upstream-rejected'&&e.message.includes('resolution'))
 assert.deepEqual(body.contents[0].parts,[{text:request.prompt}])
})
test('既有 GPT Images 请求保持原路径及上传结构',async()=>{
 let sent;globalThis.fetch=async(url,options)=>{sent={url,options};return json({data:[{b64_json:png}]})}
 const result=await generateImage({...config,apiUrl:'https://gpt.example/v1',protocol:'images'},{...request,model:'gpt-image-2.6-flare',n:1})
 assert.equal(sent.url,'https://gpt.example/v1/images/edits');assert.ok(sent.options.body instanceof FormData)
 assert.equal(sent.options.body.get('model'),'gpt-image-2.6-flare');assert.equal(result.images.length,1)
})
test('既有 Gemini Chat 请求保持 messages 和 stream 结构',async()=>{
 let sent;globalThis.fetch=async(url,options)=>{sent={url,options};return json({choices:[{message:{content:'![图](data:image/png;base64,'+png+')'}}]})}
 const result=await generateImage({...config,apiUrl:'https://chat.example/v1',protocol:'chat-completions'},{...request,model:'gemini-3.1-flash-image',n:1})
 assert.equal(sent.url,'https://chat.example/v1/chat/completions')
 const body=JSON.parse(sent.options.body);assert.equal(body.stream,false);assert.equal(body.messages[0].content[1].type,'image_url');assert.equal(body.generationConfig,undefined)
 assert.equal(result.images.length,1)
})

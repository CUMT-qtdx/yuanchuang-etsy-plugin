// 验证主体高度从设置到最终派发的约束，比例指完整商品，不是躯干或画面面积。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { composeFeltPrompt, makeFeltContext, defaultPhotography, ImageGenerationRuntime, attachSubjectLayoutGuide, createSubjectLayoutGuide } from '../.etsy-test/host.js'
import { fixture, input, pixel } from './etsy-fixture.mjs'
const context = ratio => makeFeltContext({ basePrompt: 'White rabbit with blue pinafore. The entire product should occupy approximately 45% of total image height.', stage: 'generation', photography: { ...defaultPhotography(), subject_height_ratio: ratio }, profile: {components:['body','face','clothing'],mixedMaterials:[],tones:['light'],scene:'minimal'} })
test('45%和60%使用不同的完整主体边界，旧规划百分比不能覆盖新选择',()=>{
 const small=composeFeltPrompt(context(.45),'gpt-image-2.6-flare'),normal=composeFeltPrompt(context(.6),'gpt-image-2.6-flare')
 assert.match(small.prompt,/y=330.*y=780/s)
 assert.match(normal.prompt,/y=240.*y=840/s)
 assert.match(small.prompt,/highest.*ear.*lowest.*foot/s)
 assert.doesNotMatch(normal.prompt,/45%/)
 assert.ok(small.prompt.startsWith('[subject_height_layout_v1_0]'))
 assert.equal(small.modules.subject_height_layout_v1_0,'1.0')
})
test('保留原构图与定稿多角度不套探索阶段的高度地图',()=>{
 const c=context(.45);c.photography.framing_policy='preserve_reference'
 const applied=composeFeltPrompt(c,'gpt-image-2.6-flare')
 assert.equal(applied.modules.subject_height_layout_v1_0,undefined)
 assert.doesNotMatch(applied.prompt,/y=330/)
})
test('切换比例重建示意图，保留构图时移除旧图，五张用户参考不挤掉',()=>{
 const source=`data:image/png;base64,${pixel}`,c=context(.45),base={mode:'edit',model:'gpt-image-2.6-flare',prompt:'',size:'1:1',n:1,image:source,images:[source],feltContext:c}
 const a=attachSubjectLayoutGuide(base,c.photography)
 assert.equal(a.images.length,2);assert.equal(a.images[0],source)
 const b=attachSubjectLayoutGuide(a,{...c.photography,subject_height_ratio:.6})
 assert.equal(b.images.length,2);assert.notEqual(b.image,a.image);assert.equal(b.feltContext.compositionGuide.ratio,.6)
 const preserved=attachSubjectLayoutGuide(b,{...c.photography,framing_policy:'preserve_reference'})
 assert.equal(preserved.image,source);assert.deepEqual(preserved.images,[source]);assert.equal(preserved.feltContext.compositionGuide,undefined)
 const five=attachSubjectLayoutGuide({...base,images:[source,source,source,source]},c.photography)
 assert.equal(five.image,source);assert.equal(five.images.length,4);assert.equal(five.feltContext.compositionGuide,undefined)
 const png=Buffer.from(createSubjectLayoutGuide(.45,'3:4').split(',')[1],'base64')
 assert.equal(png.readUInt32BE(16),768);assert.equal(png.readUInt32BE(20),1024)
})
test('首次生成与运行时同用构图图，重复组装不重复追加，用户原参考不丢失',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'occupancy-')),f=fixture(root);await f.workflow.ready
 t.after(async()=>{f.workflow.dispose();await f.workflow.idle();await rm(root,{recursive:true,force:true})})
 const p=await f.workflow.start(input({count:1,maxCalls:20,autoCheck:false,copyTiming:'selected',generation:{...input().generation,model:'gpt-image-2.6-flare',channelId:'enterprise',photography:{...defaultPhotography(),subject_height_ratio:.45}}}));await f.workflow.idle()
 const image=(await f.workflow.get(p.id)).images[0],request=f.queue.get(image.taskId).request
 assert.equal(request.images.length,1)
 assert.equal(request.images[0],`data:image/png;base64,${pixel}`)
 assert.equal(request.feltContext.compositionGuide.image,1)
 assert.match(request.prompt,/IMAGE 1 IS THE CANVAS/s)
 const sent=[]
 const runtime=new ImageGenerationRuntime(()=>({defaultChannelId:'enterprise',channels:[{id:'enterprise',name:'隔离模拟',apiKey:'',apiUrl:'',preset:'',auth:'subscription',subscription:'chatgpt-sub',models:[{alias:request.model,id:request.model}]}]}),{append:async()=>[]},{generate:async value=>{sent.push(value);return[{b64_json:pixel}]}})
 const result=await runtime.run(request)
 assert.equal(sent[0].referenceImages.length,2,'工作流与运行时不重复插入示意图')
 assert.equal(result.visualRules.compositionGuide.image,1)
 assert.equal(result.visualRules.prompt,sent[0].prompt)
})

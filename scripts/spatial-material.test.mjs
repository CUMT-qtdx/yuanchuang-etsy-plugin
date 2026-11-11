// 回归真实兔子问题：画面左侧的篮子不能被模型口述为左手后继续传播。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spatialExpectations, validateSpatialChecks, createEtsyModels, normalizeSpatial, spatialLocks, reconcileSpatialReview } from '../.etsy-test/host.js'
import { fixture, input, facts, modelConfig, materialComparison } from './etsy-fixture.mjs'
const spatial={version:'1.0',sourceFacing:'front',anchors:[{label:'藤篮',screenSide:'left',attachment:'腰侧',evidence:'主图画面左边的腰侧悬挂藤篮'}]}
const identity={summary:'白兔',locks:['白兔','左手提篮'],unseen:['背面未知'],spatial}
const viewChecks=Object.fromEntries(['identity','composition','material','accessories','photography'].map(k=>[k,{status:'PASS',evidence:'模拟观察'}]))
test('同图重查近远侧相矛盾时不能被最后一次PASS覆盖',()=>{
 const make=observed=>({status:'PASS',summary:'模型判断',viewpointCheck:{status:'PASS',observedFacing:'screen-left',spatialChecks:[{label:'藤篮',expected:'far',observed,evidence:'模拟'}],evidence:'模拟'}})
 const result=reconcileSpatialReview(make('far'),[make('near')])
 assert.equal(result.status,'UNKNOWN');assert.equal(result.viewpointCheck.status,'UNKNOWN');assert.match(result.reviewConflict,/相反结论/)
 assert.equal(reconcileSpatialReview(make('far'),[make('far')]).status,'PASS')
})

test('从主图画面坐标计算左右侧的篮子近远侧，非正背面不强行推断',()=>{
 assert.equal(spatialExpectations(spatial,'right')[0].visibility,'far')
 assert.equal(spatialExpectations(spatial,'right')[0].bodySide,'right')
 assert.equal(spatialExpectations(spatial,'left')[0].visibility,'near')
 assert.deepEqual(spatialExpectations({...spatial,sourceFacing:'other'},'left'),[])
 assert.equal(validateSpatialChecks([{label:'藤篮',observed:'near',evidence:'篮子在近侧手臂前'}],spatialExpectations(spatial,'right'))[0].status,'REVISE')
 assert.equal(validateSpatialChecks([],spatialExpectations(spatial,'right'))[0].status,'UNKNOWN')
 const symmetric={...spatial,anchors:[...spatial.anchors,{label:'纽扣',screenSide:'left',attachment:'肩',evidence:'左纽扣'},{label:'纽扣',screenSide:'right',attachment:'肩',evidence:'右纽扣'}]}
 assert.equal(normalizeSpatial(symmetric).anchors.length,1)
 assert.match(spatialLocks(['左手提篮，篮内三只蘑菇'],spatial)[0],/三只蘑菇/,'修正侧别不能丢掉同句中的数量和配件')
})

test('设定卡同次读取画面位置，过滤与坐标冲突的AI解剖左右文字',async()=>{
 const models=createEtsyModels(async(_,options)=>{assert.match(JSON.stringify(options.content),/画面位置|主图画面/);return JSON.stringify(identity)})
 const result=await models.identity(modelConfig,'master','',new AbortController().signal)
 assert.ok(!result.locks.includes('左手提篮'));assert.ok(result.locks.some(s=>s.includes('主图画面左侧')))
 assert.deepEqual(result.spatial,spatial)
})

test('脸朝向正确但篮子在近侧，仍判需修正；缺少配件依据不能通过',async()=>{
 let spatialChecks=[{label:'藤篮',observed:'near',evidence:'藤篮完整显示在近侧手臂前方'}]
 const models=createEtsyModels(async(_,options)=>{
   const images=options.content.filter(p=>p.type==='image_url');assert.equal(images[0].image_url.url,'candidate');assert.equal(images[1].image_url.url,'master');assert.equal(images[2].image_url.url,'opposite')
   for(let i=0;i<options.content.length;i++)if(options.content[i].type==='image_url')assert.equal(options.content[i-1].type,'text','每张图片前都须有独立标签')
   assert.match(JSON.stringify(options.content),/另一侧比较图/)
   return JSON.stringify({status:'PASS',summary:'模拟表面通过',issues:[],uncertainties:[],viewChecks,materialComparison:materialComparison(),viewpointCheck:{observedFacing:'screen-left',profile:'full-side',handedness:'consistent',pairRelation:'opposite',evidence:'鼻子朝左'},spatialChecks})
 })
 const context={identity,multiView:{angle:'right',identity,oppositeViewId:'left',references:[{image:2,id:'hero',role:'identity-anchor'},{image:3,id:'left',role:'opposite-view-check'}]}}
 const check=()=>models.vision(modelConfig,facts,'candidate',['master','opposite'],[],new AbortController().signal,context)
 assert.equal((await check()).viewpointCheck.status,'REVISE')
 spatialChecks=[];assert.equal((await check()).viewpointCheck.status,'UNKNOWN')
 spatialChecks=[{label:'藤篮',observed:'far',evidence:'篮子被身体挡住，仅前缘可见'}];assert.equal((await check()).viewpointCheck.status,'PASS')
})

test('旧项目主动补查一次，保留历史卡、人工锁定及旧图片，不自动重新生图',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'spatial-upgrade-'));let newSchema=false
 const f=fixture(root,{identity:async()=>newSchema?identity:{summary:'白兔',locks:['白兔','左手提篮'],unseen:['未知']}});await f.workflow.ready
 t.after(async()=>{f.workflow.dispose();await f.workflow.idle();await rm(root,{recursive:true,force:true})})
 const p=await f.workflow.start(input({count:1,maxCalls:60,copyTiming:'selected',autoCheck:false}));await f.workflow.idle()
 let product=await f.workflow.get(p.id);await f.workflow.confirmDesign(p.id,product.images[0].id,'');await f.workflow.idle()
 product=await f.workflow.get(p.id);const design=product.finalDesigns[0],beforeImages=structuredClone(product.images),before={...f.counts}
 newSchema=true
 await Promise.all([f.workflow.prepareSpatial(p.id,design.id),f.workflow.prepareSpatial(p.id,design.id)]);await f.workflow.idle()
 const done=await f.workflow.get(p.id)
 assert.equal(f.counts.identity,before.identity+1);assert.equal(f.counts.generation,before.generation)
 assert.deepEqual(done.images,beforeImages);assert.deepEqual(done.finalDesigns[0].specHistory[0],design.spec)
 assert.ok(!done.finalDesigns[0].spec.locks.includes('左手提篮'))
 await f.workflow.prepareSpatial(p.id,design.id);await f.workflow.idle();assert.equal(f.counts.identity,before.identity+1)
 await f.workflow.editIdentity(p.id,design.id,{summary:'人工确认白兔',locks:['篮中保持三朵蘑菇'],unseen:['未知']},1)
 assert.deepEqual((await f.workflow.get(p.id)).finalDesigns[0].spec.spatial,spatial)
})

// 左右区分必须经过实际生成/复核入口，不用任务名代替观察到的朝向。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { directionFor, validateViewpoint, createEtsyModels, makeEtsyRoutes } from '../.etsy-test/host.js'
import { fixture, input, facts, modelConfig, materialComparison } from './etsy-fixture.mjs'
import { mockDesignImage } from './mock-design-image.mjs'
const passView = (facing, pairRelation = 'not-provided') => ({ observedFacing: facing, profile: 'full-side', handedness: 'consistent', pairRelation, evidence: `可见脸朝${facing}，持物侧与主图相同` })
const checks = Object.fromEntries(['identity','composition','material','accessories','photography'].map(key=>[key,{status:'PASS',evidence:'模拟可见依据'}]))
async function setup(t, options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'view-direction-')), f = fixture(root, options); await f.workflow.ready
  t.after(async()=>{f.workflow.dispose();await f.workflow.idle();await rm(root,{recursive:true,force:true})})
  const p = await f.workflow.start(input({count:1,maxCalls:80,autoCheck:false,copyTiming:'selected'}));await f.workflow.idle()
  const product=await f.workflow.get(p.id);await f.workflow.confirmDesign(p.id,product.images[0].id,'右手拿花，左手扶帽檐');await f.workflow.idle()
  return {...f,product:await f.workflow.get(p.id),id:p.id}
}
test('左右按主图画面标注，近侧手与刚体转身几何一致',()=>{
  assert.equal(directionFor('left').expectedFacing,'screen-right');assert.equal(directionFor('right').expectedFacing,'screen-left');assert.equal(directionFor('back'),undefined)
  assert.equal(directionFor('left').visibleSide,'right', '脸朝右时角色自身右侧在近侧')
  assert.equal(directionFor('right').visibleSide,'left', '脸朝左时角色自身左侧在近侧')
  assert.equal(validateViewpoint(passView('screen-right'),directionFor('left')).status,'PASS')
  assert.equal(validateViewpoint(passView('screen-right'),directionFor('right')).status,'REVISE')
  assert.equal(validateViewpoint({...passView('screen-left'),handedness:'swapped'},directionFor('right')).status,'REVISE')
  assert.equal(validateViewpoint({...passView('screen-left'),profile:'three-quarter'},directionFor('right')).status,'REVISE')
  assert.equal(validateViewpoint(passView('screen-left','same-facing'),directionFor('right'),'left-id').status,'REVISE')
  assert.equal(validateViewpoint(passView('screen-left','mirrored'),directionFor('right'),'left-id').status,'REVISE')
  assert.equal(validateViewpoint(passView('screen-left'),directionFor('right'),'left-id').status,'UNKNOWN')
  assert.equal(validateViewpoint({},directionFor('right')).status,'UNKNOWN')
})
test('生成左右请求明确指定相反画面朝向与角色持物手，仍只使用原主图',async t=>{
  const f=await setup(t),design=f.product.finalDesigns[0]
  await f.workflow.generateViews(f.id,design.id,['left','right'],'side-directions-main',f.product.request);await f.workflow.idle()
  const product=await f.workflow.get(f.id),views=product.images.filter(i=>i.kind==='view')
  for(const view of views){
    const r=f.queue.get(view.taskId).request
    assert.equal(r.images.length,1);assert.match(r.prompt,/右手拿花，左手扶帽檐/)
    assert.match(r.prompt,/SAME anatomical hand/);assert.match(r.prompt,/NEVER a horizontal flip/)
    assert.match(r.prompt,view.angle==='left'?/face\/nose\/chest must point toward the RIGHT EDGE/:/face\/nose\/chest must point toward the LEFT EDGE/)
    assert.match(r.prompt,view.angle==='left'?/anatomical RIGHT side nearest/:/anatomical LEFT side nearest/)
    assert.equal(view.visualRules.modules.product_view_direction_v1_0,'1.0')
    assert.match(r.prompt,/soft, dense, fine-fiber/)
  }
})

test('模型保存失败回滚选择，不出现界面失败而后台已换模型',async t=>{
  const f=await setup(t),design=f.product.finalDesigns[0]
  const before=await f.workflow.get(f.id),save=f.workflow.store.save.bind(f.workflow.store)
  f.workflow.store.save=async product=>{product.revision++;product.updatedAt++;throw new Error('模拟磁盘写入失败')}
  try { await assert.rejects(f.workflow.setViewModel(f.id,design.id,{...before.request,channelId:'gpt',model:'gpt-image-2'}),/磁盘写入失败/) }
  finally { f.workflow.store.save=save }
  assert.deepEqual(await f.workflow.get(f.id),before)
})

test('通过HTTP保存GPT后重读仍保留，未重复传模型时生成使用已存选择',async t=>{
  const f=await setup(t),design=f.product.finalDesigns[0],calls={...f.counts}
  const routes=makeEtsyRoutes({workflow:f.workflow,guard:()=>true,parse:body=>body,normalize:request=>({ok:true,request})})
  const server=createServer(async(req,res)=>{const route=routes.find(r=>r.kind==='exact'&&r.path===req.url);if(route)await route.handler(req,res);else{res.statusCode=404;res.end()}})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)))
  const post=async(action,body)=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/api/dsh-imagegen/etsy/${action}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:f.id,designId:design.id,...body})});const result=await response.json();assert.equal(result.ok,true,result.message);return result}
  await post('set-view-model',{model:{channelId:'gpt',model:'gpt-image-2'}})
  assert.deepEqual((await f.workflow.store.load())[0].finalDesigns[0].sideBackModel,{channelId:'gpt',model:'gpt-image-2'})
  assert.deepEqual(f.counts,calls,'只切模型不调用生图或检查')
  await post('generate-views',{angles:['right'],requestKey:'saved-gpt-http-request'})
  await f.workflow.idle()
  const view=(await f.workflow.get(f.id)).images.at(-1)
  assert.equal(f.queue.get(view.taskId).request.model,'gpt-image-2')
  assert.equal(f.queue.get(view.taskId).request.channelId,'gpt')
})
test('另一侧图片只加入复核，不传给生图；标签独立，避免同朝向冒充左右',async t=>{
  const seen=[]
  const f=await setup(t,{generate:async(_,i)=>({images:[{b64:mockDesignImage(i).toString('base64'),mime:'image/png'}]}),vision:async(_,__,___,refs,siblings,signal,context)=>{
    seen.push({refs,context});return {status:'PASS',summary:'模拟',issues:[],uncertainties:[],assessedAt:Date.now(),model:'mock',advisory:true,viewChecks:checks,materialComparison:materialComparison()}
  }}),design=f.product.finalDesigns[0]
  await f.workflow.generateViews(f.id,design.id,['left','right'],'paired-review-only',f.product.request);await f.workflow.idle()
  assert.equal(seen.length,2);assert.equal(seen[0].context.multiView.oppositeViewId,undefined)
  const right=seen[1].context.multiView
  assert.equal(right.references[0].image,2);assert.equal(right.references.at(-1).role,'opposite-view-check')
  const done=await f.workflow.get(f.id),left=done.images.find(i=>i.angle==='left')
  assert.equal(right.oppositeViewId,left.id);assert.equal(right.exactOppositeDuplicate,false)
  const rightImage=done.images.find(i=>i.angle==='right');assert.equal(f.queue.get(rightImage.taskId).request.images.length,1)
})
test('即便模型错误返回PASS，完全相同的左右文件仍确定标为需修正',async t=>{
  const f=await setup(t),design=f.product.finalDesigns[0]
  await f.workflow.generateViews(f.id,design.id,['left','right'],'same-bytes-side-pair',f.product.request);await f.workflow.idle()
  const right=(await f.workflow.get(f.id)).images.find(i=>i.angle==='right')
  assert.equal(right.report.status,'REVISE');assert.equal(right.report.viewpointCheck.status,'REVISE')
  assert.match(right.report.viewpointCheck.evidence,/相同图片文件/)
})
test('实际模型合同中观察方向优先于任务标签，缺字段/同向/镜像均不能通过',async()=>{
  let raw={status:'PASS',summary:'都一样',issues:[],uncertainties:[],viewChecks:checks,materialComparison:materialComparison(),viewpointCheck:passView('screen-left','same-facing')}
  const models=createEtsyModels(async(_,options)=>{assert.match(options.system,/先独立辨认/);assert.match(options.system,/不是|禁止|禁止换视角/);return JSON.stringify(raw)})
  const multiView={angle:'right',direction:directionFor('right'),oppositeViewId:'opposite',references:[]}
  const args=[modelConfig,facts,'test-image',['master','opposite'],[],new AbortController().signal,{multiView}]
  let result=await models.vision(...args);assert.equal(result.status,'REVISE')
  raw.viewpointCheck=passView('screen-left','opposite');result=await models.vision(...args);assert.equal(result.status,'PASS')
  raw.viewpointCheck=undefined;result=await models.vision(...args);assert.equal(result.status,'UNKNOWN')
  raw.viewpointCheck=passView('screen-right','opposite');result=await models.vision(...args);assert.equal(result.status,'REVISE')
})
test('只修材质不暗中改变当前角度，但复核仍能指出错向；背面不被强制指定左右',async t=>{
  const f=await setup(t),design=f.product.finalDesigns[0]
  await f.workflow.generateViews(f.id,design.id,['left','back'],'repair-preserve-view',f.product.request);await f.workflow.idle()
  let product=await f.workflow.get(f.id);const left=product.images.find(i=>i.angle==='left'),back=product.images.find(i=>i.angle==='back')
  assert.equal(back.visualRules.modules.product_view_direction_v1_0,undefined)
  await f.workflow.revise(f.id,'只修材质',product.request,left.id,true);await f.workflow.idle()
  product=await f.workflow.get(f.id);const r=f.queue.get(product.images.at(-1).taskId).request
  assert.match(r.prompt,/MATERIAL-ONLY REPAIR/);assert.doesNotMatch(r.prompt,/MANDATORY SCREEN DIRECTION/)
  await f.workflow.revise(f.id,'纠正朝向',product.request,left.id,false,true);await f.workflow.idle()
  product=await f.workflow.get(f.id);assert.match(f.queue.get(product.images.at(-1).taskId).request.prompt,/RIGHT EDGE/)
})

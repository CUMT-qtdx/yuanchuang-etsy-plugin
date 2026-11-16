import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, realpath } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { composeFeltPrompt, makeFeltContext, normalizePhotography, defaultPhotography, CURRENT_MATERIAL } from '../.etsy-test/host.js'
import { fixture, input, facts } from './etsy-fixture.mjs'

const sourcePhoto = { ...defaultPhotography(), photography_preset: 'preserve-original', preserve_background: true }
function render(photo, extra = {}) {
  return composeFeltPrompt(makeFeltContext({ basePrompt: '', stage: 'generation', task: 'redesign', materialPreset: CURRENT_MATERIAL, photography: photo, designPreservation: { version: '1.1', locks: [], source: 'reference-image' }, ...extra }), 'gemini-3.1-flash-image')
}

test('新摄影选项覆盖旧背景保留标记，白底不会被旧勾选改回原背景', () => {
  const normalized = normalizePhotography({ ...sourcePhoto, photography_preset: 'white-studio', explicit_controls: ['background'] })
  assert.equal(normalized.photography_preset, 'white-studio')
  assert.equal(normalized.preserve_background, false)
})

test('原图只保留商品，背景及占比使用独立目标并明确替换参考拍摄环境', () => {
  const photo={...defaultPhotography(),photography_preset:'white-studio',subject_height_ratio:0.5}
  const out=render(photo)
  assert.match(out.prompt,/Replace the source photographic environment/)
  assert.match(out.prompt,/seamless white|pure white/i)
  assert.match(out.prompt,/top[^\n]*\d+%[^\n]*bottom[^\n]*\d+%/i)
  assert.match(out.prompt,/original-reference occupancy is not locked/i)
  assert.doesNotMatch(out.prompt,/Preserve the source overall framing/)
})

test('显式背景和构图选择不会被旧“只改材质”备注覆盖', () => {
  const out=render({...defaultPhotography(),photography_preset:'white-studio',subject_height_ratio:0.45,explicit_controls:['background','framing']},{userRequirements:'只改材质，保留原构图'})
  assert.equal(out.photography.photography_preset,'white-studio')
  assert.equal(out.photography.framing_policy,'override_reference')
  assert.equal(out.compositionTarget.heightRatio,0.45)
})

test('主题场景在原款模式不因清空部件分析而丢失节日语境', () => {
  const out=render({...defaultPhotography(),photography_preset:'seasonal-lifestyle'}, {description:'节日 Christmas 商品'})
  assert.match(out.prompt,/Christmas/)
  assert.doesNotMatch(out.prompt,/if no clear season is specified/)
})

test('后台请求保存目标几何并加入独立构图引导，不改动原参考图片', async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'photo-contract-'))
  const f=fixture(root)
  await f.workflow.ready
  t.after(async()=>{f.workflow.dispose();await f.workflow.idle();const resolved=await realpath(root);assert.equal(path.dirname(resolved).toLowerCase(),(await realpath(tmpdir())).toLowerCase());assert.ok(path.basename(resolved).startsWith('photo-contract-'));await rm(resolved,{recursive:true,force:true})})
  const photo={...defaultPhotography(),photography_preset:'home-lifestyle',subject_height_ratio:0.45}
  const original=input({count:1,autoCheck:false,copyTiming:'selected',photography:photo,facts:{...facts,requirements:''}})
  const p=await f.workflow.start(original,undefined,{creativity:'preserve'});await f.workflow.idle()
  const product=await f.workflow.get(p.id),request=f.queue.list()[0].request
  assert.equal(request.images[0],original.generation.image)
  assert.equal(request.images.length,1)
  assert.match(request.image,/^data:image\/png;base64,/)
  assert.equal(product.images[0].visualRules.compositionTarget.heightRatio,0.45)
  assert.equal(product.images[0].visualRules.compositionGuide.image,1)
  assert.match(request.prompt,/layout guide/i)
})

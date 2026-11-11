// 模拟两个生图完成通知在图片落盘期间相继到达，等待函数必须包含新排入的文案任务。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fixture, input, pixel } from './etsy-fixture.mjs'

test('等待图片归档事务期间新增的文案任务也完成后才报告空闲', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'etsy-idle-order-'))
  const f = fixture(root, { generate: async (_, index) => {
    if (index === 2) await new Promise(resolve => setTimeout(resolve, 35))
    return { images: [{ mime: 'image/png', b64: index === 1 ? Buffer.from('invalid').toString('base64') : pixel }] }
  } })
  await f.workflow.ready
  t.after(async () => { f.workflow.dispose(); await f.workflow.idle(); await rm(root, { recursive: true, force: true }) })
  const save = f.workflow.store.save.bind(f.workflow.store)
  let delayed = false
  f.workflow.store.save = async product => {
    if (!delayed && product.images[0].generation.status === 'failed') { delayed = true; await new Promise(resolve => setTimeout(resolve, 90)) }
    return save(product)
  }
  const created = await f.workflow.start(input({ count: 2, autoCheck: false }))
  await f.workflow.idle()
  const done = await f.workflow.get(created.id)
  assert.equal(done.copyStage.status, 'completed')
  assert.equal(f.counts.copy, 1)
  await f.workflow.configureModels(async () => {})
})

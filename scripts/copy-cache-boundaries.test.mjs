import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fixture, input, copyValue } from './etsy-fixture.mjs'
import { selectedCopy, imageCopyStage } from '../.etsy-test/host.js'

async function reopen(t, mutate) {
  const root = await mkdtemp(path.join(tmpdir(), 'etsy-cache-boundary-'))
  const first = fixture(root); await first.workflow.ready
  const initial = await first.workflow.start(input({ count: 4 }), undefined, { creativity: 'balanced' })
  await first.workflow.idle(); first.workflow.dispose()
  const file = path.join(root, initial.id, 'product.json'), saved = JSON.parse(await readFile(file, 'utf8'))
  mutate(saved)
  await writeFile(file, JSON.stringify(saved))
  const restored = fixture(root); await restored.workflow.ready; await restored.workflow.idle()
  t.after(async () => { restored.workflow.dispose(); await restored.workflow.idle(); await rm(root, { recursive: true, force: true }) })
  return { ...restored, root, productId: saved.id }
}

test('完成但缓存不是英文的旧稿可显式补齐，仅该图请求一次', async t => {
  let invalidId, preservedId, preserved
  const { workflow, counts, productId } = await reopen(t, product => {
    invalidId = product.images[1].id
    preservedId = product.images[0].id
    preserved = structuredClone(product.imageCopies[preservedId])
    const cached = product.imageCopies[invalidId].copy
    cached.titles = cached.titles.map(row => ({ ...row, title: '纯中文旧标题' }))
    product.selectedImageId = invalidId
  })
  let product = await workflow.get(productId)
  assert.equal(imageCopyStage(product, product.images[1]).status, 'skipped')
  assert.equal(selectedCopy(product), undefined)
  await workflow.prepareCopies(productId); await workflow.idle()
  product = await workflow.get(productId)
  assert.equal(counts.copy, 1)
  assert.equal(product.images[1].copyStage.attempts, 2, '保留原有一次调用次数')
  assert.ok(selectedCopy(product))
  assert.deepEqual(product.imageCopies[preservedId], preserved)
})

test('完成标记不能把过期资料或丢失缓存展示为图文就绪', () => {
  const copy = { ...copyValue(), description: 'A playful puppy in a colorful scarf.' }
  const image = { id: 'current-image', generation: { status: 'completed', attempts: 1 }, quality: { status: 'completed', attempts: 1 }, copyStage: { status: 'completed', attempts: 1 }, copyFactsRevision: 1, files: ['saved.png'] }
  const product = { copyMode: 'per-image', selectedImageId: image.id, factsRevision: 2, images: [image], imageCopies: { [image.id]: { factsRevision: 1, copy } } }
  assert.equal(selectedCopy(product), undefined)
  assert.equal(imageCopyStage(product, image).status, 'skipped')
  assert.match(imageCopyStage(product, image).error, /资料已更新/)
  product.factsRevision = 1; product.imageCopies = {}
  assert.equal(selectedCopy(product), undefined)
  assert.match(imageCopyStage(product, image).error, /缺少已保存文案/)
})

test('显式补齐按新的商品资料重备过期缓存，不能复用旧版完成状态', async t => {
  const { workflow, counts, productId } = await reopen(t, product => { product.factsRevision = 2 })
  const product = await workflow.get(productId)
  assert.ok(product.images.every(image => imageCopyStage(product, image).status === 'skipped'))
  await workflow.prepareCopies(productId); await workflow.idle()
  const prepared = await workflow.get(productId)
  assert.equal(counts.copy, 4)
  assert.ok(prepared.images.every(image => image.copyStage.status === 'completed' && image.copyFactsRevision === 2 && prepared.imageCopies[image.id].factsRevision === 2))
})

test('补齐本组文案不能清零同一资料版本的重试次数或重发结果不明请求', async t => {
  const { workflow, counts, productId } = await reopen(t, product => {
    const exhausted = product.images[1], uncertain = product.images[2]
    exhausted.copyStage = { status: 'failed', attempts: 3, error: '模型格式失败' }
    uncertain.copyStage = { status: 'unknown', attempts: 1, error: '请求结果不明' }
    delete product.imageCopies[exhausted.id]
    delete product.imageCopies[uncertain.id]
  })
  await assert.rejects(workflow.prepareCopies(productId), /耗尽或结果不明/)
  await workflow.idle()
  const unchanged = await workflow.get(productId)
  assert.equal(counts.copy, 0)
  assert.equal(unchanged.images[1].copyStage.attempts, 3)
  assert.equal(unchanged.images[2].copyStage.status, 'unknown')
})

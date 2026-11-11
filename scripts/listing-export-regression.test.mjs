// 公开稿导出回归：部分字段保留、错误提示隔离和明确的图片选择。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fixture, input, copyValue, facts } from './etsy-fixture.mjs'
import { validateCopy, exportProduct, selectedCopy } from '../.etsy-test/host.js'

function entries(zip) {
  const found = new Map()
  for (let offset = 0; zip.readUInt32LE(offset) === 0x04034b50;) {
    const size = zip.readUInt32LE(offset + 18), names = zip.readUInt16LE(offset + 26), extras = zip.readUInt16LE(offset + 28)
    const start = offset + 30 + names + extras
    found.set(zip.subarray(offset + 30, offset + 30 + names).toString(), zip.subarray(start, start + size).toString())
    offset = start + size
  }
  return found
}
test('部分文案导出保留合格字段，待补提示只出现在复核文件', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'etsy-partial-export-'))
  const f = fixture(root); await f.workflow.ready
  t.after(async () => { f.workflow.dispose(); await f.workflow.idle(); await rm(root, { recursive: true, force: true }) })
  const created = await f.workflow.start(input({ count: 4 }), undefined, { creativity: 'balanced' }); await f.workflow.idle()
  const product = await f.workflow.get(created.id), image = product.images[0]
  const raw = copyValue(); raw.titles[0].title = 'Cute Кот Cat Figure'
  const partial = validateCopy(raw, facts, { mode: 'generated' })
  product.selectedImageId = image.id; product.copyImageId = image.id
  product.copy = partial; product.imageCopies[image.id].copy = partial
  image.copyStage.status = 'failed'
  image.copyStage.error = '补齐失败，原有内容保留'
  assert.ok(selectedCopy(product), '补齐失败仍可读当前图片合格内容')
  const files = entries(await exportProduct(product, f.workflow.store))
  assert.ok(files.get('listing.txt').startsWith(partial.titles[partial.selectedTitle].title))
  assert.match(files.get('listing.txt'), /red scarf/)
  assert.doesNotMatch(files.get('listing.txt'), /待补齐|完整英文|Кот/)
  assert.match(files.get('review-notes.txt'), /待补齐/)
  assert.equal(files.get(`listings/${image.id}.txt`), files.get('listing.txt'))
})

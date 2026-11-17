// 使用真实图片存储和 ZIP 导出，覆盖读取失败、处理失败及 C2PA 保留的混合批次。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { EtsyStore, exportProduct } from '../.etsy-test/host.js'
import { readZipDirectory, readZipEntry } from '../src/zip.ts'
import { cleanImageMetadata } from '../src/metadata/aimeta.ts'
import { source, addMetadata, c2paPng } from './metadata-fixtures.mjs'

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metadata-batch-')), store = new EtsyStore(root)
  t.after(async () => { assert.ok(path.dirname(root) === path.resolve(os.tmpdir()) && path.basename(root).startsWith('metadata-batch-')); await fs.rm(root, { recursive: true, force: true }) })
  const product = { id: 'batch-fixture', images: [], referenceFiles: [] }
  await fs.mkdir(path.join(root, product.id))
  const add = async (name, data) => { product.referenceFiles.push(name); if (data) await fs.writeFile(path.join(root, product.id, name), data) }
  return { store, product, add, root }
}
function unpack(zip) {
  const entries = readZipDirectory(zip)
  const read = name => readZipEntry(zip, entries.find(entry => entry.name === name))
  return { entries, read, report: JSON.parse(read('图片元数据处理报告.json').toString('utf8')) }
}
test('ZIP 跳过缺失、无法读取和清理失败图片，正常图片继续导出', async t => {
  const { store, product, add, root } = await setup(t)
  const png = addMetadata(await source('base.png'), 'png'), jpg = addMetadata(await source('base.jpg'), 'jpeg')
  await add('missing.png'); await add('invalid.png', Buffer.from('damaged'))
  await add('good.png', png); await add('truncated.png', (await source('base.png')).subarray(0, 34)); await add('good.jpg', jpg)
  let callback
  const { entries, read, report } = unpack(await exportProduct(product, store, reports => { callback = reports }))
  assert.deepEqual(report.summary, { total: 5, exported: 2, failed: 3 }); assert.deepEqual(report.images, callback)
  assert.deepEqual(entries.filter(entry => entry.name.startsWith('images/')).map(entry => entry.name).sort(), ['images/good.jpg', 'images/good.png'])
  assert.equal(report.images.find(r => r.file === 'missing.png').reason, '原图文件不存在')
  assert.equal(report.images.find(r => r.file === 'invalid.png').reason, '图片已损坏')
  assert.match(report.images.find(r => r.file === 'truncated.png').reason, /未导出/)
  assert.doesNotMatch(JSON.stringify(report), /[A-Z]:[\\/]/)
  assert.deepEqual(new Uint8Array(read('images/good.png')), (await cleanImageMetadata(png)).data)
  assert.deepEqual(new Uint8Array(read('images/good.jpg')), (await cleanImageMetadata(jpg)).data)
  assert.deepEqual(new Uint8Array(await fs.readFile(path.join(root, product.id, 'good.png'))), png)
})
test('ZIP 全部失败时抛出明确原因，不返回空包', async t => {
  const { store, product, add } = await setup(t)
  await add('missing.png'); await add('broken.png', (await source('base.png')).subarray(0, 34))
  await assert.rejects(exportProduct(product, store), error => {
    assert.match(error.message, /全部 2 张图片导出失败，未生成 ZIP/)
    assert.match(error.message, /missing.png：原图文件不存在/); assert.match(error.message, /broken.png/); return true
  })
})
test('C2PA 未清理与部分清理均正常打包，其他失败单独记录', async t => {
  const { store, product, add } = await setup(t)
  const unchanged = c2paPng(await source('base.png'), false), partial = c2paPng(await source('base.png'), true)
  await add('missing.png'); await add('signed.png', unchanged); await add('partial.png', partial)
  const { report, read } = unpack(await exportProduct(product, store))
  assert.deepEqual(report.summary, { total: 3, exported: 2, failed: 1 })
  assert.equal(report.images.find(r => r.file === 'signed.png').status, 'uncleaned')
  assert.equal(report.images.find(r => r.file === 'partial.png').status, 'partial')
  assert.deepEqual(new Uint8Array(read('images/signed.png')), unchanged)
  assert.deepEqual(new Uint8Array(read('images/partial.png')), (await cleanImageMetadata(partial)).data)
})
test('没有图片的商品不生成空 ZIP', async t => {
  const { store, product } = await setup(t)
  await assert.rejects(exportProduct(product, store), /请先生成或选择图片/)
})

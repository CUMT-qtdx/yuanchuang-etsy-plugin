// 使用真实可解码的大PNG经过归档、修改和多角度，网络在本进程内模拟。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { deflateSync, inflateSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { generateImage } from '../src/engine.ts'
import { MAX_PRODUCT_IMAGE_BYTES } from '../src/image-limits.ts'
import { redactDiagnosticText } from '../src/diagnostics-store.ts'
import { fixture, input, pixel } from './etsy-fixture.mjs'

function crc32(data) {
  let crc = 0xffffffff
  for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const t = Buffer.from(type), n = Buffer.alloc(4), crc = Buffer.alloc(4)
  n.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([n, t, data, crc])
}
function png(width, height) {
  const header = Buffer.alloc(13), rows = Buffer.alloc(height * (1 + width * 3))
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2
  const encoded = deflateSync(rows, { level: 0 })
  assert.equal(inflateSync(encoded).length, rows.length)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', encoded), chunk('IEND', Buffer.alloc(0))])
}
const large = png(2048, 2048)
const oversized = png(3072, 2304)
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

test('12MiB成图保持字节和像素，经真实工作流继续原生修改及多角度', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'etsy-large-edit-')), sent = [], originalFetch = globalThis.fetch
  assert.ok(large.length > 10 * 1024 * 1024 && large.length < MAX_PRODUCT_IMAGE_BYTES)
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body)
    assert.match(url, /gemini-3\.1-flash-image:generateContent$/)
    const bytes = Buffer.from(body.contents[0].parts[1].inlineData.data, 'base64')
    assert.equal(hash(bytes), hash(large), '修改输入必须保持归档原图字节')
    assert.equal(bytes.readUInt32BE(16), 2048); assert.equal(bytes.readUInt32BE(20), 2048)
    sent.push(body)
    return json({ candidates: [{ content: { parts: [{ inlineData: { data: pixel, mimeType: 'image/png' } }] } }] })
  }
  const f = fixture(root, { generate: async (request, index) => {
    if (index === 1) return { images: [{ b64: large.toString('base64'), mime: 'image/png' }] }
    return generateImage({ apiUrl: 'https://native.mock', apiKey: 'mock', protocol: 'gemini-native' }, { ...request, model: 'gemini-3.1-flash-image' })
  } })
  t.after(async () => { globalThis.fetch = originalFetch; await f.workflow.idle(); f.workflow.dispose(); await rm(root, { recursive: true, force: true }) })
  const p = await f.workflow.start(input({ count: 1, autoCheck: false }))
  await f.workflow.idle()
  const original = (await f.workflow.get(p.id)).images[0]
  const stored = await f.workflow.store.readImage(p.id, original.files[0])
  assert.equal(hash(stored.data), hash(large))
  await f.workflow.revise(p.id, '只调整配色', p.request, original.id); await f.workflow.idle()
  let product = await f.workflow.get(p.id)
  assert.equal(product.images.at(-1).generation.status, 'completed', product.images.at(-1).generation.error)
  assert.deepEqual(product.images[0].files, original.files)
  await f.workflow.confirmDesign(p.id, original.id, '保持主图形状'); await f.workflow.idle()
  product = await f.workflow.get(p.id)
  await f.workflow.generateViews(p.id, product.finalDesigns[0].id, ['back'], 'large-back', product.request); await f.workflow.idle()
  product = await f.workflow.get(p.id)
  assert.equal(product.images.at(-1).generation.status, 'completed')
  assert.equal(sent.length, 2)
})

test('大图片诊断保持脱敏且不栈溢出，短段不误删', () => {
  const safe = redactDiagnosticText(JSON.stringify({ inlineData: { data: large.toString('base64') }, api_key: 'mock-secret-credential', note: 'A'.repeat(199) }))
  assert.match(safe, /<long-base64 redacted>/); assert.ok(!safe.includes('mock-secret-credential'))
  assert.ok(safe.includes('A'.repeat(199))); assert.ok(safe.length < 500)
  assert.equal(redactDiagnosticText('B'.repeat(200)), '<long-base64 redacted>')
})

test('超过20MiB仍在本地拒绝归档和编辑，不发网络请求', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'etsy-large-reject-')), originalFetch = globalThis.fetch
  const f = fixture(root)
  t.after(async () => { globalThis.fetch = originalFetch; await f.workflow.idle(); f.workflow.dispose(); await rm(root, { recursive: true, force: true }) })
  assert.ok(oversized.length > MAX_PRODUCT_IMAGE_BYTES)
  await assert.rejects(f.workflow.store.saveImage('oversized', { b64: oversized.toString('base64'), mime: 'image/png' }), /20 MiB/)
  globalThis.fetch = async () => { throw new Error('超限输入不应联网') }
  for (const [protocol, model] of [['gemini-native', 'gemini-3.1-flash-image']]) {
    await assert.rejects(generateImage({ apiUrl: 'https://reject.mock/v1', apiKey: 'mock', protocol }, { ...input().generation, model, image: 'data:image/png;base64,' + oversized.toString('base64') }), error => error.code === 'edit-image-too-large' && /20 MiB/.test(error.message))
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { cleanImageMetadata } from '../src/metadata/aimeta.ts'
import { cleanExif } from '../src/metadata/exif.ts'
import { cleanXmp } from '../src/metadata/rights.ts'
import { source, addMetadata, c2paPng, exif } from './metadata-fixtures.mjs'
import { cat, encoder, pngChunk } from '../src/metadata/binary.ts'

for (const [file, format] of [['base.jpg', 'jpeg'], ['progressive.jpg', 'jpeg'], ['base.png', 'png'], ['alpha.png', 'png'], ['animated.png', 'png'], ['base.webp', 'webp'], ['lossless.webp', 'webp'], ['animated.webp', 'webp']]) {
  test(`${file}：清理隐私并保留署名、原格式和原文件`, async () => {
    const original = addMetadata(await source(file), format), copy = original.slice(), result = await cleanImageMetadata(original)
    assert.deepEqual(original, copy); assert.equal(result.report.status, 'cleaned'); assert.equal(result.mime, `image/${format}`)
    const text = new TextDecoder('latin1').decode(result.data)
    assert.doesNotMatch(text, /PRIVATE_CAMERA|PRIVATE_COMMENT|PRIVATE_PROMPT|PRIVATE_GPS/)
    assert.match(text, /Test Artist/); assert.match(text, /Copyright Test Owner/); assert.match(text, /Test Creator/)
    const out = new URL('./fixtures/metadata/outputs/', import.meta.url); await fs.mkdir(out, { recursive: true })
    await fs.writeFile(new URL(file, out), result.data); await fs.writeFile(new URL(`input-${file}`, out), original)
  })
}
test('大小端 EXIF 方向、作者、版权保留且 GPS 子表移除', () => {
  for (const le of [true, false]) { const out = cleanExif(exif(le)); assert.ok(out); assert.match(new TextDecoder().decode(out), /Test Artist/); assert.doesNotMatch(new TextDecoder().decode(out), /PRIVATE_CAMERA/) }
})
test('别名命名空间 XMP 保留作者版权、移除 GPS，禁止外部实体', () => {
  assert.throws(() => cleanXmp(encoder.encode('<!DOCTYPE x [<!ENTITY y SYSTEM "file:///x">]><x/>')), /实体/)
})
test('C2PA 未签名排除范围可清理，绑定内隐私跳过且凭证不变', async () => {
  const bytes = await source('base.png')
  const allowed = c2paPng(bytes, true), blocked = c2paPng(bytes, false)
  const a = await cleanImageMetadata(allowed), b = await cleanImageMetadata(blocked)
  assert.equal(a.report.status, 'partial'); assert.equal(a.data.length, allowed.length); assert.doesNotMatch(new TextDecoder().decode(a.data), /PRIVATE_SIGNED_PROMPT/)
  assert.equal(b.report.status, 'uncleaned'); assert.deepEqual(b.data, blocked)
  for (const [before, after] of [[allowed, a.data], [blocked, b.data]]) { const p = Buffer.from(before).indexOf('caBX'); assert.deepEqual(after.subarray(p), before.subarray(p)) }
})
test('未知 C2PA 保留整份原图并明确未清理', async () => {
  const base = await source('base.png'), original = cat(base.subarray(0, 33), pngChunk('caBX', encoder.encode('unknown-manifest')), pngChunk('tEXt', encoder.encode('prompt\0PRIVATE_PROMPT')), base.subarray(33))
  const result = await cleanImageMetadata(original); assert.equal(result.report.status, 'uncleaned'); assert.deepEqual(result.data, original)
})
test('损坏、截断、不支持格式报错而不是返回原文件', async () => {
  for (const file of ['base.jpg', 'base.png', 'base.webp']) { const b = await source(file); await assert.rejects(cleanImageMetadata(b.subarray(0, 34))) }
  const bad = new Uint8Array(await source('base.png')); bad[40] ^= 1; await assert.rejects(cleanImageMetadata(bad), /校验/)
  await assert.rejects(cleanImageMetadata(encoder.encode('GIF89a')), /仅支持/)
})

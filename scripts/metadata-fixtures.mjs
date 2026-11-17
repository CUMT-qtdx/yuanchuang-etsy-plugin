import fs from 'node:fs/promises'
import { deflateSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { cat, encoder, jpegSegment, pngChunk, riffChunk, view } from '../src/metadata/binary.ts'

export const root = new URL('./fixtures/metadata/', import.meta.url)
export const source = name => fs.readFile(new URL(name, root))
export const xmp = encoder.encode('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:d="http://purl.org/dc/elements/1.1/" xmlns:e="http://ns.adobe.com/exif/1.0/" xmlns:t="http://ns.adobe.com/tiff/1.0/" e:GPSLatitude="PRIVATE_GPS" t:Orientation="6"><d:creator><rdf:Seq><rdf:li>Test Creator</rdf:li></rdf:Seq></d:creator><d:rights><rdf:Alt><rdf:li xml:lang="x-default">Copyright Test Owner</rdf:li></rdf:Alt></d:rights><e:UserComment>PRIVATE_PROMPT</e:UserComment></rdf:Description></rdf:RDF></x:xmpmeta>')
export function exif(le = true) {
  const fields = [[0x10f, 2, encoder.encode('PRIVATE_CAMERA\0')], [0x112, 3, new Uint8Array(le ? [6, 0] : [0, 6])], [0x13b, 2, encoder.encode('Test Artist\0')], [0x8298, 2, encoder.encode('Copyright Test Owner\0')], [0x8825, 4, new Uint8Array(4)], [0x8769, 4, new Uint8Array(4)]]
  const header = 8 + 2 + fields.length * 12 + 4, gps = header + fields.reduce((n, f) => n + (f[2].length > 4 ? f[2].length : 0), 0), sub = gps + 18
  const b = new Uint8Array(sub + 30), v = view(b)
  b.set(le ? [73, 73, 42, 0] : [77, 77, 0, 42]); v.setUint32(4, 8, le); v.setUint16(8, fields.length, le)
  let cursor = header
  fields.forEach(([tag, type, data], i) => {
    const p = 10 + i * 12; v.setUint16(p, tag, le); v.setUint16(p + 2, type, le); v.setUint32(p + 4, type === 2 ? data.length : 1, le)
    if (tag === 0x8825) v.setUint32(p + 8, gps, le)
    else if (tag === 0x8769) v.setUint32(p + 8, sub, le)
    else if (data.length > 4) { v.setUint32(p + 8, cursor, le); b.set(data, cursor); cursor += data.length }
    else b.set(data, p + 8)
  })
  v.setUint16(gps, 1, le); v.setUint16(gps + 2, 1, le); v.setUint16(gps + 4, 2, le); v.setUint32(gps + 6, 2, le); b[gps + 10] = 78
  v.setUint16(sub, 2, le)
  for (const [i, tag, value] of [[0, 0xa001, 1], [1, 0xa431, 1234]]) { const p = sub + 2 + i * 12; v.setUint16(p, tag, le); v.setUint16(p + 2, 3, le); v.setUint32(p + 4, 1, le); v.setUint16(p + 8, value, le) }
  return b
}
export function addMetadata(bytes, format, le = true) {
  if (format === 'jpeg') return cat(bytes.subarray(0, 2), jpegSegment(0xe1, cat(encoder.encode('Exif\0\0'), exif(le))), jpegSegment(0xe1, cat(encoder.encode('http://ns.adobe.com/xap/1.0/\0'), xmp)), jpegSegment(0xfe, encoder.encode('PRIVATE_COMMENT')), bytes.subarray(2))
  if (format === 'png') return cat(bytes.subarray(0, 33), pngChunk('eXIf', exif(le)), pngChunk('tEXt', encoder.encode('Author\0Test PNG Author')), pngChunk('zTXt', cat(encoder.encode('Copyright\0'), new Uint8Array([0]), deflateSync('Copyright PNG Owner'))), pngChunk('iTXt', cat(encoder.encode('XML:com.adobe.xmp'), new Uint8Array(5), xmp)), pngChunk('zTXt', cat(encoder.encode('parameters\0'), new Uint8Array([0]), deflateSync('PRIVATE_PROMPT'))), bytes.subarray(33))
  const out = cat(bytes, riffChunk('EXIF', exif(le)), riffChunk('XMP ', xmp)); view(out).setUint32(4, out.length - 8, true)
  if (String.fromCharCode(...out.subarray(12, 16)) === 'VP8X') out[20] |= 0x0c
  return out
}
function cbor(value) {
  const head = (major, n) => n < 24 ? new Uint8Array([major * 32 + n]) : n < 256 ? new Uint8Array([major * 32 + 24, n]) : n < 65536 ? new Uint8Array([major * 32 + 25, n >> 8, n & 255]) : cat(new Uint8Array([major * 32 + 26]), (() => { const b = new Uint8Array(4); view(b).setUint32(0, n); return b })())
  if (typeof value === 'number') return head(0, value)
  if (typeof value === 'string') { const b = encoder.encode(value); return cat(head(3, b.length), b) }
  if (value instanceof Uint8Array) return cat(head(2, value.length), value)
  if (Array.isArray(value)) return cat(head(4, value.length), ...value.map(cbor))
  const entries = Object.entries(value); return cat(head(5, entries.length), ...entries.flatMap(([k, v]) => [cbor(k), cbor(v)]))
}
const box = (type, data) => { const out = new Uint8Array(8 + data.length); view(out).setUint32(0, out.length); out.set(encoder.encode(type), 4); out.set(data, 8); return out }
export function c2paPng(bytes, allowPrivate = true) {
  // 用真实哈希绑定构造确定性测试清单；不是签名者身份验证样本。
  const privateChunk = pngChunk('tEXt', encoder.encode('prompt\0PRIVATE_SIGNED_PROMPT')), start = 33 + privateChunk.length
  const make = (hash, length) => pngChunk('caBX', box('jumb', cat(box('jumd', cat(new Uint8Array(16), new Uint8Array([2]), encoder.encode('c2pa.hash.data\0'))), box('cbor', cbor({ alg: 'sha256', exclusions: [...(allowPrivate ? [{ start: 33, length: privateChunk.length }] : []), { start, length }], hash })))))
  let manifest = make(new Uint8Array(32), 1000)
  for (let i = 0; i < 3; i++) manifest = make(new Uint8Array(32), manifest.length)
  const hashed = cat(bytes.subarray(0, 33), ...(allowPrivate ? [] : [privateChunk]), bytes.subarray(33))
  manifest = make(createHash('sha256').update(hashed).digest(), manifest.length)
  return cat(bytes.subarray(0, 33), privateChunk, manifest, bytes.subarray(33))
}

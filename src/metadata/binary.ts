// 改编自 AIMetaScrubber（MIT）的分段拼接、PNG CRC 与块写入逻辑。
export const utf8 = new TextDecoder('utf-8', { fatal: true })
export const latin = new TextDecoder('latin1')
export const encoder = new TextEncoder()
export const ascii = (b: Uint8Array): string => String.fromCharCode(...b)
export const cat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0))
  let offset = 0
  for (const part of parts) { out.set(part, offset); offset += part.length }
  return out
}
export function check(ok: unknown, message = '图片结构损坏，未导出文件'): asserts ok { if (!ok) throw new Error(message) }
export const view = (b: Uint8Array): DataView => new DataView(b.buffer, b.byteOffset, b.byteLength)
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
export function crc32(b: Uint8Array): number {
  let c = 0xffffffff
  for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length), v = view(out)
  v.setUint32(0, data.length); out.set(encoder.encode(type), 4); out.set(data, 8)
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}
export function riffChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + data.length + (data.length & 1))
  out.set(encoder.encode(type)); view(out).setUint32(4, data.length, true); out.set(data, 8)
  return out
}
export function jpegSegment(marker: number, data: Uint8Array): Uint8Array {
  check(data.length <= 65533, 'JPEG 元数据超出段长度限制')
  const out = new Uint8Array(4 + data.length)
  out.set([255, marker]); view(out).setUint16(2, data.length + 2); out.set(data, 4)
  return out
}
export const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i])

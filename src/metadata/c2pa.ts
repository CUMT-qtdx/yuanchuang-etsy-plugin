// C2PA 兼容策略：默认保护原文件；仅在可验证的字节范围排除规则下进行等长改写。
// 不验证签名者身份；通过保持签名凭证、受绑定字节及偏移不变，避免破坏原有有效性。
import { ascii, cat, check, same, utf8, view } from './binary.ts'
import type { MetadataReport, Piece } from './aimeta.ts'
type Range = { start: number; length: number }
type Binding = { alg: string; hash: Uint8Array; exclusions: Range[] }
function cbor(bytes: Uint8Array): unknown {
  let offset = 0, nodes = 0
  const read = (depth: number): unknown => {
    check(depth < 32 && ++nodes < 10000 && offset < bytes.length)
    const head = bytes[offset++], major = head >>> 5, ai = head & 31
    let n = ai
    if (ai >= 24) {
      const width = [1, 2, 4, 8][ai - 24]
      check(width && offset + width <= bytes.length)
      n = 0; for (let i = 0; i < width; i++) n = n * 256 + bytes[offset++]
      check(Number.isSafeInteger(n))
    }
    if (major === 0) return n
    if (major === 1) return -1 - n
    if (major === 2 || major === 3) { check(offset + n <= bytes.length); const value = bytes.slice(offset, offset += n); return major === 2 ? value : utf8.decode(value) }
    if (major === 4) { check(n < 10000); return Array.from({ length: n }, () => read(depth + 1)) }
    if (major === 5) {
      check(n < 10000); const value: Record<string, unknown> = Object.create(null)
      for (let i = 0; i < n; i++) { const k = read(depth + 1); check(typeof k === 'string' && !(k in value)); value[k] = read(depth + 1) }
      return value
    }
    if (major === 6) return read(depth + 1)
    if (major === 7 && [20, 21, 22].includes(ai)) return ai === 22 ? null : ai === 21
    throw new Error('不支持的 C2PA CBOR 编码')
  }
  const value = read(0); check(offset === bytes.length); return value
}
function dataBindings(bytes: Uint8Array): Binding[] {
  const found: Binding[] = []
  const boxes = (b: Uint8Array, depth: number, parentLabel = ''): void => {
    check(depth < 24)
    let label = parentLabel
    for (let offset = 0; offset < b.length;) {
      check(offset + 8 <= b.length)
      const length = view(b).getUint32(offset), type = ascii(b.subarray(offset + 4, offset + 8))
      check(length >= 8 && offset + length <= b.length)
      const data = b.subarray(offset + 8, offset + length)
      if (type === 'jumd') {
        check(data.length >= 17)
        if (data[16] & 2) { const end = data.indexOf(0, 17); check(end >= 17); label = utf8.decode(data.subarray(17, end)) }
        if (/^c2pa\.hash\./.test(label)) check(label === 'c2pa.hash.data')
      } else if (type === 'jumb') boxes(data, depth + 1)
      else if (type === 'cbor' && label === 'c2pa.hash.data') {
        const value = cbor(data) as Record<string, unknown>
        check(value && typeof value === 'object' && value.hash instanceof Uint8Array && Array.isArray(value.exclusions))
        check(['sha256', 'sha384', 'sha512'].includes(String(value.alg)))
        const ranges = value.exclusions as Range[]
        let end = 0
        for (const range of ranges) { check(Number.isSafeInteger(range.start) && Number.isSafeInteger(range.length) && range.start >= end && range.length > 0); end = range.start + range.length; check(Number.isSafeInteger(end)) }
        found.push({ alg: String(value.alg), hash: value.hash, exclusions: ranges })
      } else check(!['brob', 'uuid'].includes(type), 'C2PA 压缩或扩展格式需要保留原文件')
      offset += length
    }
  }
  boxes(bytes, 0)
  check(found.length > 0)
  return found
}
async function matches(b: Uint8Array, binding: Binding): Promise<boolean> {
  const included: Uint8Array[] = []; let p = 0
  for (const range of binding.exclusions) { check(range.start + range.length <= b.length); included.push(b.subarray(p, range.start)); p = range.start + range.length }
  included.push(b.subarray(p))
  const hash = new Uint8Array(await crypto.subtle.digest(binding.alg.replace('sha', 'SHA-'), cat(...included)))
  return same(hash, binding.hash)
}
function extract(pieces: Piece[], format: string): Uint8Array {
  const credentials = pieces.filter(p => p.credential)
  if (format === 'png') { check(credentials.every(p => p.kind === 'caBX')); return cat(...credentials.map(p => p.original.subarray(8, -4))) }
  if (format === 'webp') { check(credentials.every(p => p.kind === 'C2PA')); return cat(...credentials.map(p => p.original.subarray(8, 8 + view(p.original).getUint32(4, true)))) }
  // APP11 分片：相同实例号、连续序号、相同 JUMBF 盒头；去掉后续分片重复盒头。
  check(credentials.every(p => p.kind === 'APP11'))
  let instance = -1, sequence = 1, boxHeader: Uint8Array | undefined
  const parts: Uint8Array[] = []
  for (const p of credentials) {
    const d = p.original.subarray(4)
    check(d.length >= 16 && ascii(d.subarray(0, 2)) === 'JP')
    if (instance === -1) instance = view(d).getUint16(2)
    check(view(d).getUint16(2) === instance && view(d).getUint32(4) === sequence++)
    if (!boxHeader) { boxHeader = d.subarray(8, 16); parts.push(d.subarray(8)) }
    else { check(same(boxHeader, d.subarray(8, 16))); parts.push(d.subarray(16)) }
  }
  return cat(...parts)
}
export async function protectC2pa(input: Uint8Array, pieces: Piece[], format: MetadataReport['format']): Promise<{ data: Uint8Array; report: MetadataReport } | undefined> {
  if (!pieces.some(p => p.credential)) return
  const changed = pieces.filter(p => !p.credential && !same(p.original, p.output))
  let output = input.slice(), cleaned = 0
  try {
    check(!pieces.some(p => p.issue))
    const bindings = dataBindings(extract(pieces, format))
    check((await Promise.all(bindings.map(binding => matches(input, binding)))).every(Boolean))
    for (const piece of changed) {
      // 块头、文件总长和所有后续偏移均保持原样。仅改写完整落在所有已知排除范围的字节。
      let candidate = piece.output.length === piece.original.length ? piece.output : piece.padding
      if (!candidate && piece.output.length && piece.output.length < piece.original.length && (piece.kind === 'APP1' && ascii(piece.output.subarray(4, 10)) === 'Exif\0\0')) {
        candidate = new Uint8Array(piece.original.length); candidate.set(piece.output); candidate[2] = piece.original[2]; candidate[3] = piece.original[3]
      }
      if (!candidate || candidate.length !== piece.original.length) continue
      const positions: number[] = []
      for (let i = 0; i < candidate.length; i++) if (candidate[i] !== piece.original[i]) positions.push(piece.start + i)
      const allowed = bindings.every(binding => positions.every(pos => binding.exclusions.some(range => pos >= range.start && pos < range.start + range.length)))
      if (allowed) { output.set(candidate, piece.start); cleaned++ }
    }
    check((await Promise.all(bindings.map(binding => matches(output, binding)))).every(Boolean))
  } catch {
    // 无法可靠识别绑定规则时保持整份文件，明确返回“未清理”，不宣称清理成功。
    output = input.slice(); cleaned = 0
  }
  return { data: output, report: { format, status: cleaned ? 'partial' : 'uncleaned', removedBlocks: cleaned, protectedBlocks: pieces.filter(p => p.credential).length + changed.length - cleaned,
    reason: cleaned ? '部分清理：仅处理已验证不受 C2PA 绑定的字段；来源凭证及其余数据完整保留' : '未清理：为保留 C2PA 来源凭证及签名有效性，原文件完整保留' } }
}

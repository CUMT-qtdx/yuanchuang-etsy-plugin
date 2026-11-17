// 沿用 AIMetaScrubber 的 TIFF 字节序和 IFD 读取方式，扩展为保留作者、版权及显示参数。
import { cat, check, encoder, same, view } from './binary.ts'
type Field = { tag: number; type: number; count: number; data: Uint8Array }
const sizes = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8]
const keepRoot = new Set([0x112, 0x11a, 0x11b, 0x128, 0x13b, 0x8298, 0x9c9d, 0x8773, 0x13e, 0x13f, 0x211, 0x213, 0x214])
const keepExif = new Set([0xa001, 0xa002, 0xa003, 0xa500, 0x9101])
export function cleanExif(input: Uint8Array): Uint8Array | undefined {
  const prefix = input.length >= 6 && String.fromCharCode(...input.subarray(0, 6)) === 'Exif\0\0'
  const b = prefix ? input.subarray(6) : input
  check(b.length >= 8 && ((b[0] === 73 && b[1] === 73) || (b[0] === 77 && b[1] === 77)), 'EXIF 字节序无效，未导出')
  const le = b[0] === 73, v = view(b)
  check(v.getUint16(2, le) === 42, 'EXIF 格式不支持，未导出')
  const read = (offset: number): Field[] => {
    check(offset >= 8 && offset + 2 <= b.length)
    const count = v.getUint16(offset, le)
    check(count <= 4096 && offset + 2 + count * 12 + 4 <= b.length)
    const seen = new Set<number>()
    return Array.from({ length: count }, (_, i) => {
      const p = offset + 2 + i * 12, tag = v.getUint16(p, le), type = v.getUint16(p + 2, le), count = v.getUint32(p + 4, le)
      check(!seen.has(tag), 'EXIF 存在重复字段，未导出'); seen.add(tag)
      const size = sizes[type] * count
      check(Number.isSafeInteger(size) && size <= b.length)
      const start = size > 4 ? v.getUint32(p + 8, le) : p + 8
      check(start + size <= b.length)
      return { tag, type, count, data: b.slice(start, start + size) }
    })
  }
  const root = read(v.getUint32(4, le)), exifPointer = root.find(x => x.tag === 0x8769)
  let exif: Field[] = []
  if (exifPointer) {
    check(exifPointer.type === 4 && exifPointer.count === 1)
    exif = read(view(exifPointer.data).getUint32(0, le)).filter(x => keepExif.has(x.tag))
  }
  const fields = root.filter(x => keepRoot.has(x.tag))
  const orientation = fields.find(x => x.tag === 0x112)
  if (orientation) check(orientation.type === 3 && orientation.count === 1 && view(orientation.data).getUint16(0, le) >= 1 && view(orientation.data).getUint16(0, le) <= 8, 'EXIF 方向字段无效，未导出')
  if (!fields.length && !exif.length) return
  if (exif.length) fields.push({ tag: 0x8769, type: 4, count: 1, data: new Uint8Array(4) })
  fields.sort((a, b) => a.tag - b.tag); exif.sort((a, b) => a.tag - b.tag)
  const exifOffset = 8 + 2 + fields.length * 12 + 4
  const headerSize = exifOffset + (exif.length ? 2 + exif.length * 12 + 4 : 0)
  const total = headerSize + [...fields, ...exif].reduce((n, f) => n + (f.data.length > 4 ? f.data.length + (f.data.length & 1) : 0), 0)
  const out = new Uint8Array(total), ov = view(out)
  out.set(b.subarray(0, 4)); ov.setUint32(4, 8, le)
  let cursor = headerSize
  const write = (rows: Field[], offset: number): void => {
    ov.setUint16(offset, rows.length, le)
    rows.forEach((f, i) => {
      const p = offset + 2 + i * 12
      ov.setUint16(p, f.tag, le); ov.setUint16(p + 2, f.type, le); ov.setUint32(p + 4, f.count, le)
      if (f.tag === 0x8769) ov.setUint32(p + 8, exifOffset, le)
      else if (f.data.length <= 4) out.set(f.data, p + 8)
      else { ov.setUint32(p + 8, cursor, le); out.set(f.data, cursor); cursor += f.data.length + (f.data.length & 1) }
    })
  }
  write(fields, 8); if (exif.length) write(exif, exifOffset)
  const result = prefix ? cat(encoder.encode('Exif\0\0'), out) : out
  return same(result, input) ? input.slice() : result
}

/**
 * 改编自 muqadasejaz/AIMetaScrubber，MIT，Copyright (c) 2026 Muqadas Ejaz。
 * 来源：index.html 的 kind / strip / crc / chunk；固定提交见同目录 UPSTREAM.md。
 * 扩展：严格边界检查、署名保留、跨格式 EXIF、C2PA 保护及明确处理结果。
 */
import { ascii, cat, check, crc32, encoder, jpegSegment, latin, pngChunk, riffChunk, same, utf8, view } from './binary.ts'
import { cleanExif } from './exif.ts'
import { cleanPhotoshop, cleanXmp } from './rights.ts'
import { protectC2pa } from './c2pa.ts'

export type MetadataStatus = 'cleaned' | 'partial' | 'uncleaned' | 'unchanged'
export interface MetadataReport { status: MetadataStatus; removedBlocks: number; protectedBlocks: number; reason: string; format: 'jpeg' | 'png' | 'webp' }
export interface MetadataResult { data: Uint8Array; mime: string; report: MetadataReport }
export interface Piece { start: number; original: Uint8Array; output: Uint8Array; padding?: Uint8Array; credential?: boolean; issue?: string; kind: string }
export const MAX_EXPORT_IMAGE_BYTES = 100 * 1024 * 1024
export function imageKind(b: Uint8Array): 'jpeg' | 'png' | 'webp' | undefined {
  if (b[0] === 255 && b[1] === 216) return 'jpeg'
  if (b.length >= 8 && same(b.subarray(0, 8), new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png'
  if (b.length >= 12 && ascii(b.subarray(0, 4)) === 'RIFF' && ascii(b.subarray(8, 12)) === 'WEBP') return 'webp'
}
const empty = new Uint8Array()
const xmpHead = encoder.encode('http://ns.adobe.com/xap/1.0/\0')
const starts = (b: Uint8Array, prefix: Uint8Array): boolean => b.length >= prefix.length && same(b.subarray(0, prefix.length), prefix)
async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate')).getReader()
  const parts: Uint8Array[] = []; let size = 0
  try {
    while (true) { const r = await reader.read(); if (r.done) break; size += r.value.length; check(size <= 4 * 1024 * 1024, '压缩元数据过大，未导出'); parts.push(r.value) }
  } finally { await reader.cancel().catch(() => {}) }
  return cat(...parts)
}
function credentialText(b: Uint8Array): boolean { return /c2pa|contentauthenticity|contentcredentials|provenance/i.test(latin.decode(b)) }
async function pngText(type: string, b: Uint8Array): Promise<{ output?: Uint8Array; credential: boolean }> {
  const zero = b.indexOf(0)
  check(zero > 0 && zero <= 79, 'PNG 文本字段无效，未导出')
  const key = latin.decode(b.subarray(0, zero))
  let text: Uint8Array
  if (type === 'tEXt') text = b.subarray(zero + 1)
  else if (type === 'zTXt') { check(b[zero + 1] === 0); text = await inflate(b.subarray(zero + 2)) }
  else {
    check((b[zero + 1] === 0 || b[zero + 1] === 1) && b[zero + 2] === 0)
    const languageEnd = b.indexOf(0, zero + 3), translatedEnd = b.indexOf(0, languageEnd + 1)
    check(languageEnd >= zero + 3 && translatedEnd >= languageEnd + 1)
    text = b[zero + 1] ? await inflate(b.subarray(translatedEnd + 1)) : b.subarray(translatedEnd + 1)
  }
  const credential = credentialText(text) || /c2pa|provenance/i.test(key)
  if (/^(author|artist|copyright|creator|credit|rights|license|licence|attribution|disclaimer|source)$/i.test(key)) return { output: pngChunk(type, b), credential }
  if (/^XML:com\.adobe\.xmp$/i.test(key)) {
    const cleaned = cleanXmp(text)
    return { output: cleaned ? pngChunk('iTXt', cat(encoder.encode('XML:com.adobe.xmp'), new Uint8Array(5), cleaned)) : undefined, credential }
  }
  // ImageMagick 也会把 EXIF / IPTC 编码进文本块；未知原始 profile 不静默删除署名。
  if (/raw profile type (exif|iptc|xmp)/i.test(key)) throw new Error('PNG 含旧式原始元数据 profile，无法保证署名完整，未导出')
  return { credential }
}
async function parsePng(b: Uint8Array): Promise<Piece[]> {
  const pieces: Piece[] = [{ start: 0, original: b.subarray(0, 8), output: b.subarray(0, 8), kind: 'signature' }]
  let offset = 8, ended = false, image = false
  while (offset < b.length) {
    check(!ended && offset + 12 <= b.length)
    const length = view(b).getUint32(offset), end = offset + 12 + length
    check(end <= b.length)
    const type = ascii(b.subarray(offset + 4, offset + 8)), data = b.subarray(offset + 8, end - 4), original = b.subarray(offset, end)
    check(/^[A-Za-z]{4}$/.test(type) && crc32(original.subarray(4, original.length - 4)) === view(b).getUint32(end - 4), 'PNG 数据块校验失败，未导出')
    if (offset === 8) check(type === 'IHDR' && length === 13 && view(data).getUint32(0) && view(data).getUint32(4))
    else check(type !== 'IHDR')
    if (type === 'IDAT') image = true
    if (type === 'IEND') { check(length === 0 && image); ended = true }
    let output: Uint8Array = original, credential = type === 'caBX', issue: string | undefined
    try {
    if (['tEXt', 'zTXt', 'iTXt'].includes(type)) { const clean = await pngText(type, data); output = clean.output ?? empty; credential ||= clean.credential }
    else if (type === 'eXIf') { const clean = cleanExif(data); output = clean ? pngChunk(type, clean) : empty }
    else if (type === 'tIME') output = empty
    } catch (error) { issue = error instanceof Error ? error.message : String(error); output = original }
    // 未识别块原样保留，避免破坏 APNG、HDR、色彩配置及未来扩展。
    pieces.push({ start: offset, original, output, credential, issue, kind: type,
      padding: !output.length ? pngChunk('prIv', new Uint8Array(length)) : undefined })
    offset = end
  }
  check(ended, 'PNG 缺少结束数据块，未导出')
  return pieces
}
function parseJpeg(b: Uint8Array): Piece[] {
  const pieces: Piece[] = [{ start: 0, original: b.subarray(0, 2), output: b.subarray(0, 2), kind: 'SOI' }]
  let offset = 2, ended = false, hasFrame = false, hasScan = false
  while (offset < b.length) {
    const start = offset
    check(b[offset++] === 255)
    while (b[offset] === 255) offset++
    const marker = b[offset++]
    if (marker === 0xd9) { pieces.push({ start, original: b.subarray(start), output: b.subarray(start), kind: 'EOI' }); ended = true; break }
    check(marker !== undefined && marker !== 0 && marker !== 0xd8 && !(marker >= 0xd0 && marker <= 0xd7) && offset + 2 <= b.length)
    const length = view(b).getUint16(offset), dataStart = offset + 2, end = offset + length
    check(length >= 2 && end <= b.length)
    const original = b.subarray(start, end), data = b.subarray(dataStart, end)
    if ([0xc0, 0xc1, 0xc2].includes(marker)) { check(data.length >= 6 && view(data).getUint16(1) && view(data).getUint16(3)); hasFrame = true }
    let output: Uint8Array = original, credential = marker === 0xeb, issue: string | undefined
    try {
    if (marker === 0xe1 && starts(data, encoder.encode('Exif\0\0'))) { const clean = cleanExif(data); output = clean ? jpegSegment(marker, clean) : empty }
    else if (marker === 0xe1 && starts(data, xmpHead)) { const text = data.subarray(xmpHead.length); credential ||= credentialText(text); const clean = cleanXmp(text); output = clean ? jpegSegment(marker, cat(xmpHead, clean)) : empty }
    else if (marker === 0xe1 && ascii(data.subarray(0, 34)).startsWith('http://ns.adobe.com/xmp/extension/')) {
      throw new Error('JPEG 含扩展 XMP，无法保证署名完整，未导出')
    } else if (marker === 0xed) { const clean = cleanPhotoshop(data); output = clean ? jpegSegment(marker, clean) : empty }
    else if (marker === 0xfe && !/copyright|\bcopyleft\b|\bauthor\b|\bartist\b|\bcredit\b|\blicen[cs]e\b|版权所有|作者|©/i.test(latin.decode(data))) output = empty
    else if (marker >= 0xe1 && marker <= 0xef && ![0xe2, 0xeb, 0xee].includes(marker)) output = empty
    } catch (error) { issue = error instanceof Error ? error.message : String(error); output = original }
    // APP2 包括 ICC / MPF / HDR 增益图定位；整体保留，避免损伤多图和色彩解释。
    pieces.push({ start, original, output, credential, issue, kind: `APP${marker - 0xe0}`,
      padding: !output.length ? jpegSegment(marker, new Uint8Array(data.length)) : undefined })
    offset = end
    if (marker === 0xda) {
      hasScan = true; const scanStart = offset
      while (offset < b.length) {
        if (b[offset] !== 255) { offset++; continue }
        let next = offset + 1
        while (b[next] === 255) next++
        if (b[next] === 0 || (b[next] >= 0xd0 && b[next] <= 0xd7)) { offset = next + 1; continue }
        break
      }
      pieces.push({ start: scanStart, original: b.subarray(scanStart, offset), output: b.subarray(scanStart, offset), kind: 'scan' })
    }
  }
  check(ended && hasFrame && hasScan, 'JPEG 图像数据不完整，未导出')
  return pieces
}
function parseWebp(b: Uint8Array): Piece[] {
  check(view(b).getUint32(4, true) + 8 === b.length, 'WebP 文件长度不一致，未导出')
  const pieces: Piece[] = [{ start: 0, original: b.subarray(0, 12), output: b.slice(0, 12), kind: 'RIFF' }]
  let image = false, vp8x = false
  for (let offset = 12; offset < b.length;) {
    check(offset + 8 <= b.length)
    const type = ascii(b.subarray(offset, offset + 4)), length = view(b).getUint32(offset + 4, true), end = offset + 8 + length + (length & 1)
    check(end <= b.length)
    const original = b.subarray(offset, end), data = b.subarray(offset + 8, offset + 8 + length)
    if (['VP8 ', 'VP8L', 'ANMF'].includes(type)) { check(length > 0); image = true }
    if (type === 'VP8X') { check(!vp8x && offset === 12 && length === 10); vp8x = true }
    let output = original, credential = type === 'C2PA', issue: string | undefined
    try {
    if (type === 'EXIF') { const clean = cleanExif(data); output = clean ? riffChunk(type, clean) : empty }
    else if (type === 'XMP ') { credential ||= credentialText(data); const clean = cleanXmp(data); output = clean ? riffChunk(type, clean) : empty }
    } catch (error) { issue = error instanceof Error ? error.message : String(error); output = original }
    pieces.push({ start: offset, original, output, credential, issue, kind: type })
    offset = end
  }
  check(image, 'WebP 缺少图像数据，未导出')
  return pieces
}
export async function cleanImageMetadata(input: Uint8Array): Promise<MetadataResult> {
  check(input.length > 0 && input.length <= MAX_EXPORT_IMAGE_BYTES, '图片为空或超过 100 MiB，未导出')
  const format = imageKind(input)
  check(format, '自动元数据处理仅支持 JPG、PNG、WebP；未导出未经处理的文件')
  const pieces = format === 'png' ? await parsePng(input) : format === 'jpeg' ? parseJpeg(input) : parseWebp(input)
  const protectedResult = await protectC2pa(input, pieces, format)
  if (protectedResult) return { ...protectedResult, mime: `image/${format}` }
  const issue = pieces.find(p => p.issue)?.issue
  check(!issue, issue)
  // MPF / HDR 图像使用绝对偏移，缩短头部会损坏后续图像定位，因此保持完整原文件。
  if (format === 'jpeg' && pieces.some(p => p.kind === 'APP2' && ascii(p.original.subarray(4, 8)) === 'MPF\0')) {
    return { data: input.slice(), mime: 'image/jpeg', report: { format, status: 'uncleaned', removedBlocks: 0, protectedBlocks: 1, reason: '未清理：图片含多图／HDR 偏移索引，已保留原文件完整性' } }
  }
  if (format === 'webp') {
    const flags = pieces.find(p => p.kind === 'VP8X')
    if (flags) {
      flags.output = flags.output.slice()
      flags.output[8] = (flags.output[8] & ~0x0c) | (pieces.some(p => p.kind === 'EXIF' && p.output.length) ? 8 : 0) | (pieces.some(p => p.kind === 'XMP ' && p.output.length) ? 4 : 0)
    }
  }
  const changed = pieces.filter(p => !same(p.original, p.output)).length
  const output = cat(...pieces.map(p => p.output))
  if (format === 'webp') view(output).setUint32(4, output.length - 8, true)
  return { data: output, mime: `image/${format}`, report: { format, status: changed ? 'cleaned' : 'unchanged', removedBlocks: changed, protectedBlocks: 0,
    reason: changed ? '已清理非必要元数据；保留作者、版权、色彩配置与方向' : '无需清理：未发现可移除的隐私元数据' } }
}

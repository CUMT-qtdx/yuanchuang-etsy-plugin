// 按命名空间选择 XMP 字段，保留作者、版权和显示参数；不使用字符串关键词猜测作者身份。
import { ascii, cat, check, encoder, utf8, view } from './binary.ts'
const namespaces = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#', dc: 'http://purl.org/dc/elements/1.1/',
  rights: 'http://ns.adobe.com/xap/1.0/rights/', tiff: 'http://ns.adobe.com/tiff/1.0/',
  exif: 'http://ns.adobe.com/exif/1.0/', photoshop: 'http://ns.adobe.com/photoshop/1.0/',
  iptc: 'http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/', iptcExt: 'http://iptc.org/std/Iptc4xmpExt/2008-02-29/',
  plus: 'http://ns.useplus.org/ldf/xmp/1.0/',
}
const preserved = (uri: string, name: string): boolean => {
  if (uri === namespaces.dc) return ['creator', 'rights'].includes(name)
  if (uri === namespaces.rights || uri === namespaces.plus) return true
  if (uri === namespaces.tiff) return ['Orientation', 'XResolution', 'YResolution', 'ResolutionUnit', 'Artist', 'Copyright'].includes(name)
  if (uri === namespaces.exif) return ['ColorSpace', 'PixelXDimension', 'PixelYDimension', 'Gamma'].includes(name)
  if (uri === namespaces.photoshop) return ['AuthorsPosition', 'Credit', 'Source', 'Copyright'].includes(name)
  if (uri === namespaces.iptc) return ['CreatorContactInfo'].includes(name)
  if (uri === namespaces.iptcExt) return ['CopyrightOwner', 'ImageCreator', 'Licensor', 'DigitalSourceType'].includes(name)
  return false
}
type Node = { name: string; attrs: Array<[string, string]>; children: Array<Node | string>; ns: Record<string, string> }
export function cleanXmp(input: Uint8Array): Uint8Array | undefined {
  const text = utf8.decode(input).replace(/\0+$/g, '')
  check(!/<!DOCTYPE|<!ENTITY/i.test(text), 'XMP 含不支持的实体声明，未导出')
  const holder: Node = { name: '', attrs: [], children: [], ns: {} }, stack = [holder]
  const tokens = text.match(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<[^>"']*(?:"[^"]*"[^>"']*|'[^']*'[^>"']*)*>|[^<]+/g) ?? []
  check(tokens.join('') === text, 'XMP 结构无效，未导出')
  for (const token of tokens) {
    const parent = stack.at(-1)!
    if (token.startsWith('<!--') || token.startsWith('<?')) continue
    if (!token.startsWith('<') || token.startsWith('<![CDATA[')) { parent.children.push(token); continue }
    if (token.startsWith('</')) { check(stack.length > 1 && token.slice(2, -1).trim() === parent.name, 'XMP 标签不匹配，未导出'); stack.pop(); continue }
    const match = /^<([\w:.-]+)([\s\S]*?)(\/?)>$/.exec(token)
    check(match, 'XMP 标签无效，未导出')
    const attrs: Array<[string, string]> = [], ns = { ...parent.ns }
    let tail = match[2]
    while (tail.trim()) {
      const attr = /^\s+([\w:.-]+)\s*=\s*("[^"]*"|'[^']*')/.exec(tail)
      check(attr, 'XMP 属性无效，未导出')
      check(!attrs.some(([key]) => key === attr[1]), 'XMP 属性重复，未导出')
      attrs.push([attr[1], attr[2]])
      if (attr[1] === 'xmlns') ns[''] = attr[2].slice(1, -1)
      if (attr[1].startsWith('xmlns:')) ns[attr[1].slice(6)] = attr[2].slice(1, -1)
      tail = tail.slice(attr[0].length)
    }
    const node: Node = { name: match[1], attrs, children: [], ns }
    parent.children.push(node); if (!match[3]) stack.push(node)
    check(stack.length < 64, 'XMP 嵌套过深，未导出')
  }
  check(stack.length === 1, 'XMP 未完整结束，未导出')
  const qualified = (name: string, ns: Record<string, string>): [string, string] => {
    const p = name.indexOf(':')
    return [ns[p < 0 ? '' : name.slice(0, p)] ?? '', p < 0 ? name : name.slice(p + 1)]
  }
  const serialize = (node: Node): string => `<${node.name}${node.attrs.map(([k, v]) => ` ${k}=${v}`).join('')}>${node.children.map(c => typeof c === 'string' ? c : serialize(c)).join('')}</${node.name}>`
  const descriptions: string[] = []
  const visit = (node: Node): void => {
    const [uri, local] = qualified(node.name, node.ns)
    if (uri === namespaces.rdf && local === 'Description') {
      const attrs = node.attrs.filter(([name]) => name.includes(':') && preserved(...qualified(name, node.ns)))
      const children = node.children.filter((x): x is Node => typeof x !== 'string' && preserved(...qualified(x.name, x.ns)))
      if (attrs.length || children.length) {
        const declarations = Object.entries(node.ns).map(([prefix, value]) => ` xmlns${prefix ? ':' + prefix : ''}="${value.replaceAll('"', '&quot;')}"`).join('')
        // 使用当前 RDF 命名空间的前缀，避免覆盖原数据使用的命名空间别名。
        descriptions.push(`<${node.name}${declarations}${attrs.map(([k, v]) => ` ${k}=${v}`).join('')}>${children.map(serialize).join('')}</${node.name}>`)
      }
    }
    for (const child of node.children) if (typeof child !== 'string') visit(child)
  }
  for (const node of holder.children) if (typeof node !== 'string') visit(node)
  if (!descriptions.length) return
  return encoder.encode(`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="${namespaces.rdf}">${descriptions.join('')}</rdf:RDF></x:xmpmeta>`)
}

// Photoshop APP13 中只改写 IPTC 隐私字段，保留署名、版权、色彩与分辨率资源。
export function cleanIptc(input: Uint8Array): Uint8Array | undefined {
  const parts: Uint8Array[] = []
  for (let p = 0; p < input.length;) {
    check(p + 5 <= input.length && input[p] === 0x1c, 'IPTC 结构无效，未导出')
    const record = input[p + 1], tag = input[p + 2], length = view(input).getUint16(p + 3)
    check(!(length & 0x8000) && p + 5 + length <= input.length, 'IPTC 长度不支持，未导出')
    if ((record === 1 && [0, 90].includes(tag)) || (record === 2 && [0, 80, 85, 110, 115, 116].includes(tag))) parts.push(input.subarray(p, p + 5 + length))
    p += 5 + length
  }
  return parts.length ? cat(...parts) : undefined
}
export function cleanPhotoshop(b: Uint8Array): Uint8Array | undefined {
  check(ascii(b.subarray(0, 14)) === 'Photoshop 3.0\0', '未知 APP13 元数据格式，未导出')
  const parts: Uint8Array[] = [b.subarray(0, 14)]
  for (let p = 14; p < b.length;) {
    check(p + 12 <= b.length && ['8BIM', '8B64'].includes(ascii(b.subarray(p, p + 4))), 'Photoshop 资源结构无效，未导出')
    const id = view(b).getUint16(p + 4), nameSize = b[p + 6] + 1, sizeAt = p + 6 + nameSize + (nameSize & 1)
    check(sizeAt + 4 <= b.length)
    const length = view(b).getUint32(sizeAt), start = sizeAt + 4, end = start + length + (length & 1)
    check(end <= b.length)
    if (id === 0x0404) {
      const data = cleanIptc(b.subarray(start, start + length))
      if (data) {
        const resource = new Uint8Array(start - p + data.length + (data.length & 1))
        resource.set(b.subarray(p, start)); view(resource).setUint32(sizeAt - p, data.length); resource.set(data, start - p); parts.push(resource)
      }
    } else if ([0x03ed, 0x040f, 0x0410, 0x040a, 0x040b].includes(id)) parts.push(b.subarray(p, end))
    p = end
  }
  return parts.length > 1 ? cat(...parts) : undefined
}

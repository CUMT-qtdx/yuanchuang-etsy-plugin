import { Buffer } from 'node:buffer'
import type { EtsyProduct } from './types.ts'
import type { EtsyStore } from './store.ts'
import { selectedCopy } from './selected-copy.ts'
import { listingText, copyReviewText } from './listing-text.ts'

// 使用无压缩 ZIP，避免为 Electron 引入新的本地二进制依赖。
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
export function zipFiles(files: Array<{ name: string; data: Buffer }>): Buffer {
  const local: Buffer[] = [], central: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8'), crc = crc32(file.data)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6)
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(file.data.length, 18); header.writeUInt32LE(file.data.length, 22); header.writeUInt16LE(name.length, 26)
    local.push(header, name, file.data)
    const directory = Buffer.alloc(46)
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8)
    directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(file.data.length, 20); directory.writeUInt32LE(file.data.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42)
    central.push(directory, name); offset += header.length + name.length + file.data.length
  }
  const index = Buffer.concat(central), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(index.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, index, end])
}
export async function exportProduct(product: EtsyProduct, store: EtsyStore): Promise<Buffer> {
  const bundle = await store.export(product.id, product)
  const copy = selectedCopy(product)
  const listing = copy ? listingText(copy) : '当前方案英文文案尚未完成或资料已更新，旧稿保留于 product.json，不能当作当前商品文案。'
  return zipFiles([
    { name: 'product.json', data: Buffer.from(JSON.stringify(product, null, 2)) },
    ...(product.images.some(image => image.visualRules) ? [{ name: 'visual-rules.json', data: Buffer.from(JSON.stringify({ projectRuleVersion: product.visualRuleVersion, photography: product.photography, images: product.images.filter(image => image.visualRules).map(image => ({ imageId: image.id, parentImageId: image.parentImageId, angle: image.angle, visualRules: image.visualRules })) }, null, 2)) }] : []),
    { name: 'listing.txt', data: Buffer.from(listing) },
    { name: 'review-notes.txt', data: Buffer.from(copy ? copyReviewText(copy) : '待准备当前图片的英文文案。') },
    { name: 'title-translations.txt', data: Buffer.from(copy?.titles.map(row => `${row.title}\n中文译名：${row.titleZh || '旧稿未提供中文译名'}\n${row.explanationZh}`).join('\n\n') ?? '') },
    ...(product.finalDesigns?.length ? [{ name: 'final-designs.json', data: Buffer.from(JSON.stringify({ activeDesignId: product.finalDesignId, designs: product.finalDesigns, views: product.images.filter(image => image.kind === 'view').map(image => ({ imageId: image.id, designId: image.finalDesignId, angle: image.angle, version: image.version, parentImageId: image.parentImageId, identityRevision: image.identityRevision, approved: image.viewApproved === true, files: image.files, report: image.report })) }, null, 2)) }] : []),
    ...product.images.flatMap(image => {
      const listing = selectedCopy({ ...product, selectedImageId: image.id })
      if (!/^[a-zA-Z0-9-]{1,80}$/.test(image.id) || !listing) return []
      return [{ name: `listings/${image.id}.txt`, data: Buffer.from(listingText(listing)) }, { name: `reviews/${image.id}.txt`, data: Buffer.from(copyReviewText(listing)) }]
    }),
    { name: 'README.txt', data: Buffer.from('图片为 AI 设计结果。视觉质检为模型建议，不能证明实物真实性。调用记录 cost=null 表示金额未知，按供应商账单核对。原始参考图、全部成功图片、检测与文案均保存在本资料包中。') },
    ...bundle.files.map(file => ({ name: `images/${file.name}`, data: Buffer.from(file.base64, 'base64') })),
  ])
}

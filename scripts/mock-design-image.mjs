import { deflateSync } from 'node:zlib'
// 合成的流程测试图，不是模型设计结果。
function crc(bytes) { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let i = 0; i < 8; i++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0) } return (value ^ 0xffffffff) >>> 0 }
function chunk(type, data) { const name = Buffer.from(type), size = Buffer.alloc(4), sum = Buffer.alloc(4); size.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([name, data]))); return Buffer.concat([size, name, data, sum]) }
export function mockDesignImage(index = 0) {
  const size = 320, data = Buffer.alloc((size * 3 + 1) * size), colors = [[205, 165, 116], [144, 166, 178], [185, 151, 166], [147, 169, 138]]
  const body = colors[index % colors.length]
  const ellipse = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let rgb = [247, 246, 242]
    if (ellipse(x, y, 160, 239, 61, 61) || ellipse(x, y, 160, 133, 65, 65) || ellipse(x, y, 113, 77, 24, 39) || ellipse(x, y, 207, 77, 24, 39)) rgb = body
    if (ellipse(x, y, 160, 155, 39, 29)) rgb = [237, 222, 202]
    if (ellipse(x, y, 137, 129, 5, 6) || ellipse(x, y, 183, 129, 5, 6) || ellipse(x, y, 160, 150, 7, 5)) rgb = [61, 57, 54]
    if (y > 193 && y < 207 && x > 103 && x < 218) rgb = [164, 83 + index * 8, 75]
    const offset = y * (size * 3 + 1) + 1 + x * 3
    data.set(rgb, offset)
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(data)), chunk('IEND', Buffer.alloc(0))])
}

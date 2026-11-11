// 通用方向图由代码绘制，不镜像商品、不调用模型；主图仍是外观基准。
import { deflateSync } from 'node:zlib'
const font: Record<string, string[]> = {
  A:['01110','10001','10001','11111','10001','10001','10001'], B:['11110','10001','10001','11110','10001','10001','11110'], C:['01111','10000','10000','10000','10000','10000','01111'], D:['11110','10001','10001','10001','10001','10001','11110'], E:['11111','10000','10000','11110','10000','10000','11111'], F:['11111','10000','10000','11110','10000','10000','10000'], G:['01111','10000','10000','10111','10001','10001','01111'], H:['10001','10001','10001','11111','10001','10001','10001'], I:['11111','00100','00100','00100','00100','00100','11111'], K:['10001','10010','10100','11000','10100','10010','10001'], L:['10000','10000','10000','10000','10000','10000','11111'], N:['10001','11001','11001','10101','10011','10011','10001'], O:['01110','10001','10001','10001','10001','10001','01110'], P:['11110','10001','10001','11110','10000','10000','10000'], R:['11110','10001','10001','11110','10100','10010','10001'], S:['01111','10000','10000','01110','00001','00001','11110'], T:['11111','00100','00100','00100','00100','00100','00100'], U:['10001','10001','10001','10001','10001','10001','01110'], Y:['10001','10001','01010','00100','00100','00100','00100'], '1':['00100','01100','00100','00100','00100','00100','01110'], ' ':['00000','00000','00000','00000','00000','00000','00000'],
}
const crc = (bytes: Buffer): number => { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let i = 0; i < 8; i++) value = value >>> 1 ^ ((value & 1) ? 0xedb88320 : 0) }; return (value ^ 0xffffffff) >>> 0 }
const chunk = (type: string, data: Buffer): Buffer => { const name = Buffer.from(type), len = Buffer.alloc(4), sum = Buffer.alloc(4); len.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([name, data]))); return Buffer.concat([len, name, data, sum]) }
export function createDirectionGuide(facing: 'screen-left' | 'screen-right'): Buffer {
  const size = 1024, stride = 1 + size * 3, data = Buffer.alloc(stride * size, 255)
  for (let y = 0; y < size; y++) data[y * stride] = 0
  const set = (x: number, y: number, color: number[]): void => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < size && y < size) data.set(color, y * stride + 1 + x * 3) }
  const shape = (test: (x: number,y: number)=>boolean, color: number[]): void => { for(let y=160;y<910;y++)for(let x=180;x<960;x++)if(test(x,y))set(facing === 'screen-right' ? x : size-1-x,y,color) }
  const ellipse = (x:number,y:number,cx:number,cy:number,rx:number,ry:number):boolean => ((x-cx)/rx)**2+((y-cy)/ry)**2 <= 1
  shape((x,y)=>ellipse(x,y,500,670,125,220)||ellipse(x,y,510,350,150,155)||(x>=638&&x<=705&&y>=330+(x-638)*55/67&&y<=401-(x-638)*16/67),[187,187,187])
  shape((x,y)=>ellipse(x,y,600,329,12,12),[34,34,34])
  shape((x,y)=>x>=735&&x<=935&&Math.abs(y-350)<8||x>=890&&x<=940&&Math.abs(Math.abs(y-350)-(940-x))<9,[229,66,52])
  const text = (value:string,cx:number,y:number,scale:number):void => { let left=Math.round(cx-(value.length*6-1)*scale/2); for(const c of value){ const glyph=font[c]??font[' '];glyph.forEach((row,dy)=>[...row].forEach((v,dx)=>{if(v==='1')for(let yy=0;yy<scale;yy++)for(let xx=0;xx<scale;xx++)set(left+dx*scale+xx,y+dy*scale+yy,[40,40,40])}));left+=6*scale} }
  text('DIRECTION ONLY',512,45,5);text(facing==='screen-right'?'FACE RIGHT':'FACE LEFT',512,105,5)
  text('BACK',facing==='screen-right'?220:804,660,4);text('FRONT',facing==='screen-right'?800:224,660,4)
  text('USE PHOTO 1 FOR PRODUCT',512,955,4)
  const header = Buffer.alloc(13); header.writeUInt32BE(size);header.writeUInt32BE(size,4);header[8]=8;header[9]=2
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(data)),chunk('IEND',Buffer.alloc(0))])
}

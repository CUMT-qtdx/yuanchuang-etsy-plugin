import { deflateSync } from 'node:zlib'
import type { CompositionTarget } from './photography-contract.ts'

const crc = (bytes: Buffer): number => { let value=0xffffffff;for(const byte of bytes){value^=byte;for(let i=0;i<8;i++)value=(value>>>1)^((value&1)?0xedb88320:0)}return (value^0xffffffff)>>>0 }
const chunk = (type: string, data: Buffer): Buffer => { const name=Buffer.from(type),len=Buffer.alloc(4),sum=Buffer.alloc(4);len.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([name,data])));return Buffer.concat([len,name,data,sum]) }
const cache=new Map<string,Buffer>()

// 纯代码构图图：只有目标上下边界，不含商品、背景或装饰，避免暗示新增部件。
export function createCompositionGuide(target: CompositionTarget, aspect: string): Buffer | undefined {
  const match = /^(\d+)[:x](\d+)$/.exec(aspect)
  if (!match) return undefined
  const ratio=Number(match[1])/Number(match[2])
  if(!Number.isFinite(ratio)||ratio<0.1||ratio>10)return undefined
  const cacheKey=`${aspect}:${target.top}:${target.bottom}`
  const saved=cache.get(cacheKey)
  if(saved)return saved
  const height=640,width=Math.max(64,Math.round(height*ratio)),stride=1+width*3
  const raw=Buffer.alloc(stride*height,255)
  const top=Math.round(target.top*height),bottom=Math.round(target.bottom*height)
  for(let y=0;y<height;y++){
    raw[y*stride]=0
    for(let x=0;x<width;x++){
      const line=(Math.abs(y-top)<=2||Math.abs(y-bottom)<=2)&&x>=width*0.06&&x<=width*0.94
      const band=y>top&&y<bottom
      const colour=line?[39,103,168]:band?[235,244,251]:[255,255,255]
      const offset=y*stride+1+x*3
      raw[offset]=colour[0];raw[offset+1]=colour[1];raw[offset+2]=colour[2]
    }
  }
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2
  const image=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))])
  if(cache.size>=40)cache.delete(cache.keys().next().value!)
  cache.set(cacheKey,image)
  return image
}

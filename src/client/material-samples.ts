import { ETSY_API, type EtsyProduct, type FinalDesign } from '../etsy/types.ts'
import { etsyCall } from './etsy-api.ts'

// 直接从原始主图读取像素，按观察区域裁剪PNG；不放大、不锐化、不经过AI重画。
export async function cropMaterialSamples(product: EtsyProduct, design: FinalDesign): Promise<Array<{ index: number; dataUrl: string; width: number; height: number }>> {
  const source = product.images.find(image => image.id === design.imageId), reference = design.materialReference
  if (!source?.files[0] || !reference || reference.sourceImageId !== source.id) throw new Error('主图材质参考尚未准备完成')
  const response = await fetch(`${ETSY_API}/image?id=${encodeURIComponent(product.id)}&file=${encodeURIComponent(source.files[0])}`)
  if (!response.ok) throw new Error('主图原文件读取失败，未提交角度生图')
  const bitmap = await createImageBitmap(await response.blob())
  try {
    return reference.fingerprint.regions.map((region, index) => {
      const [x, y, w, h] = region.box
      const left = Math.round(x / 1000 * bitmap.width), top = Math.round(y / 1000 * bitmap.height)
      const width = Math.min(bitmap.width - left, Math.round(w / 1000 * bitmap.width)), height = Math.min(bitmap.height - top, Math.round(h / 1000 * bitmap.height))
      if (width < 24 || height < 24) throw new Error('主图局部尺寸不足以读取材质，请使用较清楚的主图')
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('当前窗口无法读取原图材质像素')
      context.imageSmoothingEnabled = false
      context.drawImage(bitmap, left, top, width, height, 0, 0, width, height)
      return { index, dataUrl: canvas.toDataURL('image/png'), width, height }
    })
  } finally { bitmap.close() }
}
export async function ensureMaterialSamples(id: string, designId: string, progress: (text: string) => void): Promise<void> {
  progress('正在准备主图材质参考…')
  const current = await etsyCall<EtsyProduct>('get', { id })
  const previous = current.finalDesigns?.find(design => design.id === designId)
  const confirmUnknown = previous?.materialPlanning?.status === 'unknown'
  if (confirmUnknown && !window.confirm('上次主图材质分析结果不明，确认重新分析？')) throw new Error('未重复提交材质分析')
  let product = await etsyCall<EtsyProduct>('prepare-material', { id, designId, confirmUnknown })
  const deadline = Date.now() + 310_000
  for (;;) {
    const design = product.finalDesigns?.find(value => value.id === designId)
    if (!design) throw new Error('当前主设计已变化，请重新选择')
    if (product.cancelled) throw new Error('材质准备已停止，未提交角度生图')
    if (design.materialReference?.samples.length) return
    if (design.materialReference) {
      progress('正在读取主图原始材质局部…')
      const samples = await cropMaterialSamples(product, design)
      await etsyCall('attach-material-samples', { id, designId, sourceImageId: design.imageId, samples })
      return
    }
    if (!design.materialPlanning || !['queued', 'running'].includes(design.materialPlanning.status)) throw new Error(design.materialPlanning?.error ?? '主图材质参考未就绪')
    if (Date.now() > deadline) throw new Error('材质准备仍在进行，请稍后查看状态；没有重复提交生图')
    await new Promise(resolve => setTimeout(resolve, 500))
    const list = await etsyCall<EtsyProduct[]>('list'); const current = list.find(value => value.id === id)
    if (!current) throw new Error('当前项目已移除'); product = current
  }
}

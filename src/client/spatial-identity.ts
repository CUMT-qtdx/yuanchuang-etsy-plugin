import type { EtsyProduct } from '../etsy/types.ts'
import { etsyCall } from './etsy-api.ts'

// 旧项目仅在用户主动生成、修正或检查时补查一次位置；不因打开页面触发模型。
export async function ensureSpatialIdentity(id: string, designId: string, progress: (text: string) => void): Promise<void> {
  let product = await etsyCall<EtsyProduct>('get', { id })
  let design = product.finalDesigns?.find(value => value.id === designId)
  if (design?.spec?.spatial) return
  if (!design?.spec) return
  const confirmUnknown = design.planning.status === 'unknown'
  if (confirmUnknown && !window.confirm('上次主图位置分析结果不明，确认重新分析？')) throw new Error('未重复提交位置分析')
  progress('正在核对主图的配件位置，仅首次补查…')
  product = await etsyCall<EtsyProduct>('prepare-spatial', { id, designId, confirmUnknown })
  const deadline = Date.now() + 150_000
  for (;;) {
    design = product.finalDesigns?.find(value => value.id === designId)
    if (!design || product.cancelled) throw new Error('位置核对已停止，未提交生图')
    if (design.spec?.spatial) return
    if (!['queued','running'].includes(design.planning.status)) throw new Error(design.planning.error ?? '没有获得主图位置，未提交生图')
    if (Date.now() > deadline) throw new Error('位置分析仍在进行，请稍后查看；未重复提交生图')
    await new Promise(resolve => setTimeout(resolve, 500))
    product = await etsyCall<EtsyProduct>('get', { id })
  }
}

import type { EtsyCopy, EtsyProduct, ProductImage, Stage } from './types.ts'
import { listingUsesEnglish } from './copy-style.ts'

// 统一前端、导出与宿主的图片文案关联检查，不能用上一张图片的稿件兜底。
export function selectedCopy(product?: EtsyProduct): EtsyCopy | undefined {
  if (!product) return undefined
  const selected = product.selectedImageId ?? product.images.find(image => image.generation.status === 'completed')?.id
  const revision = product.factsRevision ?? 1
  if (product.copyMode === 'per-image') {
    const image = product.images.find(image => image.id === selected), cache = selected ? product.imageCopies?.[selected] : undefined
    const partial = !!cache?.copy.fieldIssues?.length
    const stageReadable = image?.copyStage?.status === 'completed' || (partial && ['running', 'failed', 'unknown', 'cancelled'].includes(image?.copyStage?.status ?? ''))
    return stageReadable && cache?.factsRevision === revision && (image?.copyFactsRevision === undefined || image?.copyFactsRevision === revision) && listingUsesEnglish(cache.copy) ? cache.copy : undefined
  }
  return (!product.copyImageId || product.copyImageId === selected) && (product.copyFactsRevision ?? 1) === revision && product.copy && listingUsesEnglish(product.copy) ? product.copy : undefined
}
export function imageCopyStage(product: EtsyProduct, image?: ProductImage): Stage {
  const saved = image ? product.imageCopies?.[image.id]?.copy ?? (product.copyImageId === image.id ? product.copy : undefined) : undefined
  const revision = product.factsRevision ?? 1
  const cached = image ? product.imageCopies?.[image.id] : undefined
  const stage = image?.copyStage ?? (image?.id === product.copyImageId ? product.copyStage : undefined)
  const completed = product.copyMode === 'per-image' ? stage?.status === 'completed' : !!cached || stage?.status === 'completed'
  if (completed) {
    // 完成标记不等于当前资料版本有效；显示状态与实际可读取内容必须一致。
    const sourceRevision = cached?.factsRevision ?? product.copyFactsRevision ?? 1
    const targetRevision = image?.copyFactsRevision ?? sourceRevision
    const error = !saved ? '当前图片缺少已保存文案，请重新准备'
      : sourceRevision !== revision || targetRevision !== revision ? '商品资料已更新，请重新准备当前图片的文案'
      : !listingUsesEnglish(saved) ? '旧稿不是英文，请重新准备英文标题和文案' : undefined
    if (error) return { status: 'skipped', attempts: stage?.attempts ?? 0, error }
  }
  if (product.copyMode === 'per-image') return stage ?? { status: 'skipped', attempts: 0 }
  if (image?.id === product.copyImageId) return product.copyStage
  const cache = image ? product.imageCopies?.[image.id] : undefined
  if (cache?.factsRevision === (product.factsRevision ?? 1)) return { status: 'completed', attempts: 0 }
  return image?.id === product.selectedImageId ? product.copyStage : { status: 'skipped', attempts: 0 }
}
export function productStages(product: EtsyProduct): Stage[] {
  return [product.planning, product.copyStage, ...(product.finalDesigns ?? []).flatMap(design => [design.planning, design.materialPlanning]), ...product.images.flatMap(image => [image.generation, image.quality, image.copyStage])].filter((stage): stage is Stage => !!stage)
}

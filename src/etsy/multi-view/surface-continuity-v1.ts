import type { MultiViewContext } from './consistency-v1.ts'
import type { GenerateRequest } from '../../protocol.ts'
import type { StudioModelChoices } from '../types.ts'
import { directionFor, directionPrompt } from './view-direction-v1.ts'

// 首次侧背面只编辑完整主图的拍摄视角；不把局部放大图或材质分析长文重新当作生成目标。
export const SURFACE_CONTINUITY_MODULE = 'hero_surface_continuity_v1_0'
export const isSideBack = (angle: string | undefined): boolean => ['left', 'right', 'back'].includes(angle ?? '')
export function firstPassSurfacePrompt(context: MultiViewContext): string {
  const view = context.angle === 'back' ? 'a straight rear view (180 degrees from the original frontal position)'
    : `a full side profile showing the product's anatomical ${directionFor(context.angle)?.visibleSide} side (90 degrees from the original frontal position)`
  return [
    `[${SURFACE_CONTINUITY_MODULE}]`,
    directionPrompt(context.angle, context.identity, context.references.find(reference => reference.role === 'view-direction-guide')?.image),
    `Show this exact photographed product from ${view}. Keep the same pose and attached accessories.`,
    'Treat the original photo as the finished visual standard. Preserve its gentle optical softness, tonal transitions, original surface contrast and each component\'s exact finish. Do not reinterpret its material or increase detail, clarity, sharpness or surface relief. Match the original soft, dense, fine-fiber appearance at the same photographic scale, rather than outlining every strand. Same camera distance, subject height, image framing, background and window light. Only turn the product; output one photograph.',
    'Newly visible surfaces continue the material of their corresponding visible component. Keep any originally distinct layered, directional or mixed-material part distinct. Preserve its fine details at the same normal photographic scale.',
    'Keep all decorative motifs at the same physical positions. Stripes must remain stripes; do not replace them with dots.',
    'Preserve the existing silhouette and layered construction, including any rim divisions or folds. Do not add or remove body parts, tails, appendages, decorations or accessories.',
    context.fixedDetails.trim() ? `User fixed details, highest priority: ${context.fixedDetails.trim()}` : '',
    context.manualLocks?.length ? `User-confirmed details: ${context.manualLocks.join('; ')}` : '',
    context.anchor.photography.aspect_ratio !== 'auto' ? `Keep the same ${context.anchor.photography.aspect_ratio} frame.` : 'Keep the source aspect ratio.',
    `[/${SURFACE_CONTINUITY_MODULE}]`,
  ].filter(Boolean).join('\n')
}
export function chooseSurfaceModel(groups: StudioModelChoices['imageGroups'], preferred: Pick<GenerateRequest, 'channelId' | 'model'>, saved?: Pick<GenerateRequest, 'channelId' | 'model'>, catalogDefault?: Pick<GenerateRequest, 'channelId' | 'model'>): Pick<GenerateRequest, 'channelId' | 'model'> {
  const available = (choice: Pick<GenerateRequest, 'channelId' | 'model'>): boolean => groups.some(group => group.id === choice.channelId && group.models.includes(choice.model))
  if (saved && available(saved)) return saved
  // 宿主请求尚未刷新时，使用目录明确给出的当前模型，避免下拉框显示值与派发值不同。
  if (!available(preferred) && catalogDefault && available(catalogDefault)) return catalogDefault
  // 默认跟随当前图片模型；不再因存在Grok账号就自动切换。
  return preferred
}

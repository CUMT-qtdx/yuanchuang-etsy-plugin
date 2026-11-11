// 独立定稿多视角模式：按主图复制同一实物，不进入探索、材质转换或通用摄影重设。
import type { ViewAngle, IdentitySpec, ProductImage } from '../types.ts'
import type { PhotographySettings } from '../felt/photography-options.ts'
import type { FeltProfile } from '../felt/types.ts'
import { materialLockPrompt, type MaterialReference } from './material-lock-v1.ts'
import { directionPrompt, type ViewDirection } from './view-direction-v1.ts'
export const MULTI_VIEW_VERSION = '1.0'
export const MULTI_VIEW_MODULE = 'multi_view_consistency_v1_0'
export const viewCheckLabels = { identity: '同一件产品', composition: '占比与取景', material: '材质与精致度', accessories: '配件与位置', photography: '背景与光照' } as const
export type ViewCheckKey = keyof typeof viewCheckLabels
export interface ViewCheck { status: 'PASS' | 'REVISE' | 'UNKNOWN'; evidence: string }
export type ViewChecks = Record<ViewCheckKey, ViewCheck>
export interface MultiViewAnchor {
  version: '1.0'
  imageId: string
  photography: PhotographySettings
  profile: FeltProfile
  inheritedModules: Record<string, string>
  quality?: string
  detail?: string
}
export interface MultiViewContext {
  anchor: MultiViewAnchor
  angle: ViewAngle
  fixedDetails: string
  identity: IdentitySpec
  correction?: string
  materialReference?: MaterialReference
  materialRepair?: boolean
  surfaceStrategy?: 'hero-direct-v1'
  manualLocks?: string[]
  direction?: ViewDirection
  oppositeViewId?: string
  exactOppositeDuplicate?: boolean
  references: Array<{ image: number; id: string; role: 'identity-anchor' | 'view-direction-guide' | 'material-detail' | 'angle-correction' | 'human-confirmed' | 'ai-checked' | 'hidden-structure' | 'opposite-view-check' }>
}
export const turntableOrder: ViewAngle[] = ['left', 'right', 'back', 'three-quarter', 'front']
const angles: Record<ViewAngle, string> = { front: 'straight front view', left: "face toward screen-right, the product's anatomical right side in full profile", right: "face toward screen-left, the product's anatomical left side in full profile", back: 'straight back view', 'three-quarter': 'front three-quarter view' }
export function normalizeViewChecks(value: unknown): ViewChecks {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return Object.fromEntries(Object.keys(viewCheckLabels).map(key => {
    const item = raw[key] && typeof raw[key] === 'object' ? raw[key] as Record<string, unknown> : {}
    const evidence = typeof item.evidence === 'string' ? item.evidence.trim().slice(0, 2000) : ''
    return [key, { status: evidence && ['PASS', 'REVISE', 'UNKNOWN'].includes(String(item.status)) ? item.status : 'UNKNOWN', evidence: evidence || '模型未返回该项依据，需要人工核对' }]
  })) as ViewChecks
}
export function isCheckedReference(image: ProductImage, revision: number): boolean {
  if (image.generation.status !== 'completed' || !image.files.length || (image.identityRevision ?? 1) !== revision) return false
  if (image.viewApproved) return true
  if (image.report?.viewpointCheck && image.report.viewpointCheck.status !== 'PASS') return false
  return image.quality.status === 'completed' && image.report?.status === 'PASS' && !!image.report.viewChecks && Object.values(normalizeViewChecks(image.report.viewChecks)).every(check => check.status === 'PASS')
}
export function multiViewPrompt(context: MultiViewContext): string {
  const photo = context.anchor.photography
  return [
    `[${MULTI_VIEW_MODULE}]`,
    context.materialRepair ? '' : directionPrompt(context.angle, context.identity, context.references.find(reference => reference.role === 'view-direction-guide')?.image),
    materialLockPrompt(context.materialReference, context.materialRepair),
    'MODE: Turntable-style multi-view generation of ONE approved physical product. This is not redesign, a same-family variation, creative expansion, material conversion or a new concept.',
    'Rotate the same physical product in space; do not redesign, restyle, beautify, simplify, or reinterpret it.',
    'IDENTITY ANCHOR: Image 1 is the sole identity and visual-quality anchor. Its actual visible appearance overrides all auxiliary references and generic style defaults. Keep the same product geometry and pose; only the requested observation angle changes. Keep the photographic environment and camera height, distance, lens perspective and lighting setup fixed.',
    `REQUESTED VIEW: ${angles[context.angle]}. UI slots use the hero's screen sides; anatomical left/right always refer to the product itself. Never produce mirrored copies. Render one complete product in one image, not a collage, contact sheet or labeled diagram.`,
    context.fixedDetails.trim() ? `HIGHEST-PRIORITY FIXED DETAILS FROM USER: ${context.fixedDetails.trim()}. These lock details of the same approved product; do not treat them as instructions to invent another product.` : '',
    `OBSERVED IDENTITY CARD: ${JSON.stringify({ summary: context.identity.summary, locks: context.identity.locks })}. User fixed details take precedence if a card description is mistaken.`,
    'IDENTITY LOCK: Preserve silhouette in three dimensions, body type, internal proportions, pose, facial features, hat shape, collar construction, colour placement, accessory type/count/placement, flower placement, surface motifs and attachment points. Occlusion may change with the view; the underlying object must not. Stripes must remain stripes and dots must remain dots, at the same physical locations.',
    'MATERIAL AND DETAIL LOCK: Preserve the exact needle-felted wool appearance seen in the approved image: felt density, visible fiber length and direction, matte softness, edge thickness and part-specific finishes. Do not make side or back views fuzzier, coarser, smoother, lower-detail or more generic. Preserve all mixed-material accessories and existing minute construction details. Match the hero image quality instead of applying a new generic felt texture.',
    `CAMERA AND COMPOSITION LOCK: ${photo.aspect_ratio === 'auto' ? 'Match the approved image aspect ratio.' : `Keep the same ${photo.aspect_ratio} aspect ratio.`} Keep the same camera distance, camera height, approximate whole-product scale in frame, negative space and framing. ${photo.framing_policy === 'override_reference' ? `The saved hero-image occupancy target is approximately ${Math.round(photo.subject_height_ratio * 100)}%; match the actual approved image, not a freshly resized composition.` : 'Use the actual approved image framing as the scale reference.'} Never shrink the head, hat or body independently. Keep the complete product visible; view-dependent silhouette width may change naturally, so preserve camera distance rather than stretching anatomy to force an exact bounding box.`,
    'PHOTOGRAPHY LOCK: Keep the exact background type, tabletop/support material, wall, scene layout, lighting style and mood visible in Image 1. If the hero uses soft side-window daylight, preserve its softness, direction and colour balance. Do not add a wooden table or wall to a white or custom background. Keep physically consistent contact shadows and object scale as the product rotates. Keep the entire product sharply readable at the same level of detail, with the same background softness.',
    `HIDDEN SURFACES: ${context.identity.unseen.length ? `Not established by the master: ${context.identity.unseen.join('; ')}.` : 'Anything not visible in the master remains uncertain.'} Make the most conservative continuation of known geometry and patterns. Do not invent unsupported decorations, ornaments, seams, extra limbs or accessories. Any inferred structure must remain clearly marked as uncertain in later review.`,
    `REFERENCE ROLES: ${JSON.stringify(context.references)}. Material-detail images are cropped original hero pixels, surface references only. Other angles provide supporting hidden-surface geometry only, never a competing material/style anchor. Uploaded structural references must not transfer their material, background, colour scheme or ornaments. The master always remains Image 1.`,
    context.correction ? `LOCAL ANGLE CORRECTION: ${context.correction}. Correct this angle toward the master and fixed details; keep its requested viewing direction. Do not redesign the approved master or re-stage the photo. Product redesigns belong in main-image refinement first.` : '',
    'OUTPUT: Same physical product, same workmanship and photography, new observation angle only. No typography, watermark, labels or added scene objects.',
    `[/${MULTI_VIEW_MODULE}]`,
  ].filter(Boolean).join('\n')
}
export const multiViewReviewInstructions = `[${MULTI_VIEW_MODULE}:review]
你在检查同一件已定稿商品的转台多角度图。第一张为待检结果，第二张为唯一主图身份与画质基准，后续只辅助判断隐藏结构。不能沿用探索阶段允许换姿态、比例或配件的标准。
逐项比较并返回viewChecks:{identity:{status,evidence},composition:{status,evidence},material:{status,evidence},accessories:{status,evidence},photography:{status,evidence}}。每项status仅为PASS、REVISE或UNKNOWN，并给出可见证据；无法确认必须UNKNOWN。检查①是不是同一件商品、姿态和比例是否改变；②主体整体占比、相机距离、留白与取景是否漂移；③毡化密度、纤维、哑光、边缘厚度与精致度是否退化；④配件数量、位置及连接有无缺失/改动；⑤背景、桌面、光向、色温、接触阴影是否变化。区分视角遮挡与实际丢失，不能要求侧面呈现正面的相同二维轮廓。占比是视觉近似判断，不声称像素测量。未展示的隐藏面只能列为不确定；AI判断是建议，不视为人工验收。`

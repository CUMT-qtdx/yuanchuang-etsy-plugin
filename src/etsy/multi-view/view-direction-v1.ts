import type { IdentitySpec, ViewAngle } from '../types.ts'
import { spatialPrompt, type SpatialCheck } from './spatial-v1.ts'

// 左/右按主图画面的观察位置标注；角色自身左右另行计算，避免持物侧与转身方向相互矛盾。
export const VIEW_DIRECTION_MODULE = 'product_view_direction_v1_0'
export interface ViewDirection {
  version: '1.0'
  angle: 'left' | 'right'
  expectedFacing: 'screen-left' | 'screen-right'
  visibleSide: 'left' | 'right'
}
export interface ViewpointCheck {
  status: 'PASS' | 'REVISE' | 'UNKNOWN'
  expectedFacing: ViewDirection['expectedFacing']
  observedFacing: 'screen-left' | 'screen-right' | 'front' | 'back' | 'uncertain'
  profile: 'full-side' | 'three-quarter' | 'front' | 'back' | 'uncertain'
  handedness: 'consistent' | 'swapped' | 'uncertain' | 'not-applicable'
  pairRelation: 'opposite' | 'same-facing' | 'mirrored' | 'uncertain' | 'not-provided'
  evidence: string
  pairImageId?: string
  spatialChecks?: SpatialCheck[]
}
export function directionFor(angle: ViewAngle): ViewDirection | undefined {
  if (angle !== 'left' && angle !== 'right') return
  return { version: '1.0', angle, visibleSide: angle === 'left' ? 'right' : 'left', expectedFacing: angle === 'left' ? 'screen-right' : 'screen-left' }
}
export function directionPrompt(angle: ViewAngle, identity: IdentitySpec, guideImage?: number): string {
  const contract = directionFor(angle)
  if (!contract) return ''
  const left = angle === 'left', toward = left ? 'RIGHT' : 'LEFT', away = left ? 'LEFT' : 'RIGHT'
  const nearSide = contract.visibleSide
  return [
    `[${VIEW_DIRECTION_MODULE}]`,
    guideImage ? `Image ${guideImage} is a DIRECTION-ONLY DIAGRAM. Follow its face direction and arrow. Do NOT copy its gray shape, nose, eye, proportions, text or arrow; keep the approved product from Image 1. The diagram is not another character or material reference.` : '',
    `MANDATORY SCREEN DIRECTION: the character's face/nose/chest must point toward the ${toward} EDGE of the OUTPUT IMAGE. Show a full 90-degree side profile, with the product's anatomical ${nearSide.toUpperCase()} side nearest the camera. Its back is toward the ${away} edge. The UI slot names left/right refer to the original hero's screen sides, NOT anatomical sides. The other side-view slot has the opposite screen direction; do not generate the same facing direction for both.`,
    `The anatomical ${nearSide} shoulder/arm/cheek is on the camera-facing side; the opposite arm and accessories are on the far side and may be occluded. Turn the ENTIRE rigid product, not just its head. For non-character products, point the defined product front toward the ${toward} image edge.`,
    spatialPrompt(identity.spatial, angle),
    'Keep every object attached to the SAME anatomical hand/body side. Do not exchange hands to keep an accessory on its old screen side. This is a new physical view, NEVER a horizontal flip of the photo. Keep the background and light orientation fixed. A front-facing pose description in the identity card describes the original camera view, not a ban on turning the product.',
    `[/${VIEW_DIRECTION_MODULE}]`,
  ].filter(Boolean).join('\n')
}
const choose = <T extends string>(value: unknown, values: readonly T[], fallback: T): T => typeof value === 'string' && values.includes(value as T) ? value as T : fallback
export function validateViewpoint(value: unknown, contract: ViewDirection, pairImageId?: string, exactDuplicate = false): ViewpointCheck {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const observedFacing = choose(raw.observedFacing, ['screen-left', 'screen-right', 'front', 'back', 'uncertain'] as const, 'uncertain')
  const profile = choose(raw.profile, ['full-side', 'three-quarter', 'front', 'back', 'uncertain'] as const, 'uncertain')
  const handedness = choose(raw.handedness, ['consistent', 'swapped', 'uncertain', 'not-applicable'] as const, 'uncertain')
  const pairRelation = pairImageId ? choose(raw.pairRelation, ['opposite', 'same-facing', 'mirrored', 'uncertain', 'not-provided'] as const, 'uncertain') : 'not-provided'
  let evidence = typeof raw.evidence === 'string' ? raw.evidence.trim().slice(0, 2000) : ''
  const wrong = exactDuplicate || observedFacing !== 'uncertain' && observedFacing !== contract.expectedFacing || ['three-quarter', 'front', 'back'].includes(profile) || handedness === 'swapped' || ['same-facing', 'mirrored'].includes(pairRelation)
  let status: ViewpointCheck['status'] = wrong ? 'REVISE' : evidence && observedFacing === contract.expectedFacing && profile === 'full-side' && ['consistent', 'not-applicable'].includes(handedness) && (!pairImageId || pairRelation === 'opposite') ? 'PASS' : 'UNKNOWN'
  if (exactDuplicate) evidence = '左右两张返回了相同图片文件，不能作为不同侧面。' + (evidence ? ` ${evidence}` : '')
  if (!evidence) evidence = wrong ? '观察到的画面朝向或侧面形态与该角度要求不符。' : '视角检查缺少明确的朝向、持物侧或成对比较依据。'
  return { status, expectedFacing: contract.expectedFacing, observedFacing, profile, handedness, pairRelation, evidence, ...(pairImageId ? { pairImageId } : {}) }
}
export const directionReviewInstructions = `[${VIEW_DIRECTION_MODULE}:review]
先独立辨认待检图到底朝哪边，再读取标签，不得因为任务名为left/right就说正确。额外返回viewpointCheck:{observedFacing,profile,handedness,pairRelation,evidence}。
observedFacing是脸/鼻/胸朝向画面哪边：screen-left/screen-right/front/back/uncertain。profile为full-side/three-quarter/front/back/uncertain。handedness为consistent/swapped/uncertain/not-applicable，确认持物仍在角色自身同一只手。pairRelation为opposite/same-facing/mirrored/uncertain/not-provided，只在提供opposite-view-check参考时判断两张是否相反；该图仅用于比较，绝不作为材质或身份基准。
界面左右按主图画面标注：左侧槽要求脸朝画面右、角色自身右侧在近侧；右侧槽要求脸朝画面左、角色自身左侧在近侧。这是刚体转身的正常几何关系，不能把槽名当成解剖左右。两张都朝画面同一边就是失败，即使材质和形象很像。只是水平镜像导致持物换手或背景/光源左右交换也不通过。真实转身会改变配件在画面中的位置和遮挡，这是正常的；不能把“主图正面站立”当成禁止换视角的姿态锁定。帽檐遮住脸导致无法判断时填uncertain，不假装通过。evidence简述观察到的朝向、近侧手和另一张图的关系。`

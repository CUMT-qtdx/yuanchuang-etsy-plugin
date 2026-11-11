import type { ViewAngle } from '../types.ts'
import type { QualityReport } from '../types.ts'

// 先记录主图画面坐标，再由代码换算角色自身左右，避免视觉模型直接把两种左右混用。
export interface SpatialIdentity {
  version: '1.0'
  sourceFacing: 'front' | 'back' | 'other' | 'uncertain'
  anchors: Array<{ label: string; screenSide: 'left' | 'right' | 'center' | 'uncertain'; attachment: string; evidence: string }>
}
export interface SpatialExpectation { label: string; bodySide: 'left' | 'right'; visibility: 'near' | 'far'; attachment: string }
export interface SpatialCheck { label: string; expected: 'near' | 'far'; observed: 'near' | 'far' | 'uncertain'; status: 'PASS' | 'REVISE' | 'UNKNOWN'; evidence: string }
export function normalizeSpatial(value: unknown): SpatialIdentity | undefined {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  if (!['front', 'back', 'other', 'uncertain'].includes(String(raw.sourceFacing)) || !Array.isArray(raw.anchors)) return
  const anchors: SpatialIdentity['anchors'] = []
  for (const value of raw.anchors.slice(0, 6)) {
    const a = value && typeof value === 'object' ? value as Record<string, unknown> : {}
    if (typeof a.label !== 'string' || !a.label.trim() || typeof a.evidence !== 'string' || !a.evidence.trim() || !['left','right','center','uncertain'].includes(String(a.screenSide))) continue
    anchors.push({ label: a.label.trim().slice(0, 100), screenSide: a.screenSide as SpatialIdentity['anchors'][number]['screenSide'], attachment: typeof a.attachment === 'string' ? a.attachment.slice(0, 160) : '', evidence: a.evidence.trim().slice(0, 500) })
  }
  // 成对的同名纽扣等不是非对称锚点；否则同一个名称会同时被要求在近侧和远侧。
  const unique = anchors.filter((anchor, index) => !anchors.some(other => other.label === anchor.label && other.screenSide !== anchor.screenSide) && anchors.findIndex(other => other.label === anchor.label) === index)
  return { version: '1.0', sourceFacing: raw.sourceFacing as SpatialIdentity['sourceFacing'], anchors: unique }
}
export function spatialExpectations(spatial: SpatialIdentity | undefined, angle: ViewAngle): SpatialExpectation[] {
  spatial = normalizeSpatial(spatial)
  if (!spatial || !['front','back'].includes(spatial.sourceFacing) || !['left','right'].includes(angle)) return []
  return spatial.anchors.flatMap(anchor => {
    if (anchor.screenSide !== 'left' && anchor.screenSide !== 'right') return []
    const bodySide = spatial.sourceFacing === 'front' ? anchor.screenSide === 'left' ? 'right' : 'left' : anchor.screenSide
    const nearSide = angle === 'left' ? 'right' : 'left'
    return [{ label: anchor.label, bodySide, visibility: bodySide === nearSide ? 'near' : 'far', attachment: anchor.attachment }]
  })
}
export function spatialPrompt(spatial: SpatialIdentity | undefined, angle: ViewAngle): string {
  const expected = spatialExpectations(spatial, angle)
  return [
    '[product_spatial_v1_0]',
    spatial ? `SOURCE-PHOTO OBSERVATIONS (screen coordinates, not anatomical sides): ${JSON.stringify(normalizeSpatial(spatial))}.` : 'Derive accessory attachment sides from the actual hero image. Legacy AI-written left/right words may confuse screen sides with body sides; do not use them to override the photo.',
    ...expected.map(a => `${a.label}: attached to the product's OWN ${a.bodySide.toUpperCase()} side (${a.attachment}). In this requested view it is on the ${a.visibility.toUpperCase()} side. ${a.visibility === 'far' ? 'The body naturally occludes a far-side attachment; allow only physically visible edges beyond the silhouette. NEVER bring it in front of the near arm or move it to the near hip merely to display it.' : 'Keep it attached to the near side; do not move it across the body.'}`),
    'Rotate the whole physical assembly, including body, garments, straps and attached objects. Preserve original attachment points and counts even where occluded. Occlusion is not removal. A turned face alone does not prove correct accessory placement.',
    '[/product_spatial_v1_0]',
  ].join('\n')
}
export function spatialLocks(locks: string[], spatial?: SpatialIdentity): string[] {
  if (!spatial || !['front','back'].includes(spatial.sourceFacing)) return locks
  const neutral = locks.map(lock => lock.replace(/(?:角色自身)?[左右](?=手|臂|肩|腰|腿|耳|眼|脚|侧)/g, '主图对应的').replace(/\b(?:left|right)\s+(?=hand|arm|shoulder|hip|leg|ear|eye|side)/gi, 'original '))
  return [...neutral, ...(normalizeSpatial(spatial)?.anchors ?? []).map(a => `主图画面${a.screenSide === 'left' ? '左' : a.screenSide === 'right' ? '右' : '中间或不确定'}侧：${a.label}；连接位置：${a.attachment}；可见依据：${a.evidence}`)]
}
export function validateSpatialChecks(value: unknown, expected: SpatialExpectation[]): SpatialCheck[] {
  const rows = Array.isArray(value) ? value : []
  return expected.map(a => {
    const row = rows.find(v => v && typeof v === 'object' && v.label === a.label) ?? {}
    const observed = ['near','far'].includes(row.observed) ? row.observed as 'near' | 'far' : 'uncertain'
    const evidence = typeof row.evidence === 'string' ? row.evidence.trim().slice(0, 1000) : ''
    return { label: a.label, expected: a.visibility, observed, evidence: evidence || '没有逐项判断配件在身体近侧还是远侧，不能只凭脸朝向确认通过。', status: observed === 'uncertain' || !evidence ? 'UNKNOWN' : observed === a.visibility ? 'PASS' : 'REVISE' }
  })
}
export function reconcileSpatialReview(report: QualityReport, previous: QualityReport[]): QualityReport {
  const current = report.viewpointCheck
  if (!current) return report
  const conflicts = previous.some(old => {
    const prior = old.viewpointCheck
    if (!prior) return false
    if (['screen-left','screen-right'].includes(prior.observedFacing) && ['screen-left','screen-right'].includes(current.observedFacing) && prior.observedFacing !== current.observedFacing) return true
    return current.spatialChecks?.some(check => check.observed !== 'uncertain' && prior.spatialChecks?.some(before => before.label === check.label && before.expected === check.expected && before.observed !== 'uncertain' && before.observed !== check.observed))
  })
  if (!conflicts) return report
  const warning = '同一图片的多次AI检查在朝向或配件遮挡上给出相反结论，不能靠重查确认通过，请对照主图人工核对。'
  return { ...report, status: report.status === 'REJECT' ? 'REJECT' : 'UNKNOWN', reviewConflict: warning, summary: warning, viewpointCheck: { ...current, status: 'UNKNOWN', evidence: warning + ' 本次模型判断：' + current.evidence } }
}
export const spatialAnalysisInstructions = `另加 spatial:{sourceFacing:front|back|other|uncertain,anchors:[{label,screenSide:left|right|center|uncertain,attachment,evidence}]}。先只看主图画面：左边是图像左边，右边是图像右边，禁止直接填写角色自身左右。记录最多6个可追踪的非对称物件（挎包、篮子、手持物、徽章等），label只写物件名称；attachment写实际连接的手/腰/肩/头等，不带左右；evidence写可见画面位置及连接关系。不确定则如实标记。正面图中画面左侧对应角色自身右侧，换算由程序负责；locks不要另写解剖左右结论。` 

// 定稿后的材质参考独立于通用羊毛毡规则：只描述和采样主图已经呈现的表面。
export const MATERIAL_LOCK_MODULE = 'approved_material_lock_v1_0'
export interface MaterialRegion { label: string; box: [number, number, number, number]; appearance: string }
export interface MaterialAppearance { version: '1.0'; summary: string; regions: MaterialRegion[] }
export interface MaterialReference { sourceImageId: string; fingerprint: MaterialAppearance; samples: Array<{ file: string; region: MaterialRegion; width: number; height: number }>; createdAt: number }
export const materialCriteria = { fiberScale: '纤维粗细与长度', density: '压实度与孔隙', surface: '短绒与卷圈', edges: '边缘厚度与毛晕', finish: '哑光与微观对比' } as const
export type MaterialComparison = Record<keyof typeof materialCriteria, { status: 'MATCH' | 'DRIFT' | 'UNKNOWN'; evidence: string }>
export function normalizeMaterialAppearance(value: unknown): MaterialAppearance | undefined {
  if (!value || typeof value !== 'object') return
  const raw = value as Record<string, unknown>
  if (typeof raw.summary !== 'string' || !raw.summary.trim() || !Array.isArray(raw.regions)) return
  const regions: MaterialRegion[] = []
  for (const item of raw.regions.slice(0, 2)) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>, box = row.box
    if (typeof row.label !== 'string' || !row.label.trim() || typeof row.appearance !== 'string' || !row.appearance.trim() || !Array.isArray(box) || box.length !== 4 || box.some(number => typeof number !== 'number' || !Number.isFinite(number))) continue
    const [x, y, width, height] = box as number[]
    if (x < 0 || y < 0 || width < 60 || height < 60 || width > 550 || height > 550 || x + width > 1000 || y + height > 1000) continue
    regions.push({ label: row.label.trim().slice(0, 60), box: [x, y, width, height], appearance: row.appearance.trim().slice(0, 800) })
  }
  if (!regions.length) return
  return { version: '1.0', summary: raw.summary.trim().slice(0, 1200), regions }
}
export function normalizeMaterialComparison(value: unknown): MaterialComparison {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return Object.fromEntries(Object.keys(materialCriteria).map(key => {
    const row = raw[key] && typeof raw[key] === 'object' ? raw[key] as Record<string, unknown> : {}
    const evidence = typeof row.evidence === 'string' ? row.evidence.trim().slice(0, 1600) : ''
    return [key, { status: evidence && ['MATCH', 'DRIFT', 'UNKNOWN'].includes(String(row.status)) ? row.status : 'UNKNOWN', evidence: evidence || '缺少可见对比依据' }]
  })) as MaterialComparison
}
export const materialAnalysisInstructions = `[${MATERIAL_LOCK_MODULE}:analysis]
只观察这张已批准主图已经呈现的材质，不能重新定义更理想的毛毡。输出JSON {summary,regions:[{label,box:[x,y,width,height],appearance}]}。
summary具体说明纤维粗细和长度、压实程度、孔隙、短绒/卷圈、哑光和边缘。不使用“真实、精致、高质量”替代可见描述。
选择最多2块可清楚看见材质差异的主体局部，优先身体/脸部以外的躯干表面与帽片/衣服等主要部件。每块区域内部应大部分为对应材质，避开珠眼、枝条、背景和轮廓外空气；不把不同部件、整个头或全身框为一个材质样本。box使用整图0到1000归一化坐标，左上角为原点，严格按[x,y,宽,高]，宽高各60到550且不越界。只给实际存在且能辨认的部件，最多2块，不能凭空填头发或胡须。
appearance分别写每个区域的已观察纤维形态、致密程度和边缘。如果主图是细短压实纤维，要明确区分于明显粗长丝、卷曲线圈、网状/丝瓜络孔洞；如果主图本来就是卷毛则如实记录，不能统一改成光滑毡面。`
export function materialLockPrompt(reference?: MaterialReference, repair = false): string {
  return [
    `[${MATERIAL_LOCK_MODULE}]`,
    'MATERIAL SOURCE: Only the APPROVED HERO and its source-pixel material swatches define surface appearance. Match the photographed material itself, not an imagined ideal needle-felt texture. Other views are geometry references only and must never donate their texture.',
    reference ? `OBSERVED HERO SURFACES: ${JSON.stringify(reference.fingerprint)}. The material-detail references are exact unsharpened crops of this hero, shown at source pixel scale; they are NOT larger fibers, extra objects, a new close-up composition or a different product.` : 'Read fine surface structure directly from the full-resolution approved hero; do not substitute a generic coarse felt material.',
    'Match fiber thickness and visible strand length relative to the physical component size, felting density, microscopic pore visibility, softness of diffuse light and edge halo. Preserve the distinct material of each existing component.',
    'Do not interpret higher detail as thicker fibers, stronger texture contrast, wiry loops, curls, tangled spaghetti, string mesh or loofah-like pores. Do not add such patterns where the hero shows compact fine short fibers. Do not smooth away real short fibers or change mixed-material accessories. Preserve genuine curls only where they already exist in the hero.',
    repair ? 'MATERIAL-ONLY REPAIR: Keep the current-angle image geometry, camera angle, face, silhouette, pose, hat/garment construction, leaf/petal count, accessories, background, lighting and framing. Replace only the mismatched surface microtexture with the corresponding hero material. Do not turn the current angle back into the hero view. No new decorations, no extra sharpening or dramatic contrast.' : 'As unseen surfaces become visible, continue the same part-specific material. New visibility does not justify coarser felting, stronger strand outlines or newly exposed loop patterns.',
    `[/${MATERIAL_LOCK_MODULE}]`,
  ].join('\n')
}
export const materialReviewInstructions = `[${MATERIAL_LOCK_MODULE}:review]
材质必须单独比主图，不因颜色/角色相似就给PASS。先看主图及标注的原始材质局部，再看待检图对应部件，按部件物理尺度比较，不能把局部截图的放大视野误认为纤维变粗。
额外返回materialComparison:{fiberScale:{status,evidence},density:{status,evidence},surface:{status,evidence},edges:{status,evidence},finish:{status,evidence}}。status只用MATCH/DRIFT/UNKNOWN，evidence明确写“主图怎样，待检图怎样”。分别比较粗细与长度、压实度与孔隙、短绒与卷圈、边缘厚度/毛晕、哑光与微观对比。检查主图细短纤维是否变成粗卷曲线圈、蛛网/丝瓜络状孔隙，帽片是否变硬/显著过锐，身体是否过度强调每条毛丝。不将这些变化称为正常更高清。无法比较填UNKNOWN。只要一项DRIFT，viewChecks.material必须REVISE；存在UNKNOWN则不能断言材质通过。issues中出现材质退化问题时，不能同时给材质PASS。`

import type { FeltProfile, MaterialComponent, MaterialComponentCategory, MaterialPreset, MaterialRegion } from './types.ts'

// 显式保存的 v1.0 始终走旧规则；缺少预设的旧项目重试和精修采用当前通用模板。
export const EXPERIMENTAL_MATERIAL = 'needle_felt_v1_0_2' as const
export const DEFAULT_MATERIAL = 'needle_felt_v1_0' as const
export const CURRENT_MATERIAL = 'needle_felt_v2_0' as const
export const MATERIAL_REVISION = '3' as const
export function normalizeMaterialPreset(value: unknown): MaterialPreset {
  if (value === undefined) return DEFAULT_MATERIAL
  if (value === DEFAULT_MATERIAL || value === EXPERIMENTAL_MATERIAL || value === CURRENT_MATERIAL) return value
  throw new Error('请选择有效的羊毛毡材质版本')
}
export const materialCategories: MaterialComponentCategory[] = ['sculpted_needle_felt', 'loose_wool_or_curly_fleece', 'flat_felt_sheet', 'woven_or_knitted_clothing', 'mixed_material_accessory']
const regions: MaterialRegion[] = ['body', 'face', 'ears', 'limbs', 'clothing', 'accessory']
const legacy: Record<string, [MaterialComponentCategory, MaterialRegion]> = {
  sculpted_felt_body: ['sculpted_needle_felt', 'body'], sculpted_felt_face: ['sculpted_needle_felt', 'face'],
  sculpted_felt_limbs: ['sculpted_needle_felt', 'limbs'], felt_accessories: ['sculpted_needle_felt', 'accessory'],
  woven_fabric_clothing: ['woven_or_knitted_clothing', 'clothing'], embroidered_details: ['mixed_material_accessory', 'accessory'],
  mixed_material_accessories: ['mixed_material_accessory', 'accessory'],
}
export function materialRegion(part: string): MaterialRegion | undefined {
  if (/裙|衣|围裙|帽|围巾|\b(?:dress|pinafore|garment|clothing|coat|apron|hat|scarf)\b/i.test(part)) return 'clothing'
  if (/眼|鼻|刺绣|针脚|\b(?:eyes?|nose|embroidery|stitches|buttons?|ribbons?)\b/i.test(part)) return 'accessory'
  if (/脸|头部|\b(?:face|head)\b/i.test(part)) return 'face'
  if (/耳|\bears?\b/i.test(part)) return 'ears'
  if (/四肢|手臂|腿|脚|爪|鳍|\b(?:limbs?|arms?|legs?|paws?|feet|flippers?)\b/i.test(part)) return 'limbs'
  if (/身体|主体|躯干|\b(?:body|torso)\b/i.test(part)) return 'body'
}
export function normalizeMaterialComponents(value: unknown): MaterialComponent[] {
  if (!Array.isArray(value)) return []
  const result = new Map<string, MaterialComponent>()
  for (const item of value.slice(0, 30)) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>, old = legacy[String(row.category)]
    const category = old?.[0] ?? row.category as MaterialComponentCategory
    if (!materialCategories.includes(category) || typeof row.part !== 'string' || !row.part.trim()) continue
    const part = row.part.trim().slice(0, 100)
    const namedCore = /^(?:rabbit\s+|兔子)?(?:head|face|head and face|body|torso|ears?|arms?|legs?|limbs?|头部|面部|头脸|脸部|身体|手臂|腿部|耳朵|四肢)$/i.test(part)
    const region = namedCore ? materialRegion(part) : regions.includes(row.region as MaterialRegion) ? row.region as MaterialRegion : old?.[1] ?? materialRegion(part)
    const key = part.toLowerCase()
    if (result.has(key) && result.get(key)!.category !== category) throw new Error(`部件“${part}”存在互相冲突的材质分类，请明确后再生成`)
    result.set(key, { part, category, ...(region ? { region } : {}),
      ...(typeof row.evidence === 'string' && row.evidence.trim() ? { evidence: row.evidence.trim().slice(0, 300) } : {}),
      ...(typeof row.observedMaterial === 'string' && row.observedMaterial.trim() ? { observedMaterial: row.observedMaterial.trim().slice(0, 150) } : {}) })
  }
  return [...result.values()]
}
function positiveClauses(description: string): string[] {
  return description.split(/[\n;；.!?。！？]/).flatMap(sentence => {
    const negative = /\b(?:no|without|remove|avoid|do not add)\b/i.exec(sentence)
    return (negative ? sentence.slice(0, negative.index) : sentence).split(/[,，]/)
  }).filter(clause => !/(?:没有|无|去掉|移除|删除|不要(?:添加)?|禁止)/.test(clause))
}
// 旧记录兜底只识别明确材料与部件的组合；普通 clothing 不推断成棉布或毡片。
export function inferMaterialComponents(profile: FeltProfile, description: string): MaterialComponent[] {
  const explicit = normalizeMaterialComponents(profile.materialComponents), result = [...explicit]
  const add = (category: MaterialComponentCategory, part: string, region?: MaterialRegion): void => {
    if (!result.some(row => row.part === part || (region && ['body', 'face', 'ears', 'limbs'].includes(region) && row.region === region))) result.push({ category, part, ...(region ? { region } : {}) })
  }
  if (profile.components.includes('body')) add('sculpted_needle_felt', 'body', 'body')
  if (profile.components.includes('face')) add('sculpted_needle_felt', 'head and face', 'face')
  const clauses = positiveClauses(description), text = clauses.join('\n')
  if (/四肢|手臂|腿|脚|爪|鳍|\b(?:limbs?|arms?|legs?|paws?|feet|flippers?)\b/i.test(text)) add('sculpted_needle_felt', 'existing limbs', 'limbs')
  if (/耳|\bears?\b/i.test(text)) add('sculpted_needle_felt', 'existing ears', 'ears')
  // 结构化分类优先，避免旧方案中的另一种材质描述把已确认的布裙重新归类。
  if (!explicit.length) for (const clause of clauses) {
    const matches: Array<[MaterialComponentCategory, RegExp]> = [
      ['woven_or_knitted_clothing', /(?:棉布|亚麻布|机织|梭织|针织)(?:[\u4e00-\u9fff]{0,3})(?:裙|衣|围裙|围巾|帽)|布裙|布衣|\b(?:woven|cotton|linen|fabric|cloth|knitted)\s+(?:\w+\s+){0,3}(?:dress|pinafore|apron|clothing|garment|scarf|hat)\b|\bclothing\s+in\s+(?:\w+\s+){0,2}woven\s+fabric\b/ig],
      ['flat_felt_sheet', /(?:平面|裁剪|薄片|片状)(?:羊毛)?毡(?:[\u4e00-\u9fff]{0,3})(?:衣|裙|花瓣|叶片)|\b(?:flat|cut|sheet)\s+felt\s+(?:\w+\s+){0,2}(?:clothing|dress|petals?|leaves?|hat)\b/ig],
      ['sculpted_needle_felt', /(?:针毡|毡制|羊毛毡)(?:帽子|围巾|裙子|配饰|挂饰|胡萝卜)|\b(?:felt|needle-felted)\s+(?:\w+\s+){0,2}(?:hat|scarf|dress|charm|accessor(?:y|ies))\b|\b(?:clothing|dress|apron)\s+(?:is|in)\s+(?:\w+\s+){0,3}felt\b/ig],
      ['mixed_material_accessory', /刺绣|绣花|装饰针脚|装饰缝线|\b(?:embroidery|embroidered\s+\w+|decorative\s+stitches)\b/ig],
    ]
    for (const [category, pattern] of matches) for (const match of clause.matchAll(pattern)) {
      if (category === 'sculpted_needle_felt' && /(?:flat|cut|sheet)\s+$/i.test(clause.slice(0, match.index))) continue
      add(category, match[0], materialRegion(match[0]) ?? 'accessory')
    }
  }
  if (profile.components.includes('curly-overlay')) add('loose_wool_or_curly_fleece', 'existing specified fleece or curly beard', 'accessory')
  if (profile.components.includes('hair')) add('loose_wool_or_curly_fleece', 'existing directional wool hair', 'accessory')
  if (profile.components.includes('beard')) add('loose_wool_or_curly_fleece', 'existing wool beard', 'accessory')
  if (profile.components.includes('felt-accessories') && !result.some(row => row.region === 'accessory' && row.category === 'sculpted_needle_felt')) add('sculpted_needle_felt', 'existing explicitly sculpted felt accessories', 'accessory')
  for (const mixed of profile.mixedMaterials) add('mixed_material_accessory', mixed, 'accessory')
  return normalizeMaterialComponents(result)
}

export const MATERIAL_V1_0_2 = {
  id: EXPERIMENTAL_MATERIAL, version: '1.0.2',
  priority: 'Only the intended sculpted wool substrate is replaced. Preserve the reference identity, silhouette, facial landmarks, expression, pose, colours, construction and existing decorative stitches. A knitted source body is not a required material for the needle-felted target. No rule adds a component.',
  material: 'SCULPTED NEEDLE-FELTED WOOL: Shape these components directly from a solid, cohesive mass of loose unspun wool compressed and interlocked by repeated felting-needle work. Use a dense non-woven fiber structure with fine, short, organically entangled fibers embedded throughout the continuous three-dimensional felt, not a separate coating or a fabric shell filled with stuffing. At normal viewing distance the surface is compact, softly matte and carefully finished; at close inspection tiny irregular fibers and subtle variations in compression remain visible. Keep rounded sculpted volumes, softly compressed edges and a restrained fiber halo. The fiber arrangement is non-periodic: no knitted rows, repeated yarn loops, crochet stitches, woven grids, horizontal textile bands or yarn-like coils. Do not erase the wool fibers into plastic smoothness or airbrushing. No synthetic plush, artificial loose hairs, artificial floating fuzz or artificial speckles.',
  face: 'FACE: The identified head and face are one continuous mass of densely needle-felted wool, with tiny randomly interlocked fibers and subtle matte surface variation. Preserve rounded volume, eyes, nose, blush and all facial landmarks; fibers must not obscure them. No fabric-covered stuffed head, horizontal stitch rows or artificial stitch patterns. Keep fine fibers visible rather than polishing the face smooth.',
  boundaries: 'Preserve genuine woven, knitted or sewn textile details only on the identified fabric components. Do not transfer their weave, knitted appearance or stitch patterns onto the needle-felted face, head, arms or body. Different materials retain their own physical surfaces.',
  negative: 'Preserve all established geometry, motifs, attachments and supported connections. No added components, artificial dirt, damage or exaggerated needle holes. On needle-felted wool parts, no knitted or crochet stitches, woven grids, periodic textile patterns, synthetic plush, artificial loose hairs, artificial floating fuzz or artificial speckles. No plastic, ceramic, silicone or resin appearance or gloss, CGI sheen or CGI texture, airbrushed smoothness, floating accessories, fused bodies or unsupported thin parts.',
} as const

export function experimentalComponentRules(profile: FeltProfile): Array<{ id: string; text: string }> {
  const components = profile.materialComponents ?? [], rules: Array<{ id: string; text: string }> = []
  for (const category of materialCategories) {
    const group = components.filter(component => component.category === category)
    if (!group.length) continue
    const parts = group.map(component => component.part).join('; ')
    const text: Record<MaterialComponentCategory, string> = {
      sculpted_needle_felt: MATERIAL_V1_0_2.material,
      loose_wool_or_curly_fleece: 'Only these existing hair/fleece areas use loose arranged wool or the specified natural curls. Keep their original direction and shape; never spread loose fleece onto the compact face or limbs.',
      flat_felt_sheet: 'These explicitly identified cut felt-sheet parts are thin non-woven felt, with their original thickness, layers, seams and edges. Do not turn them into bulky sculpted body parts or knitted cloth.',
      woven_or_knitted_clothing: 'These real textile garments retain their specified weave or knit, folds, seams, pockets and stitching. Do not convert them to wool felt. ' + MATERIAL_V1_0_2.boundaries,
      mixed_material_accessory: 'These existing accessories and decorative threadwork retain their individually specified materials, positions and attachments. Preserve bead-eye highlights, fabric ribbons and intentional embroidery only where identified; do not extend their material across the body.',
    }
    rules.push({ id: `MAT-${category}`, text: `${category} — ${parts}. ${text[category]}` })
  }
  if (components.some(row => row.region === 'face' && row.category === 'sculpted_needle_felt')) rules.push({ id: 'MAT-face', text: MATERIAL_V1_0_2.face })
  if (profile.components.includes('clothing') && !components.some(row => row.region === 'clothing')) rules.push({ id: 'MAT-clothing-unknown', text: 'The existing clothing material is unspecified. Preserve its visible material and construction; its name alone does not establish woven cloth, knit or felt sheet.' })
  return rules
}
export const materialAnalysisV1_0_2 = `[${EXPERIMENTAL_MATERIAL}:analysis:r2]
分开记录参考图的已观察材质和本次目标材质：原图如果是布偶，应如实记录observedMaterial，不能因为目标是毛毡就声称原图已经是针毡。生成目标的主体用针刺压实羊毛；不得在英文设计稿中给主体使用knitted doll、crochet plush、stuffed fabric head等描述。
feltProfile增加materialComponents:[{part,region,category,observedMaterial,evidence}]。category只允许${materialCategories.join(', ')}；region为body/face/ears/limbs/clothing/accessory。part具体指出部件，evidence说明可见证据或明确设计要求。只列实际存在的部件。主体目标与观察不同不改变五官、姿势、身份或摄影。
真实棉布裙和针织围巾属于woven_or_knitted_clothing；明确裁剪毡片才属于flat_felt_sheet；羊毛卷毛或头发属于loose_wool_or_curly_fleece；立体针毡配饰属于sculpted_needle_felt；珠眼、丝带、刺绣属于mixed_material_accessory。普通clothing和plush不是材质类别，不因“裙子”一词就指定布料或毡片。每个方案给出独立、相互一致的部件材质。`
export const materialIdentityV1_0_2 = `[${EXPERIMENTAL_MATERIAL}:identity:r2]
只记录已批准主图的真实可见材质，不用理想针毡覆盖观察，不在多角度重新转换材质。feltProfile.materialComponents可使用${materialCategories.join(', ')}；每项为{part,region,category,observedMaterial,evidence}。分不清针织与交错纤维时保留未知；后续主图材质修正属于独立操作。`
export const materialReviewV1_0_2 = `[${EXPERIMENTAL_MATERIAL}:review:r2]
逐部件检查针毡脸、头、耳、四肢是否出现规则织行、纱线线圈或布壳填充外观；主体原参考是布偶不能成为复制织纹的理由。针毡应有连续压实的三维羊毛体与细小、不规则可见纤维，不能以塑料光滑或统一浮毛代替。衣服的合法织纹和缝线、原有面部与耳缘装饰针脚保留。分辨率不足或材质证据不明用UNKNOWN，结论不证明实物成分。`

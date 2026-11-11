import type { FeltProfile, MaterialComponent, MaterialCorrection } from './types.ts'
import { inferMaterialComponents, materialRegion } from './material-v1-0-2.ts'

// 仅清理本模块拥有的完整规则块；不靠删除普通段落消除冲突。
export function stripMaterialRuleBlocks(value: string): string {
  let text = value.replace(/\[NEEDLE_FELT_RULES:[^\]]*\][\s\S]*?\[\/NEEDLE_FELT_RULES\]/g, '')
    .replace(/\[(needle_felt_v1_0(?:_2)?)(?:;[^\]]*)?\][\s\S]*?\[\/\1\]/g, '')
  if (/\[\/?(?:NEEDLE_FELT_RULES|needle_felt_v1_0)/i.test(text)) throw new Error('材质规则块不完整或版本标记不成对，未提交图像请求')
  return text.trim()
}
const coreRegion = (part: MaterialComponent): boolean => ['body', 'face', 'ears', 'limbs'].includes(part.region ?? materialRegion(part.part) ?? '')
export function resolveMaterialProfile(profile: FeltProfile, description: string): { profile: FeltProfile; corrections: MaterialCorrection[] } {
  const corrections: MaterialCorrection[] = []
  const materialComponents = inferMaterialComponents(profile, description).map(part => {
    if (!coreRegion(part) || part.category === 'sculpted_needle_felt') return part
    corrections.push({ field: 'profile', before: `${part.part}: ${part.category}`, after: `${part.part}: sculpted_needle_felt`, reason: '候选目标的主体部件必须为针毡；原观察另存，不能成为织物目标' })
    return { ...part, observedMaterial: part.observedMaterial ?? part.category, category: 'sculpted_needle_felt' as const }
  })
  return { profile: { ...profile, materialComponents }, corrections }
}
function negativeAt(text: string, offset: number): boolean {
  const prefix = text.slice(0, offset).split(/[,，;；.!?。！？\n]|\bbut\b/i).at(-1) ?? ''
  return /\b(?:no|not|without|avoid|never)\b|不要|不应|禁止|不能|没有/i.test(prefix)
}
const core = '(?:face|head|body|torso|ears?|arms?|legs?|limbs?)'
const badSurface = '(?:(?:knitted|woven|jersey|crochet(?:ed)?|amigurumi)(?:[ -](?:fabric|cloth|texture|surface|patterns?|rows?|loops?)){0,3}|(?:fabric-covered|stuffed fabric|plush)(?:[ -](?:head|surface|texture))?|(?:regular |repeating |horizontal )+(?:textile |stitch |knit )*(?:rows|patterns|bands)|yarn-like coils)'

// 主体部位旁出现织物词，可能只是新增的真实服装/配件，而非把织纹扩散到针毡主体。
// 服装名词必须覆盖织物词之后的修饰对象，否则「knitted scarf」会被误判成「针织的脸」。
const garmentNoun = '(?:scarf|scarves|hat|cap|bonnet|beanie|beret|hood|cardigan|sweater|jumper|jacket|coat|vest|dress|pinafore|apron|skirt|shirt|blouse|trousers|pants|socks?|boots?|shoes?|mittens?|gloves?|collar|cuff|bow|ribbon|sash|belt|bag|purse|blanket|shawl|wrap|cape|cloak|necktie|tie|headband|garment|clothing|outfit)'
const additionSignal = /\b(?:adds?|added|adding|paired|wears?|wearing|plus|alongside|accompanied|complemented|trimmed|wrapped|topped|featuring|holding|carrying|draped|with a|with an|while)\b/i
function legitimateMixedMaterial(text: string, match: RegExpMatchArray): boolean {
  const excerpt = match[0]
  // 织物词后面紧跟服装/配件名词：这是独立混材部件，不是主体表面材质。
  const tail = text.slice((match.index ?? 0) + excerpt.length)
  // 但如果后文明确把织纹放回脸/头/身体，仍是主体冲突，不能放行。
  if (new RegExp(`^\\s+(?:[a-z-]+\\s+){0,3}(?:texture|finish|surface|pattern|rows|stitches|fabric)\\b[^,;.!?\\n]{0,30}\\b(?:on|over|across|covering|to)\\s+(?:the\\s+)?${core}\\b`, 'i').test(tail)) return false
  if (new RegExp(`^\\s+(?:[a-z-]+\\s+){0,3}${garmentNoun}\\b`, 'i').test(tail)) return true
  if (new RegExp(`\\b${garmentNoun}\\b`, 'i').test(excerpt)) return true
  // 「保留主体，但新增/搭配……」属于显式的配件引入，不是主体材质描述。
  return additionSignal.test(excerpt)
}

// 确定的局部材料词才替换；不删除整句，保留同句的颜色、姿势、配件和摄影要求。
export function resolveMaterialText(value: string, field: string, profile: FeltProfile, userAuthored = false): { text: string; corrections: MaterialCorrection[] } {
  let text = value
  const corrections: MaterialCorrection[] = []
  const replace = (pattern: RegExp, render: (match: string, groups: string[]) => string, reason: string): void => {
    text = text.replace(pattern, (match: string, ...args: unknown[]) => {
      const offset = args.at(-2) as number, source = args.at(-1) as string
      if (negativeAt(source, offset)) return match
      const after = render(match, args.slice(0, -2) as string[])
      if (after === match) return match
      if (userAuthored) throw new Error(`用户要求与候选材质冲突（${match}）；请明确该部件材质后再生成，未改写用户要求`)
      corrections.push({ field, before: match, after, reason })
      return after
    })
  }
  replace(/\b(?:knitted|crochet(?:ed)?|amigurumi|fabric-covered|stuffed fabric|(?:knitted|woven|sewn) fabric|plush|stuffed)(?:\s+plush)?\s+((?:(?:white|cream|grey|gray|blue|green|small|cute|rabbit)\s+){0,3}(?:doll|toy|figurine|rabbit|body|face|head|ears?|arms?|legs?|limbs?))\b/gi,
    (_, [subject]) => `needle-felted ${subject}`, '移除针毡主体的针织／填充布壳材料描述')
  replace(new RegExp(`\\b(${core}\\s+(?:is|are|has|have|shows?|with)\\s+)(?:a\\s+)?${badSurface}\\b`, 'gi'),
    (_, [subject]) => `${subject}compact non-woven needle-felted wool`, '按主体部件纠正表面材料')
  replace(new RegExp(`\\b(${core}\\s+(?:is|are)\\s+)(?:sewn from|made (?:from|of)|covered (?:with|in))\\s+(?:knitted|woven|jersey|plush)\\s+(?:fabric|cloth)\\b`, 'gi'),
    (_, [subject]) => `${subject}sculpted from densely compressed wool`, '纠正主体的布壳构造描述')
  replace(new RegExp(`\\b${badSurface}\\s+(?:on|covering)\\s+(?:the\\s+)?(${core})\\b`, 'gi'),
    (_, [part]) => `fine non-periodic felt fibers on the ${part}`, '阻止织物纹理扩散到针毡主体')
  replace(/(?:针织|钩织|编织|布料包覆|填充布壳)(?:布料)?(脸部|头部|身体|耳朵|手臂|四肢|玩偶)/g,
    (_, [part]) => `针刺压实羊毛毡${part}`, '中文主体材料描述纠正')
  replace(/((?:脸部|头部|身体|耳朵|手臂|四肢)(?:表面)?(?:是|为|具有|带有|呈现))((?:规律|横向|规则|重复)*的?(?:针织|织物|经纬|钩织)(?:纹理|织纹|线圈|布料))/g,
    (_, [part]) => `${part}细短不规则纤维的压实针毡面`, '中文主体织纹冲突纠正')
  replace(/\b((?:face|head)\s+(?:is|stays|remains)\s+)(?:completely\s+)?smooth(?:\s+and\s+tight)?\b/gi,
    (_, [part]) => `${part}finely compacted with visible tiny irregular wool fibers`, '光滑只能描述圆润轮廓，不能移除羊毛纤维')

  const clothes = (profile.materialComponents ?? []).filter(part => part.region === 'clothing')
  const categories = [...new Set(clothes.map(part => part.category))]
  // 同一方案有多种服装材料时不做全局替换，避免把针织围巾与棉布裙互换。
  for (const [noun, family] of [['dress|pinafore|裙', 'dress'], ['apron|围裙', 'apron'], ['scarf|围巾', 'scarf'], ['hat|帽', 'hat']] as const) {
    const relevant = clothes.filter(part => new RegExp(noun, 'i').test(part.part))
    const target = [...new Set(relevant.map(part => part.category))]
    if (target.length > 1) throw new Error(`同一${family}存在多个材料分类，未提交冲突提示词`)
    if (target[0] !== 'woven_or_knitted_clothing') continue
    replace(new RegExp(`\\b(?:needle-felted|felt|felted)\\s+((?:(?:blue|white|cotton|linen|small)\\s+){0,2}(?:${family === 'dress' ? 'dress|pinafore' : family}))\\b`, 'gi'),
      (_, [part]) => `textile ${part}`, '保留已明确的真实织物服装')
    replace(new RegExp(`\\b((?:${family === 'dress' ? 'dress|pinafore' : family})\\s+(?:is|in|uses)\\s+)(?:(?:layered|matte|compact)\\s+)*felt\\b`, 'gi'),
      (_, [part]) => `${part}its specified textile`, '消除服装分类与英文设计稿冲突')
  }
  if (categories.length === 1 && categories[0] === 'woven_or_knitted_clothing') {
    replace(/\b(clothing\s+(?:is|in|uses)\s+)(?:(?:layered|matte|compact)\s+)*felt\b/gi, (_, [part]) => `${part}its specified textile`, '移除覆盖全部衣服的毛毡化描述')
  }
  // 不认识的肯定冲突保守拒绝，不让模型自行仲裁。真实织物服装、新增织物配件及否定要求不误报。
  for (const match of text.matchAll(new RegExp(`\\b${core}\\b[^,;.!?\\n]{0,65}\\b(?:knitted|crocheted|jersey|woven fabric|stuffed fabric|textile rows)\\b`, 'gi'))) {
    if (negativeAt(text, match.index) || /\b(?:not|no|avoid|never|without)\b/i.test(match[0])) continue
    if (legitimateMixedMaterial(text, match)) continue
    throw new Error(`存在未能安全消除的主体材质冲突（${match[0]}），未提交图像请求`)
  }
  return { text, corrections }
}

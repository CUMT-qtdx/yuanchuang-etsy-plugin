// 对外文案只保留商品描述；内部待核对信息单独返回给后台复核区。
export function separateInternalNotes(value: string): { description: string; notes: string[] } {
  // 模型经常只换行而不用句号。逐行清理，不能把整段正文并成一条再因尾部提示整段丢弃。
  const parts = value.trim().replace(/\r\n?/g, '\n').split(/\n+|(?<=[.!?。！？])\s+(?=[\p{L}\p{Extended_Pictographic}])/u).map(part => part.trim()).filter(Boolean)
  const notes: string[] = [], content: string[] = []
  for (let index = 0; index < parts.length; index++) {
    let part = parts[index]!
    let plain = part.replace(emojiPattern(), '').trim()
    // 兼容旧文案在内部提示中途硬换行的情况，只合并明确的内部资料提示。
    if (/^(?:actual|exact|final)\s+(?:materials?|sizes?|dimensions?|format|product|delivery)/i.test(plain) && !/[.!?]$/.test(plain) && /\b(?:not confirmed|need(?:s)?\s+confirmation|to be confirmed)\b/i.test(parts[index + 1] ?? '')) {
      part += ' ' + parts[++index]
      plain = part.replace(emojiPattern(), '').trim()
    }
    const internal = /(?:实际|真实)?(?:材料|材质|尺寸|交付方式|商品参数|商品资料).*(?:待确认|未确认|尚未确认|人工核对)|请.*(?:下单|核对细节)/u.test(part)
      || /\b(?:actual materials?|materials?|sizes?|dimensions?|delivery format|physical details|product details|specifications)\b.*\b(?:not confirmed|unconfirmed|require.{0,30}confirmation|need.{0,30}confirm|to be confirmed)\b/i.test(part)
      || /\b(?:please|before ordering|before placing).{0,45}\b(?:confirm|verify|check)\b.{0,70}\b(?:details|materials|size|shop|order)\b/i.test(part)
      || /^this listing (?:is|shows|covers|presents)\b.{0,100}\b(?:draft|design direction|concept|visual reference)\b/i.test(plain)
      || /^(?:actual|exact|final)\b.{0,85}\b(?:confirmation|confirmed)\b/i.test(plain)
      || /^please (?:ask before assuming|view it as|treat it as)\b/i.test(plain)
    if (internal) notes.push(part)
    else content.push(part)
  }
  return { description: content.join('\n'), notes }
}
export function cleanListingTitle(value: string): string {
  return value.replace(/\b(?:design\s+draft|draft\s+design|design\s+concept|concept\s+design|visual\s+reference(?:\s+only)?|for\s+internal\s+review|for\s+visual\s+reference|virtual)\b/gi, '')
    // 单独的 Draft Horse 是正常商品名称；只移除尾部附加的草稿定位词。
    .replace(/\s+\b(?:draft|concept)\b\s*$/gi, '')
    .replace(/(?:设计草稿|概念草稿|概念方案|概念设计|设计概念|外观概念|创意参考|视觉参考|设计方向参考|内部审核|虚拟|草稿|概念)/gu, '')
    .replace(/\s+/g, ' ').replace(/\s*([|｜])\s*/g, ' $1 ').replace(/^[\s|｜,，:：;；\-–—]+|[\s|｜,，:：;；\-–—]+$/g, '').trim()
}
const titleTranslations: Array<[string, string]> = [
  ['深蓝', 'Navy'], ['星夜', 'Starry Night'], ['秋日', 'Autumn'], ['森林', 'Forest'], ['樱花', 'Sakura'], ['橡果', 'Acorn'],
  ['贝雷帽', 'Beret'], ['斗篷', 'Cape'], ['围巾', 'Scarf'], ['小狗', 'Puppy'], ['狗狗', 'Dog'], ['小猫', 'Kitten'], ['猫咪', 'Cat'],
  ['插画', 'Illustration'], ['毛绒', 'Plush'], ['绒感', 'Plush Look'], ['外观', 'Look'], ['风格', 'Style'], ['概念', 'Concept'],
  ['可爱', 'Cute'], ['奶油', 'Cream'], ['焦糖', 'Caramel'], ['配饰', 'Accessory'], ['帽子', 'Hat'], ['造型', 'Design'], ['设计', 'Design'],
]
function translateTitleFragments(value: string): string {
  let result = value
  for (const [source, target] of titleTranslations) result = result.replaceAll(source, ` ${target} `)
  return result
}
export function normalizeTitleLanguages(title: string, titleZh: string): { title: string; titleZh: string } {
  // 先用模型提供的语言字段归位；混合标题再翻译已出现的视觉词，剩余未知词拒绝进入商品标题。
  if (!isEnglishText(title) && /\p{Script=Han}/u.test(title) && isEnglishText(titleZh)) return { title: cleanListingTitle(titleZh), titleZh: cleanListingTitle(title) }
  const translated = translateTitleFragments(title)
  return { title: cleanListingTitle(translated), titleZh: cleanListingTitle(titleZh) }
}
export function isEnglishText(value: string): boolean {
  return /[A-Za-z]/.test(value) && [...value].every(character => !/\p{L}/u.test(character) || /\p{Script=Latin}/u.test(character))
}
export function isChineseText(value: string): boolean { return /\p{Script=Han}/u.test(value) && !/[\p{Script=Cyrillic}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value) }
export function hasInternalListingLabel(value: string): boolean { return /\b(?:design\s+draft|draft\s+design|design\s+concept|concept\s+design|visual\s+reference|for\s+internal\s+review|virtual)\b/i.test(value) || /(?:设计草稿|概念草稿|概念方案|设计概念|外观概念|创意参考|视觉参考|虚拟)/u.test(value) }
export function listingUsesEnglish(copy: { titles: Array<{ title: string }>; description: string }): boolean {
  const titles = copy.titles.filter(title => title.title.trim())
  return (titles.length > 0 || !!copy.description.trim()) && titles.every(title => isEnglishText(title.title) && title.title.trim().length >= 8) && (!copy.description.trim() || isEnglishText(copy.description))
}
const emojiPattern = (): RegExp => /\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*/gu
export function formatProductDescription(value: string): string {
  // 保留完整句子，不按词数硬拆，也不为满足数量补造表情。
  let total = 0
  const normalized = separateInternalNotes(value).description.replace(/Digital product\.\s*No physical item is included\./gi, 'Digital product. No physical item is included.')
  return normalized.split(/\n+/).map(line => {
    let count = 0
    return line.replace(emojiPattern(), emoji => count++ === 0 && total < 5 ? (total++, emoji) : '')
      .replace(/\bdesign\s+concept\b/gi, 'design').replace(/\bconcept\s+design\b/gi, 'design')
      .replace(/[ \t]+/g, ' ').trim()
  }).filter(line => /[\p{L}\p{N}]/u.test(line)).join('\n')
}

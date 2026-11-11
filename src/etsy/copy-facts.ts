import type { ProductFacts } from './types.ts'

// 对商品参数按字段建立依据；名称和创意要求不作为材料、尺寸或承诺的证据。
const materialAliases: Array<[string, RegExp, RegExp]> = [
  ['羊毛', /\bwool(?:en|len)?\b/gi, /\bwool(?:en|len)?\b|羊毛/i],
  ['棉', /\bcotton\b/gi, /\bcotton\b|棉/i],
  ['美利奴羊毛', /\bmerino\b/gi, /\bmerino\b|美利奴/i],
  ['羊驼毛', /\balpaca\b/gi, /\balpaca\b|羊驼/i],
  ['羊绒', /\bcashmere\b/gi, /\bcashmere\b|羊绒/i],
  ['丝', /\bsilk\b/gi, /\bsilk\b|蚕丝|真丝|丝绸/i],
  ['亚麻', /\blinen\b/gi, /\blinen\b|亚麻/i],
  ['聚酯纤维', /\bpolyester\b/gi, /\bpolyester\b|聚酯|涤纶/i],
  ['腈纶', /\bacrylic\b/gi, /\bacrylic\b|腈纶|亚克力/i],
  ['皮革', /\bleather\b/gi, /\bleather\b|皮革|真皮/i],
  ['竹纤维', /\bbamboo\b/gi, /\bbamboo\b|竹/i],
  ['木材', /\bwood(?:en)?\b/gi, /\bwood(?:en)?\b|木/i],
  ['树脂', /\bresin\b/gi, /\bresin\b|树脂/i],
  ['陶瓷', /\bceramic\b/gi, /\bceramic\b|陶瓷/i],
  ['金属', /\bmetal\b/gi, /\bmetal\b|金属/i],
  ['塑料', /\bplastic\b/gi, /\bplastic\b|塑料/i],
  ['玻璃', /\bglass\b/gi, /\bglass\b|玻璃/i],
]

const unitNames: Record<string, [string, number]> = {
  mm: ['length', 1], millimeter: ['length', 1], millimeters: ['length', 1], millimetre: ['length', 1], millimetres: ['length', 1], 毫米: ['length', 1],
  cm: ['length', 10], centimeter: ['length', 10], centimeters: ['length', 10], centimetre: ['length', 10], centimetres: ['length', 10], 厘米: ['length', 10], 公分: ['length', 10],
  inch: ['length', 25.4], inches: ['length', 25.4], in: ['length', 25.4], 英寸: ['length', 25.4],
  g: ['weight', 1], grams: ['weight', 1], gram: ['weight', 1], 克: ['weight', 1], kg: ['weight', 1000], 千克: ['weight', 1000],
  px: ['pixels', 1], pixel: ['pixels', 1], pixels: ['pixels', 1], 像素: ['pixels', 1], dpi: ['dpi', 1],
  day: ['time', 24], days: ['time', 24], 天: ['time', 24], 日: ['time', 24], hour: ['time', 1], hours: ['time', 1], 小时: ['time', 1], week: ['time', 168], weeks: ['time', 168], 周: ['time', 168],
}
const unitExpression = Object.keys(unitNames).sort((a, b) => b.length - a.length).join('|')
function measurements(value: string): Array<{ kind: string; value: number }> {
  return [...value.matchAll(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(${unitExpression})(?![a-z])`, 'gi'))].map(match => {
    const [kind, factor] = unitNames[match[2]!.toLowerCase()]!
    return { kind, value: Number(match[1]!.replace(',', '.')) * factor }
  })
}
const claimGroups: Array<{ claim: RegExp; evidence: RegExp; label: string; fields: Array<keyof ProductFacts> }> = [
  { claim: /\bsafe for (?:newborns?|babies|infants|children)\b|婴儿安全|儿童安全/i, evidence: /\bsafe for (?:newborns?|babies|infants|children)\b|婴儿安全|儿童安全/i, label: '婴幼儿安全', fields: ['materials', 'requirements'] },
  { claim: /\bbaby[- ]safe\b/i, evidence: /\bbaby[- ]safe\b/i, label: '婴幼儿安全', fields: ['materials', 'requirements'] },
  { claim: /\bchild[- ]safe\b/i, evidence: /\bchild[- ]safe\b/i, label: '儿童安全', fields: ['materials', 'requirements'] },
  { claim: /\bnon[- ]?toxic\b|无毒/i, evidence: /\bnon[- ]?toxic\b|无毒/i, label: '无毒安全', fields: ['materials', 'requirements'] },
  { claim: /\bhypoallergenic\b|低敏/i, evidence: /\bhypoallergenic\b|低敏/i, label: '低敏安全', fields: ['materials', 'requirements'] },
  { claim: /\bfood[- ]safe\b|食品安全/i, evidence: /\bfood[- ]safe\b|食品安全/i, label: '食品安全', fields: ['materials', 'requirements'] },
  { claim: /\bwashable\b|可水洗/i, evidence: /\bwashable\b|可水洗/i, label: '可水洗', fields: ['materials', 'processing', 'requirements'] },
  { claim: /\bmachine wash(?:able)?\b|可机洗/i, evidence: /\bmachine wash(?:able)?\b|可机洗/i, label: '可机洗', fields: ['materials', 'processing', 'requirements'] },
  { claim: /\bwaterproof\b|防水/i, evidence: /\bwaterproof\b|防水/i, label: '防水', fields: ['materials', 'processing', 'requirements'] },
  { claim: /\bwater resistant\b/i, evidence: /\bwater resistant\b/i, label: '防泼水', fields: ['materials', 'processing', 'requirements'] },
  { claim: /\bhandmade\b|手工|手作/i, evidence: /\bhandmade\b|手工|手作/i, label: '手工制作', fields: ['processing', 'requirements'] },
  { claim: /\bhand[- ]crafted\b/i, evidence: /\bhand[- ]crafted\b/i, label: '手工制作', fields: ['processing', 'requirements'] },
  { claim: /\bhand[- ]felted\b/i, evidence: /\bhand[- ]felted\b/i, label: '手工制作', fields: ['processing', 'requirements'] },
  { claim: /\bhand[- ]sewn\b/i, evidence: /\bhand[- ]sewn\b/i, label: '手工制作', fields: ['processing', 'requirements'] },
  { claim: /\bfree shipping\b|免运费|包邮/i, evidence: /\bfree shipping\b|免运费|包邮/i, label: '免运费', fields: ['delivery', 'requirements'] },
  { claim: /\bfree delivery\b/i, evidence: /\bfree delivery\b/i, label: '免费配送', fields: ['delivery', 'requirements'] },
  { claim: /\bguaranteed delivery\b|\bdelivery is guaranteed\b|保证送达/i, evidence: /\bguaranteed delivery\b|\bdelivery is guaranteed\b|保证送达/i, label: '配送保证', fields: ['delivery', 'requirements'] },
  { claim: /\bships? worldwide\b|\bworldwide shipping\b|全球配送/i, evidence: /\bships? worldwide\b|\bworldwide shipping\b|全球配送/i, label: '全球配送', fields: ['delivery', 'requirements'] },
  { claim: /\binstant download\b|即时下载/i, evidence: /\binstant download\b|即时下载/i, label: '即时下载', fields: ['delivery', 'requirements'] },
  { claim: /\bcommercial use\b|商用/i, evidence: /\bcommercial use\b|商用/i, label: '商用授权', fields: ['delivery', 'requirements'] },
]

function hasPositiveEvidence(value: string, pattern: RegExp): boolean {
  const match = value.match(pattern)
  if (!match || match.index === undefined) return false
  const before = value.slice(Math.max(0, match.index - 35), match.index)
  // “not waterproof”“禁止商用”不构成肯定依据；不把创意要求当成默认承诺。
  return !/(?:\bnot\s+(?:\w+\s+){0,3}|\bno\s+(?:\w+\s+){0,3}|\bwithout\s+(?:\w+\s+){0,3}|不含|不|非|禁止|不可|未确认|尚未确认|不能|勿)\s*$/i.test(before)
}

export function copyFactIssue(value: string, facts: ProductFacts): string | undefined {
  const confirmed = (key: keyof ProductFacts): string => facts.confirmed && typeof facts[key] === 'string' ? String(facts[key]) : ''
  for (const [label, pattern, evidence] of materialAliases) {
    for (const match of value.matchAll(pattern)) {
      const tail = value.slice(match.index! + match[0].length, match.index! + match[0].length + 35)
      const head = value.slice(Math.max(0, match.index! - 22), match.index)
      if (match[0].toLowerCase() === 'cotton' && /^\s+candy\s+(?:pink|color|colour|tone)/i.test(tail)) continue
      // wool-like、wood-look 等仅描述视觉效果，不宣称实际材料。
      if (/^(?:[- ](?:like|look|style|effect|inspired)\b|\s+(?:visual\s+)?(?:texture|appearance|effect)\b)/i.test(tail) && !/\b(?:made|crafted|constructed)\s+(?:of|from|with)\s*$/i.test(head)) continue
      if (!hasPositiveEvidence(confirmed('materials'), evidence)) return `具体材料“${label}”与已确认材料不一致或尚未填写`
    }
  }
  for (const measurement of measurements(value)) {
    const source = measurement.kind === 'time' ? `${confirmed('processing')} ${confirmed('delivery')}` : confirmed('dimensions')
    if (!measurements(source).some(expected => expected.kind === measurement.kind && Math.abs(expected.value - measurement.value) < 0.001)) return measurement.kind === 'time' ? '制作或配送时间与已确认资料不一致' : '尺寸、单位或分辨率与已确认资料不一致'
  }
  for (const group of claimGroups) {
    const claim = value.match(group.claim)
    if (!claim) continue
    const tail = value.slice((claim.index ?? 0) + claim[0].length)
    if (/^[- ](?:style|look|appearance|inspired)\b/i.test(tail)) continue
    if (!group.fields.some(key => hasPositiveEvidence(confirmed(key), group.evidence))) return `未经确认的${group.label}承诺`
  }
  // 已带单位的数值已经按换算后的物理量核对；再检查没有单位的数量。
  const stripMeasurements = (input: string): string => input.replace(new RegExp(`\\d+(?:[.,]\\d+)?\\s*(?:${unitExpression})(?![a-z])`, 'gi'), '')
  const knownPlainNumbers = new Set(stripMeasurements([facts.name, ...(['materials', 'dimensions', 'packaging', 'processing', 'delivery', 'personalization'] as const).map(confirmed)].join(' ')).match(/\d+(?:[.,]\d+)?/g) ?? [])
  if ((stripMeasurements(value).match(/\d+(?:[.,]\d+)?/g) ?? []).some(number => !knownPlainNumbers.has(number))) return '文案包含缺乏依据的数值'
  const packaging = confirmed('packaging')
  const packageKinds: Array<[RegExp, RegExp]> = [[/\bgift box\b/i, /\bgift box\b|礼盒/i], [/\bpaper box\b/i, /\bpaper box\b|纸盒/i], [/\bgift wrapping\b/i, /\bgift wrapping\b|礼品包装|礼物包装/i]]
  for (const [claim, evidence] of packageKinds) if (claim.test(value) && !hasPositiveEvidence(packaging, evidence)) return '包装描述与已确认资料不一致'
  if (/\b(?:packaged in|packed in)\b/i.test(value) && !packaging) return '未经确认的包装或交付内容'
  if (facts.type === 'unspecified' && /\b(?:digital product|digital download|instant download|no physical item|physical item included|ships within)\b/i.test(value)) return '实际交付方式尚未填写，不能写入实物或数字交付承诺'
  return undefined
}

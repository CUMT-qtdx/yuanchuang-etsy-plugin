import type { FeltScene } from './types.ts'

export const PHOTOGRAPHY_VERSION = '1.0'
export const PHOTOGRAPHY_SOURCE_SHA256 = '22451fa4818acdc43c5fef005cd18e5ff49ca367c500e0299eb5e35de27e5f0b'
export const photographyPresets = [
  { value: 'preserve-original', label: '保留原背景' },
  { value: 'natural-tabletop', label: '自然木桌' },
  { value: 'home-lifestyle', label: '家居场景' },
  { value: 'seasonal-lifestyle', label: '主题生活场景' },
  { value: 'white-studio', label: '白底摄影棚' },
] as const
export type PhotographyPreset = typeof photographyPresets[number]['value']
export interface PhotographySettings {
  photography_preset: PhotographyPreset
  subject_height_ratio: number
  aspect_ratio: string
  framing_policy: 'preserve_reference' | 'override_reference'
  preserve_background: boolean
}
export const aspectRatios = ['auto', '1:1', '3:4', '4:3', '3:2', '2:3', '16:9', '9:16', '21:9'] as const

export function defaultPhotography(task = 'redesign', referenceEdit = false): PhotographySettings {
  const preserve = referenceEdit || task === 'felt-conversion' || task === 'flat-to-felt'
  return { photography_preset: preserve ? 'preserve-original' : 'natural-tabletop', subject_height_ratio: 0.6, aspect_ratio: preserve ? 'auto' : '1:1', framing_policy: preserve ? 'preserve_reference' : 'override_reference', preserve_background: preserve }
}
export function normalizePhotography(value: unknown, fallback = defaultPhotography()): PhotographySettings {
  if (value === undefined) return { ...fallback }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('摄影设置格式无效')
  const raw = value as Record<string, unknown>
  const result = { ...fallback, ...raw } as PhotographySettings
  if (!photographyPresets.some(item => item.value === result.photography_preset)) throw new Error('请选择有效的摄影背景')
  if (!Number.isFinite(result.subject_height_ratio) || result.subject_height_ratio < 0.35 || result.subject_height_ratio > 0.9) throw new Error('主体高度占比请选择35%到90%')
  if (!(aspectRatios as readonly string[]).includes(result.aspect_ratio) && !/^\d{3,4}x\d{3,4}$/.test(result.aspect_ratio)) throw new Error('画幅比例无效')
  if (!['preserve_reference', 'override_reference'].includes(result.framing_policy) || typeof result.preserve_background !== 'boolean') throw new Error('摄影构图选项无效')
  return { photography_preset: result.photography_preset, subject_height_ratio: result.subject_height_ratio, aspect_ratio: result.aspect_ratio, framing_policy: result.framing_policy, preserve_background: result.preserve_background }
}
export function effectivePhotography(settings: PhotographySettings, userText: string): PhotographySettings {
  const onlyMaterial = /(?:仅|只|只需|仅仅)(?:改变|更改|修改|转换|换|改|转)?(?:商品)?(?:的)?(?:材质|质感)|(?:only|just)\s+(?:change|convert|modify|replace)\s+(?:the\s+)?(?:material|texture)/i.test(userText)
  const preserveBg = onlyMaterial || /(?:保留|保持|不要改|不改|不改变).{0,10}背景|(?:keep|preserve|retain|do not change).{0,24}\bbackground/i.test(userText)
  const preserveFrame = onlyMaterial || /(?:保留|保持|不要改|不改).{0,8}(?:构图|画面占比)|(?:keep|preserve|retain).{0,18}(?:original|reference).{0,12}framing/i.test(userText)
  const next = { ...settings, ...(preserveBg ? { preserve_background: true, photography_preset: 'preserve-original' as const } : {}), ...(preserveFrame ? { framing_policy: 'preserve_reference' as const } : {}) }
  if (!preserveBg && explicitBackground(userText)) { next.preserve_background = false; if (next.photography_preset === 'preserve-original') next.photography_preset = 'natural-tabletop' }
  // 只识别明确的占比表达；自由文字原文始终保留在最终任务中。
  const ratio = /(?:主体|商品|玩偶|整体)[^\n。]{0,12}?(?:占|高度)[^\n。]{0,12}?([3-8]\d|90)\s*[%％]|(?:subject|figurine|product)[^\n.]{0,35}?([3-8]\d|90)\s*%/i.exec(userText)
  const percentage = ratio ? Number(ratio[1] ?? ratio[2]) : 0
  if (percentage >= 35 && percentage <= 90 && !preserveFrame) { next.subject_height_ratio = percentage / 100; next.framing_policy = 'override_reference' }
  const aspect = /(?:画幅|画面比例|宽高比|图片比例|输出比例|aspect\s+ratio|output\s+ratio)[^\n。.;]{0,12}?(1\s*[:：]\s*1|3\s*[:：]\s*4|4\s*[:：]\s*3|3\s*[:：]\s*2|2\s*[:：]\s*3|16\s*[:：]\s*9|9\s*[:：]\s*16|21\s*[:：]\s*9)(?!\d)/i.exec(userText)
  if (aspect) next.aspect_ratio = aspect[1]!.replace(/\s/g, '').replace('：', ':')
  return next
}
function explicitBackground(text: string): boolean {
  return /(?:背景(?:改为|改成|换成|使用|设为|为|是)|(?:使用|换成|改成).{0,18}背景|(?:background|backdrop)\s*(?:is|:|to|of)|(?:use|with|on|against)\s+(?:a\s+)?[\w -]{0,32}(?:background|backdrop))/i.test(text)
}
export function photographyBlock(settings: PhotographySettings, scene: FeltScene, userText: string): string {
  if (settings.preserve_background || settings.photography_preset === 'preserve-original') return 'Preserve the source background, supporting surface, lighting direction and environment. Do not introduce a tabletop, props or a new scene. Integrate changed felt surfaces with the existing light and shadows.'
  if (explicitBackground(userText)) return 'Use the background explicitly described by the user, overriding automatic scene presets. Do not introduce conflicting furniture or props. Integrate the product, support and shadows as one coherent real photograph; keep its original colours and the entire product in focus.'
  const scenes: Record<PhotographyPreset, string> = {
    'preserve-original': '',
    'natural-tabletop': 'Photograph the product on a realistic light oak or natural wooden tabletop with a soft off-white or warm-grey indoor wall behind it. Use gentle side-window daylight and natural tabletop shadows. Keep the indoor environment subtle and spatially coherent.',
    'home-lifestyle': 'Use a restrained real home interior with plausible wooden furniture and a window; only a few relevant background details. Soft natural window light, with the entire product clearly focused and the distant room softly blurred.',
    'seasonal-lifestyle': scene === 'christmas' ? 'Use restrained Christmas home context: subtle pine greenery and warm background lights, never new ornaments on the product.' : scene === 'autumn' ? 'Use restrained autumn home context with a few subdued leaves or warm seasonal accents behind the product.' : scene === 'study' ? 'Use a quiet reading desk scene, with books and a softly lit lamp in the distant background, separate from the product.' : 'Use a restrained home scene relevant to the actual product theme; if no clear season is specified, use a neutral interior with no holiday decorations.',
    'white-studio': 'Use a pure white studio background, soft even studio lighting, clear product edges and natural contact shadows. Do not add furniture, wood texture or background props.',
  }
  return scenes[settings.photography_preset] + ' Keep true product colours, balanced colour temperature and soft realistic illumination. The full subject, including its head, feet and accessories, remains in focus; only the distant background may blur. Supports, contact shadows, surface perspective and object scale must be physically coherent, not a cutout pasted onto scenery.'
}

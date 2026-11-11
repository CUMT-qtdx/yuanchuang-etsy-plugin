// 仅扩展背景输入与旧设置兼容，不修改已发布的摄影/构图v1.0规则正文。
import { photographyPresets as builtInPresets, normalizePhotography as normalizeBase, effectivePhotography as effectiveBase, photographyBlock as baseBlock, type PhotographySettings as BaseSettings } from './photography-v1.ts'
import { compositionBlock as baseComposition } from './composition-v1.ts'
import type { FeltScene } from './types.ts'
export { PHOTOGRAPHY_VERSION, defaultPhotography, aspectRatios } from './photography-v1.ts'
export const photographyPresets = [...builtInPresets, { value: 'custom', label: '其他 / 自定义' }] as const
export type PhotographySettings = Omit<BaseSettings, 'photography_preset'> & { photography_preset: BaseSettings['photography_preset'] | 'custom'; custom_background?: string }
const toBase = (settings: PhotographySettings): BaseSettings => ({ ...settings, photography_preset: settings.photography_preset === 'custom' ? 'natural-tabletop' : settings.photography_preset })
export function normalizePhotography(value: unknown, fallback?: PhotographySettings): PhotographySettings {
  const raw = value === undefined ? fallback : value
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return normalizeBase(raw)
  const input = raw as Record<string, unknown>
  if (input.custom_background !== undefined && (typeof input.custom_background !== 'string' || input.custom_background.length > 1000)) throw new Error('自定义背景请控制在1000字以内')
  const custom = input.photography_preset === 'custom'
  const settings = normalizeBase({ ...input, ...(custom ? { photography_preset: 'natural-tabletop' } : {}) }, fallback ? toBase(fallback) : undefined)
  // 旧版下拉框与勾选项冲突时保留原有效行为，但界面只展示一个明确值。
  return { ...settings, photography_preset: settings.preserve_background ? 'preserve-original' : custom ? 'custom' : settings.photography_preset,
    preserve_background: settings.preserve_background || settings.photography_preset === 'preserve-original',
    ...(typeof input.custom_background === 'string' ? { custom_background: input.custom_background.trim() } : {}) }
}
export function effectivePhotography(settings: PhotographySettings, userText: string): PhotographySettings {
  const result = effectiveBase(toBase(settings), userText)
  return { ...settings, ...result, ...(settings.photography_preset === 'custom' && !result.preserve_background ? { photography_preset: 'custom' as const } : {}) }
}
export function photographyBlock(settings: PhotographySettings, scene: FeltScene, userText: string): string {
  if (settings.photography_preset !== 'custom' || settings.preserve_background) return baseBlock(toBase(settings), scene, userText)
  if (!settings.custom_background?.trim()) throw new Error('选择“其他 / 自定义”后，请填写背景描述')
  return `Use this user-defined photographic environment: ${settings.custom_background.trim()}. Apply it to the scene only; do not redesign the product or add accessories to it. Explicit latest user instructions take precedence over this saved scene. Preserve true product colours, realistic support, coherent contact shadows and spatial scale. Keep the full product and its fine material details in focus, with a naturally softer distant background. Do not add an automatic wooden table, wall or seasonal props unless requested in this description.`
}
export function compositionBlock(settings: PhotographySettings): string { return baseComposition(toBase(settings)) }

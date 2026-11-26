// 仅扩展背景输入与旧设置兼容，不修改已发布的摄影/构图v1.0规则正文。
import { photographyPresets as builtInPresets, normalizePhotography as normalizeBase, effectivePhotography as effectiveBase, explicitBackground, photographyBlock as baseBlock, type PhotographySettings as BaseSettings } from './photography-v1.ts'
import { compositionBlock as baseComposition } from './composition-v1.ts'
import type { FeltScene } from './types.ts'
import { photographicEnvironment } from './photography-contract.ts'
export { PHOTOGRAPHY_VERSION, defaultPhotography, aspectRatios } from './photography-v1.ts'
export const photographyPresets = [...builtInPresets, { value: 'custom', label: '其他 / 自定义' }] as const
export type PhotographySettings = Omit<BaseSettings, 'photography_preset'> & { photography_preset: BaseSettings['photography_preset'] | 'custom'; custom_background?: string; scene_theme?: FeltScene; explicit_controls?: Array<'background' | 'framing' | 'aspect'> }
const toBase = (settings: PhotographySettings): BaseSettings => ({ ...settings, photography_preset: settings.photography_preset === 'custom' ? 'natural-tabletop' : settings.photography_preset })
export function normalizePhotography(value: unknown, fallback?: PhotographySettings): PhotographySettings {
  const raw = value === undefined ? fallback : value
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return normalizeBase(raw)
  const input = raw as Record<string, unknown>
  if (input.custom_background !== undefined && (typeof input.custom_background !== 'string' || input.custom_background.length > 1000)) throw new Error('自定义背景请控制在1000字以内')
  const custom = input.photography_preset === 'custom'
  const settings = normalizeBase({ ...input, ...(custom ? { photography_preset: 'natural-tabletop' } : {}) }, fallback ? toBase(fallback) : undefined)
  // 当前下拉选项是背景的单一来源，残留旧布尔标记不能覆盖新选择。
  const preset = Array.isArray(input.explicit_controls) && input.explicit_controls.includes('background')
    ? custom ? 'custom' as const : settings.photography_preset
    : settings.preserve_background ? 'preserve-original' as const : custom ? 'custom' as const : settings.photography_preset
  const controls = Array.isArray(input.explicit_controls) ? input.explicit_controls.filter((value): value is 'background' | 'framing' | 'aspect' => value === 'background' || value === 'framing' || value === 'aspect') : []
  const theme = ['minimal','lifestyle','christmas','autumn','study'].includes(String(input.scene_theme)) ? input.scene_theme as FeltScene : undefined
  return { ...settings, photography_preset: preset,
    preserve_background: preset === 'preserve-original',
    ...(controls.length ? { explicit_controls: [...new Set(controls)] } : {}), ...(theme ? { scene_theme: theme } : {}),
    ...(typeof input.custom_background === 'string' ? { custom_background: input.custom_background.trim() } : {}) }
}
export function effectivePhotography(settings: PhotographySettings, userText: string): PhotographySettings {
  const result = effectiveBase(toBase(settings), userText)
  const controls = settings.explicit_controls ?? []
  return { ...settings, ...result, ...(settings.photography_preset === 'custom' && !result.preserve_background ? { photography_preset: 'custom' as const } : {}),
    ...(controls.includes('background') ? { photography_preset: settings.photography_preset, preserve_background: settings.photography_preset === 'preserve-original' } : {}),
    ...(controls.includes('framing') ? { framing_policy: settings.framing_policy, subject_height_ratio: settings.subject_height_ratio } : {}),
    ...(controls.includes('aspect') ? { aspect_ratio: settings.aspect_ratio } : {}) }
}
export function photographyBlock(settings: PhotographySettings, scene: FeltScene, userText: string): string {
  if (settings.explicit_controls?.includes('background')) return photographyBlockV2(settings, scene, userText)
  if (settings.photography_preset !== 'custom' || settings.preserve_background) return baseBlock(toBase(settings), scene, userText)
  if (!settings.custom_background?.trim()) throw new Error('选择“其他 / 自定义”后，请填写背景描述')
  return `Use this user-defined photographic environment: ${settings.custom_background.trim()}. Apply it to the scene only; do not redesign the product or add accessories to it. Explicit latest user instructions take precedence over this saved scene. Preserve true product colours, realistic support, coherent contact shadows and spatial scale. Keep the full product and its fine material details in focus, with a naturally softer distant background. Do not add an automatic wooden table, wall or seasonal props unless requested in this description.`
}
export function photographyBlockV2(
  settings: PhotographySettings,
  scene: FeltScene,
  userText: string,
  options?: { ornament?: boolean; themeText?: string; latestInstruction?: string },
): string {
  // 改图指令里明确要求更换场景/背景时，直接转为自定义场景替换，避免残留旧预设（如禁止节日装饰的木桌或保留原背景）与最新指令冲突。
  if (options?.latestInstruction && explicitBackground(options.latestInstruction)) {
    return photographicEnvironment(
      { ...settings, photography_preset: 'custom', preserve_background: false, custom_background: options.latestInstruction.trim() },
      scene,
      options,
    )
  }
  if (settings.photography_preset !== 'custom') return photographicEnvironment(settings, scene, options)
  if (settings.preserve_background) return baseBlock(toBase(settings), scene, userText)
  if (!settings.custom_background?.trim()) throw new Error('选择“其他 / 自定义”后，请填写背景描述')
  return photographicEnvironment(settings, scene, options)
}
export function compositionBlock(settings: PhotographySettings): string { return baseComposition(toBase(settings)) }

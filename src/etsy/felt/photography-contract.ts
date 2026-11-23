import type { PhotographySettings } from './photography-options.ts'
import type { FeltScene } from './types.ts'

export const PHOTOGRAPHY_CONTRACT_VERSION = '1.1' as const
export interface CompositionTarget { version: '1.1'; heightRatio: number; top: number; bottom: number; tolerance: number }

// 数值框约束整组商品在最终画幅中的高度，阴影和背景道具不计入。
// 悬挂与俯拍平铺改为居中留白，避免强压底边裁断顶部挂绳或破坏平铺平衡。
export function compositionTarget(settings: PhotographySettings): CompositionTarget | undefined {
  if (settings.framing_policy !== 'override_reference') return undefined
  const heightRatio = Math.max(0.35, Math.min(0.9, settings.subject_height_ratio))
  const centered = settings.photography_preset === 'hanging-display' || settings.photography_preset === 'flat-lay'
  if (centered) {
    const top = Number(((1 - heightRatio) / 2).toFixed(4))
    return { version: PHOTOGRAPHY_CONTRACT_VERSION, heightRatio, top, bottom: Number((top + heightRatio).toFixed(4)), tolerance: 0.04 }
  }
  return { version: PHOTOGRAPHY_CONTRACT_VERSION, heightRatio, bottom: 0.92, top: Number((0.92-heightRatio).toFixed(4)), tolerance: 0.04 }
}

export function targetCompositionBlock(settings: PhotographySettings): string {
  const frame = settings.aspect_ratio === 'auto' ? 'Use the requested output aspect ratio.' : `Output aspect ratio: ${settings.aspect_ratio}.`
  const target = compositionTarget(settings)
  if (!target) return `${frame} Keep the original overall framing and visible product size. Keep the entire visible product or group intact.`
  const pct = (n: number) => Math.round(n * 100)
  const layoutNote = settings.photography_preset === 'hanging-display'
    ? ' Keep all hanging cords and top loops visible inside the frame with comfortable top clearance; do not force a tabletop base.'
    : settings.photography_preset === 'flat-lay'
      ? ' Maintain balanced overhead top-down spacing around every piece and its resting hanging loop; never crop any ornament at the canvas borders and do not tilt into a tabletop standing view.'
      : ''
  return `${frame} CAMERA FRAMING TARGET: the full visible product group must span ${pct(target.heightRatio)}% of the final output height (approximately ±${pct(target.tolerance)} percentage points). Its top is at ${pct(target.top)}% and bottom at ${pct(target.bottom)}% of the output image height, measured from the top of the canvas. This includes the combined highest and lowest visible product parts across all objects, but excludes shadows and background props. The original-reference occupancy is not locked. Reframe the camera and surrounding scene to these target boundaries while keeping the product's internal proportions and arrangement. A small subject needs visibly more real environment above and around it; do not fill the frame with the original close-up. Do not shrink only one part, crop the product, or draw labels, ruler lines or frames in the final photograph.${layoutNote}`
}

// 只提取背景的宽泛主题，不把商品名字或读图中的部件猜测发送到设计简报。
export function photographyTheme(description: string, scene: FeltScene = 'minimal'): FeltScene {
  if (scene === 'christmas' || scene === 'autumn' || scene === 'study') return scene
  if (/圣诞|\bchristmas\b/i.test(description)) return 'christmas'
  if (/秋季|秋天|感恩节|\bautumn\b|\bthanksgiving\b/i.test(description)) return 'autumn'
  if (/书房|阅读|\bstudy\b|\breading\b/i.test(description)) return 'study'
  return 'lifestyle'
}

export function photographicEnvironment(settings: PhotographySettings, scene: FeltScene): string {
  if (settings.photography_preset === 'preserve-original') return 'Preserve the source photographic background, supporting surface and lighting. Only the separately selected framing target may change the camera distance and surrounding space. Keep the product itself unchanged except for the requested material or explicit user edits.'
  const scopes = 'Replace the source photographic environment. The original photo supplies the PRODUCT DESIGN ONLY, not the background, tabletop, room, light or camera distance. Rebuild a visibly different environment matching this selected setting. Preserve the actual product geometry, patterns, colours and all existing parts; environment decoration remains separate from the product.'
  const scenes = {
    'natural-tabletop': 'SCENE: a clean natural oak tabletop product-photography setup. Visible wood grain and an uncluttered warm-grey plaster wall, softly lit from the side; no living-room furniture or seasonal decorations. If the source is also a wood-table scene, create a different table grain, wall treatment, surface perspective and lighting layout rather than copying its background.',
    'home-lifestyle': 'SCENE: a real furnished living room. Place the product on a matte light stone or painted sideboard; show recognizable sofa upholstery, a distant bookcase or floor lamp, and a broad room depth behind it. Furniture stays in the background. Do not substitute the source wood tabletop and blank wall for this furnished room.',
    'seasonal-lifestyle': settings.scene_theme === 'christmas' || scene === 'christmas'
      ? 'SCENE: a Christmas-decorated home display console with subtle evergreen greenery and warm string-light bokeh across the rear wall, a distant hearth or decorated shelf. These details must be visibly recognizable in the background, separate from the product, not attached to it.'
      : settings.scene_theme === 'autumn' || scene === 'autumn'
        ? 'SCENE: a warm autumn display shelf with dried-leaf arrangements and amber textiles behind the product; show the seasonal setting clearly, keeping its props separate from the product.'
        : settings.scene_theme === 'study' || scene === 'study'
          ? 'SCENE: a real study desk with readable book-spine shapes and a desk lamp in the distant background, not a plain wall. All surrounding objects are distinct from the product.'
          : 'SCENE: a styled seasonal home display shelf with a soft textile runner, a background arrangement of flowers or foliage and warm decorative lights. Make the environment recognizable and visibly different from a bare wooden table and blank wall. Surrounding decor stays separate from the product.',
    'hanging-display': 'SCENE: a natural hanging product-photography display. Suspend the ornament(s) naturally by their top jute twine loop or thin cotton hanging cord from real evergreen spruce/pine tree branches, a taut horizontal rustic twine line, or warm wooden mantel hooks. Every hanging cord must connect physically to the ornament top cap/eyelet and remain taut under natural gravity, with comfortable clearance above the top loop so nothing is cropped. Show soft warm festive indoor background depth (gentle string-light bokeh, pine cones, or cozy room warmth) well behind the product; background decor stays separate and never attaches to the product.',
    'flat-lay': 'SCENE: a crisp 90-degree top-down overhead flat-lay product photograph. Arrange the ornament(s) neatly on a dark weathered wooden board, textured natural linen cloth, or clean matte off-white backdrop. Keep every single ornament and its complete attached hanging loop fully inside the frame with comfortable outer margins—never crop or cut off any piece at the image edges, and never omit the top loop on any piece. Let each ornament\'s top twine loop or hanging string curve and rest naturally above or beside it on the surface. Restrained natural corner accents (evergreen pine sprigs, pine cones, dried orange slices or cinnamon sticks) may frame the outer edges without overlapping or obscuring any product. Use even diffused overhead daylight with soft close contact shadows directly beneath each piece.',
    'white-studio': 'SCENE: a pure white seamless studio cyclorama with a white matte supporting surface and a soft neutral contact shadow. The background and support must read as white studio space; remove source furniture, wood grain, window shapes and room textures.',
    custom: `SCENE requested by the user: ${settings.custom_background?.trim() || ''}. If the request only asks for a realistic or different scene without naming objects, choose a concrete believable furnished-room setting visibly different from the source. Otherwise render its specified surfaces, spatial features and lighting as visible facts of the environment. Do not retain the source setting merely because it also looks realistic. Do not infer new product parts from environmental words.`,
  }
  const closing = settings.photography_preset === 'hanging-display'
    ? 'Keep true product colours, natural gravity-guided hanging support and crisp wool/embroidery detail across the entire subject; let the distant festive background soften naturally.'
    : settings.photography_preset === 'flat-lay'
      ? 'Keep true product colours, even overhead illumination, soft flat-lay shadows and sharp wool/embroidery detail across every visible piece.'
      : 'Keep true product colours, coherent contact shadows and physical support. Keep the full visible product in focus; let distant environmental detail soften naturally without disappearing into an indistinct blank wall.'
  return `${scopes}\n${scenes[settings.photography_preset]} ${closing}`
}

import type { PhotographySettings } from './photography-options.ts'
import type { FeltScene } from './types.ts'

export const PHOTOGRAPHY_CONTRACT_VERSION = '1.1' as const
export interface CompositionTarget { version: '1.1'; heightRatio: number; top: number; bottom: number; tolerance: number }

export type RichSceneTheme = 'christmas' | 'halloween' | 'autumn' | 'woodland' | 'study' | 'lifestyle'

// 真实光学融合规范：强制按新场景重新布光、柔和轮廓光包裹毛毡细纤维、自然接触阴影与真实浅景深，消除“抠图 P 上去”观感。
const PHOTOREALISTIC_INTEGRATION = 'PHOTOREALISTIC INTEGRATION: Re-light the entire product so its highlight direction, shadow side, ambient fill and colour temperature genuinely match the new environment—never keep flat or mismatched studio lighting from the source photo. Let subtle ambient bounce and soft rim light catch the fine outer wool fibers so product edges blend optically into the scene with zero hard cutout halo or pasted-on look. Ground every resting base with soft natural ambient-occlusion contact shadows aligned to the scene light direction, coherent camera eye-level perspective and realistic scale relative to nearby surfaces. Capture as one unified real photograph on a 50mm-85mm lens with natural shallow depth of field (entire product crisp in focus, midground and background softening into organic lens bokeh with subtle real camera texture).'

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
  if (/圣诞|雪人|麋鹿|驯鹿|圣诞树|姜饼|冬日|雪花|\b(?:christmas|xmas|holiday|snowman|reindeer|santa|winter|festive)\b/i.test(description)) return 'christmas'
  if (/秋季|秋天|感恩节|枫叶|橡果|南瓜|丰收|万圣|\b(?:autumn|fall|thanksgiving|harvest|maple|acorn|pumpkin|halloween)\b/i.test(description)) return 'autumn'
  if (/书房|阅读|书本|图书馆|\b(?:study|reading|library|bookshelf)\b/i.test(description)) return 'study'
  return 'lifestyle'
}

// 更细粒度识别实景主题，用于给「主题生活场景」生成更贴合商品气质的真实拍摄环境。
export function resolveRichSceneTheme(description: string, scene: FeltScene = 'minimal'): RichSceneTheme {
  if (/万圣|女巫|巫师帽|幽灵|蝙蝠|南瓜灯|\b(?:halloween|witch|ghost|bat|jack-o-lantern)\b/i.test(description)) return 'halloween'
  if (scene === 'christmas' || /圣诞|雪人|麋鹿|驯鹿|圣诞树|姜饼|冬日|雪花|\b(?:christmas|xmas|holiday|snowman|reindeer|santa|winter|festive)\b/i.test(description)) return 'christmas'
  if (scene === 'autumn' || /秋季|秋天|感恩节|枫叶|橡果|南瓜|丰收|\b(?:autumn|fall|thanksgiving|harvest|maple|acorn|pumpkin)\b/i.test(description)) return 'autumn'
  if (/森林|森系|蘑菇|精灵|花仙|花园|春天|春季|复活节|草地|林间|苔藓|田园|\b(?:woodland|forest|mushroom|fairy|garden|spring|easter|floral|botanical|moss|meadow|gnome)\b/i.test(description)) return 'woodland'
  if (scene === 'study' || /书房|阅读|书本|图书馆|\b(?:study|reading|library|bookshelf)\b/i.test(description)) return 'study'
  return 'lifestyle'
}

export function photographicEnvironment(
  settings: PhotographySettings,
  scene: FeltScene,
  options?: { ornament?: boolean; themeText?: string },
): string {
  if (settings.photography_preset === 'preserve-original') {
    return 'Preserve the source photographic background, supporting surface and lighting. Only the separately selected framing target may change the camera distance and surrounding space. Keep the product itself unchanged except for the requested material or explicit user edits.'
  }
  const ornament = !!options?.ornament
  const richTheme = resolveRichSceneTheme(options?.themeText ?? '', settings.scene_theme ?? scene)
  const scopes = 'Replace the source photographic environment. The original photo supplies the PRODUCT DESIGN ONLY, not the background, tabletop, room, light or camera distance. Rebuild a visibly different, physically believable real-world environment matching this selected setting. Preserve the actual product geometry, patterns, colours and all existing parts; environment decoration remains separate from the product.'
  const ornamentSurfaceNote = ornament && settings.photography_preset !== 'hanging-display' && settings.photography_preset !== 'flat-lay'
    ? ' Because this is a hanging ornament photographed in a tabletop or room scene, either suspend it naturally by its top cord from a real visible branch/hook/stand above, OR let it rest naturally on the surface with its hanging loop softly draped behind or beside it—never draw a taut rope pulling upward from empty space while the ornament simultaneously stands on a tabletop.'
    : ''

  const seasonalScenes: Record<RichSceneTheme, string> = {
    christmas: 'SCENE: a warm, authentic Christmas home tabletop or wooden mantel photographed in soft winter window daylight blended with warm golden string-light bokeh in the distant background. Place the product on a real weathered wood console or textured cream linen runner; arrange subtle fresh evergreen spruce/pine sprigs, natural pine cones, or a softly blurred decorated Christmas tree well behind the product in shallow depth of field. All festive props remain cleanly separate from the product and never attach to it.',
    halloween: 'SCENE: a cozy, natural autumn-evening wooden shelf with moody warm candlelight glow and soft window twilight depth behind the product. Include restrained, softly blurred seasonal background accents (miniature natural pumpkins, dried autumn twigs, dark linen texture) well behind the product; keep all props separate from the product.',
    autumn: 'SCENE: a warm sunlit autumn home display on a weathered wood shelf or woven oatmeal runner, with softly blurred dried autumn foliage, muted amber textiles and warm afternoon window light across the distant room. Keep all seasonal accents separate from the product.',
    woodland: 'SCENE: an authentic sunlit woodland/cottage-core tabletop setup using a natural rustic wood slice or textured linen surface near a bright window, with softly out-of-focus real moss, fern sprigs or indoor botanical greenery in the background depth. Natural dappled window daylight, never artificial CGI glow; all natural accents stay separate from the product.',
    study: 'SCENE: a real warm wooden study desk near natural window light, with softly out-of-focus vintage book spines, a linen notebook and a warm brass desk lamp in the distant background rather than a plain wall. All surrounding objects stay distinct from the product.',
    lifestyle: 'SCENE: a realistic sunlit handmade-shop display styled to naturally suit the product\'s own theme and colour palette—place the product on a tactile natural wood console, woven linen cloth or matte ceramic tray, with soft real room depth, subtle indoor greenery or neutral artisanal accents gently blurred in the background. Visibly richer and warmer than a bare blank wall, with no unrelated holiday clutter and all decor separate from the product.',
  }

  const scenes = {
    'natural-tabletop': 'SCENE: an authentic handmade-shop tabletop product photograph on a warm natural oak or matte solid-wood table with genuine subtle wood grain. Behind the table, show a softly sunlit, naturally out-of-focus warm cream or oatmeal interior room depth with gentle side-window light falloff—never a flat pasted-on grey studio slab. No living-room clutter or seasonal decorations. If the source is also a wood-table scene, create a visibly different wood tone, surface perspective and soft window-light direction rather than copying its background.',
    'home-lifestyle': 'SCENE: a real, lived-in sunlit living room. Place the product on a matte light stone, painted wood or woven-linen sideboard; show recognizable yet softly blurred sofa upholstery, a distant bookcase, indoor plant or warm floor lamp with genuine room depth behind it. Furniture stays well behind the product in natural shallow depth of field. Do not substitute a flat blank wall for this furnished room.',
    'seasonal-lifestyle': seasonalScenes[richTheme],
    'hanging-display': 'SCENE: a natural hanging product-photography display. Suspend the ornament(s) naturally by their top jute twine loop or thin cotton hanging cord from real evergreen spruce/pine tree branches, a taut horizontal rustic twine line, or a warm wooden mantel hook. Every hanging cord must connect physically to the ornament top cap/eyelet and hang taut under real gravity, with comfortable clearance above the top loop so nothing is cropped and no conflicting tabletop directly beneath the dangling bottom. Show soft warm indoor background depth (gentle golden string-light bokeh, distant pine foliage, or cozy sunlit room warmth) naturally blurred well behind the product; background decor stays separate and never attaches to the product.',
    'flat-lay': 'SCENE: a crisp 90-degree top-down overhead flat-lay product photograph. Arrange the ornament(s) neatly on a dark weathered wooden board, textured natural linen cloth, or clean matte off-white backdrop. Keep every single ornament and its complete attached hanging loop fully inside the frame with comfortable outer margins—never crop or cut off any piece at the image edges, and never omit the top loop on any piece. Let each ornament\'s top twine loop or hanging string curve and rest naturally above or beside it on the surface. Restrained natural corner accents (evergreen pine sprigs, pine cones, dried orange slices or cinnamon sticks) may frame the outer edges without overlapping or obscuring any product. Use even diffused overhead daylight with soft close contact shadows directly beneath each piece.',
    'white-studio': 'SCENE: a pure white seamless studio cyclorama with a white matte supporting surface and a soft neutral grounded contact shadow directly under the base. The background and support must read as clean white photographic studio space with even softbox wrap lighting around the wool edges; remove source furniture, wood grain, window shapes and room textures.',
    custom: `SCENE requested by the user: ${settings.custom_background?.trim() || ''}. Interpret this request into a concrete, physically believable real-world photography set with real tactile surfaces, authentic spatial depth, natural background props scaled realistically and placed in the midground/background (never pasted flat behind the subject), and lighting whose direction, softness and colour temperature naturally match the requested mood.${ornament ? ' Because this is a hanging ornament, suspend it naturally from a believable scene element (such as a pine branch, wooden hook or twine line) when the requested scene suits hanging, or rest it cleanly on a matching surface with the cord naturally draped—never dangle from invisible empty space onto a tabletop.' : ''} Do not retain the source background or source flat studio lighting. Do not infer or add new parts onto the product itself.`,
  }

  const closing = settings.photography_preset === 'hanging-display'
    ? 'Keep true product colours, real gravity-guided hanging physics, soft ambient rim light through outer wool fibers, and crisp wool/embroidery detail across the entire subject while the distant background softens into natural photographic bokeh.'
    : settings.photography_preset === 'flat-lay'
      ? 'Keep true product colours, even diffused overhead illumination, soft close contact shadows directly beneath every piece and sharp wool/embroidery detail across the entire flat-lay.'
      : PHOTOREALISTIC_INTEGRATION

  return `${scopes}\n${scenes[settings.photography_preset]}${ornamentSurfaceNote}\n${closing}`
}

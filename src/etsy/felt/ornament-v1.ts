// 基于 E:\etsy\小挂件模范图（6 个系列 25 张样本）提炼的小挂件针毡规则。
// 仅在检测到挂件形态或选用悬挂/俯拍平铺展示时启用，不影响原有桌面人物摆件。
import type { FeltProfile } from './types.ts'

export const ORNAMENT_RULES_VERSION = '1.0' as const
export const ORNAMENT_MODULE = 'ornament_v1_0' as const

// 挂件核心手感、挂绳顶帽硬件与手工表层刺绣保护（英文直供生图模型）。
export const ORNAMENT_CRAFT_V1 = [
  'ORNAMENT SCALE & SURFACE: Render each piece as a palm-sized, plump sculpted or softly puffed handmade needle-felted wool ornament. At close-up ornament scale, compact crisscrossed short wool fibers and a restrained, delicate stray-fiber edge halo are clearly readable, with rich warm wool saturation and subtle natural fiber melange rather than flat digital fills.',
  'HANGING HARDWARE & CORDS: Preserve every visible hanging component in its authentic material and physical connection—twisted natural jute twine loops (including knotted ends), thin cream cotton hanging strings, braided cord loops, ribbed or crown-shaped felted ornament caps, and tiny metal eyelets or jump rings. Keep hanging cords naturally taut when suspended and gently draped when laid flat; never turn thin cords or metal rings into thick wool strips and never crop or disconnect the top loop.',
  'HAND-EMBROIDERED & INLAID MOTIFS: Keep intentional hand-stitched wool or cotton embroidery (snowflakes, stars, botanical leaves, flowers, French knots, looped swirls, and running/blanket stitches along heels, toes or cuffs) as well as raised needle-felted inlays and miniature felt beads crisp and cleanly layered atop the matte felt body.',
].join('\n')

// 挂件模式负面约束：在严防针织底面、塑料光泽与 CGI 感的同时，豁免表层手工刺绣与正常垂挂连接。
export const ORNAMENT_NEGATIVE_V1 = 'Keep the established ornament silhouette, motifs, top caps, hanging cords and attachments that the PRIORITY items do not change. No components beyond the design and its planned changes, no artificial dirt, damage or exaggerated needle holes. On the needle-felted wool base body, no knitted or crochet stitches, woven grids, periodic textile patterns, synthetic plush, artificial loose hairs, artificial floating fuzz or artificial speckles (intentional surface hand-embroidery, stitched motifs, felt inlays and mini beads remain crisp and preserved). No plastic, ceramic, silicone or resin appearance or gloss, CGI sheen or CGI texture, airbrushed smoothness, detached floating pieces, disconnected or cropped hanging loops, fused bodies, letter labels (A, B, C, etc.) or added text.'

const ORNAMENT_CUE = /挂件|挂饰|吊饰|圣诞球|圣诞袜|树挂|钥匙扣|包挂|挂绳|麻绳环|羊眼钉|\b(?:ornament|ornaments|bauble|baubles|pendant|pendants|hanging\s+(?:decor|loop|cord|twine|string|charm|stocking|ball)|christmas\s+(?:ball|balls|stocking|stockings|tree\s+ornament)|keychain|bag\s+charm|jute\s+twine\s+loop|metal\s+eyelet)\b/i
const NEGATED_ORNAMENT = /(?:不要|无|没有|去掉|移除|禁止).{0,6}(?:挂件|挂饰|吊饰|挂绳|麻绳)|\b(?:no|without|avoid|remove)\s+(?:hanging\s+)?(?:ornament|loop|cord|twine|string)\b/i

function positiveText(value: string): string {
  return value.split(/[\n.!?。！？;；]/).filter(clause => !NEGATED_ORNAMENT.test(clause)).join(' ')
}

/** 自动识别当前生图任务是否属于小挂件/挂饰；人物与动物桌面摆件默认返回 false。 */
export function isOrnamentContext(
  profile: FeltProfile | undefined,
  texts: readonly string[],
  photographyPreset?: string,
): boolean {
  if (profile?.productForm === 'ornament') return true
  if (photographyPreset === 'hanging-display' || photographyPreset === 'flat-lay') return true
  if (profile?.productForm === 'figurine') return false
  return texts.some(text => text && ORNAMENT_CUE.test(positiveText(text)))
}

// 用户正式采用的视觉规则。此版本发布后保持不可变；修订请新增版本文件。
// 来源覆盖 MR-01～07、FR-01～06、PR-01～06、AR-01～07 与原文的部件及模型适配章节。
import type { FeltPart, MixedMaterial, FeltScene } from './types.ts'
export const FELT_LIBRARY_V1 = {
  id: 'etsy-real-needle-felt' as const,
  version: '1.0',
  name: '真实羊毛毡视觉规则库',
  adoptedAt: '2026-11-09',
  adoption: '用户确认已完成验证并正式采用；不重新安排A/B测试。',
  sourceSha256: '7686aa43b0551388f1de351fe314bafde31010d09d87a38ee0f9ec7c95413868',
  sourceFile: 'docs/felt-rules/source-v1.0.txt',
  sourceSampleCount: 17,
  priority: 'User-specified silhouette, face, pose, colours, clothing, accessories, quantity and surface motifs are hard constraints. Material treatment must not redesign them. Apply component rules only to parts already present or explicitly requested; never add a part, prop or ornament merely because a rule names it. Explicit user instructions outrank stylistic defaults.',
  material: {
    id: 'MR-01', text: 'Default to a compact needle-felted core, densely interlocked short wool fibers, fine visible crossed strands, soft matte light scattering, restrained natural fuzz and a subtle fiber halo. Realism comes from compact volume plus micro-fibers, not maximum fluff.',
  },
  density: { id: 'MR-02', text: 'Use different felting densities for different existing components; never cover the entire object with one uniform fuzzy texture.' },
  edges: { id: 'MR-03', text: 'Keep softly rounded, readable edges and believable felt thickness. A gently softened fiber contour must not become blur or rigid mold-cut outlines.' },
  light: { id: 'MR-04', text: 'Existing white, cream and ivory regions retain visible short fibers and subtle tonal variation; do not smooth them into featureless plastic.' },
  dark: { id: 'MR-05', text: 'Existing black and dark regions remain matte with a fine crossed fiber network, not glossy toy shells.' },
  curls: { id: 'MR-06', text: 'Curly or looped fleece is a local overlay only where the design calls for sheep fleece or a curled beard. Keep face, limbs and other compact parts distinct; do not spread curls across the whole object.' },
  mixed: { id: 'MR-07', text: 'Preserve explicitly present mixed-material accessories and their original material identity; keep proportions and physical connections believable. Small highlights belong only to appropriate beads or metal, not to felt surfaces.' },
  structure: { id: 'FR-01/02/03/04', text: 'Respect the approved shape and facial features. Within that shape, use readable compact sculpted volumes, believable thickness, supported attachments and stable contact points. Do not alter locked anatomy, pose or facial detail merely to simplify it.' },
  family: { id: 'FR-05', text: 'For newly designed multi-character sets, use cohesive materials and restrained individual variation rather than scale-cloned figures, only where the user permits it. Never alter a locked count, symmetry or approved proportions.' },
  continuity: { id: 'FR-06', text: 'Across views and edits, preserve the exact component inventory, identity, pattern geometry, hair arrangement, ties, tail and attachment positions. Only perspective and visible surfaces change; keep stripes as stripes and dots as dots.' },
  photography: { id: 'PR-01/03/04/05', text: 'Use a real-camera close product photograph, soft diffused daylight or window light, neutral-warm colour balance, and controlled depth of field. Keep the complete subject and its fiber detail clearer than the background. Use gentle contact shadows at actual supports; keep the requested viewpoint.' },
  sceneRule: { id: 'PR-02/06', text: 'Scene styling is optional and separate from material. Preserve a specified background. Do not add wood tables, seasonal props, candles or books unless they belong to the design or requested scene.' },
  avoid: { id: 'AR-01/02/04/05/06/07', text: 'Avoid plastic, ceramic, silicone, polished-resin or CGI sheen on felt; airbrushed smoothness; synthetic uniform fur; global long plush hair; oversharpened texture; floating or fused attachments; impossible unsupported thinness; artificial dirt, pilling, damage or coarse needle holes. Do not turn ribbons into wool strips, paper into felt, beads into fur, or wire glasses into felt rings.' },
  symmetry: { id: 'AR-03', text: 'Retain subtle hand-shaped variation where allowed, without distorting requested symmetry, expression, alignment or approved product identity.' },
} as const

export const FELT_PART_RULES: Record<FeltPart, { id: string; text: string }> = {
  body: { id: 'PART-body', text: 'Existing body: dense, compact short-fiber felt, clear sculpted volume and a restrained micro-fiber surface.' },
  face: { id: 'PART-face', text: 'Existing face and limbs: finely compacted felt; preserve every facial landmark and proportion, with clean readable edges.' },
  hair: { id: 'PART-hair', text: 'Existing hair: aligned directional wool strands following the hairstyle and head form, slightly looser than the face; no random fuzz blanket.' },
  beard: { id: 'PART-beard', text: 'Existing beard: gently arranged directional locks, softer than the coat; use controlled local curls only if the beard design already requires curls.' },
  wings: { id: 'PART-wings', text: 'Existing wings: layered felt components with real dimensional thickness and gently softened edges; preserve the exact wing shape, feather divisions and decorative markings.' },
  petals: { id: 'PART-petals', text: 'Existing petals: softly sculpted layered felt with fine fiber direction, readable overlap and rounded thickness; keep the original petal count and shape.' },
  leaves: { id: 'PART-leaves', text: 'Existing leaves: directional fibers following each leaf form and dimensional felt thickness, with supported stems and unchanged outline.' },
  shell: { id: 'PART-shell', text: 'Existing shell: compact raised felt sections, restrained grooves, interwoven directional fibers and softly thick edges; keep the same section layout and markings.' },
  clothing: { id: 'PART-clothing', text: 'Existing felt clothing: compact matte felt distinct from skin and hair, readable folds and layered hems; retain colour blocks, patterns and garment construction.' },
  trim: { id: 'PART-trim', text: 'Existing wool trim or hat brim: slightly fuller than the compact core with softly rounded felt thickness, never uncontrolled long fur.' },
  'felt-accessories': { id: 'PART-felt-accessories', text: 'Existing felt accessories: closely felted, clearly dimensional and physically attached, without losing miniature detail or replacing mixed materials.' },
  'curly-overlay': { id: 'PART-curly-overlay', text: 'An already specified sheep-fleece or curly-beard area may use irregular short wool curls or loops over a compact core; keep compact face and feet free of that overlay.' },
}
export const MIXED_MATERIAL_RULES: Record<MixedMaterial, { id: string; text: string }> = {
  'bead-eyes': { id: 'MIX-bead-eyes', text: 'Existing bead eyes retain tiny bead highlights and a smooth bead surface; the surrounding face stays matte felt.' },
  'wire-glasses': { id: 'MIX-wire-glasses', text: 'Existing wire glasses stay thin metal wire, correctly connected and proportional; do not replace them with wool loops.' },
  paper: { id: 'MIX-paper', text: 'Existing book pages stay thin paper, not thick felt slabs; preserve the book and page arrangement.' },
  'woven-ribbon': { id: 'MIX-woven-ribbon', text: 'Existing woven or fabric ribbon retains its textile weave, thickness and tied shape rather than becoming a wool rope.' },
  whiskers: { id: 'MIX-whiskers', text: 'Existing fine-thread whiskers remain fine supported threads with their original placement; do not add extra whiskers.' },
}
export const FELT_SCENE_RULES: Record<FeltScene, string> = {
  minimal: 'Use a simple neutral product background and plausible support unless the user specifies otherwise; no added decorative props.',
  lifestyle: 'Retain the requested restrained home setting; keep context softer and less prominent than the product.',
  autumn: 'Retain requested autumn context only, with subdued colours and props that never obscure the product fibers.',
  christmas: 'Retain requested Christmas context only; lights and greenery are background accents, never new product accessories.',
  study: 'Retain requested reading-room or desk context only; books and lamps stay secondary and never change the product inventory.',
}

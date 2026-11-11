// 通用真实针毡商品模板。槽位只能由程序一次性替换，不能把原始占位符发给图像模型。
export interface RealisticNeedleFeltTemplateSlots {
  SUBJECT: string
  QUANTITY: string
  POSE: string
  CAMERA_VIEW: string
  FACIAL_FEATURES: string
  COLOR_PALETTE: string
  SURFACE_TYPE: string
  BACKGROUND_STYLE: string
  ASPECT_RATIO: string
  SUBJECT_HEIGHT_RATIO: string
}

export const REALISTIC_NEEDLE_FELT_TEMPLATE_ID = 'realistic-needle-felt-product-v1' as const

export const REALISTIC_NEEDLE_FELT_PRODUCT_TEMPLATE = `**SUBJECT & IDENTITY**

Create a realistic handmade needle-felted wool figurine of {SUBJECT}, with {QUANTITY} and {POSE}, viewed from {CAMERA_VIEW}.

When using a reference image, preserve its recognizable character identity, proportions, facial features, colors, pose, and existing accessories, except for modifications explicitly requested by the user or listed as planned subject changes.

The figurine should consist of carefully sculpted, densely needle-felted wool components forming a cohesive physical object.

**SURFACE — AUTHENTIC NEEDLE-FELTED WOOL**

The sculpted wool body is made from densely compressed, naturally interlocked, non-woven wool fibers.

Show fine, short, irregularly entangled wool fibers partially embedded within the compact felt surface.

The fibers must appear integrated into the physical sculpted volume, not as a separate fuzzy coating over a smooth digital model.

Preserve subtle, non-repeating variations in fiber direction, compression, and surface density.

The surface should be softly matte and tactile, with gentle light scattering and restrained natural fuzz.

Avoid woven grids, knitted loops, parallel stitch rows, crochet patterns, yarn-like coils, synthetic plush fabric, and repeated digital fiber patterns on sculpted wool components.

Do not introduce artificial color speckles, dirt, or exaggerated needle holes.

**MATERIAL DIFFERENTIATION**

Apply distinct material properties according to each existing component.

- Sculpted wool body: dense, compact, fine irregular fibers.
- Face and limbs: finely compressed wool with subtle short fibers and clearly defined features.
- Wool hair or beard: natural directional fibers, with controlled volume.
- Felt wings, ears, petals, and layered parts: believable felt thickness, softly compressed edges, and natural fiber integration.
- Curly wool sections: natural wool locks only where explicitly appropriate.
- Small felt accessories: tightly sculpted, dimensional wool forms.

Do not apply identical fiber density or texture to every component.

Do not add components merely because they are listed in these material rules.

**FORM & PHYSICAL CONSTRUCTION**

Create compact, clearly sculpted three-dimensional forms with readable silhouettes and softly rounded edges.

Every component must have believable physical thickness, attachment points, and support.

Maintain natural handmade construction without excessive irregularity.

Avoid floating accessories, fused body parts, impossible thin structures, and rigid plastic-like contours.

**FACE & EXPRESSION**

Preserve or create {FACIAL_FEATURES}.

Keep facial features small, clearly defined, and physically integrated into the felt sculpture.

Retain realistic bead highlights if bead eyes are specified.

Do not invent extra facial details or change expressions unless explicitly requested.

**COLOR**

Preserve the specified color palette: {COLOR_PALETTE}.

For needle-felted components, colors should appear within the wool fibers themselves, with soft but readable transitions where appropriate.

Maintain clear intentional color boundaries and preserve existing patterns.

Do not introduce unintended gradients, stains, spots, or additional decorative colors.

**MIXED MATERIALS**

Preserve the distinct appearance of non-wool components whenever they are present.

Real cotton, linen, ribbons, paper, embroidery, metal wire, beads, and buttons must retain their respective material properties.

Woven or knitted patterns and visible stitches are allowed on explicitly textile-based garments, but must not spread onto the sculpted needle-felted body.

Do not automatically convert real fabric clothing into needle-felted wool.

**PRODUCT PHOTOGRAPHY**

Photograph the figurine on {SURFACE_TYPE}, in {BACKGROUND_STYLE}.

Use soft diffused natural light, balanced color temperature, realistic contact shadows, and coherent tabletop perspective.

Keep the product clearly in focus while allowing the distant background to remain softly blurred.

The image should resemble a real handcrafted miniature photographed with a physical camera.

**COMPOSITION**

Use a {ASPECT_RATIO} image.

The complete subject should occupy approximately {SUBJECT_HEIGHT_RATIO} of the total image height, unless the user explicitly requests another composition.

Preserve the figurine's internal anatomical proportions while adjusting the camera framing and surrounding space.

Keep the entire subject and all accessories visible, with natural negative space and a grounded base.

For wide animals and multi-character groups, fit the entire composition without cropping.

**FINAL QUALITY CONTROL**

The final result should resemble a carefully handcrafted needle-felted wool collectible with authentic compressed wool structure, visible but controlled natural fibers, and realistic material differentiation.

Avoid plastic, ceramic, silicone, polished resin, CGI gloss, synthetic uniform plush fur, artificial fuzzy overlays, knitted fabric textures on sculpted felt, excessive stray hairs, artificial dirt, and impossible physical construction.

Do not alter the approved subject design beyond the explicitly requested changes.

No added text, logos, or watermarks unless explicitly requested.`

const keyPattern = /\{([A-Z][A-Z0-9_]*)\}/g

export function renderRealisticNeedleFeltTemplate(slots: RealisticNeedleFeltTemplateSlots): string {
  for (const [key, value] of Object.entries(slots)) if (typeof value !== 'string' || !value.trim()) throw new Error(`通用针毡模板缺少槽位：${key}`)
  // 先把可信模板中的槽位换成唯一标记，再一次性写回值；值的原文即使含 {SUBJECT} 也不会被二次替换。
  const replacements: string[] = []
  const marked = REALISTIC_NEEDLE_FELT_PRODUCT_TEMPLATE.replace(keyPattern, (match, key: string) => {
    if (!(key in slots)) throw new Error(`通用针毡模板存在未知槽位：${key}`)
    const token = `\u0000R3_TEMPLATE_SLOT_${replacements.length}\u0000`
    replacements.push(slots[key as keyof RealisticNeedleFeltTemplateSlots].trim())
    return token
  })
  const leftover = marked.match(keyPattern)
  if (leftover?.length) throw new Error(`通用针毡模板槽位未替换：${[...new Set(leftover)].join(', ')}`)
  return replacements.reduce((text, value, index) => text.replaceAll(`\u0000R3_TEMPLATE_SLOT_${index}\u0000`, value), marked)
}

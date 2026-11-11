import { FELT_LIBRARY_V1, FELT_PART_RULES, MIXED_MATERIAL_RULES } from './library-v1.ts'
import { PHOTOGRAPHY_VERSION, defaultPhotography, effectivePhotography, normalizePhotography, photographyBlock } from './photography-options.ts'
import { COMPOSITION_VERSION } from './composition-v1.ts'
import { compositionBlock } from './photography-options.ts'
import type { PhotographySettings } from './photography-options.ts'
import type { FeltAdapter, FeltApplication, FeltPart, FeltProfile, FeltRequestContext, FeltScene, FeltStage, MixedMaterial } from './types.ts'
import { MULTI_VIEW_MODULE, MULTI_VIEW_VERSION, multiViewPrompt, type MultiViewContext } from '../multi-view/consistency-v1.ts'
import { firstPassSurfacePrompt, SURFACE_CONTINUITY_MODULE } from '../multi-view/surface-continuity-v1.ts'
import { directionFor, VIEW_DIRECTION_MODULE } from '../multi-view/view-direction-v1.ts'
import { EXPERIMENTAL_MATERIAL, MATERIAL_V1_0_2, MATERIAL_REVISION, normalizeMaterialPreset, normalizeMaterialComponents, inferMaterialComponents, experimentalComponentRules, materialAnalysisV1_0_2, materialIdentityV1_0_2, materialReviewV1_0_2 } from './material-v1-0-2.ts'
import { stripMaterialRuleBlocks, resolveMaterialProfile, resolveMaterialText } from './material-assembly.ts'
import type { MaterialPreset } from './types.ts'
import { STUDIO_MATERIAL_V2, materialAnalysisV2, normalizeMaterialPlanV2, stripOwnedBlocksV2 } from './material-policy-v2.ts'
import { composeStudioV2 } from './composer-v2.ts'

export const FELT_RULES_VERSION = '1.0'
export function feltLibrary(version = FELT_RULES_VERSION) {
  if (version !== '1.0') throw new Error(`不支持的羊毛毡视觉规则版本：${version}`)
  return FELT_LIBRARY_V1
}
const parts = Object.keys(FELT_PART_RULES) as FeltPart[], mixed = Object.keys(MIXED_MATERIAL_RULES) as MixedMaterial[]
const scenes: FeltScene[] = ['minimal', 'lifestyle', 'autumn', 'christmas', 'study']
export function normalizeProfileV2(value: unknown): FeltProfile {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const select = <T extends string>(v: unknown, allowed: T[]): T[] => Array.isArray(v) ? [...new Set(v.filter((item): item is T => typeof item === 'string' && allowed.includes(item as T)))] : []
  return { components: select(raw.components, parts), mixedMaterials: select(raw.mixedMaterials, mixed), tones: select(raw.tones, ['light', 'dark']),
    scene: scenes.includes(raw.scene as FeltScene) ? raw.scene as FeltScene : 'minimal', materialPlan: normalizeMaterialPlanV2(raw.materialPlan).plan }
}
const partMatches: Array<[FeltPart, RegExp]> = [
  ['face', /脸|面部|五官|\bface\b|facial/i], ['hair', /头发|发髻|发型|\bhair\b|hairstyle/i], ['beard', /胡须|胡子|\bbeard\b/i],
  ['wings', /翅膀|羽翼|\bwings?\b/i], ['petals', /花瓣|\bpetals?\b/i], ['leaves', /叶片|树叶|\bleaves?\b/i],
  ['shell', /龟壳|甲壳|\bshell\b/i], ['clothing', /服装|裙|外套|围裙|\b(?:coat|dress|clothing|apron)\b/i],
  ['trim', /帽檐|绒边|\b(?:trim|hat brim)\b/i], ['curly-overlay', /绵羊|卷毛|卷曲胡须|\b(?:sheep|curly beard|curly fleece)\b/i],
]
const mixedMatches: Array<[MixedMaterial, RegExp]> = [
  ['bead-eyes', /珠眼|\bbead eyes?\b/i], ['wire-glasses', /金属.*眼镜|铁丝.*眼镜|\bwire glasses\b/i],
  ['paper', /纸页|纸质|\bpaper (?:pages?|book)\b/i], ['woven-ribbon', /丝带|布.*飘带|\b(?:woven|fabric|satin) ribbon\b/i], ['whiskers', /细线.*胡须|\bwhiskers\b/i],
]
function positiveDesignText(value: string): string {
  // 兜底只读取设计内容；明确否定的部件不能被识别为“需要添加”。
  return value.split(/[\n.!?。！？;]/).filter(clause => !/(?:无|没有|不要|不加|禁止).{0,8}(?:翅膀|头发|胡须|叶片|龟壳)|\b(?:no|without|avoid|do not add)\b/i.test(clause)).join(' ')
}
export function normalizeFeltProfile(value: unknown, fallbackText = ''): FeltProfile {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const select = <T extends string>(value: unknown, allowed: T[]): T[] => Array.isArray(value) ? [...new Set(value.filter((item): item is T => typeof item === 'string' && allowed.includes(item as T)))] : []
  const text = positiveDesignText(fallbackText)
  const components = Array.isArray(raw.components) ? select(raw.components, parts) : partMatches.filter(([, pattern]) => pattern.test(text)).map(([key]) => key)
  const mixedMaterials = Array.isArray(raw.mixedMaterials) ? select(raw.mixedMaterials, mixed) : mixedMatches.filter(([, pattern]) => pattern.test(text)).map(([key]) => key)
  const tones = select(raw.tones, ['light', 'dark'] as Array<'light' | 'dark'>)
  if (!Array.isArray(raw.tones)) {
    if (/白|米色|奶油|\b(?:white|ivory|cream)\b/i.test(text)) tones.push('light')
    if (/黑|深色|\b(?:black|charcoal|dark)\b/i.test(text)) tones.push('dark')
  }
  const scene: FeltScene = scenes.includes(raw.scene as FeltScene) ? raw.scene as FeltScene
    : /圣诞|\bchristmas\b/i.test(text) ? 'christmas' : /秋季|感恩节|\b(?:autumn|thanksgiving)\b/i.test(text) ? 'autumn' : /读书|阅读|\breading\b/i.test(text) ? 'study' : 'minimal'
  return { components: [...new Set(['body' as const, ...components])], mixedMaterials, tones, scene,
    ...(Array.isArray(raw.materialComponents) ? { materialComponents: normalizeMaterialComponents(raw.materialComponents) } : {}),
    ...(raw.materialPlan ? { materialPlan: normalizeMaterialPlanV2(raw.materialPlan).plan } : {}) }
}
export function profileForEdit(value: unknown, fallbackText: string, instruction: string): FeltProfile {
  const base = normalizeFeltProfile(value, fallbackText)
  if (!instruction.trim()) return base
  const additions = normalizeFeltProfile(undefined, instruction)
  base.components = [...new Set([...base.components, ...additions.components])]
  base.mixedMaterials = [...new Set([...base.mixedMaterials, ...additions.mixedMaterials])]
  base.tones = [...new Set([...base.tones, ...additions.tones])]
  for (const [part, pattern] of partMatches) {
    const match = pattern.exec(instruction)
    if (match && /(?:去掉|移除|不要|删除|无|\bremove\b|\bwithout\b|\bno\b)\s*(?:the\s+)?[^，。,.]{0,8}$/i.test(instruction.slice(Math.max(0, match.index - 20), match.index))) base.components = base.components.filter(item => item !== part)
  }
  return base
}
export function feltAdapter(model: string, subscription?: string): FeltAdapter {
  if (subscription === 'google-sub') return 'gemini'
  if (subscription === 'chatgpt-sub') return 'gpt-image'
  if (subscription === 'grok-sub') return 'grok'
  if (/gemini|nano[-_ ]?banana/i.test(model)) return 'gemini'
  if (/gpt[-_ ]?image|chatgpt[-_ ]?image|dall[-_ ]?e/i.test(model)) return 'gpt-image'
  if (/grok|imagine[-_ ]?image/i.test(model)) return 'grok'
  return 'generic'
}

export function feltAnalysisInstructions(stage: 'planning' | 'identity' | 'quality', version = FELT_RULES_VERSION, materialPreset?: MaterialPreset): string {
  if (materialPreset === STUDIO_MATERIAL_V2) return materialAnalysisV2(stage)
  const library = feltLibrary(version)
  return [
    `[NEEDLE_FELT_ANALYSIS:v${library.version}]`,
    '用户明确保留的主体、五官、比例、姿势、配色、服饰、配饰、纹样和数量优先；视觉规则只改变材质与允许的摄影表现，不能借简化造型、自然不对称或增加纤维之名改动这些特征。',
    '默认材质为紧实压实的毡芯、细短交错羊毛纤维、柔和哑光、受控微绒和清楚但略柔化的边缘。真实感不是全身更长、更蓬松。',
    materialPreset === EXPERIMENTAL_MATERIAL ? (stage === 'quality' ? materialReviewV1_0_2 : stage === 'identity' ? materialIdentityV1_0_2 : materialAnalysisV1_0_2) : '先读图中的实际部件，再按部件安排密度：身体和脸紧实；已有头发用方向性纤维；胡须较松但卷毛仅限设计已有卷毛处；翅膀、花瓣、叶片、龟壳和衣摆用分层且有厚度的毡构件；小毡配饰紧密清晰。不存在的部件不能因为词库出现而添加。',
    '浅色部分仍有短纤维，深色部分不变成塑料壳。已有珠眼、金属丝眼镜、纸页、织物丝带、细线胡须保留原材质与合理连接，不全部毛毡化。',
    '保持可信的支撑、接触、部件厚度与空间关系；不靠脏污、毛球、破损和粗针孔假装手工。避免统一长毛、塑料陶瓷高光、CGI贴图感、悬浮或融合配件。',
    stage === 'quality' ? '只提供视觉检查建议，区分已观察问题和未知；规则不证明实物成分、制作工艺或商品安全，不替代用户对实物的核实。'
      : `在现有JSON中增加 feltProfile:{components:[],mixedMaterials:[],tones:[],scene}。components仅选实际存在或该方案明确设计的部件：${parts.join(',')}；mixedMaterials仅选实际存在的混材：${mixed.join(',')}；tones为light/dark；scene为minimal/lifestyle/autumn/christmas/study。`,
    stage === 'planning' ? '方案整体和每个plans项都可给出feltProfile；按各方案实际内容分别填写。这个字段只描述视觉材质，不写进商品factsUsed。不将示例部件自动复制进商品。' : '',
    stage === 'identity' ? '设定卡记录主图真实可见形态与部件；看不到的部分保留未知。默认毛毡目标不能覆盖用户锁定的配件材质与纹样。' : '',
  ].filter(Boolean).join('\n')
}

export function makeFeltContext(input: { basePrompt: string; stage: FeltStage; task?: FeltRequestContext['task']; profile?: unknown; description?: string; userRequirements?: string; latestInstruction?: string; multiReference?: boolean; version?: string; materialPreset?: MaterialPreset; photography?: PhotographySettings; multiView?: MultiViewContext }): FeltRequestContext {
  const version = input.version ?? FELT_RULES_VERSION; feltLibrary(version)
  const task = input.task ?? 'redesign'
  if (input.materialPreset === STUDIO_MATERIAL_V2) return { version, stage: input.stage, task, materialPreset: STUDIO_MATERIAL_V2,
    basePrompt: stripOwnedBlocksV2(input.basePrompt), userRequirements: input.userRequirements ?? '', latestInstruction: input.latestInstruction,
    multiReference: !!input.multiReference, profile: normalizeProfileV2(input.profile),
    photography: normalizePhotography(input.photography, defaultPhotography(task, input.stage === 'refinement' || input.stage === 'multi-view')),
    ...(input.multiView ? { multiView: structuredClone(input.multiView) } : {}) }
  const profile = normalizeFeltProfile(input.profile, input.description ?? '')
  const materialPreset = normalizeMaterialPreset(input.materialPreset)
  const basePrompt = input.stage !== 'multi-view' ? stripMaterialRuleBlocks(input.basePrompt) : input.basePrompt.replace(/\[NEEDLE_FELT_RULES:[^\]]*\][\s\S]*?\[\/NEEDLE_FELT_RULES\]/g, '').trim()
  if (materialPreset === EXPERIMENTAL_MATERIAL && input.stage !== 'multi-view') profile.materialComponents = inferMaterialComponents(profile, [input.description, basePrompt].filter(Boolean).join('\n'))
  return { version, stage: input.stage, task, basePrompt, userRequirements: input.userRequirements ?? '', latestInstruction: input.latestInstruction, multiReference: !!input.multiReference,
    profile, ...(input.materialPreset ? { materialPreset } : {}), photography: normalizePhotography(input.photography, defaultPhotography(task, input.stage === 'refinement' || input.stage === 'multi-view')), ...(input.multiView ? { multiView: structuredClone(input.multiView) } : {}) }
}

export function composeFeltPrompt(context: FeltRequestContext, model: string, subscription?: string): FeltApplication {
  const library = feltLibrary(context.version), profile = context.materialPreset === STUDIO_MATERIAL_V2 ? normalizeProfileV2(context.profile) : normalizeFeltProfile(context.profile), adapter = feltAdapter(model, subscription)
  const experimental = normalizeMaterialPreset(context.materialPreset) === EXPERIMENTAL_MATERIAL
  if (context.stage === 'multi-view' && context.multiView) {
    const directionModules = directionFor(context.multiView.angle) ? { product_view_direction_v1_0: '1.0', product_spatial_v1_0: '1.0' } : {}
    const directionRules = directionFor(context.multiView.angle) ? [VIEW_DIRECTION_MODULE, 'product_spatial_v1_0'] : []
    if (context.multiView.surfaceStrategy === 'hero-direct-v1') return { library: library.id, version: library.version, sourceSha256: library.sourceSha256, adapter, model, stage: 'multi-view', task: context.task,
      ruleIds: [MULTI_VIEW_MODULE, SURFACE_CONTINUITY_MODULE, ...directionRules], profile: context.multiView.anchor.profile, photography: context.multiView.anchor.photography,
      prompt: firstPassSurfacePrompt(context.multiView), modules: { multi_view_consistency_v1_0: MULTI_VIEW_VERSION, hero_surface_continuity_v1_0: '1.0', ...directionModules }, multiView: structuredClone(context.multiView) }
    // 多角度使用独立完整规则；不再重新施加默认纤维、摄影背景或创意任务。
    return { library: library.id, version: library.version, sourceSha256: library.sourceSha256, adapter, model, stage: 'multi-view', task: context.task,
      ruleIds: [MULTI_VIEW_MODULE, ...directionRules], profile: context.multiView.anchor.profile, photography: context.multiView.anchor.photography,
      prompt: multiViewPrompt(context.multiView), modules: { multi_view_consistency_v1_0: MULTI_VIEW_VERSION, approved_material_lock_v1_0: '1.0', ...directionModules }, multiView: structuredClone(context.multiView) }
  }
  if (context.materialPreset === STUDIO_MATERIAL_V2) return composeStudioV2({ ...context, profile }, model, adapter)
  const materialResolution = experimental ? resolveMaterialProfile(profile, stripMaterialRuleBlocks(context.basePrompt)) : undefined
  if (materialResolution) profile.materialComponents = materialResolution.profile.materialComponents
  const resolvedBrief = experimental ? resolveMaterialText(stripMaterialRuleBlocks(context.basePrompt), 'designBrief', profile) : undefined
  if (experimental) {
    resolveMaterialText(context.userRequirements, 'userRequirements', profile, true)
    resolveMaterialText(context.latestInstruction ?? '', 'latestInstruction', profile, true)
  }
  const requestedPhoto = normalizePhotography(context.photography)
  const photography = effectivePhotography(effectivePhotography(requestedPhoto, context.userRequirements), context.latestInstruction ?? '')
  // 旧要求曾保留背景、最新修图又明确换背景时，恢复本次选择的自定义描述。
  if (!photography.preserve_background && requestedPhoto.photography_preset === 'custom') {
    photography.photography_preset = 'custom'; photography.custom_background = requestedPhoto.custom_background
  }
  const photoText = context.latestInstruction ? `${context.userRequirements}\nLatest correction (takes precedence): ${context.latestInstruction}` : context.userRequirements
  const compact = adapter === 'gemini' || adapter === 'grok'
  const rules: Array<{ id: string; text: string }> = experimental
    ? [{ id: EXPERIMENTAL_MATERIAL, text: MATERIAL_V1_0_2.priority }]
    : [library.material, library.density, library.edges, library.mixed, library.structure, library.symmetry]
  const partRules = experimental ? experimentalComponentRules(profile) : profile.components.map(part => FELT_PART_RULES[part])
  const mixedRules = experimental ? [] : profile.mixedMaterials.map(material => MIXED_MATERIAL_RULES[material])
  if (!experimental && profile.components.includes('curly-overlay')) rules.push(library.curls)
  if (!experimental && profile.tones.includes('light')) rules.push(library.light)
  if (!experimental && profile.tones.includes('dark')) rules.push(library.dark)
  const continuity = context.stage === 'multi-view' || context.stage === 'refinement' ? library.continuity.text : library.family.text
  const task = context.stage === 'multi-view'
    ? 'Render only the requested camera view of the approved master design. Do not restart the original redesign or 2D conversion. Keep its geometry, material zones, pattern layout and inventory identical.'
    : context.stage === 'refinement' ? 'Refine the selected current version, changing only what the latest instruction asks. Do not restart its original redesign or conversion. Keep every unaffected shape, pose, colour block and accessory.'
    : context.task === 'flat-to-felt'
    ? 'Convert the 2D design into a plausible three-dimensional needle-felted object. Preserve the locked design, face, pose, palette and ornament; add depth and component thickness without inventing new features.'
    : context.task === 'felt-conversion' ? 'Convert only the intended main sculptural surfaces to needle-felted wool; preserve locked design features and specified mixed-material accessories.'
      : 'Apply the requested redesign only; retain locked identity and existing part relationships while using the adopted needle-felted surface treatment.'
  const material = compact && !experimental
    ? 'Needle-felted wool: compact dense core, fine visible short interlocked fibers, matte surface, restrained fuzz, gently thick readable edges. Different existing parts use different densities. White areas keep fibers; dark felt avoids plastic sheen. Preserve mixed-material accessories.'
    : rules.map(rule => rule.text).join('\n')
  const components = partRules.concat(mixedRules).map(rule => rule.text).join('\n')
  const negative = experimental ? MATERIAL_V1_0_2.negative : compact
    ? 'No plastic/ceramic/resin gloss on felt, uniform long fur, CGI texture, airbrushing, artificial dirt or damage, floating accessories, fused bodies or unsupported thin parts. Never replace existing bead, wire, paper or ribbon with wool.'
    : library.avoid.text
  const heading = `[NEEDLE_FELT_RULES:v${experimental ? MATERIAL_V1_0_2.version : library.version};adapter=${adapter};stage=${context.stage}]`
  let brief = resolvedBrief?.text ?? stripMaterialRuleBlocks(context.basePrompt)
  const selectedLayout = photography.framing_policy === 'override_reference'
  if (selectedLayout) brief = brief.replace(/Keep the framing and character scale consistent with the reference\.?/gi, 'Preserve identity and internal proportions; use the selected camera framing.')
  const block = [
    heading,
    `SUBJECT / REFERENCE PRIORITY: ${library.priority}`,
    context.userRequirements ? `USER REQUIREMENTS: ${context.userRequirements}` : '',
    context.latestInstruction ? `LATEST EDIT (overrides conflicting older requirements only for the requested change): ${context.latestInstruction}` : '',
    `TASK: ${task}`,
    context.stage === 'refinement' ? 'REFINEMENT: change only the requested part; do not redesign approved geometry or shift unaffected motifs. Apply micro-fiber treatment without changing the original silhouette.' : '',
    context.stage === 'multi-view' ? 'VIEWPOINT: the requested new viewing angle takes precedence over the source camera direction. Framing settings control whole-product occupancy and margins, never a change in anatomy or decorative pattern.' : '',
    context.multiReference ? 'MULTI-REFERENCE: follow the assigned role of each image. A material reference contributes surface behaviour only, never its shape, pose, colours, outfit or extra accessories.' : '',
    experimental ? `[${EXPERIMENTAL_MATERIAL}]\n${material}\n${components}\n[/${EXPERIMENTAL_MATERIAL}]` : `MATERIAL: ${material}`,
    experimental ? '' : `COMPONENT DENSITY (only existing/requested parts):\n${components}`,
    `PHYSICAL STRUCTURE: ${compact ? 'Keep approved anatomy, pattern layout, colour placement and attachment points consistent across every view and edit. Components have believable felt thickness and support; do not distort requested symmetry or clone new characters.' : continuity}`,
    `[felt_photography_v1_0] ${photographyBlock(photography, profile.scene, photoText)}`,
    `[felt_composition_v1_0] ${compositionBlock(photography)}`,
    `AVOID: ${negative}`,
    'Priority order: explicit user instructions; locked subject identity; selected photography/composition; felt material defaults; automatic scene styling. These are visual rendering rules, not evidence of real materials, manufacturing or safety.',
    '[/NEEDLE_FELT_RULES]',
  ].filter(Boolean).join('\n')
  const prompt = (compact || experimental) ? `${block}\n\nDESIGN / EDIT BRIEF:\n${brief}` : `${brief}\n\n${block}`
  return { library: library.id, version: library.version, sourceSha256: library.sourceSha256, adapter, model, stage: context.stage, task: context.task,
    ruleIds: [...rules, ...partRules, ...mixedRules].map(rule => rule.id).concat(context.stage === 'generation' ? 'FR-05' : 'FR-06', experimental ? 'MAT-structure' : library.avoid.id, 'felt_photography_v1_0', 'felt_composition_v1_0'),
    profile, photography, prompt, ...(experimental ? { materialPreset: EXPERIMENTAL_MATERIAL, materialRevision: MATERIAL_REVISION, materialCorrections: [...materialResolution?.corrections ?? [], ...resolvedBrief?.corrections ?? []] } : context.materialPreset ? { materialPreset: context.materialPreset } : {}), modules: { ...(experimental ? { needle_felt_v1_0_2: '1.0.2' } : { needle_felt_v1_0: library.version }), felt_photography_v1_0: PHOTOGRAPHY_VERSION, felt_composition_v1_0: COMPOSITION_VERSION, ...(photography.photography_preset === 'custom' ? { custom_background_v1_0: '1.0' } : {}) } }
}

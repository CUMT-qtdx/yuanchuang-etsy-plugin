import { compositionTarget, targetCompositionBlock } from './photography-contract.ts'
import type { FeltApplication, FeltRequestContext, FeltAdapter } from './types.ts'
import { normalizePhotography, effectivePhotography, photographyBlockV2 as photographyBlock, PHOTOGRAPHY_VERSION } from './photography-options.ts'
import { COMPOSITION_VERSION } from './composition-v1.ts'
import { STUDIO_MATERIAL_V2, STUDIO_MATERIAL_REVISION, NEEDLE_FELT_CORE_V2, normalizeMaterialPlanV2, materialPlanBlockV2, stripOwnedBlocksV2 } from './material-policy-v2.ts'
import { DESIGN_PRESERVATION_MODULE, preservationTaskInstruction, preservationMaterialScope, referenceFirstDesignBrief } from '../design-preservation.ts'

// 负面清单沿用 v1.0.2 原词；冲突取舍统一由 PRIORITY 一句决定，这里不再单独写“除计划变化外”。
export const NEGATIVE_FELT_V2 = 'Keep the established geometry, motifs, attachments and supported connections that the PRIORITY items do not change. No components beyond the design and its planned changes, no artificial dirt, damage or exaggerated needle holes. On needle-felted wool parts, no knitted or crochet stitches, woven grids, periodic textile patterns, synthetic plush, artificial loose hairs, artificial floating fuzz or artificial speckles. No plastic, ceramic, silicone or resin appearance or gloss, CGI sheen or CGI texture, airbrushed smoothness, floating accessories, fused bodies or unsupported thin parts.'

// v2只组合一次材料意图。自然语言设计和用户要求原样传递，不自动替换、拒绝。
export function composeStudioV2(context: FeltRequestContext, model: string, adapter: FeltAdapter): FeltApplication {
  const source = normalizePhotography(context.photography)
  const photography = effectivePhotography(effectivePhotography(source, context.userRequirements), context.latestInstruction ?? '')
  if (!photography.preserve_background && source.photography_preset === 'custom') {
    photography.photography_preset = 'custom'; photography.custom_background = source.custom_background
  }
  const editing = context.stage === 'refinement'
  const preserve = !!context.designPreservation
  const subjectImage = context.compositionGuide?.subjectImage ?? (editing ? 2 : 1)
  const currentImage = context.compositionGuide?.currentImage ?? 1
  const resolved = normalizeMaterialPlanV2(preserve ? undefined : context.profile.materialPlan)
  const task = preserve ? editing ? `Use the original reference in image ${subjectImage} for product geometry, and image ${currentImage} for its correct target material. Apply the latest explicit correction without retaining design drift; take the environment and framing from the selected photography contract.` : preservationTaskInstruction(context.task)
    : editing ? 'Edit image 1, the selected current design. Apply the latest edit and keep unaffected design details; render its environment and framing according to the selected photography settings below.'
      : context.task === 'flat-to-felt' ? 'Develop the planned design as a three-dimensional needle-felted product, keeping its specified identity, pose and decorations.'
      : context.task === 'felt-conversion' ? 'Render the planned sculpted form in needle-felted wool. Keep the specified design and part relationships.'
        : 'Create the planned product variation at the selected creativity level, using the material treatment below.'
  let brief = preserve ? referenceFirstDesignBrief(editing, context.designPreservation?.referenceRoles, context.compositionGuide) : stripOwnedBlocksV2(context.basePrompt)
  // 复用当前安装版已存在的构图兼容句，不引入新的占比算法。
  if (photography.framing_policy === 'override_reference') brief = brief.replace(/Keep the framing and character scale consistent with the reference\.?/gi, 'Preserve identity and internal proportions; use the selected camera framing.')
  const photoText = context.latestInstruction ? `${context.userRequirements}\nLatest correction: ${context.latestInstruction}` : context.userRequirements
  const rawPhotography = photographyBlock(photography, preserve ? 'minimal' : context.profile.scene, photoText)
  const photographicScene = preserve ? rawPhotography.replace('The full subject, including its head, feet and accessories, remains in focus; only the distant background may blur.', 'Keep the whole visible product in focus; only the distant background may blur.') : rawPhotography
  // 唯一的优先级说明：其余段落只描述内容，不再各自声明“谁覆盖谁”。
  const priority = preserve
    ? 'PRIORITY: The original reference image is the sole authority for visible product design. Explicit user edits override only their stated scope. Machine-written descriptions, category names and inferred part lists do not authorize additions or reconstructions. Material and photography instructions change their own scopes only. When correcting a generated result, compare geometry directly with the original reference. Preserve its environment only when the photography setting says preserve-original; any selected new scene replaces it. The composition target controls the complete product size in the output, not its anatomy.'
    : editing ? 'PRIORITY (highest first): 1) the latest edit; 2) user requirements; 3) every other detail of image 1, the selected design, framed and lit as the photography and composition settings below describe; 4) material defaults. A higher item overrides any conflicting lower item. Change only what the latest edit asks for.'
      : 'PRIORITY (highest first): 1) user requirements; 2) the planned changes in DESIGN; 3) identity details kept from the reference; 4) the selected photography and composition; 5) material defaults. A higher item overrides any conflicting lower item. Every planned change must be visible; never return the reference unchanged.'
  const prompt = [
    '[STUDIO_MATERIAL_V2]',
    priority,
    `TASK: ${task}`,
    preserve ? '[DESIGN_PRESERVATION_V1]\n[SOURCE_IMAGE_AUTHORITY] Use the actual reference image, not a generated description of it.' : '',
    context.userRequirements ? `USER REQUIREMENTS: ${context.userRequirements}` : '',
    context.latestInstruction ? `LATEST EDIT: ${context.latestInstruction}` : '',
    `DESIGN:\n${brief}`,
    'PRESENTATION SCOPE: Product design preservation does not lock the reference background, supporting surface, lighting or camera distance. Use the selected photographic scene and composition below for those properties.',
    context.compositionGuide ? `LAYOUT GUIDE: Image ${context.compositionGuide.image} is only a layout guide with two horizontal boundaries marking the target product top and bottom. Use this spatial guide for the final framing; it is not a product reference or a background. Do not render its blue marks or tinted field in the output.` : '',
    `MATERIAL:\n${NEEDLE_FELT_CORE_V2}`,
    preserve ? preservationMaterialScope : materialPlanBlockV2(resolved.plan, editing),
    `SURFACE LIMITS:\n${NEGATIVE_FELT_V2}`,
    context.multiReference && !preserve ? 'Use each reference only for its assigned role. Material references supply surface appearance, while the subject reference and design brief determine identity.' : '',
    `[felt_photography_v1_0] ${photographicScene}`,
    `[felt_composition_v1_0] ${targetCompositionBlock(photography)}`,
    'OUTPUT: One coherent product photograph. Preserve intentional decorative stitching and distinct part materials. No added text or watermark.',
    '[/STUDIO_MATERIAL_V2]',
  ].filter(Boolean).join('\n\n')
  return { library: 'etsy-real-needle-felt', version: '2.0', sourceSha256: '73026bdcf6ba76889df39237f41f5eb079f0922b623d4cde62dd05f2f629c50c', adapter, model, stage: context.stage, task: context.task,
    materialPreset: STUDIO_MATERIAL_V2, materialRevision: STUDIO_MATERIAL_REVISION, materialNotes: resolved.notes,
    profile: { ...context.profile, materialPlan: resolved.plan }, photography, prompt,
    compositionTarget: compositionTarget(photography), ...(context.compositionGuide ? { compositionGuide: structuredClone(context.compositionGuide) } : {}),
    ...(preserve ? { designPreservation: structuredClone(context.designPreservation) } : {}),
    ruleIds: [STUDIO_MATERIAL_V2, 'felt_photography_v1_0', 'felt_composition_v1_0', ...(preserve ? [DESIGN_PRESERVATION_MODULE] : [])],
    modules: { needle_felt_v2_0: '2.0', felt_photography_v1_0: PHOTOGRAPHY_VERSION, felt_composition_v1_0: COMPOSITION_VERSION, ...(preserve ? { design_preservation_v1_1: '1.1' } : {}) } }
}

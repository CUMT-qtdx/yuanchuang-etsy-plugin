import type { FeltApplication, FeltRequestContext, FeltAdapter } from './types.ts'
import { normalizePhotography, effectivePhotography, photographyBlock, compositionBlock, PHOTOGRAPHY_VERSION } from './photography-options.ts'
import { COMPOSITION_VERSION } from './composition-v1.ts'
import { STUDIO_MATERIAL_V2, STUDIO_MATERIAL_REVISION, NEEDLE_FELT_CORE_V2, normalizeMaterialPlanV2, materialPlanBlockV2, stripOwnedBlocksV2 } from './material-policy-v2.ts'

// 旧版 v1.0.2 的完整负面清单（69 词）原样保留，只把首句限定为“除计划变化外”，避免与抬爪、加围巾等改动冲突。
export const NEGATIVE_FELT_V2 = 'Except for the planned changes listed in DESIGN, preserve all established geometry, motifs, attachments and supported connections. No added components, artificial dirt, damage or exaggerated needle holes. On needle-felted wool parts, no knitted or crochet stitches, woven grids, periodic textile patterns, synthetic plush, artificial loose hairs, artificial floating fuzz or artificial speckles. No plastic, ceramic, silicone or resin appearance or gloss, CGI sheen or CGI texture, airbrushed smoothness, floating accessories, fused bodies or unsupported thin parts.'

// v2只组合一次材料意图。自然语言设计和用户要求原样传递，不自动替换、拒绝。
export function composeStudioV2(context: FeltRequestContext, model: string, adapter: FeltAdapter): FeltApplication {
  const source = normalizePhotography(context.photography)
  const photography = effectivePhotography(effectivePhotography(source, context.userRequirements), context.latestInstruction ?? '')
  if (!photography.preserve_background && source.photography_preset === 'custom') {
    photography.photography_preset = 'custom'; photography.custom_background = source.custom_background
  }
  const editing = context.stage === 'refinement'
  const resolved = normalizeMaterialPlanV2(context.profile.materialPlan)
  const task = editing ? 'Edit image 1, the selected current design. Apply the latest edit and keep unaffected design details.'
    : context.task === 'flat-to-felt' ? 'Develop the planned design as a three-dimensional needle-felted product, keeping its specified identity, pose and decorations.'
      : context.task === 'felt-conversion' ? 'Render the planned sculpted form in needle-felted wool. Keep the specified design and part relationships.'
        : 'Create the planned product variation at the selected creativity level, using the material treatment below.'
  let brief = stripOwnedBlocksV2(context.basePrompt)
  // 复用当前安装版已存在的构图兼容句，不引入新的占比算法。
  if (photography.framing_policy === 'override_reference') brief = brief.replace(/Keep the framing and character scale consistent with the reference\.?/gi, 'Preserve identity and internal proportions; use the selected camera framing.')
  const photoText = context.latestInstruction ? `${context.userRequirements}\nLatest correction: ${context.latestInstruction}` : context.userRequirements
  const prompt = [
    '[STUDIO_MATERIAL_V2]',
    `TASK: ${task}`,
    context.userRequirements ? `USER REQUIREMENTS: ${context.userRequirements}` : '',
    context.latestInstruction ? `LATEST EDIT: ${context.latestInstruction}` : '',
    `DESIGN:\n${brief}`,
    `MATERIAL:\n${NEEDLE_FELT_CORE_V2}`,
    materialPlanBlockV2(resolved.plan, editing),
    `SURFACE LIMITS:\n${NEGATIVE_FELT_V2}`,
    context.multiReference ? 'Use each reference only for its assigned role. Material references supply surface appearance, while the subject reference and design brief determine identity.' : '',
    `[felt_photography_v1_0] ${photographyBlock(photography, context.profile.scene, photoText)}`,
    `[felt_composition_v1_0] ${compositionBlock(photography)}`,
    'OUTPUT: One coherent product photograph. The latest user edit overrides earlier design and material notes where it explicitly changes them. Preserve intentional decorative stitching and distinct part materials. No added text or watermark.',
    '计划变化优先于参考图保留措辞。Planned changes take priority over any wording that preserves the reference pose, accessories, or framing.',
    '[/STUDIO_MATERIAL_V2]',
  ].filter(Boolean).join('\n\n')
  return { library: 'etsy-real-needle-felt', version: '2.0', sourceSha256: '73026bdcf6ba76889df39237f41f5eb079f0922b623d4cde62dd05f2f629c50c', adapter, model, stage: context.stage, task: context.task,
    materialPreset: STUDIO_MATERIAL_V2, materialRevision: STUDIO_MATERIAL_REVISION, materialNotes: resolved.notes,
    profile: { ...context.profile, materialPlan: resolved.plan }, photography, prompt,
    ruleIds: [STUDIO_MATERIAL_V2, 'felt_photography_v1_0', 'felt_composition_v1_0'],
    modules: { needle_felt_v2_0: '2.0', felt_photography_v1_0: PHOTOGRAPHY_VERSION, felt_composition_v1_0: COMPOSITION_VERSION } }
}

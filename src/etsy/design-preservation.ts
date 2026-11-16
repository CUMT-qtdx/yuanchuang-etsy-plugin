import type { CreationTask, QualityReport } from './types.ts'
import { targetCompositionBlock } from './felt/photography-contract.ts'

export const DESIGN_PRESERVATION_VERSION = '1.1' as const
export const DESIGN_PRESERVATION_MODULE = 'design_preservation_v1_1' as const

// 保留规则适用于实际可见的任意商品，不靠人物或配件词表猜测对象。
export const preservationGenerationRules = 'The subject reference image is the visual source of truth for the product design. Edit that exact visible design rather than rebuilding an idealized example of its category. Preserve visible shapes, silhouettes, proportions, poses, surface regions, motifs, existing attachments and object arrangement. Do not complete a familiar character, product archetype or theme from prior knowledge. A continuous surface or colour boundary is not permission to invent another part, seam, layered edge or attachment. Keep ambiguity visually as it appears instead of converting an interpretation into a new object. Transform only the requested materials and photographic presentation; do not add, remove, replace or beautify design elements. Only explicit user edits release their specified details.'

export const preservationMaterialScope = 'Apply the target needle-felted material to the existing sculpted forms visible in the source image. Preserve their exact geometry, colour regions and decorative patterns. Distinct visible materials and attachment boundaries remain distinct unless explicitly changed by the user. Material transformation is a surface-and-substance edit, not permission to create a part or divide a continuous shape into new objects. No inferred component inventory or category-based completion is authorized.'

export function referenceFirstDesignBrief(editing: boolean, roles: Array<{ image: number; role: string; note: string }> = [], order?: { subjectImage?: number; currentImage?: number }): string {
  const subject = order?.subjectImage ?? (editing ? 2 : 1), current = order?.currentImage ?? 1
  return [
    editing ? `Image ${current} is the current result for its correct material; image ${subject} is the original product design reference. Correct only the latest explicit edit, using the original visible design as the geometry baseline without restoring its old material. Use the selected photography and composition for the environment and camera framing.` : `Image ${subject} is the original product to edit. Use its visible geometry directly; do not reconstruct it from a prose description or a category name. Its original camera distance and background are not product design features.`,
    preservationGenerationRules,
    roles.length ? `User-assigned reference roles: ${JSON.stringify(roles)}. Auxiliary references supply only their assigned information; they cannot introduce extra parts into the subject.` : '',
  ].filter(Boolean).join('\n')
}

export function referenceFirstComposition(settings: { aspect_ratio: string; framing_policy: string; subject_height_ratio: number }): string {
  return targetCompositionBlock(settings as import('./felt/photography-options.ts').PhotographySettings)
}

export function preservationTaskHint(task: CreationTask): string {
  if (task === 'felt-conversion') return '按原造型转换主体材质，保留部件、配件与纹样。'
  if (task === 'flat-to-felt') return '保留图案身份、姿态、配色与布局，补成立体毛毡体积。'
  return '按原款设计生成，材质和摄影继续使用当前规则。'
}

export function preservationPlanningRules(count: number): string {
  return `目标：按原款呈现，恰好输出${count}张同一商品的生成简报。完整观察实际可见的所有主体、部件、造型轮廓、内部比例、姿态、表情、纹样配色、配件连接及组合关系，写入keep及逐条对应的keepEn。没有脸或肢体的商品不强加这些特征。默认不改款，不自动换色、换装、变姿态或增加装饰；材质按当前任务及各部件材料方案转换，摄影按既有设置处理。原材料和背景不能误写成造型锁。二维转立体只补必要体积、厚度和连接；看不到的内容标未知，不捏造复杂隐藏装饰。用户明确要求改变某处时只释放那一处。多张可使用相同设计方向和提示词，不为差异化重做商品；未指定摄影探索时也不强制换场景。changes只记录实际材质处理和用户明确改动，允许为空；仅材质或摄影变化时changeAxes允许为空。观察只描述原图确实可见的几何与边界；不要按角色名称、节日或商品类别补齐常见物件。相连曲面、同色区域和毛绒边缘不能仅凭联想命名为独立配件，无法确认的结构写入uncertainties。此分析是辅助描述，不能覆盖原图本身。`
}

export function preservationTaskInstruction(task: CreationTask): string {
  return task === 'flat-to-felt'
    ? 'Preserve the source illustration identity, pose, colours, motifs and arrangement while adding only the thickness, volumes and connections necessary for a three-dimensional needle-felted object.'
    : 'Edit the original visible product design into the target needle-felted materials. Keep the same geometry, pose, expression, colours, motifs and relationships; use the reference image directly rather than recreating a category example.'
}

export const preservationReviewInstructions = `本次为原封不动模式：按原始主体参考保留原款设计，材质与摄影依任务独立处理。各张结果允许同款，不能要求方案间有不同造型。
复核必须独立观察原图，不读取或沿用同一次规划的对象名称、保留清单、部件解释或改款描述。角色及商品类别不构成部件存在的证据；原图模糊或相连的几何区域只描述其可见形状，无法确认是否独立部件就写UNKNOWN。明确指出待检图相比原图新增、缺失、替换或重构的可见结构，不把推测命名当成原款事实。
逐项比较任何实际商品的主体与部件数量、形状比例、姿态表情、配件连接、纹样配色及组合关系；不向无脸器物强加五官检查。只有用户明确指定的修改可以放开对应项目，规划中无依据的改款不能自动成为许可。
材质转换必须检查目标材质，原树脂或陶瓷不能因保留造型而被判为应当保留。二维转立体所必需的体积及自然纤维边缘不等同于改款。摄影设置允许的背景、整体取景和支撑变化单独判断。
另返回designPreservation:{design:{status,evidence},material:{status,evidence},photography:{status,evidence}}，status各为PASS|REVISE|REJECT|UNKNOWN；每项evidence写原图与待检图可见依据，不超过90字，无法确定写UNKNOWN。此检查是模型建议，不证明像素或实物材料。`

export function normalizePreservationChecks(value: unknown): NonNullable<QualityReport['designPreservation']> {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return Object.fromEntries(['design', 'material', 'photography'].map(key => {
    const item = raw[key] && typeof raw[key] === 'object' ? raw[key] as Record<string, unknown> : {}
    const status = ['PASS', 'REVISE', 'REJECT', 'UNKNOWN'].includes(String(item.status)) ? item.status as QualityReport['status'] : 'UNKNOWN'
    const evidence = typeof item.evidence === 'string' ? item.evidence.trim().slice(0, 500) : ''
    return [key, { status: evidence ? status : 'UNKNOWN', evidence: evidence || '本次未返回可核对依据。' }]
  })) as NonNullable<QualityReport['designPreservation']>
}

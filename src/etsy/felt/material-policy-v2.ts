import type { MaterialPlanV2 } from './types.ts'

export const STUDIO_MATERIAL_V2 = 'needle_felt_v2_0' as const
export const STUDIO_MATERIAL_REVISION = '1' as const

// 这是给图像模型的材料描述，不是用于扫描用户或模型文字的词表。
export const NEEDLE_FELT_CORE_V2 = 'Render the main sculpted form as a solid, hand-shaped needle-felted wool object. Fine short wool fibers are compressed and interlocked through its volume, forming a cohesive non-woven surface. At normal product-photo scale the felt is compact, softly matte and tactile; close inspection reveals irregular embedded fibers and subtle handmade density variations. Keep clear sculpted volumes and a restrained soft fiber edge. Clothing and accessories retain their individually specified materials and construction. Their texture belongs to those parts only. The latest requested design and edit determine geometry, expression and pose; material treatment does not redesign them.'

export interface NormalizedMaterialPlan { plan: MaterialPlanV2; notes: string[] }
const short = (value: unknown, limit: number): string => typeof value === 'string' ? value.trim().slice(0, limit) : ''
export function normalizeMaterialPlanV2(value: unknown): NormalizedMaterialPlan {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const parts: MaterialPlanV2['parts'] = [], notes: string[] = [], indexes = new Map<string, number>(), ambiguous = new Set<string>()
  if (!Array.isArray(raw.parts)) return { plan: { version: '2.0', parts: [] }, notes: [] }
  for (const value of raw.parts.slice(0, 30)) {
    if (!value || typeof value !== 'object') continue
    const row = value as Record<string, unknown>, part = short(row.part, 100), material = short(row.material, 240)
    if (!part || !material) { notes.push('有一项部件材质缺少名称或描述，沿用可见参考；未阻止生成'); continue }
    const treatment = row.treatment === 'felt' || row.treatment === 'retain' ? row.treatment : 'unspecified'
    const key = part.toLocaleLowerCase()
    if (ambiguous.has(key)) continue
    const index = indexes.get(key)
    if (index !== undefined) {
      const previous = parts[index]
      if (previous.material !== material || previous.treatment !== treatment) {
        parts[index] = { part, material: 'Use the material established by the latest user instruction and the visible reference.', treatment: 'unspecified' }
        ambiguous.add(key); notes.push(`部件“${part}”的结构化材料记录不一致，保留用户要求与参考，不做文字猜测或中断`)
      }
      continue
    }
    indexes.set(key, parts.length)
    parts.push({ part, material, treatment })
  }
  return { plan: { version: '2.0', parts }, notes: [...new Set(notes)] }
}

export function materialPlanBlockV2(plan: MaterialPlanV2, editing = false): string {
  if (!plan.parts.length) return 'No additional part material has been confirmed. Preserve the visible construction and material of existing clothing and accessories; use the main felt treatment for the sculpted form.'
  return [editing ? 'The following are materials from the selected design, not new instructions to recreate removed parts. The latest edit overrides them where requested.' : 'Materials for the existing or explicitly planned parts:',
    ...plan.parts.map(part => `${JSON.stringify(part.part)}: ${part.treatment === 'felt' ? 'sculpted needle-felted wool' : part.material}.`),
  ].join('\n')
}

export function materialAnalysisV2(stage: 'planning' | 'identity' | 'quality'): string {
  if (stage === 'identity') return '[STUDIO_V2_MATERIAL_OBSERVATION]\n只记录批准主图可见的材料和连接，不重新设计或把不理想表面说成正确针毡。看不清保留未知；材质评价与身份记录分开。'
  if (stage === 'quality') return '[STUDIO_V2_MATERIAL_REVIEW]\n按部件比较目标材料与成图：主体是否有连续压实羊毛体、细纤维是否自然嵌入，服装和配件是否保留各自材料。区分自然交错纤维与周期性织物结构，避免以塑料光滑作为合格针毡。只报告可见问题；不确定写UNKNOWN。检查本身不自动重试，不证明实物材料。'
  return `[STUDIO_V2_MATERIAL_PLAN]
这是毛毡商品创作。主体目标为连续、紧实、哑光的针刺羊毛体，保留细短不规则纤维；参考图的身份与原材料分开理解。
每个方案在原有同一次JSON输出中增加两个字段：
designBrief：简洁英文，只写主体、数量、造型、配色、表情、姿态、服装配件及该方案变化，不重复材料工艺、摄影参数或禁止词清单。
materialPlan:{parts:[{part,material,treatment}]}：part使用任何实际部件名称；material用简短英文写该部件唯一目标材料；treatment为felt（立体针毡）、retain（按此材料保留）、unspecified（未知）。只记录存在或明确新增的部件，不凑清单，不推断实物成分。衣服可以是布、针织或毡片，配件可以是任意材料；不要因它们出现在主体附近就同化成针毡。眼睛、鼻头、珠类小件默认 retain，不归羊毛；material 写可见珠面或高光，不要写成羊毛毡。原prompt字段可与designBrief相同，保持原有JSON兼容。
发送前在本次规划回答内统一每个部件的材料意图：一个部件只有一份材料决定。材质放materialPlan，设计放designBrief；不要输出思考过程，也不新增分析调用。`
}

// 仅处理已知协议标签；不扫描 knitted、服装名词或其他自然语言。
export function stripOwnedBlocksV2(value: string): string {
  return value
    .replace(/\[STUDIO_MATERIAL_V2\][\s\S]*?\[\/STUDIO_MATERIAL_V2\]/g, '')
    .replace(/\[NEEDLE_FELT_RULES:[^\]]*\][\s\S]*?\[\/NEEDLE_FELT_RULES\]/g, '')
    .replace(/\[realistic-needle-felt-product-v1\][\s\S]*?\[\/realistic-needle-felt-product-v1\]/g, '')
    .trim()
}

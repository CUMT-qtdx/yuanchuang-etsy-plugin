import type { CreationTask, FinalDesign, ViewAngle } from './types.ts'

export const creationTasks = [
  { value: 'redesign', label: '参考图改款', hint: '用于已有商品找新款；是否换姿态、轮廓由改动幅度决定。只影响探索，不影响定稿多角度。' },
  { value: 'felt-conversion', label: '转成毛毡作品', hint: '用于陶瓷、树脂等立体商品；重点换成毛毡。想尽量保留原样，搭配“小幅调整”。' },
  { value: 'flat-to-felt', label: '二维转立体毛毡', hint: '用于插画、卡通和平面图案；补出立体体积、厚度与连接，再表现成毛毡。' },
] as const
export const referenceRoles = [
  { value: 'detail', label: '局部造型' }, { value: 'material', label: '材质参考' },
  { value: 'palette', label: '配色参考' }, { value: 'view', label: '其他角度' },
] as const
export const viewAngles = [
  { value: 'front', label: '正面', instruction: 'straight front view' },
  { value: 'three-quarter', label: '斜侧面', instruction: 'front three-quarter view' },
  { value: 'left', label: '左侧', instruction: "face toward screen-right, the subject's anatomical right side in full profile" },
  { value: 'right', label: '右侧', instruction: "face toward screen-left, the subject's anatomical left side in full profile" },
  { value: 'back', label: '背面', instruction: 'straight back view' },
] as const
export function creationTask(value: unknown): CreationTask { return value === 'felt-conversion' || value === 'flat-to-felt' ? value : 'redesign' }
export function taskInstruction(task: CreationTask): string {
  if (task === 'felt-conversion') return '任务是把其他材质的商品转成毛毡作品。保留用户指定的角色与造型关系，将商品表现改成毛毡；原图的陶瓷、树脂等材质不属于保留项。材质转换是本次必做任务，不受小幅调整的幅度限制。采用当前羊毛毡视觉规则，用户锁定的造型和配件优先。'
  if (task === 'flat-to-felt') return '任务是把二维插画或平面图案转成立体毛毡造型。保留指定的角色特征，设计合理的体积、厚度、前后结构、姿态与连接关系；平面图的平坦形态不属于保留项。立体化与毛毡转换是本次必做任务，不受小幅调整的幅度限制。采用当前羊毛毡视觉规则，用户锁定的造型和配件优先。'
  return '任务是在参考商品上改款，按创意档位控制变化。'
}
export function viewPrompt(design: FinalDesign, angle: ViewAngle, instruction?: string, correctionSource = false): string {
  return [
    '[CONSISTENT_PRODUCT_VIEW]',
    `The first image is the approved master product design.${correctionSource ? ' The second image is the current angle version to correct; retain its viewpoint, but fix details to match the master and latest card.' : ''} The following ${Math.min(design.approvedImageIds.length, correctionSource ? 3 : 4)} images are human-approved views of that same design. Any remaining images are uploaded angle references for hidden structure only; the master and identity card override their colours, decorations and old styling. Never treat them as alternative design concepts.`,
    `Show ${viewAngles.find(item => item.value === angle)!.instruction}. Change only the camera viewpoint, not the product design or pose. Show one complete product, not a contact sheet.`,
    `Locked identity and details: ${JSON.stringify(design.spec)}`,
    `Original user notes (the latest identity card overrides any conflicting older notes): ${design.notes || 'Use the visible master details.'}`,
    instruction ? `Requested correction for this angle only: ${instruction}` : '',
    'Keep proportions, colour placement, appendage count, silhouette, accessories, attachment points and surface motifs identical. Stripes must remain stripes with the same spacing and orientation; never replace them with dots. Define left and right from the subject itself. Preserve all non-requested details.',
    'For surfaces not visible in approved references, use the simplest coherent continuation; do not invent extra ornament. Keep the same material appearance. Use the selected photography and framing settings; no labels, logos or text.',
  ].filter(Boolean).join('\n')
}

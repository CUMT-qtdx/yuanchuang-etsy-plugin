import { EtsyWorkflow, EtsyStore, GenerationTaskQueue, validateCopy, validateQuality } from '../.etsy-test/host.js'
export const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
export const facts = { name: 'Red scarf felt cat', type: 'physical_felt', requirements: '羊毛毡猫，红围巾，自然比例', materials: 'wool', dimensions: '10 cm', packaging: 'paper box', processing: '5 days', delivery: 'physical item', personalization: 'scarf color', confirmed: true }
export const modelConfig = { apiUrl: 'https://mock.invalid/v1', apiKey: 'mock-private-secret', model: 'mock-vision-text' }
export const materialAppearance = { version: '1.0', summary: '模拟主图：细短致密纤维，帽片略松，哑光', regions: [{ label: '身体', box: [450, 600, 120, 120], appearance: '细短压实纤维，低对比，无明显卷圈' }, { label: '帽片', box: [400, 250, 200, 180], appearance: '短纤维片层，软边，原图可见轻微绒毛' }] }
export const materialComparison = () => Object.fromEntries(['fiberScale', 'density', 'surface', 'edges', 'finish'].map(key => [key, { status: 'MATCH', evidence: '模拟对比：主图细短压实，待检图同样细短压实' }]))
export function copyValue(f = facts) {
  return { titles: [
    ['Red Scarf Felt Cat', '商品类别'], ['Wool Cat with Red Scarf', '材质特征'], ['Felt Cat Figure in Red Scarf', '外观细节'], ['Red Scarf Cat Wool Figure', '造型特点'], ['Small Felt Cat with Scarf', '简洁表达'],
  ].map(([title, strategy]) => ({ title, titleZh: `${strategy}：红围巾毛毡小猫`, strategy, explanationZh: `突出${strategy}`, keywords: ['felt cat'] })),
  description: 'A felt cat with a red scarf. Material: wool. Size: 10 cm.', sellingPoints: ['Red scarf design'], tags: ['felt cat', 'wool figure'], factsUsed: { name: f.name }, humanConfirmation: ['请核对实物与设计一致'] }
}
export function input(overrides = {}) {
  return { requestKey: crypto.randomUUID(), facts, generation: { mode: 'edit', model: 'mock-image', prompt: facts.requirements, size: 'auto', quality: 'auto', n: 1, image: `data:image/png;base64,${pixel}` }, count: 6, maxCalls: 24, ...overrides }
}
export function fixture(root, options = {}) {
  const counts = { generation: 0, quality: 0, copy: 0 }, events = []
  const queue = new GenerationTaskQueue(async (request, signal) => {
    counts.generation++
    const index = counts.generation
    await new Promise(resolve => setTimeout(resolve, options.generationDelay ?? 8))
    if (options.failGeneration?.(index)) throw new Error('mock image failure')
    if (options.generate) return options.generate(request, index)
    return { images: [{ b64: pixel, mime: 'image/png' }] }
  }, 4)
  let completionListener
  const subscribe = queue.subscribe.bind(queue)
  queue.subscribe = listener => { completionListener = listener; return subscribe(listener) }
  const client = {
    async plan(config, f, image, creativity, signal, optionsInput) {
      counts.planning = (counts.planning ?? 0) + 1
      if (options.plan) return options.plan(config, f, image, creativity, signal, optionsInput)
      return { name: '四方案测试设计', summary: '参考图为毛毡风格动物，具体实物参数待确认', keep: ['主体轮廓', '柔软视觉质感'], uncertainties: ['未确认真实材料'], plans: Array.from({ length: optionsInput?.count ?? 4 }, (_, i) => ['配色', '服饰', '主题', '创新', '造型延伸', '场景组合', '轮廓拓展', '角色延伸'][i]).map((name, i) => ({ id: `plan-${i + 1}`, name, direction: `测试${name}变化`, changes: [`变化${name}`], prompt: `Use the provided reference for a handmade-style concept. Create a unique ${name} design variation ${i + 1}, preserve recognizable subject traits and avoid text or logos.` })) }
    },
    async identity(config, image, notes, signal) {
      counts.identity = (counts.identity ?? 0) + 1
      if (options.identity) return options.identity(config, image, notes, signal)
      return { summary: '红围巾小猫主设计', locks: ['保持小猫五官比例', '红色围巾', notes || '条纹形态一致'], unseen: ['背面纹样需核对'], spatial: {version:'1.0',sourceFacing:'front',anchors:[]}, materialAppearance }
    },
    async material(config, image, signal) { counts.material = (counts.material ?? 0) + 1; return options.material ? options.material(config, image, signal) : materialAppearance },
    async vision(config, f, image, references, siblings, signal, context) {
      counts.quality++; events.push('quality-start')
      if (options.vision) return options.vision(config, f, image, references, siblings, signal, context)
      await new Promise(resolve => setTimeout(resolve, 10))
      const report = validateQuality({ status: 'PASS', summary: '主体结构未发现明显异常', issues: [], uncertainties: [] }, f, references.length > 0, config.model)
      if (context?.multiView) report.viewChecks = Object.fromEntries(['identity', 'composition', 'material', 'accessories', 'photography'].map(key => [key, { status: 'PASS', evidence: '隔离模拟检查：与主图一致' }]))
      if (context?.multiView) report.materialComparison = materialComparison()
      if (context?.multiView?.direction) report.viewpointCheck = { status: 'PASS', expectedFacing: context.multiView.direction.expectedFacing, observedFacing: context.multiView.direction.expectedFacing, profile: 'full-side', handedness: 'consistent', pairRelation: context.multiView.oppositeViewId ? 'opposite' : 'not-provided', evidence: '模拟：脸朝规定方向，角色持物侧不变', pairImageId: context.multiView.oppositeViewId }
      return report
    },
    async copy(config, f, signal, context) {
      counts.copy++; events.push('copy-start')
      if (options.copy) return options.copy(config, f, signal, context)
      return validateCopy(copyValue(f), f)
    },
  }
  const workflow = new EtsyWorkflow({ queue, store: new EtsyStore(root), models: () => options.models ?? { vision: modelConfig, copy: modelConfig }, client })
  return { workflow, counts, events, queue, duplicate: task => completionListener(task) }
}

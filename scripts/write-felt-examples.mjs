// 示例直接调用生产提示词组装器，保证维护文档与实际规则一致；不请求模型。
import { mkdir, writeFile } from 'node:fs/promises'
import { makeFeltContext, composeFeltPrompt, defaultPhotography } from '../.etsy-test/host.js'
const profile = { components: ['body', 'face', 'clothing', 'trim'], mixedMaterials: [], tones: ['light', 'dark'], scene: 'minimal' }
const basePrompt = 'Use the supplied two-dimensional blue-hat boy as the sole subject reference. Reconstruct the same complete character as a physically plausible three-dimensional needle-felted collectible. Keep the blue hat, red scarf, exact face and expression, pose, colour placement, clothing, accessories and internal body proportions. Preserve the number and position of every existing feature. Add only the depth and thickness necessary to turn the same flat design into a physical object.'
const examples = [
  ['natural-tabletop-60', '自然木桌 · 主体60% · 1:1', defaultPhotography(), 'Preserve all subject features. Use the selected natural tabletop photography with the complete subject occupying approximately 60% of a square image.'],
  ['preserve-original', '保留原背景与原构图 · 自动画幅', defaultPhotography('flat-to-felt'), 'Only change the material and add plausible sculptural depth. Preserve the original background, source camera framing, relative subject size, face, pose, colours, clothing and accessories.'],
]
await mkdir(new URL('../docs/felt-rules/examples/', import.meta.url), { recursive: true })
const summary = []
for (const [name, label, photography, userRequirements] of examples) {
  const result = composeFeltPrompt(makeFeltContext({ basePrompt, stage: 'generation', task: 'flat-to-felt', profile, photography, userRequirements }), 'gpt-image-2')
  await writeFile(new URL(`../docs/felt-rules/examples/${name}.txt`, import.meta.url), result.prompt + '\n')
  summary.push({ name, label, photography: result.photography, modules: result.modules, adapter: result.adapter, characters: result.prompt.length })
}
await writeFile(new URL('../docs/felt-rules/examples/manifest.json', import.meta.url), JSON.stringify(summary, null, 2) + '\n')
console.log(JSON.stringify({ examples: summary.length, generatedByProductionComposer: true, modelCalls: 0 }))

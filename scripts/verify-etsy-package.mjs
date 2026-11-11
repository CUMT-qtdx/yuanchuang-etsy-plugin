// 验收实际 Etsy 定制包，逐文件比较构建产物，不套用社区版已移除的 PPT 界面断言。
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
const file = process.argv[2], output = process.argv[3]
assert.ok(file, '需要待验收插件包路径')
const list = execFileSync('tar', ['-tzf', file], { encoding: 'utf8', maxBuffer: 15 * 1024 * 1024 }).trim().split(/\r?\n/)
const extract = name => execFileSync('tar', ['-xOzf', file, `package/${name}`], { maxBuffer: 15 * 1024 * 1024 })
const manifest = JSON.parse(extract('package.json').toString())
assert.equal(manifest.version, JSON.parse(readFileSync('package.json')).version)
assert.ok(list.includes(`package/docs/releases/v${manifest.version}.md`))
assert.ok(!list.some(name => /(?:node_modules|\.credentials|\.env(?:\.|$)|\.npmrc|desktop-data)/.test(name)), '包内不应有本机配置或凭证')
for (const name of readdirSync('lib').filter(name => /\.js$/.test(name))) assert.deepEqual(extract(`lib/${name}`), readFileSync(path.join('lib', name)), `构建文件不一致：${name}`)
for (const name of ['src/client/useCopyEditor.ts', 'src/client/CreationImageViewer.tsx', 'src/client/DesignReferences.tsx', 'src/client/FinalDesignPanel.tsx', 'src/etsy/creation-flow.ts', 'src/etsy/copy-facts.ts', 'src/etsy/listing-text.ts', 'src/etsy/workflow.ts', 'src/etsy/design-strategy.ts']) assert.deepEqual(extract(name), readFileSync(name))
const client = extract('lib/client.js').toString(), host = extract('lib/index.js').toString()
assert.ok(client.includes(manifest.version) && host.includes(manifest.version), '运行时显示版本必须与安装版本一致')
for (const marker of ['data-reference-studio', 'data-creation-image', 'data-creation-lightbox', 'data-creation-full-image', 'data-final-design', 'data-generate-angle-images', 'data-angle-placeholder', '探索图片数量', '设定卡', '下载这张原图', '__ModuleLoader__.load', '保留草稿并载入最新', '恢复本地草稿', '补齐未完成项']) assert.ok(client.includes(marker), `缺少界面能力：${marker}`)
for (const marker of ['mergeCopyRepair', 'baseCopy', 'confirmUnknown', 'copyFactIssue', 'REFERENCE_DESIGN_V2', 'referencePlannerSystem']) assert.ok(host.includes(marker), `缺少服务端能力：${marker}`)
for (const name of ['src/etsy/felt/types.ts', 'src/etsy/felt/library-v1.ts', 'src/etsy/felt/composer.ts', 'src/etsy/felt/photography-v1.ts', 'src/etsy/felt/composition-v1.ts', 'src/client/PhotographyControls.tsx', 'docs/felt-rules/README.md', 'docs/felt-rules/source-v1.0.txt', 'docs/felt-rules/photography-composition-source-v1.0.md', 'docs/felt-rules/examples/natural-tabletop-60.txt', 'docs/felt-rules/examples/preserve-original.txt']) assert.deepEqual(extract(name), readFileSync(name), `规则文件不一致：${name}`)
for (const marker of ['data-photography-controls', '主体高度占比', '视觉规则与实际提示词', 'data-visual-rules-status']) assert.ok(client.includes(marker), `缺少摄影界面能力：${marker}`)
for (const marker of ['NEEDLE_FELT_RULES:v', 'felt_photography_v1_0', 'felt_composition_v1_0', 'visual-rules.json']) assert.ok(host.includes(marker), `缺少规则接线：${marker}`)
for (const name of ['src/etsy/felt/photography-options.ts', 'src/etsy/multi-view/consistency-v1.ts', 'docs/felt-rules/multi-view-v1.md']) assert.deepEqual(extract(name), readFileSync(name), `多角度模块不一致：${name}`)
for (const marker of ['multi_view_consistency_v1_0', 'HIGHEST-PRIORITY FIXED DETAILS FROM USER', 'viewChecks']) assert.ok(host.includes(marker), `缺少多角度接线：${marker}`)
for (const marker of ['自定义摄影背景', 'data-view-anchor', '同一件产品 · 只换观察角度']) assert.ok(client.includes(marker), `缺少新界面：${marker}`)
for (const name of ['src/etsy/multi-view/material-lock-v1.ts', 'src/client/material-samples.ts', 'docs/felt-rules/material-lock-v1.md']) assert.deepEqual(extract(name), readFileSync(name), `材质锁定模块不一致：${name}`)
for (const marker of ['approved_material_lock_v1_0', 'MATERIAL-ONLY REPAIR', 'materialComparison', 'prepare-material', 'attach-material-samples']) assert.ok(host.includes(marker), `缺少材质接线：${marker}`)
for (const marker of ['只修材质', 'data-material-samples', '正在读取主图原始材质局部']) assert.ok(client.includes(marker), `缺少材质界面：${marker}`)
for (const name of ['src/etsy/multi-view/surface-continuity-v1.ts', 'docs/felt-rules/first-pass-material-v1.md']) assert.deepEqual(extract(name), readFileSync(name), `首次材质模块不一致：${name}`)
for (const marker of ['hero_surface_continuity_v1_0', 'sideBackModel']) assert.ok(host.includes(marker), `缺少首次生图能力：${marker}`)
assert.ok(client.includes('侧面背面模型'), '缺少侧背面独立模型选择')
for (const name of ['src/etsy/multi-view/view-direction-v1.ts', 'src/etsy/multi-view/direction-guide.ts', 'docs/felt-rules/view-direction-v1.md']) assert.deepEqual(extract(name), readFileSync(name), '方向模块必须与源码一致')
for (const marker of ['product_view_direction_v1_0', 'opposite-view-check', 'set-view-model']) assert.ok(host.includes(marker), `缺少方向与模型保存能力：${marker}`)
for (const marker of ['data-view-direction-hint', '纠正朝向', '朝向尚未检查']) assert.ok(client.includes(marker), `缺少方向界面：${marker}`)
for (const name of ['src/etsy/multi-view/spatial-v1.ts', 'src/client/spatial-identity.ts', 'docs/felt-rules/spatial-v1.md']) assert.deepEqual(extract(name), readFileSync(name), '配件位置模块必须与源码一致')
for (const marker of ['prepare-spatial', 'spatialChecks', 'SOURCE-PHOTO OBSERVATIONS']) assert.ok(host.includes(marker), `缺少配件位置能力：${marker}`)
const result = { passed: true, version: manifest.version, allJavaScriptBundlesMatch: true, sourceMatches: true, noLocalConfiguration: true, sha256: createHash('sha256').update(readFileSync(file)).digest('hex') }
if (output) writeFileSync(output, JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))

// 离线恢复已经返回的文案；不调用模型。--apply 仅在 DSH 完全退出后执行。
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { validateCopy } from '../.etsy-test/host.js'
const id = process.argv.find(value => value.startsWith('--product='))?.slice(10)
if (!id || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('请指定合法 --product=商品ID')
const base = 'E:/etsy/desktop-data/dsh-imagegen', directory = path.join(base, 'etsy-products', id), file = path.join(directory, 'product.json')
const evidence = 'E:/etsy/desktop-evidence', previewFile = path.join(evidence, 'copy-recovery-preview.private.json')
const bytes = await fs.readFile(file), digest = createHash('sha256').update(bytes).digest('hex'), product = JSON.parse(bytes.toString('utf8'))
const allowed = Object.fromEntries(Object.entries(product.facts).filter(([key, value]) => typeof value === 'string' && value.trim() !== '' && (['name', 'type', 'requirements'].includes(key) || product.facts.confirmed)))
const canonical = value => JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))))
let preview
if (!process.argv.includes('--apply')) {
  if (product.copyStage.status !== 'failed' || !/商品事实：(name|id|direction|changes)$/.test(product.copyStage.error ?? '')) throw new Error('本次不是可离线恢复的命名／元数据校验错误')
  const call = product.calls.filter(call => call.stage === 'copy' && call.status === 'failed' && call.finishedAt === product.copyStage.finishedAt).at(-1)
  if (!call) throw new Error('未找到唯一对应的失败调用')
  const image = product.images.find(image => image.id === product.selectedImageId)
  if (!image) throw new Error('当前选定图片不明确')
  const plan = product.referencePlan?.plans.find(plan => plan.id === image.planId)
  const candidates = []
  for (const name of await fs.readdir(path.join(base, 'etsy-model-calls'))) {
    if (!name.endsWith('.json')) continue
    const log = JSON.parse(await fs.readFile(path.join(base, 'etsy-model-calls', name), 'utf8'))
    if (log.createdAt < product.copyStage.startedAt - 100 || log.createdAt > product.copyStage.finishedAt || !log.request?.system?.includes('Etsy 英文商品文案助手') || typeof log.answer !== 'string') continue
    const parts = log.request.messages[0].content
    const text = typeof parts === 'string' ? parts : parts.find(part => part.type === 'text')?.text
    const source = text?.split('\n').flatMap(line => { try { const value = JSON.parse(line); return value?.name && value?.type ? [value] : [] } catch { return [] } })[0]
    if (!source || canonical(source) !== canonical(allowed)) continue
    if (plan) {
      const chunk = text.split('当前设计意图：')[1]?.split('。图片仅用于')[0]
      let design; try { design = JSON.parse(chunk) } catch { continue }
      if (design.id !== plan.id || design.prompt !== plan.prompt) continue
    }
    const raw = JSON.parse(log.answer.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
    candidates.push({ log: name, copy: validateCopy(raw, product.facts) })
  }
  if (candidates.length !== 1) throw new Error(`对应模型返回不唯一（${candidates.length}），未自动恢复`)
  preview = { productId: id, sourceSha256: digest, selectedImageId: image.id, callId: call.id, log: candidates[0].log, copy: candidates[0].copy, preparedAt: new Date().toISOString() }
  await fs.writeFile(previewFile, JSON.stringify(preview, null, 2), { mode: 0o600 })
  console.log(JSON.stringify({ ready: true, productId: id, selectedImageId: image.id, titles: preview.copy.titles.length, tags: preview.copy.tags.length, newModelCalls: 0 }, null, 2))
} else {
  preview = JSON.parse(await fs.readFile(previewFile, 'utf8'))
  if (preview.productId !== id || preview.sourceSha256 !== digest || preview.selectedImageId !== product.selectedImageId) throw new Error('准备恢复后项目发生变化，未修改数据')
  const call = product.calls.find(call => call.id === preview.callId)
  if (!call || call.status !== 'failed') throw new Error('失败调用状态已改变，未修改数据')
  const backup = path.join('E:/etsy/backups', `copy-recovery-${Date.now()}`, id)
  await fs.cp(directory, backup, { recursive: true, force: false, errorOnExist: true })
  const callsBefore = product.calls.length
  if (product.copy) product.copyVersions.push(structuredClone(product.copy))
  product.copy = preview.copy; product.copyImageId = preview.selectedImageId; product.copyFactsRevision = product.factsRevision ?? 1
  product.imageCopies ??= {}; product.imageCopies[preview.selectedImageId] = { copy: structuredClone(preview.copy), factsRevision: product.factsRevision ?? 1 }
  product.copyStage.status = 'completed'; product.copyStage.finishedAt = Date.now(); delete product.copyStage.error
  call.recovery = { at: Date.now(), sourceLog: preview.log, previousError: call.error, newModelCalls: 0 }; call.status = 'completed'; delete call.error
  product.updatedAt = Date.now(); product.revision++
  const temporary = path.join(directory, '.copy-recovery.tmp'); await fs.writeFile(temporary, JSON.stringify(product, null, 2), { mode: 0o600 }); await fs.rename(temporary, file)
  const result = { restored: true, productId: id, titles: product.copy.titles.length, tags: product.copy.tags.length, callsBefore, callsAfter: product.calls.length, newModelCalls: 0, backup }
  await fs.writeFile(path.join(evidence, 'copy-recovery-result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2))
}

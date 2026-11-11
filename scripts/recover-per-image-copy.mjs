// 离线修复逐图失败文案：只读取对应时间窗的模型返回，不调用模型。
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { validateCopy } from '../.etsy-test/host.js'
import { listingUsesEnglish } from '../.etsy-test/host.js'
const id = process.argv.find(value => value.startsWith('--product='))?.slice(10), base = 'E:/etsy/desktop-data/dsh-imagegen'
const imageId = process.argv.find(value => value.startsWith('--image='))?.slice(8)
if (!id || !/^[a-f0-9-]{36}$/.test(id) || !imageId || !/^[a-f0-9-]{36}$/.test(imageId)) throw new Error('请指定 --product=商品ID --image=图片ID')
const directory = path.join(base, 'etsy-products', id), file = path.join(directory, 'product.json'), product = JSON.parse(await fs.readFile(file, 'utf8'))
const image = product.images.find(image => image.id === imageId), migrate = process.argv.includes('--migrate'), existing = product.imageCopies?.[imageId]
if (!image) throw new Error('目标图片不存在')
const invalidCache = !existing || existing.factsRevision !== (product.factsRevision ?? 1) || !listingUsesEnglish(existing.copy)
if (migrate && !invalidCache && image.copyStage?.status === 'completed') throw new Error('目标图片的当前文案已经符合新规则，无需迁移')
if (!migrate && image.copyStage?.status !== 'failed') throw new Error('目标图片不是可离线恢复的文案失败状态')
const call = product.calls.filter(call => call.stage === 'copy' && call.target === imageId && (migrate ? call.status === 'completed' : call.status === 'failed') && (!image.copyStage?.finishedAt || call.finishedAt === image.copyStage.finishedAt)).at(-1)
if (!call) throw new Error('找不到唯一对应的文案调用')
const plan = product.referencePlan?.plans.find(plan => plan.id === image.planId), candidates = []
for (const name of await fs.readdir(path.join(base, 'etsy-model-calls'))) {
  if (!name.endsWith('.json')) continue
  const log = JSON.parse(await fs.readFile(path.join(base, 'etsy-model-calls', name), 'utf8'))
  if (log.createdAt < image.copyStage.startedAt - 100 || log.createdAt > image.copyStage.finishedAt || !log.request?.system?.includes('Etsy 英文商品文案助手') || typeof log.answer !== 'string') continue
  const content = log.request.messages[0]?.content, body = typeof content === 'string' ? content : content?.filter(part => part.type === 'text').map(part => part.text).join('\n')
  if (plan && !body?.includes(plan.name)) continue
  let raw; try { raw = JSON.parse(log.answer.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) } catch { continue }
  try { candidates.push({ name, copy: validateCopy(raw, product.facts) }) } catch { /* 旧规则返回不满足新英文规则，不能伪造恢复。 */ }
}
if (candidates.length !== 1) throw new Error(`对应返回不唯一或不满足新规则（${candidates.length}），未自动恢复；请显式重试`)
const sourceBytes = await fs.readFile(file), preview = { productId: id, imageId, sourceSha256: createHash('sha256').update(sourceBytes).digest('hex'), failedCallId: call.id, log: candidates[0].name, copy: candidates[0].copy }
const previewFile = path.join('E:/etsy/desktop-evidence', `copy-recovery-${imageId}.private.json`)
if (!process.argv.includes('--apply')) { await fs.writeFile(previewFile, JSON.stringify(preview, null, 2), { mode: 0o600 }); console.log(JSON.stringify({ ready: true, productId: id, imageId, log: candidates[0].name, titles: 5, newModelCalls: 0 })) }
else {
  const prepared = JSON.parse(await fs.readFile(previewFile, 'utf8')), digest = createHash('sha256').update(await fs.readFile(file)).digest('hex')
  if (prepared.sourceSha256 !== digest) throw new Error('商品在预检后发生变化，未修改')
  const backup = path.join('E:/etsy/backups', `copy-recovery-${Date.now()}`, id); await fs.cp(directory, backup, { recursive: true, force: false, errorOnExist: true })
  product.imageCopies ??= {}; product.imageCopies[imageId] = { copy: prepared.copy, factsRevision: product.factsRevision ?? 1 }; image.copyStage ??= { status: 'queued', attempts: 0 }; image.copyStage.status = 'completed'; image.copyStage.finishedAt = Date.now(); image.copyFactsRevision = product.factsRevision ?? 1; delete image.copyStage.error
  if (product.selectedImageId === imageId) { product.copy = prepared.copy; product.copyImageId = imageId; product.copyFactsRevision = product.factsRevision ?? 1; product.copyStage = { status: 'completed', attempts: 0 } }
  const call = product.calls.find(call => call.id === prepared.failedCallId); call.status = 'completed'; call.finishedAt = Date.now(); call.recovery = { at: Date.now(), sourceLog: prepared.log, previousError: call.error, migratedInvalidCache: migrate, newModelCalls: 0 }; delete call.error
  product.updatedAt = Date.now(); product.revision++
  await fs.writeFile(`${file}.tmp`, JSON.stringify(product, null, 2)); await fs.rename(`${file}.tmp`, file)
  console.log(JSON.stringify({ restored: true, productId: id, imageId, newModelCalls: 0, backup }))
}

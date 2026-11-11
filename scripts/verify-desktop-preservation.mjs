// 只读核对安装前后商品、图片与调用记录；私密基线只保留在本机证据目录。
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'

const base = 'E:/etsy/desktop-data', evidence = 'E:/etsy/desktop-evidence'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const read = async file => JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''))
const products = []
for (const entry of await fs.readdir(`${base}/dsh-imagegen/etsy-products`, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const directory = `${base}/dsh-imagegen/etsy-products/${entry.name}`, bytes = await fs.readFile(`${directory}/product.json`), product = JSON.parse(bytes.toString('utf8'))
  const stages = [product.planning, product.copyStage, ...product.images.flatMap(image => [image.generation, image.quality, image.copyStage])]
  const assets = {}
  for (const file of new Set([...product.referenceFiles, ...product.images.flatMap(image => image.files)])) assets[file] = sha(await fs.readFile(path.join(directory, file)))
  products.push({ id: product.id, calls: product.calls.length, active: stages.filter(stage => stage && ['queued', 'running'].includes(stage.status)).length, sha256: sha(bytes), assets })
}
products.sort((a, b) => a.id.localeCompare(b.id))
const settings = {}
for (const file of ['.credentials.yaml', 'cordis.yml', 'cordis.patch.yml']) {
  try { settings[file] = sha(await fs.readFile(path.join(base, file))) }
  catch (error) { if (error.code !== 'ENOENT') throw error; settings[file] = null }
}
const snapshot = { products, settings, modelLogs: (await fs.readdir(`${base}/dsh-imagegen/etsy-model-calls`)).filter(file => file.endsWith('.json')).length }
const baselineFile = `${evidence}/editor-delete-baseline.private.json`
if (process.argv.includes('--before')) {
  assert.ok(products.every(product => product.active === 0), '存在未完成任务，先保留运行状态')
  await fs.writeFile(baselineFile, JSON.stringify(snapshot, null, 2))
  console.log(JSON.stringify({ ready: true, products: products.length, calls: products.reduce((sum, product) => sum + product.calls, 0) }))
} else {
  const baseline = await read(baselineFile)
  const afterRestart = process.argv.includes('--after-restart')
  if (afterRestart) {
    // 宿主恢复完成的创作时会更新时间与修订号；业务内容仍必须与安装备份一致。
    const backup = process.argv.find(value => value.startsWith('--backup='))?.slice(9)
    if (!backup) throw new Error('重开后核对需要 --backup=安装前备份目录')
    assert.deepEqual(snapshot.products.map(product => ({ ...product, sha256: undefined })), baseline.products.map(product => ({ ...product, sha256: undefined })), '项目、图片或调用记录发生变化')
    for (const product of products) {
      assert.ok(/^[a-zA-Z0-9-]{1,80}$/.test(product.id), '商品 ID 无效')
      const bytes = await fs.readFile(path.join(backup, 'etsy-products', product.id, 'product.json'))
      assert.equal(sha(bytes), baseline.products.find(previous => previous.id === product.id)?.sha256, '备份与安装前基线不一致')
      const previous = JSON.parse(bytes.toString('utf8')), current = await read(`${base}/dsh-imagegen/etsy-products/${product.id}/product.json`)
      for (const value of [previous, current]) { delete value.updatedAt; delete value.revision }
      assert.deepEqual(current, previous, '商品业务内容发生变化')
    }
  } else assert.deepEqual(snapshot.products, baseline.products, '商品档案或原图出现变化，需核对')
  assert.equal(snapshot.modelLogs, baseline.modelLogs, '模型日志数量出现变化，需核对')
  if (process.argv.includes('--installed')) assert.deepEqual(settings, baseline.settings, '安装前后宿主设置出现变化，需核对')
  const installed = `${base}/profiles/desktop/node_modules/@dickpy/dsh-imagegen`
  const version = (await read('package.json')).version
  assert.equal((await read(`${installed}/package.json`)).version, version)
  for (const file of ['lib/index.js', 'lib/client.js']) assert.equal(sha(await fs.readFile(file)), sha(await fs.readFile(`${installed}/${file}`)))
  const result = { checkedAt: new Date().toISOString(), version, installedHashesMatch: true, productsPreserved: products.length, originalFilesPreserved: products.reduce((sum, product) => sum + Object.keys(product.assets).length, 0), productRecordsUnchanged: products.every(product => product.sha256 === baseline.products.find(previous => previous.id === product.id)?.sha256), productBusinessDataUnchanged: true, afterRestart, newModelCalls: 0, modelLogDelta: 0, deletionTestUsesMockOnly: true }
  await fs.writeFile(`${evidence}/editor-delete-verification.json`, JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
}

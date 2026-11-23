import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import {
  jsonPayload,
  validateQuality,
  generateImage,
  EtsyStore,
  composeFeltPrompt,
  makeFeltContext,
  defaultPhotography,
  normalizePhotography,
  compositionTarget,
  CURRENT_MATERIAL,
  ORNAMENT_MODULE,
  isOrnamentContext,
  imageDataRoot,
  setImageDataRoot,
  makeRoutes,
} from '../.etsy-test/host.js'
import { fixture, input, facts } from './etsy-fixture.mjs'

test('jsonPayload 容错修复真实线上出现的非标准 JSON 形态且不破坏合法字符串', () => {
  // 1) 未加引号键名 + 裸状态枚举
  const unquoted = jsonPayload('{status:PASS, summary:"待检图正常，保留:原样", issues:[], uncertainties:[]}')
  assert.equal(unquoted.status, 'PASS')
  assert.equal(unquoted.summary, '待检图正常，保留:原样')
  const report = validateQuality(unquoted, { ...facts, confirmed: true }, true, 'deepseek-flash')
  assert.equal(report.status, 'PASS')

  // 2) 末尾多出闭合大括号
  const extraBrace = jsonPayload('{"name":"猫挂件","plans":[{"name":"A"}]} }')
  assert.equal(extraBrace.name, '猫挂件')

  // 3) 末尾漏掉闭合大括号
  const missingBrace = jsonPayload('{"status":"REVISE","summary":"需修正","issues":[{"area":"材质","problem":"偏松","suggestion":"压紧","evidence":"帽檐偏松"}]')
  assert.equal(missingBrace.status, 'REVISE')
  assert.equal(missingBrace.issues.length, 1)

  // 4) 逗号后孤立引号笔误 `,"}`
  const strayQuote = jsonPayload('{"status":"REVISE","summary":"背面一致","issues":[{"area":"配件","problem":"换手","suggestion":"调回","evidence":"见主图","}],"uncertainties":[]}')
  assert.equal(strayQuote.status, 'REVISE')
  assert.equal(strayQuote.issues[0].evidence, '见主图')

  // 5) Markdown 代码块包裹 + 尾逗号 + 字符串内裸换行
  const fenced = jsonPayload('```json\n{"status":"PASS","summary":"第一行\n第二行","issues":[],}\n```')
  assert.equal(fenced.status, 'PASS')
  assert.match(fenced.summary, /第一行\n第二行/)
})

test('协议防呆：仅拦截明确冲突的 :generateContent + images 组合，不发送错误拼接请求', async () => {
  await assert.rejects(
    () => generateImage(
      { apiUrl: 'https://creative.example.test/v1beta/models/gemini-3.1-flash-image:generateContent', apiKey: 'test-key', protocol: 'images', apiUrlFull: false },
      { mode: 'edit', model: 'gemini-3.1-flash-image', prompt: 'test', image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', n: 1, size: '1:1', quality: '2k', detail: '' },
    ),
    /Gemini 原生接口|protocol-mismatch/,
  )
})

test('单条损坏的 product.json 会被隔离，不拖垮其余正常商品与工作台恢复', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'etsy-corrupt-'))
  t.after(async () => { await rm(root, { recursive: true, force: true }) })

  const first = fixture(root)
  await first.workflow.ready
  const okProduct = await first.workflow.start(input({ count: 1, autoCheck: false }))
  await first.workflow.idle()
  first.workflow.dispose()

  // 写入一个损坏的同级商品目录
  const brokenDir = path.join(root, 'broken-product-001')
  await mkdir(brokenDir, { recursive: true })
  await writeFile(path.join(brokenDir, 'product.json'), '{"schema":1,"id":"broken-product-001", CORRUPT', 'utf8')

  const store = new EtsyStore(root)
  const loaded = await store.load()
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].id, okProduct.id)
  assert.equal(store.corruptEntries().length, 1)
  assert.equal(store.corruptEntries()[0].id, 'broken-product-001')

  const recovered = fixture(root)
  await recovered.workflow.ready
  const list = await recovered.workflow.list()
  assert.equal(list.length, 1)
  assert.equal(list[0].id, okProduct.id)
  recovered.workflow.dispose()
})

test('小挂件自动识别与悬挂/俯拍平铺预设生效，且桌面人物摆件零回归', () => {
  // 1) 人物桌面摆件：不启用挂件规则，底部仍落在 92%
  const figurinePhoto = normalizePhotography({ ...defaultPhotography(), photography_preset: 'natural-tabletop', subject_height_ratio: 0.6, framing_policy: 'override_reference' })
  const figurine = composeFeltPrompt(makeFeltContext({
    materialPreset: CURRENT_MATERIAL,
    stage: 'generation',
    task: 'redesign',
    basePrompt: 'Two standing needle-felted wool angel figurines holding red hearts on an oak table.',
    photography: figurinePhoto,
  }), 'gemini-3.1-flash-image')
  assert.equal(figurine.modules.ornament_v1_0, undefined)
  assert.equal(figurine.compositionTarget.bottom, 0.92)
  assert.doesNotMatch(figurine.prompt, /HANGING HARDWARE & CORDS/)

  // 2) 小挂件（关键词/profile 自动识别 + 悬挂展示）：启用挂件规则，构图上下居中留足挂绳空间
  const hangingPhoto = normalizePhotography({ ...defaultPhotography(), photography_preset: 'hanging-display', subject_height_ratio: 0.6, framing_policy: 'override_reference', explicit_controls: ['background', 'framing'] })
  assert.equal(hangingPhoto.photography_preset, 'hanging-display')
  const hangingTarget = compositionTarget(hangingPhoto)
  assert.equal(hangingTarget.top, 0.2)
  assert.equal(hangingTarget.bottom, 0.8)

  const ornament = composeFeltPrompt(makeFeltContext({
    materialPreset: CURRENT_MATERIAL,
    stage: 'generation',
    task: 'redesign',
    profile: { components: [], mixedMaterials: [], tones: [], scene: 'christmas', productForm: 'ornament' },
    basePrompt: 'Set of 6 needle-felted wool Christmas baubles with embroidered snowflakes, felted caps and twisted jute twine hanging loops.',
    photography: hangingPhoto,
  }), 'gemini-3.1-flash-image')
  assert.equal(ornament.modules.ornament_v1_0, '1.0')
  assert.ok(ornament.ruleIds.includes(ORNAMENT_MODULE))
  assert.match(ornament.prompt, /HANGING HARDWARE & CORDS/)
  assert.match(ornament.prompt, /HAND-EMBROIDERED & INLAID MOTIFS/)
  assert.match(ornament.prompt, /natural hanging product-photography display/i)
  assert.match(ornament.prompt, /comfortable top clearance/i)

  // 3) 俯拍平铺预设
  const flatLayPhoto = normalizePhotography({ ...defaultPhotography(), photography_preset: 'flat-lay', subject_height_ratio: 0.7, framing_policy: 'override_reference', explicit_controls: ['background', 'framing'] })
  const flatLay = composeFeltPrompt(makeFeltContext({
    materialPreset: CURRENT_MATERIAL,
    stage: 'generation',
    task: 'redesign',
    basePrompt: 'Six wool felt Christmas stocking ornaments with blanket stitches and twine loops.',
    photography: flatLayPhoto,
  }), 'gemini-3.1-flash-image')
  assert.equal(flatLay.modules.ornament_v1_0, '1.0')
  assert.match(flatLay.prompt, /90-degree top-down overhead flat-lay/i)
  assert.match(flatLay.prompt, /never crop or cut off any piece at the image edges/i)
  assert.equal(isOrnamentContext(undefined, ['不要挂绳的站立玩偶'], 'natural-tabletop'), false)

  // 4) 人物毛毡分层密度、哑光防塑壳与合理物理结构约束
  assert.match(figurine.prompt, /Differentiate felting density by part/i)
  assert.match(figurine.prompt, /dark wool stays matte without a glossy shell/i)
})

test('左侧创作分组全链路持久化，删除分组保留创作，移动分组不破坏文案乐观锁', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'etsy-groups-'))
  t.after(async () => { await rm(root, { recursive: true, force: true }) })

  const f = fixture(root)
  await f.workflow.ready
  const created = await f.workflow.start(input({ count: 1, autoCheck: false }))
  await f.workflow.idle()
  const beforeRevision = (await f.workflow.get(created.id)).revision

  const groups1 = await f.workflow.createGroup('圣诞小挂件')
  assert.equal(groups1.length, 1)
  assert.equal(groups1[0].name, '圣诞小挂件')
  await assert.rejects(() => f.workflow.createGroup('圣诞小挂件'), /同名分组/)

  const moved = await f.workflow.moveToGroup(created.id, groups1[0].id)
  assert.equal(moved.groupId, groups1[0].id)
  assert.equal(moved.revision, beforeRevision, '移动分组不应递增文案乐观锁 revision')

  const renamed = await f.workflow.renameGroup(groups1[0].id, '圣诞吊饰精选')
  assert.equal(renamed[0].name, '圣诞吊饰精选')
  f.workflow.dispose()

  // 重启后重新加载验证持久化
  const f2 = fixture(root)
  await f2.workflow.ready
  const persistedGroups = await f2.workflow.listGroups()
  assert.equal(persistedGroups.length, 1)
  assert.equal(persistedGroups[0].name, '圣诞吊饰精选')
  const persistedProduct = await f2.workflow.get(created.id)
  assert.equal(persistedProduct.groupId, persistedGroups[0].id)

  // 删除分组不删除创作，且商品回到未分组
  const afterDelete = await f2.workflow.deleteGroup(persistedGroups[0].id)
  assert.equal(afterDelete.length, 0)
  const ungrouped = await f2.workflow.get(created.id)
  assert.equal(ungrouped.groupId, undefined)
  f2.workflow.dispose()
})

test('打开数据目录接口遵循 imageDataRoot 而不是硬编码 ~/.dsh', async () => {
  const previous = imageDataRoot()
  const customRoot = path.join(tmpdir(), 'custom-dsh-imagegen-root')
  try {
    setImageDataRoot(customRoot)
    const routes = makeRoutes({
      settings: { describe: () => [], mutate: async () => {} },
      resolveChannels: () => ({ defaultChannelId: '', channels: [] }),
      resolvePromptModel: () => ({ apiUrl: '', apiKey: '', model: '' }),
      resolveImageModels: () => [],
    })
    const route = routes.find(item => item.path === '/api/dsh-imagegen/data-folder/open')
    assert.ok(route)
    let status = 200
    let body = ''
    const req = {
      method: 'POST',
      url: '/api/dsh-imagegen/data-folder/open',
      headers: { host: '127.0.0.1:1234', 'content-type': 'application/json' },
      socket: { remoteAddress: '127.0.0.1' },
      [Symbol.asyncIterator]: async function* () { yield Buffer.from(JSON.stringify({ open: false })) },
    }
    const res = {
      statusCode: 200,
      setHeader() {},
      writeHead(code) { status = code },
      end(chunk) { body = String(chunk ?? '') },
    }
    await route.handler(req, res)
    assert.equal(status, 200)
    const parsed = JSON.parse(body)
    assert.equal(parsed.ok, true)
    assert.equal(parsed.path, path.resolve(customRoot))
  } finally {
    setImageDataRoot(previous)
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { EtsyHostModel, HOST_MODEL_URL, chooseEtsyModel, checkForUpdate, installUpdate, resolveEtsyModels, createStudioModelControls } from '../.etsy-test/host.js'
import { pixel } from './etsy-fixture.mjs'

async function fixture(t, inputModalities = ['text', 'image'], failure = false) {
  const root = await mkdtemp(path.join(tmpdir(), 'etsy-native-model-'))
  const bridge = new EtsyHostModel(() => root), requests = [], admitted = []
  bridge.attach({
    selection: { currentSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }) },
    llm: {
      listProviders: () => [{ id: 'deepseek-account', name: 'DeepSeek' }, { id: 'other-provider', name: 'Other' }],
      listModels: async provider => [{ id: provider === 'deepseek-account' ? 'deepseek-flash' : 'other-vision', name: provider, inputModalities, apiKey: 'never-return-this-secret' }],
      resolveModelInfo: async () => ({ inputModalities, reasoning: { efforts: [{ id: 'off' }, { id: 'high' }] } }),
      async *stream(request) {
        requests.push(request)
        if (failure) { yield { type: 'finish', reason: { kind: 'error', failure: { code: 'ACCOUNT_QUOTA', message: '测试额度不足' } } }; return }
        yield { type: 'text-delta', text: '{"ok":' }; yield { type: 'text-delta', text: 'true}' }
        yield { type: 'usage', usage: { inputTokens: 20, outputTokens: 5 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    },
    attachments: { async saveImage(input) { admitted.push(input); return { attachmentId: 'owned-test-image', mediaType: input.mediaType, bytes: input.data.length, width: 1, height: 1 } } },
  })
  t.after(async () => rm(root, { recursive: true, force: true }))
  return { bridge, requests, admitted, root }
}
test('直接复用 DSH 已选账户模型，不需要复制 API Key，视觉输入为宿主持久附件', async t => {
  const { bridge, requests, admitted, root } = await fixture(t)
  const config = bridge.config()
  assert.equal(config.apiKey, '')
  assert.equal(config.model, 'deepseek-account/deepseek-flash')
  assert.equal((await bridge.status()).vision, true)
  const result = await bridge.complete(config, { system: '检测要求', content: [{ type: 'text', text: '检查图片' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${pixel}` } }] })
  assert.equal(result, '{"ok":true}'); assert.equal(admitted.length, 1)
  assert.equal(requests[0].provider, 'deepseek-account')
  assert.equal(requests[0].model, 'deepseek-flash')
  assert.equal(requests[0].reasoningEffort, 'off')
  assert.equal(requests[0].messages[0].content[1].type, 'image')
  const records = await readdir(root), record = JSON.parse(await readFile(path.join(root, records[0]), 'utf8'))
  assert.equal(record.status, 'completed'); assert.equal(record.usage.outputTokens, 5)
  assert.ok(!JSON.stringify(record).includes('apiKey'))
})
test('纯文字模型禁止假装看图，提交前明确拒绝视觉请求', async t => {
  const { bridge, requests } = await fixture(t, ['text'])
  assert.equal((await bridge.status()).vision, false)
  await assert.rejects(bridge.complete(bridge.config(), { system: '检测', content: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${pixel}` } }] }), /不能用文字占位/)
  assert.equal(requests.length, 0)
})
test('宿主错误结束不可当成成功文案，不自动重试', async t => {
  const { bridge, requests } = await fixture(t, ['text', 'image'], true)
  await assert.rejects(bridge.complete(bridge.config(), { system: '文案', content: '商品资料' }), /ACCOUNT_QUOTA/)
  assert.equal(requests.length, 1)
})
test('独立 API 仍受支持，换服务商不会自动转发原服务商密钥', () => {
  const base = { apiUrl: 'https://a.example/v1', apiKey: 'private-a-key', model: 'chat-a' }
  const other = chooseEtsyModel({ apiUrl: 'https://b.example/v1', model: 'chat-b' }, base)
  assert.equal(other.apiKey, '')
  const host = chooseEtsyModel({ model: 'another-model' }, { apiUrl: HOST_MODEL_URL, apiKey: '', model: 'p/m', hostProvider: 'p', hostModel: 'm' })
  assert.equal(host.hostModel, 'another-model'); assert.equal(host.model, 'p/another-model')
})
test('定制版不提示覆盖上游包，安装接口也拒绝丢失定制功能的替换', async () => {
  const status = await checkForUpdate(async () => { throw new Error('不应发出上游更新请求') })
  assert.equal(status.updateAvailable, false)
  await assert.rejects(installUpdate('1.15.5', () => { throw new Error('不应启动包管理器') }), /定制开发版/)
})
test('模型目录只返回展示信息，统一分析选择准确路由其他供应商且不带旧密钥', async t => {
  const { bridge, requests } = await fixture(t)
  const catalog = await bridge.catalog()
  assert.equal(catalog.models.length, 2)
  assert.ok(!JSON.stringify(catalog).includes('never-return-this-secret'))
  const resolved = resolveEtsyModels({ etsyAnalysisProvider: 'other-provider', etsyAnalysisModel: 'other-vision' }, { apiUrl: 'https://old.invalid/v1', apiKey: 'old-secret', model: 'old-model' }, bridge)
  assert.equal(resolved.vision, resolved.copy)
  assert.equal(resolved.vision.apiKey, '')
  assert.equal(resolved.vision.model, 'other-provider/other-vision')
  await bridge.complete(resolved.copy, { system: '测试写作', content: 'mock' })
  assert.equal(requests[0].provider, 'other-provider')
  assert.equal(requests[0].model, 'other-vision')
  assert.equal(bridge.config('other-provider', ''), undefined)
})
test('两类模型选择原子保存，目录不暴露密钥，忙碌时禁止中途切换', async t => {
  const { bridge, requests } = await fixture(t)
  const settings = { defaultChannelId: 'gpt', defaultModel: 'gpt-image-2.5-flare' }, mutations = []
  let revision = 1, busy = false
  const controls = createStudioModelControls({ settings: () => settings, revision: () => revision, writable: () => true,
    channels: () => ({ defaultChannelId: 'gpt', channels: [{ id: 'gpt', name: 'GPT 图片', apiUrl: 'https://private.invalid/v1', apiKey: 'image-secret', models: [{ alias: 'gpt-image-2.5-flare', id: 'gpt-image-2.5-flare' }] }] }), host: bridge,
    resolved: () => resolveEtsyModels(settings, bridge.config(), bridge), busy: async () => busy,
    mutate: async (ops, expected) => { assert.equal(expected, revision); mutations.push(ops); for (const op of ops) settings[op.path[0]] = op.value; revision++ },
  })
  const view = await controls.read()
  assert.ok(!JSON.stringify(view).includes('image-secret'))
  const body = { revision: view.revision, image: view.image, analysis: { provider: 'other-provider', model: 'other-vision' } }
  const saved = await controls.save(body)
  assert.equal(mutations.length, 1)
  assert.equal(mutations[0].length, 4)
  assert.equal(saved.analysis.provider, 'other-provider')
  assert.equal((await controls.read()).analysis.model, 'other-vision')
  assert.equal(settings.defaultModel, 'gpt-image-2.5-flare')
  assert.equal(requests.length, 0, '读取目录与保存设置不应发起模型推理')
  busy = true
  await assert.rejects(controls.save({ ...body, revision: saved.revision }), /等待/)
  assert.equal(mutations.length, 1)
  busy = false
  await assert.rejects(controls.save({ ...body, revision: saved.revision, image: { channelId: 'other', model: 'not-configured' } }), /已配置/)
})
test('分析模型必须支持图片，拒绝只支持文字的模型且不发出推理', async t => {
  const { bridge, requests } = await fixture(t, ['text'])
  assert.ok((await bridge.catalog()).models.every(model => model.vision === false))
  await assert.rejects(bridge.validateVisionSelection('other-provider', 'other-vision'), /支持图片输入/)
  assert.equal(requests.length, 0)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { ensureAgentImageConfigured } from '../src/agent-image-tools.ts'
import { imageChannelConfigured } from '../src/client/channel-readiness.ts'

function config(channel) {
  return {
    enabled: true,
    allowAgentImageGeneration: true,
    defaultChannelId: 'channel-a',
    channels: [{
      id: 'channel-a',
      preset: '',
      name: 'Image channel',
      apiUrl: '',
      apiUrlFull: false,
      apiKey: '',
      models: [{ alias: 'image-model', id: 'image-model' }],
      ...channel,
    }],
  }
}

test('subscription channel with a resolved subscription passes image preflight', () => {
  assert.doesNotThrow(() => ensureAgentImageConfigured(config({ auth: 'subscription', subscription: 'chatgpt-sub' })))
})

test('subscription channel without a resolved subscription fails image preflight', () => {
  assert.throws(() => ensureAgentImageConfigured(config({ auth: 'subscription' })), { code: 'image-api-not-configured' })
})

test('API-key channel with URL and key passes image preflight', () => {
  assert.doesNotThrow(() => ensureAgentImageConfigured(config({ auth: 'api-key', apiUrl: 'https://example.com/v1', apiKey: 'test-key' })))
})

test('empty API-key channel fails image preflight', () => {
  assert.throws(() => ensureAgentImageConfigured(config({ auth: 'api-key' })), { code: 'image-api-not-configured' })
})
test('设置页将已登录订阅计入已配置渠道，不要求另填 API Key', () => {
  const channel = config({ auth: 'subscription', subscription: 'chatgpt-sub' }).channels[0]
  assert.equal(imageChannelConfigured(channel, false, { 'chatgpt-sub': { state: 'logged-in' } }), true)
  assert.equal(imageChannelConfigured(channel, false, { 'chatgpt-sub': { state: 'logged-out' } }), false)
  assert.equal(imageChannelConfigured(channel, false), false)
})
test('设置页的 API Key 渠道需要地址、密钥和实际模型配置', () => {
  const channel = config({ auth: 'api-key', apiUrl: 'https://example.com/v1' }).channels[0]
  assert.equal(imageChannelConfigured(channel, true), true)
  assert.equal(imageChannelConfigured(channel, false), false)
  assert.equal(imageChannelConfigured({ ...channel, apiUrl: '' }, true), false)
  assert.equal(imageChannelConfigured({ ...channel, models: [] }, true), false)
})

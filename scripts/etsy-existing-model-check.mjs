import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
const runtime = createRequire('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/package.json')
const { chromium } = runtime('playwright')
const YAML = createRequire('E:/etsy/poc/dickpy/npm-cache/_npx/b5e10b118beccd0f/node_modules/package.json')('yaml')
const home = 'E:/etsy/desktop-data', privateRoot = 'E:/etsy/development/live-test-data'
if (process.argv.includes('--run')) {
  try {
    const prior = JSON.parse(await readFile(`${privateRoot}/live-test-result.json`, 'utf8'))
    if (prior.calls?.length > 0) throw new Error('本轮已有真实调用记录，禁止重复运行整轮，需按剩余额度继续')
  } catch (error) { if (error.code !== 'ENOENT') throw error }
}
const cli = 'E:/etsy/poc/dickpy/npm-cache/_npx/b5e10b118beccd0f/node_modules/@deepseek-ai/dsh/lib/bin.js'
const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version
const desktop = YAML.parse(await readFile(`${home}/profiles/desktop/cordis.patch.yml`, 'utf8'), { logLevel: 'silent', customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => value }] })
const selected = desktop.find(entry => entry.id === 'agent-default-model')?.config
if (!selected?.provider || !selected.model) throw new Error('DSH 当前未保存默认模型')
const channels = desktop.find(entry => entry.id === 'imagegen')?.config?.channels ?? []
await mkdir(privateRoot, { recursive: true })
const installed = spawnSync(process.execPath, [cli, 'plugin', '--profile', 'web', 'add', '--save-exact', `E:/etsy/development/releases/dickpy-dsh-imagegen-${version}.tgz`, '--store-dir', 'E:/etsy/.pnpm-store'], { env: { ...process.env, DSH_HOME: home }, windowsHide: true, encoding: 'utf8' })
await writeFile(`${privateRoot}/profile-install.private.log`, (installed.stdout ?? '') + (installed.stderr ?? ''))
if (installed.status !== 0) throw new Error('隔离验证 profile 安装失败，见本机私密日志')
const patchFile = `${home}/profiles/web/cordis.patch.yml`, originalPatch = await readFile(patchFile, 'utf8')
await writeFile(`${privateRoot}/web-patch-before.private.yml`, originalPatch)
await writeFile(patchFile, JSON.stringify([
  { id: 'agent-default-model', config: selected },
  { id: 'imagegen', config: { channels, localStoragePath: `${privateRoot}/images` } },
  { id: 'locale', config: { preference: 'zh' } },
  { id: 'ui-settings-general', config: { welcomeNoticeVersion: '2026-09-28.1' } },
], null, 2))
const host = spawn(process.execPath, [cli, 'web', '--port', '0', '--no-open'], { env: { ...process.env, DSH_HOME: home }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
let output = '', browser
host.stdout.on('data', value => { output += value }); host.stderr.on('data', value => { output += value })
try {
  let url
  for (let attempt = 0; attempt < 600; attempt++) {
    const clean = output.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    const matches = clean.match(/http:\/\/127\.0\.0\.1:\d+\/[^\s<>]*/g) ?? []
    url = matches.find(value => value.includes('?')) ?? matches.at(-1)
    if (url) break
    if (host.exitCode !== null) throw new Error('模型检查宿主提前退出')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  if (!url) throw new Error('模型检查宿主未就绪')
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage(); await page.goto(url)
  const base = new URL(url).origin
  const call = async (action, value = {}) => {
    const response = await page.request.post(`${base}/api/dsh-imagegen/etsy/${action}`, { data: value })
    const result = await response.json()
    if (!result.ok) throw new Error(result.message || '宿主模型调用失败')
    return result.value
  }
  const model = await call('models')
  await writeFile(`${privateRoot}/model-capabilities.json`, JSON.stringify({ checkedAt: new Date().toISOString(), ...model }, null, 2))
  console.log(JSON.stringify({ step: 'existing-model-capabilities', ...model }, null, 2))
  if (process.argv.includes('--run')) {
    if (!model.available || !model.vision) throw new Error('现有模型尚未验证具备视觉能力，停止真实生成')
    const channel = channels.find(channel => channel.auth === 'subscription' && channel.models?.length > 0)
    if (!channel) throw new Error('未找到可复用的订阅生图渠道，停止真实生成')
    const product = await call('start', {
      requestKey: `live-${crypto.randomUUID()}`, count: 1, maxCalls: 3, autoCheck: true,
      facts: { name: 'Needle-felt Cat Digital Concept', type: 'digital_illustration', requirements: 'Single cat character with red scarf, natural proportions, soft needle-felt appearance; digital concept image only.', materials: 'AI-generated digital illustration depicting a needle-felt appearance', dimensions: '', packaging: 'Digital concept image only; no physical packaging', processing: '', delivery: 'Digital concept for internal design review only; no physical item', personalization: '', confirmed: true, authenticityConfirmed: false },
      generation: { mode: 'text', model: channel.models[0].alias, channelId: channel.id, size: '1:1', quality: 'auto', n: 1,
        prompt: 'Create one digital product-design concept illustration of a small cute cat with a red scarf, sculpted needle-felt appearance with visible soft fibers, natural balanced proportions, two ears, two eyes, one tail, full body, plain light background, no text, no watermark. One character only.' },
    })
    await writeFile(`${privateRoot}/live-product-id.json`, JSON.stringify({ id: product.id }, null, 2))
    let current = product
    for (let attempt = 0; attempt < 210; attempt++) {
      current = await call('get', { id: product.id })
      const active = current.images.some(image => ['queued', 'running'].includes(image.generation.status) || ['queued', 'running'].includes(image.quality.status)) || ['queued', 'running'].includes(current.copyStage.status)
      if (!active) break
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
    const summary = { checkedAt: new Date().toISOString(), model, id: current.id, generation: current.images.map(image => image.generation), quality: current.images.map(image => ({ stage: image.quality, status: image.report?.status, summary: image.report?.summary })), copy: current.copyStage, titleCount: current.copy?.titles.length ?? 0, tags: current.copy?.tags.length ?? 0, calls: current.calls.map(({ stage, model, status }) => ({ stage, model, status })), maxCalls: current.options.maxCalls }
    await writeFile(`${privateRoot}/live-test-result.json`, JSON.stringify(summary, null, 2))
    console.log(JSON.stringify({ step: 'live-product-test', ...summary }, null, 2))
  }
} finally {
  await writeFile(`${privateRoot}/host.private.log`, output)
  await browser?.close(); host.kill(); await writeFile(patchFile, originalPatch)
}

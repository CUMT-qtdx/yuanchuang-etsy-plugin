// 纯模型能力查询：不提交生图、视觉推理或文案生成请求。
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
const runtime = createRequire('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/package.json')
const { chromium } = runtime('playwright')
const YAML = createRequire('E:/etsy/poc/dickpy/npm-cache/_npx/b5e10b118beccd0f/node_modules/package.json')('yaml')
const home = 'E:/etsy/desktop-data', root = 'E:/etsy/development/live-test-data'
const cli = 'E:/etsy/poc/dickpy/npm-cache/_npx/b5e10b118beccd0f/node_modules/@deepseek-ai/dsh/lib/bin.js'
const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version
const entries = YAML.parse(await readFile(`${home}/profiles/desktop/cordis.patch.yml`, 'utf8'), { logLevel: 'silent', customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => value }] })
const selected = entries.find(entry => entry.id === 'agent-default-model')?.config
if (!selected?.provider || !selected.model) throw new Error('当前 DSH 未保存默认模型')
await mkdir(root, { recursive: true })
const install = spawnSync(process.execPath, [cli, 'plugin', '--profile', 'web', 'add', '--save-exact', `E:/etsy/development/releases/dickpy-dsh-imagegen-${version}.tgz`, '--store-dir', 'E:/etsy/.pnpm-store'], { env: { ...process.env, DSH_HOME: home }, windowsHide: true, encoding: 'utf8' })
await writeFile(`${root}/status-profile-install.private.log`, (install.stdout ?? '') + (install.stderr ?? ''))
if (install.status !== 0) throw new Error('查询用 profile 准备失败')
const patch = `${home}/profiles/web/cordis.patch.yml`, before = await readFile(patch, 'utf8')
await writeFile(`${root}/status-web-patch-before.private.yml`, before)
await writeFile(patch, JSON.stringify([{ id: 'agent-default-model', config: selected }, { id: 'imagegen', config: { localStoragePath: `${root}/metadata-only` } }], null, 2))
const child = spawn(process.execPath, [cli, 'web', '--port', '0', '--no-open'], { env: { ...process.env, DSH_HOME: home }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
let output = '', browser
child.stdout.on('data', data => { output += data }); child.stderr.on('data', data => { output += data })
try {
  let target
  for (let attempt = 0; attempt < 600; attempt++) {
    const links = output.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').match(/http:\/\/127\.0\.0\.1:\d+\/[^\s<>]*/g) ?? []
    target = links.find(link => link.includes('?')) ?? links.at(-1)
    if (target) break
    if (child.exitCode !== null) throw new Error('模型能力查询宿主提前退出')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  if (!target) throw new Error('模型能力查询宿主未就绪')
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage(); await page.goto(target)
  const response = await page.request.post(`${new URL(target).origin}/api/dsh-imagegen/etsy/models`, { data: {} })
  const result = await response.json()
  if (!result.ok) throw new Error('模型能力查询失败')
  await writeFile(`${root}/model-capabilities.json`, JSON.stringify({ checkedAt: new Date().toISOString(), ...result.value }, null, 2))
  console.log(JSON.stringify({ step: 'metadata-only', ...result.value }, null, 2))
} finally {
  await writeFile(`${root}/status-host.private.log`, output)
  await browser?.close(); child.kill(); await writeFile(patch, before)
}

// 安装交付包验收：验证双击入口、中文路径、既有存储目录和损坏包拒绝，不访问正式数据。
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
const version = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8')).version
const folder = fileURLToPath(new URL(`../../releases/Yuanchuang-Etsy-Windows-${version}-install/`, import.meta.url))
const manifest = JSON.parse(await fs.readFile(path.join(folder, 'release.json'), 'utf8'))
const expected = ['双击安装元创插件.cmd', manifest.package, 'install-plugin.ps1', 'release.json'].sort()
assert.deepEqual((await fs.readdir(folder)).sort(), expected)
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
assert.equal(sha(await fs.readFile(path.join(folder, manifest.package))), manifest.sha256)
const installer = await fs.readFile(path.join(folder, 'install-plugin.ps1')), launcher = await fs.readFile(path.join(folder, '双击安装元创插件.cmd'), 'utf8')
assert.deepEqual([...installer.subarray(0, 3)], [239, 187, 191], 'Windows PowerShell 5.1 中文脚本需要 BOM')
assert.match(launcher, /chcp 65001/)
assert.match(launcher, /-File "%~dp0install-plugin\.ps1" %\*/)
assert.doesNotMatch(launcher + installer.toString(), /Read-Me\.html|教程/)
const sandbox = await fs.mkdtemp(path.join(tmpdir(), 'etsy-installer-check-'))
try {
  const application = path.join(sandbox, '自选应用 with spaces'), home = path.join(sandbox, '员工数据'), profile = path.join(home, 'profiles/desktop'), bundle = path.join(sandbox, '交付包 with spaces')
  await fs.mkdir(path.join(application, 'resources/runtime/cli/bin'), { recursive: true })
  await fs.mkdir(path.join(profile, 'node_modules'), { recursive: true })
  await fs.cp(folder, bundle, { recursive: true })
  const app = path.join(application, 'DeepSeek Harness.exe')
  await fs.writeFile(app, 'fake app; must not execute')
  await fs.writeFile(path.join(application, 'resources/runtime/cli/bin/dsh.cmd'), '@echo off\r\nexit /b 97\r\n')
  await fs.writeFile(path.join(profile, 'package.json'), '{"private":true}')
  const store = path.join(sandbox, '已有依赖存储')
  await fs.mkdir(store)
  await fs.writeFile(path.join(profile, 'node_modules/.modules.yaml'), JSON.stringify({ storeDir: path.join(store, 'v11') }))
  const run = () => spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(bundle, 'install-plugin.ps1'), '-AppPath', app, '-DataDirectory', home, '-CheckOnly'], { encoding: 'utf8', windowsHide: true })
  let check = run()
  assert.equal(check.status, 0, check.stderr)
  const result = JSON.parse(check.stdout.replace(/^\uFEFF/, ''))
  assert.equal(result.InstallationPerformed, false)
  assert.equal((await fs.realpath(result.StoreDirectory)).toLowerCase(), (await fs.realpath(store)).toLowerCase())
  assert.deepEqual(await fs.readdir(home), ['profiles'])
  await fs.writeFile(path.join(profile, 'node_modules/.modules.yaml'), `storeDir: '${path.join(store, 'v11')}'\n`)
  check = run(); assert.equal(check.status, 0, check.stderr)
  assert.equal((await fs.realpath(JSON.parse(check.stdout).StoreDirectory)).toLowerCase(), (await fs.realpath(store)).toLowerCase())
  await fs.appendFile(path.join(bundle, manifest.package), Buffer.from('tampered'))
  check = run(); assert.notEqual(check.status, 0); assert.match(check.stderr, /校验失败/)
  const report = { passed: true, version, files: expected, noTutorial: true, installerUsesPowerShell51: true, chineseAndSpacedPaths: true, jsonAndYamlStoreDetected: true, damagedPackageRejected: true, noProductionChanges: true }
  if (process.env.ETSY_DELIVERY_EVIDENCE) await fs.writeFile(path.join(process.env.ETSY_DELIVERY_EVIDENCE, 'installer-checks.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  assert.ok(path.resolve(sandbox).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(sandbox).startsWith('etsy-installer-check-'))
  await fs.rm(sandbox, { recursive: true, force: true })
}

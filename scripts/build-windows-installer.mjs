// 将插件及完整运行依赖封装为单个 Windows EXE，供本机和 GitHub Actions 共同使用。
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { isInstallerVersion } from './release-version.mjs'

if (process.platform !== 'win32') throw new Error('请在 Windows 上构建安装器')
const root = fileURLToPath(new URL('../', import.meta.url))
const args = process.argv.slice(2)
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined
const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
const version = packageJson.version
if (!isInstallerVersion(version)) throw new Error('版本号无效，请使用 2.0.10-etsy 或 2.1.1 格式')
const output = path.resolve(option('--output') || path.join(root, 'out/windows-installer'))
const dependenciesRoot = path.resolve(option('--dependencies-root') || root)
const npmCli = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
// 使用 npm 自带的 tar 库，避免 Windows 系统 tar 依赖当前区域设置而拒绝中文路径。
const tar = createRequire(npmCli)('tar')
const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'yuanchuang-installer-'))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const run = (file, params, cwd = root) => execFileSync(file, params, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 })
await fs.mkdir(output, { recursive: true })
try {
  let originalPackage = option('--package')
  if (!originalPackage) {
    const packed = JSON.parse(run(process.execPath, [npmCli, 'pack', '--ignore-scripts', '--json', '--pack-destination', stage]))
    originalPackage = path.join(stage, packed[0].filename)
  }
  originalPackage = path.resolve(originalPackage)
  const unpacked = path.join(stage, 'unpacked')
  await fs.mkdir(unpacked)
  await tar.x({ file: originalPackage, cwd: unpacked, strict: true })
  const pkg = path.join(unpacked, 'package')
  const manifest = JSON.parse(await fs.readFile(path.join(pkg, 'package.json'), 'utf8'))
  if (manifest.version !== version) throw new Error('插件发布包与源码版本不一致')
  const vendors = new Map()
  async function collect(name, parent) {
    const require = createRequire(path.join(parent, 'package.json'))
    let directory
    try { directory = path.dirname(require.resolve(`${name}/package.json`)) }
    catch {
      directory = path.dirname(require.resolve(name))
      while (true) {
        try {
          const found = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'))
          if (found.name === name) break
        } catch {}
        const parentDir = path.dirname(directory)
        if (parentDir === directory) throw new Error(`无法定位依赖：${name}`)
        directory = parentDir
      }
    }
    const metadata = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'))
    if (vendors.has(name)) {
      if (vendors.get(name).version !== metadata.version) throw new Error(`依赖存在不同版本，不能直接合并：${name}`)
      return
    }
    vendors.set(name, { directory, version: metadata.version })
    for (const dependency of Object.keys(metadata.dependencies || {})) await collect(dependency, directory)
  }
  for (const name of [...Object.keys(manifest.dependencies || {}), 'react']) await collect(name, dependenciesRoot)
  manifest.dependencies = Object.fromEntries([...vendors].map(([name, item]) => [name, item.version]))
  manifest.bundledDependencies = [...vendors.keys()]
  delete manifest.devDependencies
  delete manifest.scripts
  for (const [name, item] of vendors) {
    const destination = path.join(pkg, 'node_modules', name)
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.cp(item.directory, destination, { recursive: true, dereference: true })
  }
  await fs.writeFile(path.join(pkg, 'package.json'), JSON.stringify(manifest, null, 2))
  const payload = path.join(stage, 'payload')
  await fs.mkdir(payload)
  const packageName = `dickpy-dsh-imagegen-${version}-offline.tgz`
  const bundle = path.join(payload, packageName)
  await tar.c({ file: bundle, cwd: unpacked, gzip: true, portable: true }, ['package'])
  const files = {}
  for (const name of await fs.readdir(path.join(pkg, 'lib'))) {
    if (/^[A-Za-z0-9_.-]+\.js$/.test(name)) files[`lib/${name}`] = sha(await fs.readFile(path.join(pkg, 'lib', name)))
  }
  if (!files['lib/index.js'] || !files['lib/client.js']) throw new Error('缺少插件构建文件，请先执行 pnpm build')
  const release = { version, package: packageName, sha256: sha(await fs.readFile(bundle)), files, bundledDependencies: manifest.dependencies, host: 'DeepSeek Harness Windows x64', containsAccounts: false, installerRevision: 'single-exe-1' }
  await fs.writeFile(path.join(payload, 'release.json'), JSON.stringify(release, null, 2))
  const script = await fs.readFile(path.join(root, 'distribution/windows/install-plugin.ps1'), 'utf8')
  await fs.writeFile(path.join(payload, 'install-offline.ps1'), '\uFEFF' + script.replace(/^\uFEFF/, ''))
  const source = (await fs.readFile(path.join(root, 'distribution/windows/Installer.cs'), 'utf8')).replaceAll('__PLUGIN_VERSION__', version)
  await fs.writeFile(path.join(stage, 'Installer.cs'), '\uFEFF' + source)
  const exeName = `Update-Yuanchuang-Etsy-${version}.exe`
  const exe = path.join(output, exeName)
  const zip = path.join(stage, 'payload.zip')
  const compile = path.join(stage, 'compile.ps1')
  const psQuote = value => "'" + value.replaceAll("'", "''") + "'"
  await fs.writeFile(compile, '\uFEFF' + [
    "$ErrorActionPreference='Stop'",
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    `[IO.Compression.ZipFile]::CreateFromDirectory(${psQuote(payload)},${psQuote(zip)})`,
    "$compiler=Join-Path $env:WINDIR 'Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe'",
    `$compileArgs=@('/nologo','/target:winexe','/platform:anycpu','/optimize+','/codepage:65001','/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.IO.Compression.dll','/reference:System.IO.Compression.FileSystem.dll',${psQuote('/resource:' + zip + ',payload.zip')},${psQuote('/out:' + exe)},${psQuote(path.join(stage, 'Installer.cs'))})`,
    '& $compiler @compileArgs',
    'if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}',
  ].join('\r\n'))
  run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', compile])
  const report = { version, exe: exeName, sha256: sha(await fs.readFile(exe)), bytes: (await fs.stat(exe)).size, originalPackageSha256: sha(await fs.readFile(originalPackage)), release, payloadFiles: await fs.readdir(payload) }
  await fs.writeFile(path.join(output, 'installer-manifest.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ version, exe, bytes: report.bytes, sha256: report.sha256 }, null, 2))
} finally {
  if (!path.resolve(stage).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(stage).startsWith('yuanchuang-installer-')) throw new Error('临时目录清理边界无效')
  await fs.rm(stage, { recursive: true, force: true })
}

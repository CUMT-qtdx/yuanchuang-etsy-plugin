// 仅打包最新版插件、双击入口及安装器；不包含教程、主程序、账号或商品历史。
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { zipFiles } from '../.etsy-test/host.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const packageName = `dickpy-dsh-imagegen-${version}.tgz`, packagePath = path.join(root, '../releases', packageName)
const packageBytes = await fs.readFile(packagePath)
const extract = name => execFileSync('tar', ['-xOzf', packagePath, `package/${name}`], { maxBuffer: 15 * 1024 * 1024 })
if (JSON.parse(extract('package.json').toString()).version !== version) throw new Error('插件包版本不一致')
const entries = execFileSync('tar', ['-tzf', packagePath], { encoding: 'utf8', maxBuffer: 15 * 1024 * 1024 }).trim().split(/\r?\n/)
const bundleNames = entries.filter(name => /^package\/lib\/[A-Za-z0-9_.-]+\.js$/.test(name)).map(name => name.slice(8))
const buildFiles = Object.fromEntries(bundleNames.map(name => [name, hash(extract(name))]))
if (!buildFiles['lib/index.js'] || !buildFiles['lib/client.js']) throw new Error('插件包缺少必需构建文件')
const manifest = { version, package: packageName, sha256: hash(packageBytes), files: buildFiles, host: 'DeepSeek Harness Windows x64', containsAccounts: false, sharedQuotaService: false }
const files = [
  { name: '双击安装元创插件.cmd', data: Buffer.from((await fs.readFile(path.join(root, 'distribution/Install-Plugin.cmd'), 'utf8')).replace(/\r?\n/g, '\r\n')) },
  { name: packageName, data: packageBytes },
  { name: 'install-plugin.ps1', data: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), await fs.readFile(path.join(root, 'distribution/install-plugin.ps1'))]) },
  { name: 'release.json', data: Buffer.from(JSON.stringify(manifest, null, 2)) },
]
const output = path.resolve(root, '../releases', `Yuanchuang-Etsy-Windows-${version}-install`)
await fs.mkdir(output, { recursive: true })
const allowed = new Set(files.map(file => file.name))
if ((await fs.readdir(output)).some(name => !allowed.has(name))) throw new Error('输出目录有非本次交付文件，请使用干净目录')
for (const file of files) await fs.writeFile(path.join(output, file.name), file.data)
const zip = zipFiles(files), zipPath = path.join(root, '../releases', `元创生图插件_一键安装版_${version}.zip`)
await fs.writeFile(zipPath, zip)
const report = { version, directory: output, zip: zipPath, bytes: zip.length, zipSha256: hash(zip), files: files.map(file => ({ name: file.name, bytes: file.data.length, sha256: hash(file.data) })), tutorialIncluded: false, accountFilesIncluded: 0, userImagesIncluded: 0, hostInstallerIncluded: false }
const evidence = process.env.ETSY_DELIVERY_EVIDENCE || path.join(root, '../releases')
await fs.mkdir(evidence, { recursive: true })
await fs.writeFile(path.join(evidence, `employee-package-${version}.json`), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ version, directory: output, zip: zipPath, files: files.length, bytes: zip.length }, null, 2))

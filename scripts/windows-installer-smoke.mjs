// 检查最终 EXE 的真实资源与入口，避免发布空壳或缺少启动脚本的文件。
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const folder = process.argv[2] || path.join(root, 'out/windows-installer')
const report = JSON.parse(await fs.readFile(path.join(folder, 'installer-manifest.json'), 'utf8'))
const exe = path.join(folder, report.exe)
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
assert.equal(sha(await fs.readFile(exe)), report.sha256)
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'yuanchuang-smoke-'))
let unpacked
let extractedRoot
try {
  const pointer = path.join(temp, 'unpacked.txt')
  let result = spawnSync(exe, ['--extract', pointer], { windowsHide: true, timeout: 30000 })
  assert.equal(result.status, 0, '交付 EXE 无法解包')
  unpacked = (await fs.readFile(pointer, 'utf8')).replace(/^\uFEFF/, '')
  extractedRoot = await fs.realpath(path.join(os.tmpdir(), 'YuanchuangPlugin'))
  unpacked = await fs.realpath(unpacked)
  assert.equal(path.dirname(unpacked).toLowerCase(), extractedRoot.toLowerCase())
  assert.match(path.basename(unpacked), /^[a-f0-9]{32}$/)
  const manifest = JSON.parse(await fs.readFile(path.join(unpacked, 'release.json'), 'utf8'))
  assert.equal(manifest.version, report.version)
  assert.deepEqual((await fs.readdir(unpacked)).sort(), ['install-offline.ps1', 'release.json', manifest.package].sort())
  assert.equal(sha(await fs.readFile(path.join(unpacked, manifest.package))), manifest.sha256)
  const unpackedPackage = path.join(temp, 'package')
  await fs.mkdir(unpackedPackage)
  execFileSync('tar.exe', ['-xzf', path.join(unpacked, manifest.package), '-C', unpackedPackage])
  for (const [name, hash] of Object.entries(manifest.files)) assert.equal(sha(await fs.readFile(path.join(unpackedPackage, 'package', name))), hash)
  for (const [name, version] of Object.entries(manifest.bundledDependencies)) {
    const metadata = JSON.parse(await fs.readFile(path.join(unpackedPackage, 'package/node_modules', name, 'package.json'), 'utf8'))
    assert.equal(metadata.version, version)
  }
  const errorReceipt = path.join(temp, 'error.json')
  result = spawnSync(exe, ['--silent', '--check', '--app', path.join(temp, '不存在/DeepSeek Harness.exe'), '--result', errorReceipt], { windowsHide: true, timeout: 30000 })
  assert.equal(result.status, 1)
  const error = JSON.parse((await fs.readFile(errorReceipt, 'utf8')).replace(/^\uFEFF/, ''))
  assert.equal(error.success, false)
  assert.match(error.error, /不存在/)
  console.log(JSON.stringify({ passed: true, version: report.version, exe: report.exe, bundledDependencies: Object.keys(manifest.bundledDependencies).length, realEntrypointChecked: true }))
} finally {
  if (unpacked && extractedRoot && path.dirname(unpacked).toLowerCase() === extractedRoot.toLowerCase() && /^[a-f0-9]{32}$/.test(path.basename(unpacked))) await fs.rm(unpacked, { recursive: true, force: true })
  if (path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(temp).startsWith('yuanchuang-smoke-')) await fs.rm(temp, { recursive: true, force: true })
}

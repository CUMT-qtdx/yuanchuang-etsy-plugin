// 校验新版本链条：源码、构建、包、安装内容、依赖和运行时身份。
import fs from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import path from 'node:path'
const root = path.resolve(import.meta.dirname, '..'), top = path.resolve(root, '..')
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
const version = pkg.version, packagePath = path.join(top, 'releases', `dickpy-dsh-imagegen-${version}.tgz`)
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32/tar.exe') : 'tar'
const extract = name => execFileSync(tar, ['-xOf', packagePath, `package/${name}`], { maxBuffer: 20 * 1024 * 1024 })
const list = execFileSync(tar, ['-tf', packagePath], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }).trim().split(/\r?\n/)
assert.equal(JSON.parse(extract('package.json')).version, version)
assert.ok(!list.some(name => /(?:node_modules|\.credentials|desktop-data|runtime\/|\/data\/|\.env$)/.test(name)))
assert.ok(!list.some(name => /docs\/releases\/v1\.|docs\/felt-rules/.test(name)), '分发包不带过时的运行版本说明')
const files = {}
for (const name of await fs.readdir(path.join(root, 'lib'))) if (/\.js$/.test(name)) {
  const key = `lib/${name}`, bytes = await fs.readFile(path.join(root, key))
  assert.deepEqual(extract(key), bytes); files[key] = sha(bytes)
}
for (const file of ['src/etsy/felt/composer-v2.ts','src/etsy/felt/material-policy-v2.ts','src/etsy/models.ts','src/etsy/workflow.ts','src/client/ReferenceStudio.tsx','src/etsy/routes.ts']) assert.deepEqual(extract(file), await fs.readFile(path.join(root, file)))
for (const file of ['lib/index.js','lib/client.js']) assert.ok(extract(file).toString().includes(version))
assert.ok(extract('lib/client.js').toString().includes('元创 Etsy Studio 2'))
const profile = process.env.ETSY_DESKTOP_PROFILE ?? path.resolve(top, '../desktop-data/profiles/desktop'), installed = path.join(profile, 'node_modules/@dickpy/dsh-imagegen')
const profileJson = JSON.parse(await fs.readFile(path.join(profile, 'package.json'), 'utf8'))
assert.ok(profileJson.dependencies['@dickpy/dsh-imagegen'].includes(`-${version}.tgz`))
assert.ok((await fs.readFile(path.join(profile, 'pnpm-lock.yaml'),'utf8')).includes(`-${version}.tgz`))
assert.equal(JSON.parse(await fs.readFile(path.join(installed, 'package.json'),'utf8')).version,version)
for (const [file,expected] of Object.entries(files)) assert.equal(sha(await fs.readFile(path.join(installed,file))),expected)
const manifest = { version, profile:'desktop', package:path.basename(packagePath), sha256:sha(await fs.readFile(packagePath)), files, containsAccounts:false, userProjectsIncluded:false }
await fs.writeFile(path.join(top,'releases/release.json'),JSON.stringify(manifest,null,2))
const result = { passed:true, version, packageMatchesSource:true, installedBundlesMatch:true, dependencyAndLockMatch:true, accountsInPackage:false, oldReleaseDocsExcluded:true }
await fs.writeFile(path.join(top,'evidence/version-chain.json'),JSON.stringify(result,null,2)); console.log(JSON.stringify(result))

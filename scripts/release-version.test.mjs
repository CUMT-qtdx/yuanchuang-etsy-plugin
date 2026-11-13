import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { isInstallerVersion, nextReleaseVersion } from './release-version.mjs'
import { checkForUpdate, clearUpdateCache, installUpdate, CURRENT_VERSION } from '../src/updater.ts'

test('安装包名兼容历史格式、纯数字旧版和统一 Etsy 后缀', () => {
  for (const version of ['2.0.0-etsy.8', '2.0.0-etsy.9', '2.0.10-etsy', '2.1.1', '2.1.10', '2.2.1', '2.1.1-etsy', '2.1.10-etsy', '2.2.1-etsy']) assert.equal(isInstallerVersion(version), true)
  for (const version of ['', '2.01.1', 'v2.1.1', '2.1.1/bad', '2.1.1;bad', '2.1.1-beta', '2.1.1\n']) assert.equal(isInstallerVersion(version), false)
})

test('按每组十版递进并统一 Etsy 后缀，第十版后为下一组第一版', () => {
  assert.equal(nextReleaseVersion('2.0.0-etsy.9'), '2.0.10-etsy')
  assert.equal(nextReleaseVersion('2.0.10-etsy'), '2.1.1-etsy')
  for (let minor = 1; minor <= 5; minor++) for (let patch = 1; patch <= 10; patch++) {
    const expected = patch === 10 ? `2.${minor + 1}.1-etsy` : `2.${minor}.${patch + 1}-etsy`
    assert.equal(nextReleaseVersion(`2.${minor}.${patch}`), expected)
    assert.equal(nextReleaseVersion(`2.${minor}.${patch}-etsy`), expected)
  }
  for (const version of ['2.1.0', '2.1.11', '2.0.0-etsy.8', 'bad']) assert.throws(() => nextReleaseVersion(version))
})

test('定制版在线发现自己的发布，同时拒绝旧的npm替包路径', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(CURRENT_VERSION, pkg.version)
  clearUpdateCache()
  const update = await checkForUpdate(async url => { assert.match(url, /CUMT-qtdx\/yuanchuang-etsy-plugin/); return new Response(JSON.stringify({tag_name:pkg.version,body:'说明',assets:[]})) })
  assert.equal(update.currentVersion, pkg.version)
  assert.equal(update.updateAvailable, false)
  assert.match(update.releaseUrl, /CUMT-qtdx\/yuanchuang-etsy-plugin\/releases/)
  await assert.rejects(installUpdate('2.1.1', () => { throw new Error('不应调用安装器') }), /EXE 安装包/)
})

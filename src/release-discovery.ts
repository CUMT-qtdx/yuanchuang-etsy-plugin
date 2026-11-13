// 仅接受元创仓库公开的单个 EXE，元数据不携带模型渠道密钥。
import type { UpdateInfo } from './protocol.ts'
export const REPOSITORY = 'CUMT-qtdx/yuanchuang-etsy-plugin'
export const RELEASES_URL = `https://api.github.com/repos/${REPOSITORY}/releases/latest`
export const RELEASE_PAGE = `https://github.com/${REPOSITORY}/releases`
export function normalizedVersion(value: unknown): string | undefined {
  if (typeof value !== 'string') return
  const version = value.replace(/^v/, '')
  if (/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-etsy(?:\.[1-9]\d*)?)?$/.test(version)) return version
}
export function compareReleaseVersions(left: string, right: string): number {
  const parse = (value: string): number[] => {
    const version = normalizedVersion(value)
    if (!version) throw new Error('版本号格式无效')
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-etsy(?:\.(\d+))?)?$/.exec(version)!
    return [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4] ?? 0)]
  }
  const a = parse(left), b = parse(right)
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!
  return 0
}
export function releaseInfo(payload: unknown, current: string): UpdateInfo {
  if (!payload || typeof payload !== 'object') throw new Error('GitHub 版本信息无效')
  const record = payload as Record<string, unknown>
  if (record.draft || record.prerelease) throw new Error('最新公开版本尚未正式发布')
  const version = normalizedVersion(record.tag_name)
  if (!version) throw new Error('GitHub 版本标签格式无效')
  const newer = compareReleaseVersions(version, current) > 0
  const assets = Array.isArray(record.assets) ? record.assets as Array<Record<string, unknown>> : []
  const expected = `Update-Yuanchuang-Etsy-${version}.exe`
  const asset = assets.find(asset => asset.name === expected)
  let installer: UpdateInfo['installer']
  if (asset) {
    const url = String(asset.browser_download_url || '')
    const parsed = new URL(url)
    const prefix = `https://github.com/${REPOSITORY}/releases/download/`
    const sha = /^sha256:([a-f0-9]{64})$/i.exec(String(asset.digest || ''))?.[1]?.toLowerCase()
    const size = Number(asset.size)
    if (parsed.protocol !== 'https:' || !url.startsWith(prefix) || decodeURIComponent(parsed.pathname.split('/').at(-1) || '') !== expected || parsed.search || parsed.hash || parsed.username || parsed.password) throw new Error('安装器下载地址不属于元创发布附件')
    if (!sha || !Number.isSafeInteger(size) || size <= 0 || size > 512 * 1024 * 1024) throw new Error('发布安装器缺少 SHA-256 或文件大小无效')
    installer = { name: expected, url, size, sha256: sha }
  }
  if (newer && !installer) throw new Error('新版还没有可用的单文件 EXE 附件，请稍后检查')
  if (newer && assets.length !== 1) throw new Error('新版附件不符合单个 EXE 规则，停止自动安装')
  return { currentVersion: current, latestVersion: version, updateAvailable: newer, releaseUrl: `${RELEASE_PAGE}/tag/v${version}`, releaseNotes: typeof record.body === 'string' ? record.body.slice(0, 20000) : '', publishedAt: typeof record.published_at === 'string' ? record.published_at : undefined, installMode: 'exe', installer }
}

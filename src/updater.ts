/** GitHub Release discovery and explicit, user-triggered plugin updates. */

import { spawn, type ChildProcess } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PLUGIN_VERSION, type UpdateInfo } from './protocol.ts'
import { recordDiagnostic, redactDiagnosticText } from './diagnostics-store.ts'
export type { UpdateInfo } from './protocol.ts'

/** Keep this in sync with package.json for each published release. */
export const CURRENT_VERSION = PLUGIN_VERSION
export const PACKAGE_NAME = '@dickpy/dsh-imagegen'
export const RELEASES_URL = 'https://api.github.com/repos/dickpy/dsh-imagegen/releases/latest'

const CHECK_TIMEOUT_MS = 10_000
const CACHE_TTL_MS = 15 * 60_000

/** Optional launcher-owned facts, read without requiring a newer DSH package. */
export interface HostUpdateResult {
  application?: string
  bundle?: string
  version?: string
  error?: { code?: string; diagnostic?: string }
  packageResult?: { exitCode?: number; output?: string; logPath?: string }
}
export interface UpdateHostContext {
  profile?: string
  profileDir?: string
  /** The live host owns package-manager selection, locking and activation. */
  installBundle?: (spec: string, options: { saveExact: boolean }) => Promise<HostUpdateResult>
}
export interface UpdateInstallTarget { profile: string; installMode: 'cli' | 'host' | 'host-managed' }

interface GitHubRelease {
  tag_name?: unknown
  html_url?: unknown
  published_at?: unknown
  body?: unknown
  draft?: unknown
  prerelease?: unknown
}

let cached: { expiresAt: number; value: UpdateInfo } | undefined

/** Compare stable semver triples; returns positive when `left` is newer. */
export function compareVersions(left: string, right: string): number {
  const parse = (value: string): [number, number, number] => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(value.trim())
    if (match === null) return [0, 0, 0]
    return [Number(match[1]), Number(match[2]), Number(match[3])]
  }
  const a = parse(left)
  const b = parse(right)
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

function normalizedReleaseVersion(tag: unknown): string | undefined {
  if (typeof tag !== 'string' || !/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag.trim())) return undefined
  return tag.trim().replace(/^v/, '')
}

/** Read the latest stable GitHub Release, with a short host-side cache. */
export async function checkForUpdate(fetchFn: typeof fetch = fetch, now = Date.now()): Promise<UpdateInfo> {
  if (CURRENT_VERSION.includes('-etsy.')) return {
    currentVersion: CURRENT_VERSION, latestVersion: CURRENT_VERSION, updateAvailable: false,
    releaseUrl: 'https://github.com/dickpy/dsh-imagegen',
    releaseNotes: '当前为 Etsy 定制开发版，请使用本地开发项目发布的安装包升级，以保留商品工作台功能。',
  }
  if (cached !== undefined && cached.expiresAt > now) return cached.value
  const response = await fetchFn(RELEASES_URL, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'dsh-imagegen-update-check',
    },
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`GitHub Releases returned HTTP ${response.status}`)
  const payload: unknown = await response.json()
  if (payload === null || typeof payload !== 'object') throw new Error('GitHub Releases returned malformed JSON')
  const release = payload as GitHubRelease
  if (release.draft === true || release.prerelease === true) throw new Error('latest GitHub Release is not stable')
  const latestVersion = normalizedReleaseVersion(release.tag_name)
  if (latestVersion === undefined) throw new Error('latest GitHub Release has an invalid version tag')
  const releaseUrl = typeof release.html_url === 'string' ? release.html_url : 'https://github.com/dickpy/dsh-imagegen/releases'
  const releaseNotes = typeof release.body === 'string' ? release.body.trim() : ''
  const value: UpdateInfo = {
    currentVersion: CURRENT_VERSION,
    latestVersion,
    updateAvailable: compareVersions(latestVersion, CURRENT_VERSION) > 0,
    releaseUrl,
    ...typeof release.published_at === 'string' ? { publishedAt: release.published_at } : {},
    ...releaseNotes === '' ? {} : { releaseNotes: releaseNotes.slice(0, 20_000) },
  }
  cached = { expiresAt: now + CACHE_TTL_MS, value }
  return value
}

const VALID_PROFILE = /^[a-zA-Z0-9_-]+$/
const DESKTOP_HINT = '当前 DSH 桌面宿主未提供插件安装接口，无法在线更新。请先升级 DSH，或从 Release 下载插件安装包后按宿主支持的方式安装。'

/** Explicit host facts win; Electron also passes an absolute profile directory. */
export function profileFromProcess(argv: readonly string[] = process.argv, env: NodeJS.ProcessEnv = process.env, host: UpdateHostContext = {}): string {
  for (const candidate of [host.profile, env.DSH_PROFILE]) {
    const value = candidate?.trim()
    if (value && VALID_PROFILE.test(value)) return value
  }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index] === '--profile' ? argv[index + 1]?.trim() : argv[index]?.startsWith('--profile=') ? argv[index]!.slice(10).trim() : undefined
    if (value && VALID_PROFILE.test(value)) return value
  }
  for (const arg of [host.profileDir ?? '', ...argv]) {
    const match = /[\\/]profiles[\\/]([a-zA-Z0-9_-]+)[\\/]?$/.exec(arg)
    if (match) return match[1]!
  }
  if (env.DSH_DESKTOP === '1' || typeof process.versions.electron === 'string' || argv.some(arg => /[\\/]dsh-desktop-host[\\/]/.test(arg))) return 'desktop'
  return 'web'
}

/** A managed desktop profile must never be mutated by a guessed CLI command. */
export function updateInstallTarget(argv: readonly string[] = process.argv, env: NodeJS.ProcessEnv = process.env, host: UpdateHostContext = {}): UpdateInstallTarget {
  const profile = profileFromProcess(argv, env, host)
  const desktop = profile === 'desktop' || env.DSH_DESKTOP === '1' || typeof process.versions.electron === 'string'
    || argv.some(arg => /[\\/]dsh-desktop-host[\\/]/.test(arg))
  return { profile, installMode: typeof host.installBundle === 'function' ? 'host' : desktop ? 'host-managed' : 'cli' }
}

/** Bounded, credential-redacted package-manager output for both UI and logs. */
function updateDiagnostic(value: string, limit = 6000): string {
  return redactDiagnosticText(value
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1<redacted>@')
    .replace(/((?:_authToken|npm_token|password)\s*[=:]\s*)[^\s]+/gi, '$1<redacted>'), limit)
}

/** Use the live host when available; CLI remains a Web-only fallback. */
export function installUpdate(
  version: string,
  spawnFn: typeof spawn = spawn,
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
  host: UpdateHostContext = {},
): Promise<void> {
  if (CURRENT_VERSION.includes('-etsy.')) return Promise.reject(new Error('当前为 Etsy 定制开发版，请使用本地开发安装包升级，避免覆盖定制功能'))
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) return Promise.reject(new Error('invalid update version'))
  const { profile, installMode } = updateInstallTarget(argv, env, host)
  const command = process.platform === 'win32' ? 'dsh.cmd' : 'dsh'
  const args = ['plugin', '--profile', profile, 'add', `${PACKAGE_NAME}@${version}`]
  // A Release tarball is accepted by the host replacement flow, including HMR.
  // A registry-name install is refused for an already installed HMR bundle;
  // removing this running plugin first would destroy its own update route.
  const tarball = `https://github.com/dickpy/dsh-imagegen/releases/download/v${version}/dickpy-dsh-imagegen-${version}.tgz`
  const displayCommand = installMode === 'host' ? `pluginManager.installBundle(${tarball})` : `${command} ${args.join(' ')}`
  const started = Date.now()
  const failure = (message: string): Error => {
    const safe = updateDiagnostic(`profile: ${profile}\ncommand${installMode === 'host-managed' ? ' (not run)' : ''}: ${displayCommand}\n${message}`)
    recordDiagnostic({ phase: 'config', channel: '', model: PACKAGE_NAME, mode: 'update', url: installMode === 'host' ? tarball : command, method: installMode === 'host' ? 'HOST' : installMode === 'host-managed' ? 'CHECK' : 'SPAWN', message: safe, requestExcerpt: displayCommand, durationMs: Date.now() - started })
    return new Error(safe)
  }
  if (installMode === 'host-managed') return Promise.reject(failure(DESKTOP_HINT))
  if (installMode === 'host') return (async () => {
    try {
      const result = await host.installBundle!(tarball, { saveExact: true })
      if (result === null || typeof result !== 'object') throw new Error('DSH returned an invalid installation result')
      if (result.error !== undefined || !['applied', 'restart-required'].includes(result.application ?? '') || (result.packageResult?.exitCode !== undefined && result.packageResult.exitCode !== 0)) {
        throw new Error([
          `DSH: ${result.application ?? 'unknown'}${result.error?.code ? ` (${result.error.code})` : ''}`,
          result.error?.diagnostic, result.packageResult?.output,
          result.packageResult?.logPath ? `diagnostics: ${result.packageResult.logPath}` : '',
        ].filter(Boolean).join('\n'))
      }
      if (result.bundle !== undefined && result.bundle !== PACKAGE_NAME) throw new Error(`DSH installed an unexpected bundle: ${result.bundle}`)
      let installedVersion = result.version
      // Older managers omit `version`; verify their installed manifest instead.
      if (installedVersion === undefined && host.profileDir !== undefined) {
        const manifest = JSON.parse(await readFile(join(host.profileDir, 'node_modules', '@dickpy', 'dsh-imagegen', 'package.json'), 'utf8')) as { name?: unknown; version?: unknown }
        if (manifest.name === PACKAGE_NAME && typeof manifest.version === 'string') installedVersion = manifest.version
      }
      if (installedVersion !== version) throw new Error(`DSH installed version ${installedVersion ?? 'unknown'}; expected ${version}`)
    } catch (caught) { throw failure(caught instanceof Error ? caught.message : String(caught)) }
  })()
  return new Promise((resolve, reject) => {
    let child: ChildProcess
    try {
      child = spawnFn(command, args, { shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'], env })
    } catch (caught) {
      reject(failure(caught instanceof Error ? caught.message : String(caught)))
      return
    }
    let output = '', settled = false, timedOut = false
    const append = (chunk: Buffer | string): void => { output = (output + String(chunk)).slice(-32_768) }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    const timer = setTimeout(() => {
      timedOut = true
      try { child.kill() } catch { /* retain the timeout diagnostic */ }
      finish('plugin update timed out after 10 minutes')
    }, 10 * 60_000)
    timer.unref()
    const finish = (message?: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (message === undefined) { resolve(); return }
      const hint = /ERR_PNPM_UNEXPECTED_STORE/.test(output)
        ? '\nThe pnpm store does not match this profile. Use the DSH installation that created it, or the same pnpm version/store recorded in node_modules/.modules.yaml; do not switch stores automatically.' : ''
      const tail = output.trim().split(/\r?\n/).slice(-50).join('\n').slice(-4000)
      reject(failure(`${message}${hint}${tail ? `\n${tail}` : ''}`))
    }
    child.once('error', error => finish(error.message))
    // close waits until piped output is drained; exit can arrive before stderr.
    child.once('close', (code, signal) => {
      if (timedOut) return
      finish(code === 0 ? undefined : signal ? `plugin update terminated by ${signal}` : `plugin update exited with code ${code ?? 'unknown'}`)
    })
  })
}

/** Test helper: clear the host-side Release cache. */
export function clearUpdateCache(): void {
  cached = undefined
}

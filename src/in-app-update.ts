// 下载、校验与重启交接独立于生图引擎，不读取渠道或模型密钥。
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, open, unlink, access } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { PLUGIN_VERSION, type UpdateInfo, type UpdateProgress } from './protocol.ts'
import { imageDataRoot } from './image-storage-path.ts'
import { checkForUpdate } from './updater.ts'

export interface AppUpdateOptions {
  dataDirectory?: string
  application?: string
  check?: (force?: boolean) => Promise<UpdateInfo>
  fetchFn?: typeof fetch
  busy: () => Promise<boolean>
  launch?: (helper: string, plan: string) => Promise<void>
  helperPath?: string
  userDataDirectory?: string
}
type Downloaded = { version: string; file: string; sha256: string; size: number }
const initial = (): UpdateProgress => ({ phase: 'idle', receivedBytes: 0, totalBytes: 0, updatedAt: Date.now() })
export class AppUpdateService {
  private state: UpdateProgress = initial()
  private downloaded?: Downloaded
  private downloading = false
  private handoff = false
  private hydrated = false
  readonly dataDirectory: string
  readonly root: string
  private options: AppUpdateOptions
  constructor(options: AppUpdateOptions) {
    this.options = options
    this.dataDirectory = path.resolve(options.dataDirectory ?? path.dirname(imageDataRoot()))
    this.root = path.join(this.dataDirectory, 'plugin-updates', 'yuanchuang')
  }
  private async persist(): Promise<void> {
    await mkdir(this.root, { recursive: true })
    const target = path.join(this.root, 'state.json'), temporary = target + '.' + randomUUID() + '.tmp'
    await writeFile(temporary, JSON.stringify(this.state, null, 2)); await rename(temporary, target)
  }
  private async update(patch: Partial<UpdateProgress>): Promise<void> {
    this.state = { ...this.state, ...patch, updatedAt: Date.now() }; await this.persist()
  }
  async status(): Promise<UpdateProgress> {
    if (!this.hydrated) {
      this.hydrated = true
      try {
        const saved = JSON.parse((await readFile(path.join(this.root, 'state.json'), 'utf8')).replace(/^\uFEFF/, '')) as UpdateProgress
        if (saved && ['failed', 'completed', 'installing', 'restarting'].includes(saved.phase)) this.state = saved
      } catch { /* 尚未运行过更新，不产生错误提示。 */ }
    }
    if (['installing', 'restarting'].includes(this.state.phase)) {
      try { this.state = JSON.parse((await readFile(path.join(this.root, 'state.json'), 'utf8')).replace(/^\uFEFF/, '')) as UpdateProgress } catch {}
    }
    return { ...this.state }
  }
  private check(force = false): Promise<UpdateInfo> { return this.options.check?.(force) ?? checkForUpdate(fetch, Date.now(), force) }
  async download(version: string): Promise<UpdateProgress> {
    await this.status()
    if (this.downloading) {
      if (this.state.version !== version) throw new Error('另一个版本正在下载，请等待完成')
      return { ...this.state }
    }
    if (this.handoff) throw new Error('已进入安装交接，请等待重启')
    const info = await this.check(true)
    if (!info.updateAvailable || info.latestVersion !== version || !info.installer) throw new Error('该版本不是当前可更新的正式版本')
    if (this.downloaded?.version === version && this.state.phase === 'ready') return { ...this.state }
    this.downloading = true
    await this.update({ phase: 'downloading', version, receivedBytes: 0, totalBytes: info.installer.size, message: '正在下载新版安装器' })
    void this.transfer(info).catch(async error => {
      this.downloaded = undefined
      await this.update({ phase: 'failed', message: error instanceof Error ? error.message : '下载失败，请重新尝试' })
    }).finally(() => { this.downloading = false })
    return { ...this.state }
  }
  private async transfer(info: UpdateInfo): Promise<void> {
    const asset = info.installer!
    const directory = path.join(this.root, 'downloads', randomUUID()); await mkdir(directory, { recursive: true })
    const temporary = path.join(directory, asset.name + '.part'), destination = path.join(directory, asset.name)
    const response = await (this.options.fetchFn ?? fetch)(asset.url, { headers: { accept: 'application/octet-stream' }, signal: AbortSignal.timeout(10 * 60_000) })
    if (!response.ok || !response.body) throw new Error(`下载失败（HTTP ${response.status}），请稍后重试`)
    const announced = response.headers.get('content-length')
    if (announced && Number(announced) !== asset.size) throw new Error('安装器长度与 GitHub 发布信息不一致')
    const handle = await open(temporary, 'wx'), hash = createHash('sha256'); let received = 0, savedAt = 0
    try {
      for await (const block of response.body as unknown as AsyncIterable<Uint8Array>) {
        received += block.byteLength
        if (received > asset.size || received > 512 * 1024 * 1024) throw new Error('下载内容超过预期大小，已停止')
        hash.update(block); await handle.writeFile(block)
        this.state.receivedBytes = received
        if (Date.now() - savedAt > 200) { savedAt = Date.now(); await this.update({ receivedBytes: received }) }
      }
    } finally { await handle.close() }
    if (received !== asset.size || hash.digest('hex') !== asset.sha256) { await unlink(temporary).catch(() => {}); throw new Error('安装器 SHA-256 校验失败，未执行任何安装') }
    await rename(temporary, destination)
    this.downloaded = { version: info.latestVersion, file: destination, sha256: asset.sha256, size: asset.size }
    await this.update({ phase: 'ready', receivedBytes: received, message: '已下载并校验，点击重启并更新' })
  }
  async restart(version: string): Promise<UpdateProgress> {
    if (this.handoff) throw new Error('安装已经开始，请等待 DSH 重启')
    if (await this.options.busy()) throw new Error('还有生图、分析或文案任务进行中，请完成后再更新')
    const artifact = this.downloaded
    if (this.state.phase !== 'ready' || artifact?.version !== version) throw new Error('请先下载并校验这个版本')
    const bytes = await readFile(artifact.file)
    if (bytes.byteLength !== artifact.size || createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) throw new Error('安装器已变化，必须重新下载')
    const application = path.resolve(this.options.application ?? process.execPath)
    if (path.basename(application).toLowerCase() !== 'deepseek harness.exe') throw new Error('当前环境不是 Windows DSH 桌面，请使用桌面程序更新')
    await access(path.join(path.dirname(application), 'resources/runtime/cli/bin/dsh.cmd'))
    const directory = path.join(this.root, 'jobs', randomUUID()); await mkdir(directory, { recursive: true })
    const helperSource = this.options.helperPath ?? fileURLToPath(new URL('../distribution/windows/Apply-Update.ps1', import.meta.url))
    const helper = path.join(directory, 'Apply-Update.ps1'), plan = path.join(directory, 'plan.json')
    await writeFile(helper, '\uFEFF' + (await readFile(helperSource, 'utf8')).replace(/^\uFEFF/, ''))
    const installed = JSON.parse(await readFile(path.join(this.dataDirectory, 'profiles/desktop/node_modules/@dickpy/dsh-imagegen/package.json'), 'utf8')) as { version?: string }
    const userDataArg = process.argv.find(arg => arg.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length)
    await writeFile(plan, JSON.stringify({ schema: 1, version, installer: artifact.file, sha256: artifact.sha256, application, dataDirectory: this.dataDirectory, stateFile: path.join(this.root, 'state.json'), receipt: path.join(directory, 'install-result.json'), logFile: path.join(directory, 'update.log'), previousVersion: installed.version ?? PLUGIN_VERSION, userDataDirectory: this.options.userDataDirectory ?? userDataArg }, null, 2))
    this.handoff = true
    await this.update({ phase: 'restarting', message: '正在退出 DSH 并安装新版，请稍候' })
    try {
      if (this.options.launch) await this.options.launch(helper, plan)
      else {
        const windows = process.env.SystemRoot || 'C:\\Windows'
        const powershell = path.join(windows, process.arch === 'ia32' ? 'Sysnative' : 'System32', 'WindowsPowerShell/v1.0/powershell.exe')
        const psQuote = (value: string): string => "'" + value.replaceAll("'", "''") + "'"
        const launcher = path.join(directory, 'Start-Update.ps1')
        const launchArgs = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', '"' + helper + '"', '-Plan', '"' + plan + '"']
        await writeFile(launcher, '\uFEFF' + [
          "$ErrorActionPreference='Stop'",
          "$env:PSModulePath=$env:SystemRoot+'\\System32\\WindowsPowerShell\\v1.0\\Modules;'+$env:PSModulePath",
          `$p=Start-Process -FilePath ${psQuote(powershell)} -ArgumentList @(${launchArgs.map(psQuote).join(',')}) -WindowStyle Hidden -PassThru -RedirectStandardOutput ${psQuote(path.join(directory, 'helper-output.log'))} -RedirectStandardError ${psQuote(path.join(directory, 'helper-error.log'))}`,
          'Write-Output $p.Id',
        ].join('\r\n'))
        // 短启动器通过 Windows Start-Process 创建独立进程，握手成功后本机 DSH 才交接。
        await new Promise<void>((resolve, reject) => {
          const child = spawn(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', launcher], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
          let output = '', errors = ''
          child.stdout.on('data', chunk => { output += String(chunk) }); child.stderr.on('data', chunk => { errors += String(chunk) })
          const timer = setTimeout(() => { child.kill(); reject(new Error('更新启动器未响应')) }, 30000)
          child.once('error', error => { clearTimeout(timer); reject(error) })
          child.once('close', code => { clearTimeout(timer); if (code === 0 && /\b\d+\s*$/.test(output.trim())) resolve(); else reject(new Error(errors.trim() || '更新启动器没有返回进程标识')) })
        })
      }
    } catch (error) { this.handoff = false; await this.update({ phase: 'failed', message: '更新程序未能启动，请重试' }); throw error }
    return { ...this.state }
  }
}

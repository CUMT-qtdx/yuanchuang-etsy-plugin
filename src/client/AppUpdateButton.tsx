import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PLUGIN_VERSION, UPDATE_API, type UpdateInfo, type UpdateProgress } from '../protocol.ts'
import css from './app-update.module.css'
import { renderMarkdown } from './markdown.tsx'

const AUTO_OPEN_KEY = 'dsh-imagegen:update-auto-opened-version'
const autoOpenedInSession = new Set<string>()

/** 记录每个新版本是否已自动弹出过更新窗口，保证同一新版本仅首次自动提示一次。 */
export function shouldAutoOpenUpdatePopover(version: string): boolean {
  const key = version.trim()
  if (!key || autoOpenedInSession.has(key)) return false
  try {
    if (window.localStorage.getItem(AUTO_OPEN_KEY) === key) {
      autoOpenedInSession.add(key)
      return false
    }
    window.localStorage.setItem(AUTO_OPEN_KEY, key)
  } catch {
    // 受限存储环境退回本次会话内去重，不阻断提示展示。
  }
  autoOpenedInSession.add(key)
  return true
}

async function post<T>(url: string, body: unknown = {}): Promise<T> {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const value = await response.json() as T & { ok?: boolean; message?: string }
  if (!response.ok || value.ok !== true) throw new Error(value.message || `更新请求失败（HTTP ${response.status}）`)
  return value
}

export function AppUpdateButton(): React.JSX.Element {
  const [info, setInfo] = useState<UpdateInfo>()
  const [progress, setProgress] = useState<UpdateProgress>()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [checking, setChecking] = useState(false)
  const live = useRef(true)
  const autoApply = useRef(false)
  const applying = useRef(false)

  const check = async (manual = false): Promise<void> => {
    if (checking) return
    setChecking(true)
    if (manual) { setOpen(true); setMessage('') }
    try {
      const result = await post<{ ok: true; update: UpdateInfo }>(UPDATE_API.check, { force: manual })
      if (live.current) {
        setInfo(result.update)
        if (result.update.updateAvailable && result.update.latestVersion) {
          if (shouldAutoOpenUpdatePopover(result.update.latestVersion)) setOpen(true)
        } else if (manual) {
          setMessage('当前已是最新版本')
        }
      }
    } catch (error) {
      if (manual && live.current) setMessage(error instanceof Error ? error.message : '检查失败，请稍后重试')
    } finally {
      if (live.current) setChecking(false)
    }
  }

  const status = async (): Promise<void> => {
    try {
      const result = await post<{ ok: true; progress: UpdateProgress }>(UPDATE_API.status)
      if (live.current) {
        if (result.progress.phase === 'failed') autoApply.current = false
        setProgress(result.progress)
      }
    } catch { /* 退出和重启期间连接暂时断开，等待应用重新打开。 */ }
  }

  const applyUpdate = useCallback(async (version: string): Promise<void> => {
    if (applying.current) return
    applying.current = true
    setBusy(true)
    setMessage('')
    try {
      await post(UPDATE_API.apply, { version })
      if (live.current) {
        setProgress(previous => ({
          ...(previous || { receivedBytes: 0, totalBytes: 0 }),
          phase: 'restarting',
          version,
          updatedAt: Date.now(),
          message: '正在退出 DSH 并安装新版，请稍候',
        }))
      }
    } catch (error) {
      if (live.current) {
        setMessage(error instanceof Error ? error.message : '更新未开始')
        setBusy(false)
      }
      applying.current = false
    }
  }, [])

  useEffect(() => {
    live.current = true
    void check()
    void status()
    const interval = window.setInterval(() => { void check() }, 15 * 60_000)
    return () => { live.current = false; window.clearInterval(interval) }
  }, [])

  useEffect(() => {
    if (!progress || !['downloading', 'restarting', 'installing'].includes(progress.phase)) return
    const timer = window.setInterval(() => { void status() }, 500)
    return () => window.clearInterval(timer)
  }, [progress?.phase])

  // 点击「立即更新」后，下载校验通过且弹窗仍打开时自动进入安装重启。
  useEffect(() => {
    if (!autoApply.current || !open || !info?.updateAvailable || !info.latestVersion) return
    if (progress?.phase !== 'ready' || progress.version !== info.latestVersion) return
    autoApply.current = false
    void applyUpdate(info.latestVersion)
  }, [progress?.phase, progress?.version, info?.updateAvailable, info?.latestVersion, open, applyUpdate])

  const locking = progress?.phase === 'restarting' || progress?.phase === 'installing'
  const dismiss = useCallback((): void => {
    if (locking) return
    // 用户点击取消离开弹窗时，取消待执行的自动重启，避免后台突然退出。
    autoApply.current = false
    setOpen(false)
  }, [locking])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); dismiss() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, dismiss])

  const updateNow = async (): Promise<void> => {
    if (!info?.updateAvailable || !info.latestVersion || busy || locking) return
    if (progress?.phase === 'ready' && progress.version === info.latestVersion) {
      await applyUpdate(info.latestVersion)
      return
    }
    autoApply.current = true
    setBusy(true)
    setMessage('')
    try {
      const result = await post<{ ok: true; progress: UpdateProgress }>(UPDATE_API.download, { version: info.latestVersion })
      if (live.current) {
        if (result.progress.phase === 'failed') autoApply.current = false
        setProgress(result.progress)
      }
    } catch (error) {
      autoApply.current = false
      if (live.current) setMessage(error instanceof Error ? error.message : '下载失败')
    } finally {
      if (live.current && !applying.current) setBusy(false)
    }
  }

  const active = progress && ['downloading', 'restarting', 'installing'].includes(progress.phase)
  const percent = progress?.totalBytes ? Math.min(100, Math.floor(progress.receivedBytes / progress.totalBytes * 100)) : 0
  const hasUpdate = !!info?.updateAvailable
  const primaryLabel = locking
    ? '正在更新…'
    : progress?.phase === 'downloading'
      ? `正在下载 ${percent}%`
      : busy
        ? '正在准备…'
        : '立即更新'

  const modal = open && typeof document !== 'undefined' ? createPortal(
    <div className={css.backdrop} onClick={event => { if (event.target === event.currentTarget) dismiss() }}>
      <section className={css.modal} role="dialog" aria-modal="true" aria-labelledby="app-update-dialog-title">
        <div className={css.head}>
          <div className={css.titleGroup}>
            {hasUpdate ? <span className={css.badge}>新版本可用</span> : null}
            <h3 id="app-update-dialog-title">{hasUpdate ? `发现新版本 ${info!.latestVersion}` : '插件更新'}</h3>
          </div>
          <button type="button" className={css.close} disabled={locking} onClick={dismiss} aria-label="关闭更新面板">×</button>
        </div>
        <p className={css.versionLine}>
          当前版本 <b>{PLUGIN_VERSION}</b>
          {hasUpdate ? <> → <b className={css.newVersion}>{info!.latestVersion}</b></> : null}
        </p>
        {info?.releaseNotes ? <div className={css.notes} aria-label="更新内容">{renderMarkdown(info.releaseNotes)}</div> : null}
        {progress?.phase === 'downloading' ? (
          <div className={css.progressBox}>
            <progress aria-label="更新下载进度" max={100} value={percent} />
            <small>正在下载 {percent}% · {(progress.receivedBytes / 1048576).toFixed(1)} / {(progress.totalBytes / 1048576).toFixed(1)} MB{autoApply.current ? '（完成后将自动重启更新）' : ''}</small>
          </div>
        ) : null}
        {progress && progress.phase !== 'idle' ? (
          <p className={css.status} role="status" data-error={progress.phase === 'failed' ? 'true' : undefined}>{progress.message}</p>
        ) : null}
        {message ? <p className={css.status} role="status" data-error={hasUpdate ? 'true' : undefined}>{message}</p> : null}
        <div className={css.actions}>
          <button type="button" className={css.cancelBtn} disabled={locking} onClick={dismiss}>{hasUpdate ? '取消' : '关闭'}</button>
          {hasUpdate
            ? <button type="button" className={css.primary} disabled={busy || !!active} onClick={() => { void updateNow() }}>{primaryLabel}</button>
            : <button type="button" className={css.primary} disabled={checking || !!active} onClick={() => { void check(true) }}>{checking ? '正在检查…' : '检查最新版'}</button>}
        </div>
      </section>
    </div>,
    document.body,
  ) : null

  return <div className={css.root} data-app-update="">
    <button type="button" className={css.trigger} data-new={hasUpdate ? 'true' : undefined} onClick={() => { setOpen(value => !value); if (!info && !checking) void check() }} aria-expanded={open} aria-label="插件更新">
      {active ? progress.phase === 'downloading' ? `下载更新 ${percent}%` : '正在更新…' : hasUpdate ? `发现新版 ${info!.latestVersion}` : '检查更新'}
    </button>
    {modal}
  </div>
}

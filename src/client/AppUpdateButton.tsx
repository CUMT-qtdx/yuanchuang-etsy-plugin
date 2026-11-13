import { useEffect, useRef, useState } from 'react'
import { PLUGIN_VERSION, UPDATE_API, type UpdateInfo, type UpdateProgress } from '../protocol.ts'
import css from './app-update.module.css'
async function post<T>(url: string, body: unknown = {}): Promise<T> {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const value = await response.json() as T & { ok?: boolean; message?: string }
  if (!response.ok || value.ok !== true) throw new Error(value.message || `更新请求失败（HTTP ${response.status}）`)
  return value
}
export function AppUpdateButton(): React.JSX.Element {
  const [info, setInfo] = useState<UpdateInfo>(), [progress, setProgress] = useState<UpdateProgress>(), [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [checking, setChecking] = useState(false)
  const live = useRef(true)
  const check = async (manual = false): Promise<void> => {
    if (checking) return
    setChecking(true); if (manual) { setOpen(true); setMessage('') }
    try {
      const result = await post<{ ok: true; update: UpdateInfo }>(UPDATE_API.check, { force: manual })
      if (live.current) { setInfo(result.update); if (manual && !result.update.updateAvailable) setMessage('当前已是最新版本') }
    } catch (error) { if (manual && live.current) setMessage(error instanceof Error ? error.message : '检查失败，请稍后重试') }
    finally { if (live.current) setChecking(false) }
  }
  const status = async (): Promise<void> => {
    try {
      const result = await post<{ ok: true; progress: UpdateProgress }>(UPDATE_API.status)
      if (live.current) setProgress(result.progress)
    } catch { /* 退出和重启期间连接暂时断开，等待应用重新打开。 */ }
  }
  useEffect(() => {
    live.current = true; void check(); void status()
    const interval = window.setInterval(() => { void check() }, 15 * 60_000)
    return () => { live.current = false; window.clearInterval(interval) }
  }, [])
  useEffect(() => {
    if (!progress || !['downloading', 'restarting', 'installing'].includes(progress.phase)) return
    const timer = window.setInterval(() => { void status() }, 500)
    return () => window.clearInterval(timer)
  }, [progress?.phase])
  const download = async (): Promise<void> => {
    if (!info || busy) return
    setBusy(true); setMessage('')
    try { const result = await post<{ ok: true; progress: UpdateProgress }>(UPDATE_API.download, { version: info.latestVersion }); setProgress(result.progress) }
    catch (error) { setMessage(error instanceof Error ? error.message : '下载失败') }
    finally { setBusy(false) }
  }
  const restart = async (): Promise<void> => {
    if (!info || busy) return
    if (!window.confirm(`将退出并重新打开 DeepSeek Harness，更新到 ${info.latestVersion}。请先保存当前正在编辑的内容，继续吗？`)) return
    setBusy(true); setMessage('')
    try { await post(UPDATE_API.apply, { version: info.latestVersion }); setProgress(previous => ({ ...(previous || { receivedBytes: 0, totalBytes: 0 }), phase: 'restarting', version: info.latestVersion, updatedAt: Date.now(), message: '正在重启并安装，请稍候' })) }
    catch (error) { setMessage(error instanceof Error ? error.message : '更新未开始'); setBusy(false) }
  }
  const active = progress && ['downloading', 'restarting', 'installing'].includes(progress.phase)
  const percent = progress?.totalBytes ? Math.min(100, Math.floor(progress.receivedBytes / progress.totalBytes * 100)) : 0
  return <div className={css.root} data-app-update="">
    <button type="button" className={css.trigger} data-new={info?.updateAvailable ? 'true' : undefined} onClick={() => { setOpen(value => !value); if (!info && !checking) void check() }} aria-expanded={open} aria-label="插件更新">
      {active ? progress.phase === 'downloading' ? `下载更新 ${percent}%` : '正在更新…' : info?.updateAvailable ? `发现新版 ${info.latestVersion}` : '检查更新'}
    </button>
    {open ? <section className={css.popover} role="dialog" aria-label="插件版本更新">
      <div className={css.head}><strong>插件更新</strong><button type="button" onClick={() => setOpen(false)} aria-label="关闭更新面板">×</button></div>
      <p>当前版本 <b>{PLUGIN_VERSION}</b>{info?.updateAvailable ? <> → <b>{info.latestVersion}</b></> : null}</p>
      {info?.releaseNotes ? <p className={css.notes}>{info.releaseNotes}</p> : null}
      {progress?.phase === 'downloading' ? <div><progress aria-label="更新下载进度" max={100} value={percent} /><small>正在下载 {percent}% · {(progress.receivedBytes / 1048576).toFixed(1)} / {(progress.totalBytes / 1048576).toFixed(1)} MB</small></div> : null}
      {progress && progress.phase !== 'idle' ? <p className={css.status} role="status" data-error={progress.phase === 'failed' ? 'true' : undefined}>{progress.message}</p> : null}
      {message ? <p className={css.status} role="status">{message}</p> : null}
      <div className={css.actions}>
        <button type="button" disabled={checking || !!active} onClick={() => { void check(true) }}>{checking ? '正在检查…' : '检查最新版'}</button>
        {info?.updateAvailable && !active ? progress?.phase === 'ready' && progress.version === info.latestVersion
          ? <button type="button" className={css.primary} disabled={busy} onClick={() => { void restart() }}>重启并更新</button>
          : <button type="button" className={css.primary} disabled={busy} onClick={() => { void download() }}>{busy ? '正在准备…' : '下载更新'}</button> : null}
      </div>
    </section> : null}
  </div>
}

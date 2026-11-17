import { cleanImageMetadata, imageKind, MAX_EXPORT_IMAGE_BYTES, type MetadataReport } from '../metadata/aimeta.ts'

export interface DownloadItem { url: string; name: string }
let noticeTimer: ReturnType<typeof setTimeout> | undefined
export function exportNotice(message: string, failed = false): void {
  let notice = document.querySelector<HTMLDivElement>('[data-export-notice]')
  if (!notice) {
    notice = document.createElement('div'); notice.dataset.exportNotice = ''
    notice.style.cssText = 'position:fixed;right:22px;bottom:22px;z-index:2147483647;max-width:min(480px,calc(100vw - 44px));max-height:45vh;overflow-y:auto;padding:14px 18px;border:1px solid #b9c7d3;border-radius:10px;background:#fff;color:#213547;box-shadow:0 6px 28px #14253830;font:14px/1.6 system-ui,sans-serif;white-space:pre-line;cursor:pointer'
    notice.title = '点击关闭'; notice.onclick = () => notice?.remove(); document.body.appendChild(notice)
  }
  notice.setAttribute('role', failed ? 'alert' : 'status'); notice.setAttribute('aria-live', failed ? 'assertive' : 'polite')
  notice.textContent = message; notice.style.borderColor = failed ? '#b91c1c' : '#b9c7d3'
  clearTimeout(noticeTimer)
  // 未清理／部分清理和错误保留至点击关闭或下一次导出，避免用户错过状态。
  if (!failed && !/未清理|部分清理|未导出/.test(message)) noticeTimer = setTimeout(() => notice?.remove(), 12000)
}
function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}
async function readResponse(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.ok) {
    const text = await response.text(); let message = text
    try { const data = JSON.parse(text); message = data.message || data.error || text } catch {}
    throw new Error(message.slice(0, 400) || `下载失败（HTTP ${response.status}）`)
  }
  if (!response.body) throw new Error('下载响应为空，未导出')
  const reader = response.body.getReader(), parts: Uint8Array[] = []; let length = 0
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > maxBytes) throw new Error('导出文件过大，未下载'); parts.push(value) }
  } finally { await reader.cancel().catch(() => {}) }
  const data = new Uint8Array(length); let p = 0
  for (const part of parts) { data.set(part, p); p += part.length }
  return data
}
function statusMessage(reports: MetadataReport[]): string {
  const counts = { cleaned: 0, partial: 0, uncleaned: 0, unchanged: 0 }
  for (const report of reports) counts[report.status]++
  const labels = { cleaned: '已清理', partial: '部分清理', uncleaned: '未清理', unchanged: '无需清理' }
  return Object.entries(counts).filter(([, n]) => n).map(([status, n]) => `${labels[status as keyof typeof labels]} ${n} 张`).join('；')
}
export async function downloadImages(items: DownloadItem[]): Promise<void> {
  if (!items.length) return
  exportNotice(`正在处理 ${items.length} 张图片的导出元数据…`)
  try {
    // 逐张收集结果，处理失败只跳过当前图片，不阻断其他可导出的图片。
    const prepared: Array<{ name: string; blob: Blob; report: MetadataReport }> = []
    const failures: Array<{ name: string; reason: string }> = []
    let total = 0
    for (const item of items) {
      try {
        const bytes = await readResponse(await fetch(item.url, { cache: 'no-store' }), MAX_EXPORT_IMAGE_BYTES)
        if (total + bytes.length > 512 * 1024 * 1024) throw new Error('本次批量导出超过 512 MiB，请分批选择')
        const cleaned = await cleanImageMetadata(bytes)
        const extension = cleaned.report.format === 'jpeg' ? 'jpg' : cleaned.report.format
        const name = /\.(jpe?g|png|webp)$/i.test(item.name) ? item.name.replace(/\.(jpe?g|png|webp)$/i, `.${extension}`) : `${item.name}.${extension}`
        prepared.push({ name, blob: new Blob([cleaned.data], { type: cleaned.mime }), report: cleaned.report }); total += bytes.length
      } catch (error) { failures.push({ name: item.name, reason: error instanceof Error ? error.message : String(error) }) }
    }
    const exported: typeof prepared = []
    for (const item of prepared) {
      try { saveBlob(item.blob, item.name); exported.push(item) }
      catch (error) { failures.push({ name: item.name, reason: error instanceof Error ? error.message : String(error) }) }
    }
    const failureDetails = failures.map(p => `${p.name}：${p.reason}`).join('\n')
    if (!exported.length) throw new Error(`全部 ${items.length} 张图片未导出。\n${failureDetails}`)
    const exceptions = exported.filter(p => ['partial', 'uncleaned'].includes(p.report.status))
    exportNotice(`已下载 ${exported.length} 张${failures.length ? `，${failures.length} 张未导出` : ''} · ${statusMessage(exported.map(p => p.report))}${failures.length ? '\n未导出文件：\n' + failureDetails : ''}${exceptions.length ? '\n' + exceptions.slice(0, 4).map(p => `${p.name}：${p.report.reason}`).join('\n') : '\n保留作者、版权、色彩配置与方向。'}`)
  } catch (error) { exportNotice(`导出失败：${error instanceof Error ? error.message : String(error)}`, true); throw error }
}
export async function downloadImageBlob(blob: Blob, name: string): Promise<void> {
  const url = URL.createObjectURL(blob)
  try { await downloadImages([{ url, name }]) } finally { URL.revokeObjectURL(url) }
}
export async function downloadImageZip(url: string, name: string): Promise<void> {
  exportNotice('正在处理 ZIP 内全部图片的元数据…')
  try {
    const response = await fetch(url, { cache: 'no-store' })
    const bytes = await readResponse(response, 512 * 1024 * 1024)
    if (response.headers.get('content-type')?.split(';')[0] !== 'application/zip' || !response.headers.has('x-image-metadata-summary')) throw new Error('导出响应缺少图片处理报告，未下载')
    const summary = JSON.parse(response.headers.get('x-image-metadata-summary')!) as Record<string, number>
    if (!['cleaned', 'partial', 'uncleaned', 'unchanged', 'failed'].every(k => Number.isInteger(summary[k]) && summary[k] >= 0)) throw new Error('图片处理报告无效，未下载')
    const count = summary.cleaned + summary.partial + summary.uncleaned + summary.unchanged
    if (!count) throw new Error('全部图片导出失败，未下载空 ZIP')
    const failures = JSON.parse(decodeURIComponent(response.headers.get('x-image-metadata-failures') || '%5B%5D')) as Array<{ file: string; reason: string }>
    if (!Array.isArray(failures) || !failures.every(f => typeof f.file === 'string' && typeof f.reason === 'string')) throw new Error('图片失败清单无效，未下载')
    saveBlob(new Blob([bytes], { type: 'application/zip' }), name)
    exportNotice(`ZIP 已下载，包含 ${count} 张图片${summary.failed ? `，${summary.failed} 张未导出` : ''}。\n已清理 ${summary.cleaned} 张；部分清理 ${summary.partial} 张；未清理 ${summary.uncleaned} 张；无需清理 ${summary.unchanged} 张。${failures.length ? '\n未导出文件：\n' + failures.map(f => `${f.file}：${f.reason}`).join('\n') : ''}${summary.failed > failures.length ? `\n另有 ${summary.failed - failures.length} 张失败，详见包内报告。` : ''}\n逐张结果见 ZIP 内的图片元数据处理报告.json。`)
  } catch (error) { exportNotice(`导出失败：${error instanceof Error ? error.message : String(error)}`, true); throw error }
}
// 文件节点仍可下载文档；图片必须进入同一处理模块，不能因 MIME 缺失绕过。
export async function downloadCanvasFile(url: string, name: string, mime = ''): Promise<void> {
  if (/^image\//i.test(mime) || /\.(png|jpe?g|webp|gif|bmp|tiff?|heic)$/i.test(name)) { await downloadImages([{ url, name }]); return }
  try {
    const response = await fetch(url, { cache: 'no-store' }), bytes = await readResponse(response, 512 * 1024 * 1024)
    if (imageKind(bytes) || /^image\//i.test(response.headers.get('content-type') || '')) {
      await downloadImageBlob(new Blob([bytes]), name); return
    }
    saveBlob(new Blob([bytes], { type: response.headers.get('content-type') || 'application/octet-stream' }), name)
  } catch (error) { exportNotice(`导出失败：${error instanceof Error ? error.message : String(error)}`, true); throw error }
}

import { useRef, useState, type AnchorHTMLAttributes } from 'react'
import { downloadImages } from './metadata-download.ts'

// 复用现有下载按钮的外观；链接仅作为语义入口，文件准备好后才触发真实下载。
export function ImageDownloadLink(props: AnchorHTMLAttributes<HTMLAnchorElement>): React.JSX.Element {
  const { href, download, onClick, children, ...rest } = props
  const lock = useRef(false), [busy, setBusy] = useState(false)
  return <a {...rest} href="#export-image" download={download} aria-busy={busy} onClick={event => {
    event.preventDefault(); event.stopPropagation(); onClick?.(event)
    if (lock.current || !href) return
    lock.current = true; setBusy(true)
    void downloadImages([{ url: href, name: typeof download === 'string' ? download : 'image' }]).catch(() => {}).finally(() => { lock.current = false; setBusy(false) })
  }}>{busy ? '正在处理…' : children}</a>
}

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import css from './creation-image-viewer.module.css'

export interface CreationPreviewImage { id: string; src: string; title: string; downloadName: string }

// 与宿主已有预览采用相同的页面内弹层方式，避免桌面壳拦截新窗口。
export function CreationImageViewer(props: { images: CreationPreviewImage[]; index: number; onIndex: (index: number) => void; onClose: () => void }): React.JSX.Element | null {
  const { images, index, onIndex, onClose } = props, image = images[index]
  const dialog = useRef<HTMLDivElement>(null), stage = useRef<HTMLDivElement>(null)
  const [natural, setNatural] = useState({ width: 0, height: 0 }), [available, setAvailable] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState<number | null>(null), [failed, setFailed] = useState(false)
  const fit = natural.width && available.width ? Math.min(1, available.width / natural.width, available.height / natural.height) : 1
  const scale = zoom ?? fit
  const imageWidth = natural.width * scale, imageHeight = natural.height * scale

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'; dialog.current?.focus()
    const observer = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect
      if (box) setAvailable({ width: Math.max(1, box.width - 24), height: Math.max(1, box.height - 24) })
    })
    if (stage.current) observer.observe(stage.current)
    return () => { observer.disconnect(); document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  useEffect(() => { setNatural({ width: 0, height: 0 }); setZoom(null); setFailed(false) }, [image?.src])
  useEffect(() => {
    if (stage.current) { stage.current.scrollLeft = Math.max(0, (imageWidth + 24 - stage.current.clientWidth) / 2); stage.current.scrollTop = Math.max(0, (imageHeight + 24 - stage.current.clientHeight) / 2) }
  }, [imageWidth, imageHeight])
  useEffect(() => {
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
      else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && images.length > 1) {
        event.preventDefault(); event.stopPropagation(); onIndex((index + (event.key === 'ArrowLeft' ? -1 : 1) + images.length) % images.length)
      } else if (event.key === 'Tab') {
        const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]') ?? [])]
        const first = controls[0], last = controls.at(-1)
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    window.addEventListener('keydown', keydown, true)
    return () => window.removeEventListener('keydown', keydown, true)
  }, [images.length, index, onClose, onIndex])
  if (!image) return null
  const step = (amount: number): void => onIndex((index + amount + images.length) % images.length)
  const resize = (factor: number): void => setZoom(Math.max(Math.min(fit, 0.1), Math.min(4, scale * factor)))

  return createPortal(<div className={css.overlay} data-creation-lightbox="" onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className={css.dialog} role="dialog" aria-modal="true" aria-label="创作图片预览" ref={dialog} tabIndex={-1}>
      <header className={css.header}><strong>{image.title}</strong><span>{index + 1} / {images.length}</span><button type="button" aria-label="关闭图片预览" onClick={onClose}>×</button></header>
      <div className={css.viewer}>
        {images.length > 1 ? <button type="button" className={css.previous} aria-label="上一张图片" onClick={() => step(-1)}>‹</button> : null}
        <div className={css.stage} ref={stage} data-creation-viewer-stage="">
          {failed ? <p className={css.message} role="alert">原图暂时无法读取，请关闭后重新打开。</p> : <div className={css.canvas} style={{ width: Math.max(available.width + 24, imageWidth + 24), height: Math.max(available.height + 24, imageHeight + 24) }}>
            <img key={image.src} src={image.src} alt={image.title} draggable={false} data-creation-full-image="" onLoad={event => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} onError={() => setFailed(true)} onDoubleClick={() => setZoom(value => value === null ? Math.min(4, fit * 2) : null)} style={natural.width ? { width: imageWidth, height: imageHeight } : { visibility: 'hidden' }} />
            {!natural.width ? <span className={css.message} role="status">正在读取原图…</span> : null}
          </div>}
        </div>
        {images.length > 1 ? <button type="button" className={css.next} aria-label="下一张图片" onClick={() => step(1)}>›</button> : null}
      </div>
      <footer className={css.footer}>
        <span className={css.dimensions}>{natural.width ? `${natural.width} × ${natural.height}` : ''}</span>
        <div className={css.zoom} role="group" aria-label="图片缩放"><button type="button" aria-label="缩小图片" disabled={!natural.width || failed} onClick={() => resize(0.8)}>−</button><button type="button" disabled={!natural.width || failed} onClick={() => setZoom(null)} title="恢复适应窗口">适应窗口</button><span data-creation-zoom="">{Math.round(scale * 100)}%</span><button type="button" aria-label="放大图片" disabled={!natural.width || failed || scale >= 4} onClick={() => resize(1.25)}>＋</button></div>
        <a className={css.download} href={image.src} download={image.downloadName} data-creation-download="">下载这张原图</a>
      </footer>
    </div>
  </div>, document.body)
}

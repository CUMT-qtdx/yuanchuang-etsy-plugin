import { useCallback, useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react'

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'rows'> & { value: string; minRows?: number }

// 编辑框随内容和列宽自动长高，保留员工手动拉大的高度。
export function AutoSizeTextarea({ value, minRows = 3, style, ...props }: Props): React.JSX.Element {
  const textarea = useRef<HTMLTextAreaElement>(null)
  const resize = useCallback(() => {
    const element = textarea.current
    if (!element || element.clientWidth === 0) return
    const previous = element.getBoundingClientRect().height
    const appearance = getComputedStyle(element)
    const border = (parseFloat(appearance.borderTopWidth) || 0) + (parseFloat(appearance.borderBottomWidth) || 0)
    element.style.height = 'auto'
    element.style.height = `${Math.ceil(Math.max(previous, element.scrollHeight + border))}px`
  }, [])
  useLayoutEffect(resize, [value, resize])
  useLayoutEffect(() => {
    const element = textarea.current
    if (!element) return
    let width = 0, frame = 0
    const observer = new ResizeObserver(entries => {
      const nextWidth = entries[0]?.contentRect.width ?? 0
      if (nextWidth === width) return
      width = nextWidth
      cancelAnimationFrame(frame); frame = requestAnimationFrame(resize)
    })
    observer.observe(element)
    return () => { observer.disconnect(); cancelAnimationFrame(frame) }
  }, [resize])
  return <textarea {...props} ref={textarea} rows={minRows} value={value} data-auto-size="" style={{ ...style, boxSizing: 'border-box', overflowY: 'hidden', resize: 'vertical' }} />
}

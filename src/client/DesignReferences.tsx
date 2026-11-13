import { useEffect, useRef, useState } from 'react'
import type { ReferenceRole } from '../etsy/types.ts'
import { referenceRoles } from '../etsy/creation-flow.ts'
import css from './reference-studio.module.css'

export interface ReferenceDraft { src: string; name: string; role: ReferenceRole; note: string; bytes?: number }
export function DesignReferences(props: { value: ReferenceDraft[]; onChange: (value: ReferenceDraft[]) => void; onError: (message: string) => void }): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null), replacement = useRef<number>(), value = useRef(props.value), readingRef = useRef(false)
  const alive = useRef(true), operation = useRef(0), readers = useRef(new Set<FileReader>())
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false; operation.current++
      for (const reader of readers.current) if (reader.readyState === FileReader.LOADING) reader.abort()
      readers.current.clear()
    }
  }, [])
  value.current = props.value
  const [reading, setReading] = useState(false)
  const load = async (files: File[]): Promise<void> => {
    if (readingRef.current || !files.length) return
    const index = replacement.current; replacement.current = undefined
    const selected = index === undefined ? files : files.slice(0, 1)
    if ((index === undefined ? value.current.length : value.current.length - 1) + selected.length > 5) { props.onError('最多上传5张参考图'); return }
    if (selected.some(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024)) { props.onError('请使用每张10 MiB以内的JPG、PNG或WebP图片'); return }
    readingRef.current = true; setReading(true)
    const token = ++operation.current
    try {
      const loaded = await Promise.all(selected.map(async file => ({ src: await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); readers.current.add(reader)
        const finish = (): void => { readers.current.delete(reader) }
        reader.onload = () => { finish(); resolve(String(reader.result)) }
        reader.onerror = () => { finish(); reject(new Error('图片读取失败，请重新选择')) }
        reader.onabort = () => { finish(); reject(new Error('图片读取已取消')) }
        reader.readAsDataURL(file)
      }), name: file.name, bytes: file.size, role: 'detail' as ReferenceRole, note: '' })))
      if (!alive.current || token !== operation.current) return
      const next = [...value.current]
      if (index === undefined) next.push(...loaded)
      else next[index] = { ...loaded[0], role: next[index].role, note: next[index].note }
      if (next.reduce((sum, item) => sum + (item.bytes ?? 0), 0) > 20 * 1024 * 1024) throw new Error('参考图合计不能超过20 MiB')
      props.onChange(next.map((item, index) => ({ ...item, role: index === 0 ? 'subject' : item.role === 'subject' ? 'detail' : item.role })))
      props.onError('')
    } catch (error) { if (alive.current && token === operation.current) props.onError(error instanceof Error ? error.message : '图片读取失败，请重新选择') }
    finally { if (alive.current && token === operation.current) { readingRef.current = false; setReading(false) } }
  }
  return <div className={css.referenceBox} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); replacement.current = undefined; void load([...event.dataTransfer.files]) }}>
    <div className={css.sectionHeading}><strong>参考图片 <small>{props.value.length}/5</small></strong><button type="button" disabled={reading || props.value.length >= 5} onClick={() => { replacement.current = undefined; input.current?.click() }}>{reading ? '读取中…' : props.value.length ? '添加参考图' : '选择图片'}</button></div>
    <input ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp" aria-label="参考图片" hidden onChange={event => { void load([...event.target.files ?? []]); event.target.value = '' }} />
    {!props.value.length ? <div className={css.referenceEmpty}>拖入1～5张图片<br /><small>第一张是主体，辅助图可指定局部、材质、配色或其他角度</small></div> : <div className={css.referenceList}>{props.value.map((item, index) => <div className={css.referenceRow} key={index} data-reference-item={index}>
      <button type="button" disabled={reading} className={css.referenceThumb} aria-label={`更换参考图 ${index + 1}`} onClick={() => { replacement.current = index; input.current?.click() }}><img src={item.src} alt={`参考图 ${index + 1}`} /></button>
      <div className={css.referenceFields}><div className={css.referenceTop}>{index === 0 ? <strong>主体参考</strong> : <select aria-label={`参考图 ${index + 1} 用途`} value={item.role} onChange={event => props.onChange(props.value.map((entry, i) => i === index ? { ...entry, role: event.target.value as ReferenceRole } : entry))}>{referenceRoles.map(role => <option key={role.value} value={role.value}>{role.label}</option>)}</select>}<button type="button" disabled={reading} aria-label={`移除参考图 ${index + 1}`} onClick={() => props.onChange(props.value.filter((_, i) => i !== index).map((entry, i) => ({ ...entry, role: i === 0 ? 'subject' : entry.role })))}>×</button></div><input aria-label={`参考图 ${index + 1} 说明`} maxLength={500} value={item.note} placeholder={index === 0 ? '要保留的特征（可选）' : '例如：只参考翅膀，不参考人物'} onChange={event => props.onChange(props.value.map((entry, i) => i === index ? { ...entry, note: event.target.value } : entry))} /></div>
    </div>)}</div>}
    <small>每张10 MiB以内，合计20 MiB以内 · 点击缩略图可更换</small>
  </div>
}

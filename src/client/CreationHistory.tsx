import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { EtsyProduct } from '../etsy/types.ts'
import css from './reference-studio.module.css'
import { productStages } from '../etsy/selected-copy.ts'

const titleOf = (product: EtsyProduct): string => product.displayName?.trim() || product.facts.name

export function CreationHistory(props: {
  products: EtsyProduct[]
  selectedId: string
  disabled: boolean
  notice?: string
  onSelect: (id: string) => void
  onDelete: (id: string) => Promise<void>
  onRename: (id: string, name: string) => Promise<void>
}): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [menu, setMenu] = useState<{ id: string; x: number; y: number }>()
  const [removing, setRemoving] = useState<EtsyProduct>(), [deleting, setDeleting] = useState(false), [error, setError] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; value: string; original: string }>(), [renameBusy, setRenameBusy] = useState(false), [renameError, setRenameError] = useState('')
  const menuElement = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    const outside = (event: PointerEvent): void => { if (!menuElement.current?.contains(event.target as Node)) setMenu(undefined) }
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape') setMenu(undefined) }
    window.addEventListener('pointerdown', outside); window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape) }
  }, [menu])
  const target = props.products.find(product => product.id === menu?.id)
  const active = target && productStages(target).some(stage => ['queued', 'running'].includes(stage.status))
  const products = [...props.products].sort((a, b) => b.createdAt - a.createdAt).filter(product => titleOf(product).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  const menuAt = (x: number, y: number): { x: number; y: number } => ({ x: Math.max(8, Math.min(x, window.innerWidth - 205)), y: Math.max(8, Math.min(y, window.innerHeight - 125)) })
  const submitRename = async (): Promise<void> => {
    if (!renaming || renameBusy) return
    const value = renaming.value.trim()
    if (!value) { setRenameError('请输入创作名称'); return }
    if (value === renaming.original) { setRenaming(undefined); return }
    setRenameBusy(true); setRenameError('')
    try { await props.onRename(renaming.id, value); setRenaming(undefined) }
    catch (caught) { setRenameError(caught instanceof Error ? caught.message : '重命名未完成，请重试') }
    finally { setRenameBusy(false) }
  }
  return <nav className={css.history} aria-label="创作记录" data-creation-history="">
    <div className={css.historyHeader}><strong>我的创作</strong><span>{props.products.length} 组</span></div>
    <button className={css.newCreation} type="button" aria-label="新创作" disabled={props.disabled} onClick={() => { setSearch(''); props.onSelect('') }}>＋ 新创作</button>
    <input aria-label="搜索创作" placeholder="搜索创作名称" value={search} onChange={event => setSearch(event.target.value)} />
    {props.notice ? <p className={css.renameNotice} role="status">{props.notice}</p> : null}
    <div className={css.historyList}>
      {products.map(product => {
        const count = product.images.filter(image => image.files.length > 0).length
        const edits = product.images.filter(image => image.kind !== 'view' && image.parentImageId && image.files.length > 0).length
        const naming = !product.displayName && product.facts.name.startsWith('参考图设计') && product.planning?.status !== 'completed'
        const shown = titleOf(product)
        return <button key={product.id} type="button" className={css.historyItem} data-creation-project={product.id} aria-current={props.selectedId === product.id ? 'page' : undefined} disabled={props.disabled} onClick={() => props.onSelect(product.id)} onContextMenu={event => { event.preventDefault(); setMenu({ id: product.id, ...menuAt(event.clientX, event.clientY) }) }} onKeyDown={event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); const box = event.currentTarget.getBoundingClientRect(); setMenu({ id: product.id, ...menuAt(box.left + 20, box.top + 20) }) } }}>
          <strong>{naming ? '正在命名的新创作…' : shown}</strong>
          <span>{product.round ? `第${product.round}轮 · ` : ''}{count} 张图片{edits ? ` · ${edits} 张修改` : ''}</span>
          <small>{new Date(product.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</small>
        </button>
      })}
      {!products.length ? <p className={css.historyEmpty}>{search ? '没有找到这组创作' : '每次生成会保存为一组，修改图也放在同一组。'}</p> : null}
    </div>
    {menu && target ? createPortal(<div ref={menuElement} className={css.contextMenu} role="menu" aria-label="创作操作" style={{ left: menu.x, top: menu.y }}>
      <button type="button" role="menuitem" className={css.renameMenuItem} disabled={props.disabled} onClick={() => { setRenameError(''); setRenaming({ id: target.id, value: titleOf(target), original: titleOf(target) }); setMenu(undefined) }}>重新命名</button>
      <button type="button" role="menuitem" disabled={props.disabled || active} onClick={() => { setError(''); setRemoving(target); setMenu(undefined) }}>删除本次创作</button>
      {active ? <small>任务进行中，请先停止任务。</small> : null}
    </div>, document.body) : null}
    {removing ? createPortal(<div className={css.deleteOverlay}><section className={css.deleteDialog} role="alertdialog" aria-modal="true" aria-labelledby="delete-creation-heading" aria-describedby="delete-creation-details"><h3 id="delete-creation-heading">删除本次创作？</h3><strong>{titleOf(removing)}</strong><p id="delete-creation-details">将永久清理本组 {removing.images.filter(image => image.files.length).length} 张图片，以及参考图、商品文案、检查结果和修改记录。删除后无法撤销。</p>{error ? <p role="alert" className={css.error}>{error}</p> : null}<div><button type="button" autoFocus disabled={deleting} onClick={() => setRemoving(undefined)}>取消</button><button type="button" className={css.deleteConfirm} disabled={deleting} onClick={() => { setDeleting(true); void props.onDelete(removing.id).then(() => setRemoving(undefined)).catch(caught => setError(caught instanceof Error ? caught.message : '删除未完成，请重试')).finally(() => setDeleting(false)) }}>{deleting ? '正在清理…' : '确认删除'}</button></div></section></div>, document.body) : null}
    {renaming ? createPortal(<div className={css.deleteOverlay}><section className={css.deleteDialog} role="dialog" aria-modal="true" aria-labelledby="rename-creation-heading" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); if (!renameBusy) setRenaming(undefined) } }}><h3 id="rename-creation-heading">重新命名</h3><p>只修改这组创作在左侧显示的名称，不影响已生成的图片、文案和商品资料。</p><input className={css.renameInput} aria-label="创作名称" autoFocus onFocus={event => event.currentTarget.select()} maxLength={80} disabled={renameBusy} value={renaming.value} onChange={event => setRenaming({ ...renaming, value: event.target.value })} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void submitRename() } }} />{renameError ? <p role="alert" className={css.error}>{renameError}</p> : null}<div><button type="button" disabled={renameBusy} onClick={() => setRenaming(undefined)}>取消</button><button type="button" className={css.renameSave} disabled={renameBusy || !renaming.value.trim()} onClick={() => { void submitRename() }}>{renameBusy ? '正在保存…' : '保存名称'}</button></div></section></div>, document.body) : null}
  </nav>
}

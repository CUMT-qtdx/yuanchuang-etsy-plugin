import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CreationGroup, EtsyProduct } from '../etsy/types.ts'
import css from './reference-studio.module.css'
import { productStages } from '../etsy/selected-copy.ts'
import { readCollapsedGroups, writeCollapsedGroups } from './creation-groups.ts'

const titleOf = (product: EtsyProduct): string => product.displayName?.trim() || product.facts.name
const UNGROUPED_ID = '__ungrouped__'

export function CreationHistory(props: {
  products: EtsyProduct[]
  groups?: CreationGroup[]
  selectedId: string
  disabled: boolean
  notice?: string
  onSelect: (id: string) => void
  onDelete: (id: string) => Promise<void>
  onRename: (id: string, name: string) => Promise<void>
  onCreateGroup?: (name: string) => Promise<CreationGroup[]>
  onRenameGroup?: (groupId: string, name: string) => Promise<CreationGroup[]>
  onDeleteGroup?: (groupId: string) => Promise<CreationGroup[]>
  onMoveGroup?: (id: string, groupId: string) => Promise<void>
}): React.JSX.Element {
  const groups = props.groups ?? []
  const groupIds = new Set(groups.map(group => group.id))
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsedGroups)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number }>()
  const [groupMenu, setGroupMenu] = useState<{ group: CreationGroup; x: number; y: number }>()
  const [removing, setRemoving] = useState<EtsyProduct>(), [deleting, setDeleting] = useState(false), [error, setError] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; value: string; original: string }>(), [renameBusy, setRenameBusy] = useState(false), [renameError, setRenameError] = useState('')
  const [groupDialog, setGroupDialog] = useState<{ mode: 'create' | 'rename'; groupId?: string; moveProjectId?: string; value: string; original?: string }>()
  const [groupBusy, setGroupBusy] = useState(false), [groupError, setGroupError] = useState('')
  const [removingGroup, setRemovingGroup] = useState<CreationGroup>()
  const [moveError, setMoveError] = useState('')
  const menuElement = useRef<HTMLDivElement>(null)
  const groupMenuElement = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu && !groupMenu) return
    const outside = (event: PointerEvent): void => {
      const target = event.target as Node
      if (menu && !menuElement.current?.contains(target)) setMenu(undefined)
      if (groupMenu && !groupMenuElement.current?.contains(target)) setGroupMenu(undefined)
    }
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape') { setMenu(undefined); setGroupMenu(undefined) } }
    window.addEventListener('pointerdown', outside); window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape) }
  }, [menu, groupMenu])

  const toggleGroup = (key: string): void => {
    setCollapsed(previous => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      writeCollapsedGroups(next)
      return next
    })
  }

  const target = props.products.find(product => product.id === menu?.id)
  const active = target && productStages(target).some(stage => ['queued', 'running'].includes(stage.status))
  const keyword = search.trim().toLocaleLowerCase()
  const products = [...props.products]
    .sort((a, b) => b.createdAt - a.createdAt)
    .filter(product => titleOf(product).toLocaleLowerCase().includes(keyword))

  const menuAt = (x: number, y: number, approxHeight = 220): { x: number; y: number } => ({
    x: Math.max(8, Math.min(x, window.innerWidth - 220)),
    y: Math.max(8, Math.min(y, window.innerHeight - approxHeight)),
  })

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

  const submitGroup = async (): Promise<void> => {
    if (!groupDialog || groupBusy) return
    const value = groupDialog.value.trim()
    if (!value) { setGroupError('请输入分组名称'); return }
    if (groupDialog.mode === 'rename' && value === groupDialog.original) { setGroupDialog(undefined); return }
    setGroupBusy(true); setGroupError('')
    try {
      if (groupDialog.mode === 'create' && props.onCreateGroup) {
        const updated = await props.onCreateGroup(value)
        const created = updated.find(group => group.name.toLocaleLowerCase() === value.toLocaleLowerCase())
        if (groupDialog.moveProjectId && created && props.onMoveGroup) {
          await props.onMoveGroup(groupDialog.moveProjectId, created.id)
        }
      } else if (groupDialog.mode === 'rename' && groupDialog.groupId && props.onRenameGroup) {
        await props.onRenameGroup(groupDialog.groupId, value)
      }
      setGroupDialog(undefined)
    } catch (caught) {
      setGroupError(caught instanceof Error ? caught.message : '分组保存未完成，请重试')
    } finally { setGroupBusy(false) }
  }

  const moveProject = async (projectId: string, groupId: string): Promise<void> => {
    if (!props.onMoveGroup) return
    setMoveError('')
    setMenu(undefined)
    try { await props.onMoveGroup(projectId, groupId) }
    catch (caught) { setMoveError(caught instanceof Error ? caught.message : '移动分组失败') }
  }

  const renderItem = (product: EtsyProduct): React.JSX.Element => {
    const count = product.images.filter(image => image.files.length > 0).length
    const edits = product.images.filter(image => image.kind !== 'view' && image.parentImageId && image.files.length > 0).length
    const naming = !product.displayName && product.facts.name.startsWith('参考图设计') && product.planning?.status !== 'completed'
    const shown = naming ? '正在命名的新创作…' : titleOf(product)
    const time = new Date(product.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    const badge = product.round ? `${product.round}轮·${count}图` : `${count}图`
    const fullTip = `${shown}\n${product.round ? `第${product.round}轮 · ` : ''}${count} 张图片${edits ? ` · ${edits} 张修改` : ''} · ${time}`
    return <button
      key={product.id}
      type="button"
      className={css.historyItem}
      data-creation-project={product.id}
      aria-current={props.selectedId === product.id ? 'page' : undefined}
      disabled={props.disabled}
      title={fullTip}
      onClick={() => props.onSelect(product.id)}
      onContextMenu={event => {
        event.preventDefault()
        setGroupMenu(undefined)
        setMenu({ id: product.id, ...menuAt(event.clientX, event.clientY, Math.min(340, 170 + groups.length * 32)) })
      }}
      onKeyDown={event => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault()
          const box = event.currentTarget.getBoundingClientRect()
          setGroupMenu(undefined)
          setMenu({ id: product.id, ...menuAt(box.left + 20, box.top + 20, Math.min(340, 170 + groups.length * 32)) })
        }
      }}
    >
      <strong className={css.historyTitle}>{shown}</strong>
      <span className={css.historyMeta}>{badge}</span>
    </button>
  }

  const ungrouped = products.filter(product => !product.groupId || !groupIds.has(product.groupId))
  const groupedSections = groups.map(group => ({
    group,
    items: products.filter(product => product.groupId === group.id),
  }))

  return <nav className={css.history} aria-label="创作记录" data-creation-history="" onWheel={event => { event.stopPropagation() }}>
    <div className={css.historyHeader}>
      <div className={css.historyTitleRow}><strong>我的创作</strong><span>{props.products.length} 组</span></div>
      {props.onCreateGroup ? <button type="button" className={css.newGroupButton} aria-label="新建分组" title="新建创作分组" disabled={props.disabled} onClick={() => { setGroupError(''); setGroupDialog({ mode: 'create', value: '' }) }}>＋ 分组</button> : null}
    </div>
    <button className={css.newCreation} type="button" aria-label="新创作" disabled={props.disabled} onClick={() => { setSearch(''); props.onSelect('') }}>＋ 新创作</button>
    <input aria-label="搜索创作" placeholder="搜索创作名称" value={search} onChange={event => setSearch(event.target.value)} />
    {props.notice ? <p className={css.renameNotice} role="status">{props.notice}</p> : null}
    {moveError ? <p className={css.error} role="alert">{moveError}</p> : null}
    <div className={css.historyList} data-creation-history-list="">
      {groups.length > 0 ? <>
        {groupedSections.map(({ group, items }) => {
          if (keyword && items.length === 0) return null
          const isCollapsed = !keyword && collapsed.has(group.id)
          return <section key={group.id} className={css.historyGroup} data-creation-group={group.id}>
            <button
              type="button"
              className={css.historyGroupHeader}
              aria-expanded={!isCollapsed}
              onClick={() => toggleGroup(group.id)}
              onContextMenu={event => {
                event.preventDefault()
                setMenu(undefined)
                setGroupMenu({ group, ...menuAt(event.clientX, event.clientY, 120) })
              }}
            >
              <span className={css.historyGroupArrow}>{isCollapsed ? '▸' : '▾'}</span>
              <span className={css.historyGroupName}>{group.name}</span>
              <span className={css.historyGroupCount}>{items.length}</span>
            </button>
            {!isCollapsed ? <div className={css.historyGroupItems}>
              {items.length > 0 ? items.map(renderItem) : <p className={css.historyGroupEmpty}>右键创作可移入此分组</p>}
            </div> : null}
          </section>
        })}
        {(!keyword || ungrouped.length > 0) ? <section className={css.historyGroup} data-creation-group="ungrouped">
          <button type="button" className={css.historyGroupHeader} aria-expanded={!!keyword || !collapsed.has(UNGROUPED_ID)} onClick={() => toggleGroup(UNGROUPED_ID)}>
            <span className={css.historyGroupArrow}>{!keyword && collapsed.has(UNGROUPED_ID) ? '▸' : '▾'}</span>
            <span className={css.historyGroupName}>未分组</span>
            <span className={css.historyGroupCount}>{ungrouped.length}</span>
          </button>
          {(keyword || !collapsed.has(UNGROUPED_ID)) ? <div className={css.historyGroupItems}>
            {ungrouped.map(renderItem)}
          </div> : null}
        </section> : null}
      </> : products.map(renderItem)}
      {!products.length ? <p className={css.historyEmpty}>{search ? '没有找到这组创作' : '每次生成会保存为一组，修改图也放在同一组。'}</p> : null}
    </div>

    {menu && target ? createPortal(<div ref={menuElement} className={css.contextMenu} role="menu" aria-label="创作操作" style={{ left: menu.x, top: menu.y }}>
      <button type="button" role="menuitem" className={css.renameMenuItem} disabled={props.disabled} onClick={() => { setRenameError(''); setRenaming({ id: target.id, value: titleOf(target), original: titleOf(target) }); setMenu(undefined) }}>重新命名</button>
      {props.onMoveGroup ? <>
        <div className={css.menuDivider} role="separator" />
        <div className={css.menuSectionLabel}>移动到分组</div>
        {groups.map(group => {
          const current = target.groupId === group.id
          return <button key={group.id} type="button" role="menuitem" className={css.groupMenuItem} disabled={props.disabled || current} onClick={() => { void moveProject(target.id, group.id) }}>
            <span>{current ? '✓ ' : ''}{group.name}</span>
          </button>
        })}
        {target.groupId && groupIds.has(target.groupId) ? <button type="button" role="menuitem" className={css.groupMenuItem} disabled={props.disabled} onClick={() => { void moveProject(target.id, '') }}>移出分组（未分组）</button> : null}
        {props.onCreateGroup ? <button type="button" role="menuitem" className={css.renameMenuItem} disabled={props.disabled} onClick={() => { setGroupError(''); setGroupDialog({ mode: 'create', moveProjectId: target.id, value: '' }); setMenu(undefined) }}>＋ 新建分组并移入…</button> : null}
      </> : null}
      <div className={css.menuDivider} role="separator" />
      <button type="button" role="menuitem" disabled={props.disabled || active} onClick={() => { setError(''); setRemoving(target); setMenu(undefined) }}>删除本次创作</button>
      {active ? <small>任务进行中，请先停止任务。</small> : null}
    </div>, document.body) : null}

    {groupMenu ? createPortal(<div ref={groupMenuElement} className={css.contextMenu} role="menu" aria-label="分组操作" style={{ left: groupMenu.x, top: groupMenu.y }}>
      <button type="button" role="menuitem" className={css.renameMenuItem} disabled={props.disabled} onClick={() => { setGroupError(''); setGroupDialog({ mode: 'rename', groupId: groupMenu.group.id, value: groupMenu.group.name, original: groupMenu.group.name }); setGroupMenu(undefined) }}>重命名分组</button>
      <button type="button" role="menuitem" disabled={props.disabled} onClick={() => { setGroupError(''); setRemovingGroup(groupMenu.group); setGroupMenu(undefined) }}>删除分组</button>
    </div>, document.body) : null}

    {removing ? createPortal(<div className={css.deleteOverlay}><section className={css.deleteDialog} role="alertdialog" aria-modal="true" aria-labelledby="delete-creation-heading" aria-describedby="delete-creation-details"><h3 id="delete-creation-heading">删除本次创作？</h3><strong>{titleOf(removing)}</strong><p id="delete-creation-details">将永久清理本组 {removing.images.filter(image => image.files.length).length} 张图片，以及参考图、商品文案、检查结果和修改记录。删除后无法撤销。</p>{error ? <p role="alert" className={css.error}>{error}</p> : null}<div><button type="button" autoFocus disabled={deleting} onClick={() => setRemoving(undefined)}>取消</button><button type="button" className={css.deleteConfirm} disabled={deleting} onClick={() => { setDeleting(true); void props.onDelete(removing.id).then(() => setRemoving(undefined)).catch(caught => setError(caught instanceof Error ? caught.message : '删除未完成，请重试')).finally(() => setDeleting(false)) }}>{deleting ? '正在清理…' : '确认删除'}</button></div></section></div>, document.body) : null}

    {renaming ? createPortal(<div className={css.deleteOverlay}><section className={css.deleteDialog} role="dialog" aria-modal="true" aria-labelledby="rename-creation-heading" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); if (!renameBusy) setRenaming(undefined) } }}><h3 id="rename-creation-heading">重新命名</h3><p>只修改这组创作在左侧显示的名称，不影响已生成的图片、文案和商品资料。</p><input className={css.renameInput} aria-label="创作名称" autoFocus onFocus={event => event.currentTarget.select()} maxLength={80} disabled={renameBusy} value={renaming.value} onChange={event => setRenaming({ ...renaming, value: event.target.value })} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void submitRename() } }} />{renameError ? <p role="alert" className={css.error}>{renameError}</p> : null}<div><button type="button" disabled={renameBusy} onClick={() => setRenaming(undefined)}>取消</button><button type="button" className={css.renameSave} disabled={renameBusy || !renaming.value.trim()} onClick={() => { void submitRename() }}>{renameBusy ? '正在保存…' : '保存名称'}</button></div></section></div>, document.body) : null}

    {groupDialog ? createPortal(<div className={css.deleteOverlay}><section className={css.deleteDialog} role="dialog" aria-modal="true" aria-labelledby="group-dialog-heading" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); if (!groupBusy) setGroupDialog(undefined) } }}><h3 id="group-dialog-heading">{groupDialog.mode === 'create' ? (groupDialog.moveProjectId ? '新建分组并移入' : '新建分组') : '重命名分组'}</h3><p>分组只用于整理左侧创作记录，不影响已生成的图片与商品文案。</p><input className={css.renameInput} aria-label="分组名称" placeholder="例如：圣诞小挂件、人物摆件" autoFocus onFocus={event => event.currentTarget.select()} maxLength={40} disabled={groupBusy} value={groupDialog.value} onChange={event => setGroupDialog({ ...groupDialog, value: event.target.value })} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void submitGroup() } }} />{groupError ? <p role="alert" className={css.error}>{groupError}</p> : null}<div><button type="button" disabled={groupBusy} onClick={() => setGroupDialog(undefined)}>取消</button><button type="button" className={css.renameSave} disabled={groupBusy || !groupDialog.value.trim()} onClick={() => { void submitGroup() }}>{groupBusy ? '正在保存…' : '保存分组'}</button></div></section></div>, document.body) : null}

    {removingGroup ? createPortal(<div className={css.deleteOverlay}><section className={css.deleteDialog} role="alertdialog" aria-modal="true" aria-labelledby="delete-group-heading"><h3 id="delete-group-heading">删除分组？</h3><strong>{removingGroup.name}</strong><p>只删除该分组标签，组内所有创作、图片与文案都会保留并移回「未分组」。</p>{groupError ? <p role="alert" className={css.error}>{groupError}</p> : null}<div><button type="button" autoFocus disabled={groupBusy} onClick={() => setRemovingGroup(undefined)}>取消</button><button type="button" className={css.deleteConfirm} disabled={groupBusy} onClick={() => { if (!props.onDeleteGroup) return; setGroupBusy(true); void props.onDeleteGroup(removingGroup.id).then(() => setRemovingGroup(undefined)).catch(caught => setGroupError(caught instanceof Error ? caught.message : '删除分组失败')).finally(() => setGroupBusy(false)) }}>{groupBusy ? '正在处理…' : '确认删除'}</button></div></section></div>, document.body) : null}
  </nav>
}

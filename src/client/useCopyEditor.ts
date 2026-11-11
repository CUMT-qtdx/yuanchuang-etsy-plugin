import { useEffect, useRef, useState } from 'react'
import type { EtsyCopy, EtsyProduct } from '../etsy/types.ts'
import { selectedCopy } from '../etsy/selected-copy.ts'
import { formatProductDescription, normalizeTitleLanguages } from '../etsy/copy-style.ts'
import { etsyCall } from './etsy-api.ts'

interface EditBinding { id: string; revision: number; imageId?: string; baseCopy: string; factsRevision: number; perImage: boolean }
const displayCopy = (copy?: EtsyCopy): EtsyCopy | undefined => copy ? { ...structuredClone(copy), titles: copy.titles.map(row => ({ ...row, ...normalizeTitleLanguages(row.title, row.titleZh ?? '') })), description: formatProductDescription(copy.description) } : undefined

// 两个编辑入口共用同一保存语义：绑定开始编辑时的图片和原稿，串行提交更新。
export function useCopyEditor(product: EtsyProduct | undefined, onSaved: (product: EtsyProduct) => void) {
  const [draft, setDraft] = useState<EtsyCopy>(), [dirty, setDirty] = useState(false), [saveState, setSaveState] = useState('已保存'), [hasBackup, setHasBackup] = useState(false)
  const draftRef = useRef<EtsyCopy>(), dirtyRef = useRef(false), binding = useRef<EditBinding>(), version = useRef(0)
  const saving = useRef<Promise<boolean>>(), productRef = useRef(product), onSavedRef = useRef(onSaved)
  productRef.current = product; onSavedRef.current = onSaved
  const load = (value?: EtsyProduct): void => {
    const source = selectedCopy(value)
    const next = displayCopy(source)
    draftRef.current = next; setDraft(next)
    binding.current = value && source ? { id: value.id, revision: value.revision, imageId: value.selectedImageId ?? value.copyImageId, baseCopy: JSON.stringify(source), factsRevision: value.factsRevision ?? 1, perImage: value.copyMode === 'per-image' } : undefined
    try { setHasBackup(!!binding.current && !!localStorage.getItem(backupKey(binding.current))) } catch { setHasBackup(false) }
  }
  useEffect(() => { if (!dirtyRef.current) load(product) }, [product])
  const change = (patch: Partial<EtsyCopy>): void => {
    if (!draftRef.current || !binding.current) return
    version.current++; dirtyRef.current = true; setDirty(true); setSaveState('有未保存修改')
    draftRef.current = { ...draftRef.current, ...patch }; setDraft(draftRef.current)
  }
  const save = (): Promise<boolean> => {
    if (saving.current) return saving.current
    if (!dirtyRef.current || !draftRef.current || !binding.current) return Promise.resolve(true)
    const operation = async (): Promise<boolean> => {
      while (dirtyRef.current && draftRef.current && binding.current) {
        const target = { ...binding.current }, patch = structuredClone(draftRef.current), submittedVersion = version.current
        setSaveState('保存中…')
        try {
          const next = await etsyCall<EtsyProduct>('edit', { id: target.id, revision: target.revision, patch, ...(target.perImage ? { imageId: target.imageId, baseCopy: target.baseCopy, factsRevision: target.factsRevision } : {}) })
          const committed = target.perImage && target.imageId ? next.imageCopies?.[target.imageId]?.copy : next.copy
          if (!committed) throw new Error('保存结果缺少当前图片的文案，请保留草稿重试')
          binding.current = { ...target, revision: next.revision, baseCopy: JSON.stringify(committed), factsRevision: next.factsRevision ?? 1 }
          productRef.current = next
          onSavedRef.current(next)
          if (submittedVersion === version.current) {
            dirtyRef.current = false; setDirty(false); setSaveState('已保存'); load(next)
          }
        } catch (caught) {
          setSaveState('尚未保存：' + (caught instanceof Error ? caught.message : '请重试'))
          return false
        }
      }
      return true
    }
    saving.current = operation().finally(() => { saving.current = undefined })
    return saving.current
  }
  useEffect(() => {
    if (!dirty) return
    const timer = window.setTimeout(() => { void save() }, 900)
    return () => clearTimeout(timer)
  }, [draft, dirty])
  const reset = (): void => { dirtyRef.current = false; setDirty(false); setSaveState('已保存'); load(undefined) }
  const committedCopy = (imageId?: string): EtsyCopy | undefined => {
    const value = productRef.current
    return displayCopy(imageId && value?.copyMode === 'per-image' ? value.imageCopies?.[imageId]?.copy : value?.copy)
  }
  const reloadKeepingDraft = async (): Promise<void> => {
    const target = binding.current
    if (!target || !draftRef.current || saving.current) return
    try {
      // 先持久保存草稿；备份失败时不离开编辑，避免静默丢失输入。
      localStorage.setItem(backupKey(target), JSON.stringify(draftRef.current))
      const next = await etsyCall<EtsyProduct>('get', { id: target.id })
      dirtyRef.current = false; setDirty(false); productRef.current = next; onSavedRef.current(next); load(next)
      setSaveState('本地草稿已保留，已载入最新文案')
    } catch (caught) { setSaveState('尚未保存：' + (caught instanceof Error ? caught.message : '载入失败，草稿仍保留')) }
  }
  const restoreBackup = (): void => {
    const target = binding.current
    if (!target) return
    try {
      const raw = localStorage.getItem(backupKey(target))
      if (!raw) return
      const saved = JSON.parse(raw) as EtsyCopy
      if (!Array.isArray(saved.titles) || typeof saved.description !== 'string' || !Array.isArray(saved.tags)) throw new Error('草稿格式无法读取')
      // 只在员工主动恢复时使用当前原稿作为编辑基线，不自动覆盖别人的修改。
      version.current++; dirtyRef.current = true; setDirty(true); draftRef.current = saved; setDraft(saved); setSaveState('已恢复本地草稿，请核对后保存')
    } catch (caught) { setSaveState(caught instanceof Error ? caught.message : '草稿读取失败') }
  }
  const editImageId = dirty && binding.current?.id === product?.id ? binding.current?.imageId : undefined
  return { draft, dirty, dirtyRef, saveState, setSaveState, change, save, reset, committedCopy, editImageId, hasBackup, reloadKeepingDraft, restoreBackup }
}

const backupKey = (binding: EditBinding): string => `etsy-copy-backup:${binding.id}:${binding.imageId ?? 'legacy'}`

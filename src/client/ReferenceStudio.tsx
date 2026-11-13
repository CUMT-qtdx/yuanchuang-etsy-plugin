import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PLUGIN_VERSION, type ChannelConfig, type GenerateRequest } from '../protocol.ts'
import { ETSY_API, type EtsyCopy, type EtsyProduct, type ProductFacts, type ProductImage, type ProductType, type CreationTask } from '../etsy/types.ts'
import { etsyCall, EtsyRouteError } from './etsy-api.ts'
import { readLocalNames, writeLocalName, clearLocalName, withLocalName } from './creation-names.ts'
import { useCopyEditor } from './useCopyEditor.ts'
import { listingText } from '../etsy/listing-text.ts'
import { creativityOptions, creativityMode, referenceGenerationPrompt } from '../etsy/design-strategy.ts'
import { DesignReferences, type ReferenceDraft } from './DesignReferences.tsx'
import { PhotographyControls } from './PhotographyControls.tsx'
import { REFERENCE_RESOLUTION_KEY, referenceResolution, referenceResolutions, referenceModelOnly1K, referenceResolutionIssue, type ReferenceResolution } from './reference-resolution.ts'
import { CURRENT_MATERIAL } from '../etsy/felt/material-v1-0-2.ts'
import { defaultPhotography, normalizePhotography, type PhotographySettings } from '../etsy/felt/photography-options.ts'
import { FinalDesignPanel } from './FinalDesignPanel.tsx'
import { creationTasks, viewAngles } from '../etsy/creation-flow.ts'
import { CreationHistory } from './CreationHistory.tsx'
import { CreationImageViewer, type CreationPreviewImage } from './CreationImageViewer.tsx'
import { AutoSizeTextarea } from './AutoSizeTextarea.tsx'
import { StudioModelPanel } from './StudioModelPanel.tsx'
import type { ModelPickerValue } from './ModelPicker.tsx'
import { imageCopyStage, productStages } from '../etsy/selected-copy.ts'
import { listingUsesEnglish } from '../etsy/copy-style.ts'
import css from './reference-studio.module.css'

const blank: ProductFacts = { name: '', type: 'unspecified', requirements: '', materials: '', dimensions: '', packaging: '', processing: '', delivery: '', personalization: '', confirmed: false, authenticityConfirmed: false }
const newProjectKey = '__new__'
const stageText: Record<string, string> = { queued: '等待中', running: '生成中', completed: '已完成', failed: '未成功', unknown: '需核对', cancelled: '已取消', skipped: '未执行' }
const asset = (product: EtsyProduct, file: string): string => `${ETSY_API}/image?id=${encodeURIComponent(product.id)}&file=${encodeURIComponent(file)}`
async function asDataUrl(blob: Blob): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('图片读取失败')); reader.readAsDataURL(blob) }) }
export function ReferenceStudio(props: { request: () => GenerateRequest; channels?: readonly ChannelConfig[]; onAdvanced: () => void; historyHost?: HTMLElement | null; onModelsSaved?: (image: ModelPickerValue) => Promise<void> }): React.JSX.Element {
  const [facts, setFacts] = useState<ProductFacts>(() => { try { return { ...blank, ...JSON.parse(localStorage.getItem('etsy-reference-facts') || '{}') } } catch { return blank } })
  const [referenceDraft, setReferenceDraft] = useState<ReferenceDraft[]>(), [notes, setNotes] = useState('')
  const [count, setCount] = useState(4), [task, setTask] = useState<CreationTask>('redesign'), [copyTiming, setCopyTiming] = useState<'all' | 'selected'>('selected')
  const [resolution, setResolution] = useState<ReferenceResolution>(() => {
    try { return referenceResolution(localStorage.getItem(REFERENCE_RESOLUTION_KEY), referenceResolution(props.request().quality)) }
    catch { return '2k' }
  })
  const currentRequest = props.request()
  const currentChannel = props.channels?.find(channel => channel.id === currentRequest.channelId)
  const wireModel = currentChannel?.models.find(model => model.alias === currentRequest.model)?.id ?? currentRequest.upstream ?? currentRequest.model
  const only1K = referenceModelOnly1K(wireModel)
  const resolutionIssue = referenceResolutionIssue({ ...currentRequest, quality: resolution }, props.channels)
  useEffect(() => { try { localStorage.setItem(REFERENCE_RESOLUTION_KEY, resolution) } catch { /* 存储不可用时，本页选择仍生效。 */ } }, [resolution])
  useEffect(() => { if (only1K && resolution !== '1k') setResolution('1k') }, [only1K, resolution])
  const [photography, setPhotography] = useState<PhotographySettings>(() => { const defaults = defaultPhotography(); try { const size = props.request().size; return { ...defaults, aspect_ratio: size !== 'auto' ? size : defaults.aspect_ratio } } catch { return defaults } })
  const photoTouched = useRef(false)
  const generationRequest = (): GenerateRequest => ({ ...props.request(), quality: resolution, size: photography.aspect_ratio, photography, materialPreset: CURRENT_MATERIAL })
  const [creativity, setCreativity] = useState('balanced'), [autoCheck, setAutoCheck] = useState(true), [maxCalls, setMaxCalls] = useState(100)
  const [products, setProducts] = useState<EtsyProduct[]>([]), [id, setId] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [nameNotice, setNameNotice] = useState('')
  const [instruction, setInstruction] = useState(''), [tab, setTab] = useState<'titles' | 'description' | 'tags'>('titles')
  const [editing, setEditing] = useState(false), [actionBusy, setActionBusy] = useState(false)
  const [imagePreview, setImagePreview] = useState<{ images: CreationPreviewImage[]; index: number }>()
  const [modelSaving, setModelSaving] = useState(false)
  const currentId = useRef(''), lock = useRef(false), requestKey = useRef(''), restoreRecent = useRef(true)
  const deletedProjects = useRef(new Set<string>()), namesSynced = useRef(false)
  const storedProduct = products.find(product => product.id === id)
  const accept = (value: EtsyProduct): void => { const merged = withLocalName(value); setProducts(previous => [merged, ...previous.filter(product => product.id !== merged.id)]) }
  const editor = useCopyEditor(storedProduct, accept)
  const { draft: copy, dirtyRef: dirty, saveState, setSaveState, save: saveCopy } = editor
  // 编辑中锁定本页的图片，远端选择变化不会把旧草稿显示在另一张图旁。
  const editingImage = storedProduct?.images.find(image => image.id === editor.editImageId)
  const product = editingImage && storedProduct ? { ...storedProduct, selectedImageId: editingImage.id, copyImageId: editingImage.id, copyStage: editingImage.copyStage ?? storedProduct.copyStage } : storedProduct
  const productRef = useRef(product); productRef.current = product
  const chosen = product?.images.find(image => image.id === product.selectedImageId) ?? product?.images.find(image => image.generation.status === 'completed')
  // 切换图片或重开项目时，以当前版本的摄影快照为准，避免继续精修时退回初始背景。
  useEffect(() => {
    if (chosen) {
      setPhotography(normalizePhotography(chosen.visualRules?.photography ?? product?.photography, defaultPhotography(product?.creationTask, true)))
      setResolution(only1K ? '1k' : referenceResolution(chosen.renderSettings?.quality ?? product?.request.quality))
    }
  }, [chosen?.id, product?.id, only1K])
  const references: ReferenceDraft[] = referenceDraft ?? product?.referenceFiles.map((file, index) => ({ src: asset(product, file), name: `参考图${index + 1}`, role: product.designReferences?.[index]?.role ?? (index === 0 ? 'subject' : 'detail'), note: product.designReferences?.[index]?.note ?? '' })) ?? []
  const minimumCalls = 1 + count * (1 + (autoCheck ? 1 : 0) + (copyTiming === 'all' ? 1 : 0))
  useEffect(() => { try { localStorage.setItem('etsy-reference-facts', JSON.stringify(facts)) } catch { /* 模板保存失败不影响宿主结果。 */ } }, [facts])
  useEffect(() => {
    let disposed = false, refreshing = false, firstRefresh = true
    try {
      const stored = localStorage.getItem('etsy-reference-current')
      restoreRecent.current = stored === null
      currentId.current = stored && stored !== newProjectKey ? stored : ''; setId(currentId.current)
      if (stored === newProjectKey) setFacts({ ...blank })
    } catch { /* 使用宿主项目列表恢复。 */ }
    const refresh = async (): Promise<void> => {
      if (refreshing) return
      refreshing = true
      try {
        const localNames = readLocalNames()
        const list = (await etsyCall<EtsyProduct[]>('list')).filter(product => !deletedProjects.current.has(product.id)).map(product => withLocalName(product, localNames))
        if (disposed) return
        setProducts(list)
        // 宿主重启后第一次刷新时，把因旧路由缺失而暂存在本机的名称写回创作档案。
        if (!namesSynced.current) {
          namesSynced.current = true
          if (Object.keys(localNames).length) void (async () => {
            for (const [projectId, name] of Object.entries(localNames)) {
              if (!list.some(item => item.id === projectId)) continue
              try { await etsyCall('rename', { id: projectId, name }); clearLocalName(projectId); setNameNotice('') }
              catch { /* 路由仍不可用，继续保留本机名称。 */ }
            }
          })()
        }
        if (restoreRecent.current) {
          restoreRecent.current = false
          const recent = list.find(product => product.source === 'reference')
          if (recent) { currentId.current = recent.id; setId(recent.id); setFacts(structuredClone(recent.facts)); setCreativity(recent.creativity ?? 'balanced') }
        }
        const active = list.find(product => product.id === currentId.current)
        if (firstRefresh && active) { setFacts(structuredClone(active.facts)); setCreativity(active.creativity ?? 'balanced'); setTask(active.creationTask ?? 'redesign'); setCount(active.referencePlan?.plans.length ?? 4); setCopyTiming(active.copyTiming ?? 'all'); setResolution(only1K ? '1k' : referenceResolution(active.images.find(image => image.id === active.selectedImageId)?.renderSettings?.quality ?? active.request.quality)); setPhotography(normalizePhotography(active.photography, defaultPhotography(active.creationTask, true))); photoTouched.current = !!active.photography }
        firstRefresh = false
      } catch (caught) { if (!disposed) setError(caught instanceof Error ? caught.message : '项目读取失败') }
      finally { refreshing = false }
    }
    void refresh(); const timer = window.setInterval(() => { void refresh() }, 1000)
    return () => { disposed = true; clearInterval(timer) }
  }, [])
  const selectProject = (next: string): void => {
    if (dirty.current) { setError('文案还有未保存修改，请先保存'); return }
    restoreRecent.current = false
    currentId.current = next; setId(next); setReferenceDraft(undefined); setError(''); setEditing(false); setInstruction(''); setNotes(''); setTab('titles'); setSaveState('已保存'); requestKey.current = ''
    editor.reset(); const record = products.find(product => product.id === next)
    setFacts(record ? structuredClone(record.facts) : { ...blank }); setCreativity(record?.creativity ?? 'balanced'); setTask(record?.creationTask ?? 'redesign'); setCount(record?.referencePlan?.plans.length ?? 4); setCopyTiming(record?.copyTiming ?? (record ? 'all' : 'selected')); setPhotography(normalizePhotography(record?.photography, defaultPhotography(record?.creationTask, !!record))); photoTouched.current = !!record?.photography
    if (record) setResolution(only1K ? '1k' : referenceResolution(record.images.find(image => image.id === record.selectedImageId)?.renderSettings?.quality ?? record.request.quality))
    try { localStorage.setItem('etsy-reference-current', next || newProjectKey) } catch { /* 项目本身已保存。 */ }
  }
  const deleteProject = async (projectId: string): Promise<void> => {
    if (dirty.current) throw new Error('请先保存文案修改，再删除创作')
    await etsyCall('delete', { id: projectId })
    clearLocalName(projectId)
    deletedProjects.current.add(projectId)
    setProducts(previous => previous.filter(product => product.id !== projectId))
    if (currentId.current === projectId) selectProject('')
  }
  // 只改列表显示名：优先走后端 rename，复用返回的整份项目，避免本地拼装丢失图片与文案状态。
  // 宿主仍是旧路由表时，先落在本机，重启后由首次刷新自动同步。
  const renameProject = async (projectId: string, name: string): Promise<void> => {
    try {
      const next = await etsyCall<EtsyProduct>('rename', { id: projectId, name })
      clearLocalName(projectId)
      accept(next)
      setNameNotice('')
      return
    } catch (caught) {
      if (!(caught instanceof EtsyRouteError)) throw caught
      writeLocalName(projectId, name)
      setProducts(previous => previous.map(item => item.id === projectId ? { ...item, displayName: name } : item))
      setNameNotice('名称已在本机生效；完全重启宿主后会自动同步到创作档案。')
    }
  }
  const create = async (): Promise<void> => {
    if (lock.current || dirty.current || modelSaving) return
    if (resolutionIssue) { setError(resolutionIssue); return }
    lock.current = true; setBusy(true); setError('')
    if (!requestKey.current) requestKey.current = `reference-${crypto.randomUUID()}`
    try {
      if (!references.length) throw new Error('请先上传参考图片')
      if (!Number.isInteger(maxCalls) || maxCalls < minimumCalls) throw new Error(`当前设置至少需要 ${minimumCalls} 次调用额度`)
      const referenceInputs = await Promise.all(references.map(async (reference, index) => {
        let dataUrl = reference.src
        if (!dataUrl.startsWith('data:')) { const response = await fetch(dataUrl); if (!response.ok) throw new Error('参考图读取失败'); dataUrl = await asDataUrl(await response.blob()) }
        return { dataUrl, role: index === 0 ? 'subject' : reference.role, note: reference.note }
      }))
      const next = await etsyCall<EtsyProduct>('reference', { requestKey: requestKey.current, references: referenceInputs, count, creationTask: task, photography, copyTiming, facts, notes, creativity, maxCalls, autoCheck, generation: generationRequest(), ...(product ? { previousProjectId: product.id } : {}) })
      restoreRecent.current = false; currentId.current = next.id; setId(next.id); setReferenceDraft(undefined); accept(next); editor.reset(); setEditing(false); requestKey.current = ''
      try { localStorage.setItem('etsy-reference-current', next.id) } catch { /* 不影响宿主保存。 */ }
    } catch (caught) { setError(caught instanceof Error ? caught.message : '提交失败') }
    finally { lock.current = false; setBusy(false) }
  }
  const action = async (name: string, body: Record<string, unknown> = {}, onError?: (message: string) => void): Promise<boolean> => {
    if (body.generation && (name === 'revise' || name === 'generate-views' || name === 'retry' && body.stage === 'generation')) {
      const issue = referenceResolutionIssue(body.generation as GenerateRequest, props.channels)
      if (issue) { setError(issue); onError?.(issue); return false }
    }
    const current = productRef.current
    if (!current || lock.current) { onError?.('正在处理上一个操作，请稍候'); return false }
    if (dirty.current) { const message = '请先保存当前文案修改'; setError(message); onError?.(message); return false }
    if (name === 'retry' && body.stage !== 'generation' && body.confirmUnknown !== true) {
      const image = current.images.find(item => item.id === body.imageId)
      const stage = body.stage === 'quality' ? image?.quality : image?.copyStage ?? current.copyStage
      if (stage?.status === 'unknown') { if (!window.confirm('上次请求结果不明，重新准备会增加一次调用，继续吗？')) return false; body = { ...body, confirmUnknown: true } }
    }
    lock.current = true; setActionBusy(true)
    try { setError(''); accept(await etsyCall<EtsyProduct>(name, { id: current.id, ...body })); return true }
    catch (caught) { const message = caught instanceof Error ? caught.message : '操作失败'; setError(message); onError?.(message); return false }
    finally { lock.current = false; setActionBusy(false) }
  }
  const changeCopy = (patch: Partial<EtsyCopy>): void => {
    const active = productRef.current
    if (active && (active.copyStage.status === 'running' || (active.copyImageId && active.selectedImageId && active.copyImageId !== active.selectedImageId))) { setError('当前方案文案尚未完成，请稍候'); return }
    editor.change(patch)
  }
  const copyText = async (): Promise<void> => {
    if (!copy) return
    const imageId = chosen?.id
    if (!await saveCopy()) return
    const committed = editor.committedCopy(imageId)
    if (!committed) return
    try { await navigator.clipboard.writeText(listingText(committed)); setSaveState('已复制') }
    catch { setError('复制失败，可选中文字后复制') }
  }
  const exportCurrent = async (): Promise<void> => {
    const current = productRef.current, imageId = chosen?.id
    if (!current || !await saveCopy()) return
    const link = document.createElement('a')
    link.href = `${ETSY_API}/export?id=${encodeURIComponent(current.id)}${imageId ? `&imageId=${encodeURIComponent(imageId)}` : ''}`
    link.download = `etsy-${current.id}.zip`; link.click()
  }
  const retryImage = async (image: ProductImage): Promise<void> => {
    const confirmUnknown = image.generation.status === 'unknown'
    if (confirmUnknown && !window.confirm('上次生图结果不明。重新生成会增加一次调用，继续吗？')) return
    await action('retry', { stage: 'generation', imageId: image.id, confirmUnknown, generation: generationRequest() })
  }
  const updateFacts = async (): Promise<void> => {
    if (!product) return
    if (dirty.current) { setError('请先保存当前文案修改'); return }
    try { const latest = await etsyCall<EtsyProduct>('get', { id: product.id }); const confirmed = { ...facts, name: facts.name.trim() || latest.facts.name, requirements: latest.facts.requirements }; const next = await etsyCall<EtsyProduct>('facts', { id: product.id, facts: confirmed, revision: latest.revision }); accept(next); if (!next.cancelled && next.copyMode !== 'per-image') await action('retry', { stage: 'copy', imageId: chosen?.id }) }
    catch (caught) { setError(caught instanceof Error ? caught.message : '商品资料保存失败') }
  }
  const cards = product ? product.images.filter(image => image.kind !== 'view').map((image, index) => {
    const plan = product.referencePlan?.plans.find(plan => plan.id === image.planId)
      ?? { id: image.planId ?? image.id, name: `方案 ${index + 1}`, direction: '', changes: [] as string[], prompt: '' }
    const planIndex = product.referencePlan?.plans.findIndex(value => value.id === plan.id) ?? index
    return { plan, image: image as ProductImage | undefined, index: planIndex >= 0 ? planIndex : index }
  }) : Array.from({ length: count }, (_, index) => { const directions = (creativityOptions.find(option => option.value === creativity) ?? creativityOptions[1]).directions; const direction = directions[index % directions.length]; return { plan: { id: `plan-${index + 1}`, name: `${direction}${index >= 4 ? ' · 延伸' : ''}`, direction, changes: [] as string[], prompt: '' }, image: undefined as ProductImage | undefined, index } })
  const previewEntries: CreationPreviewImage[] = product ? [...cards, ...product.images.filter(image => image.kind === 'view').map((image, index) => ({ image, index, plan: { name: viewAngles.find(angle => angle.value === image.angle)?.label ?? '角度图' } }))].flatMap(({ plan, image, index }) => image?.files.map((file, fileIndex) => ({
    id: `${image.id}:${file}`, src: asset(product, file), title: `${plan.name} · ${image.parentImageId ? `修改版 ${image.version ?? 2}` : '初始方案'}${image.files.length > 1 ? ` · 第 ${fileIndex + 1} 张` : ''}`,
    downloadName: `${product.displayName?.trim() || product.facts.name}_${plan.name}_方案${index + 1}_版本${image.version ?? 1}_${fileIndex + 1}`.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 110).replace(/[. ]+$/g, '') + `.${file.split('.').at(-1)}`,
  })) ?? []) : []
  const openImage = (imageId: string): void => {
    const index = previewEntries.findIndex(entry => entry.id.startsWith(`${imageId}:`))
    if (index >= 0) setImagePreview({ images: previewEntries, index })
  }
  const staleCopy = !!product?.copyImageId && chosen?.id !== product.copyImageId
  const updatingCopy = product?.copyStage.status === 'running' || product?.copyStage.status === 'queued'
  const activeTask = product && productStages(product).some(stage => ['queued', 'running'].includes(stage.status))
  const copiesReady = product?.images.filter(image => image.kind !== 'view' && image.files.length && imageCopyStage(product, image).status === 'completed' && !product.imageCopies?.[image.id]?.copy.fieldIssues?.length && (product.imageCopies?.[image.id]?.factsRevision ?? product.copyFactsRevision ?? 1) === (product.factsRevision ?? 1)).length ?? 0
  const missingCopies = product?.images.filter(image => image.kind !== 'view' && image.files.length && !['completed', 'queued', 'running'].includes(imageCopyStage(product, image).status)).length ?? 0
  const storedSelectedCopy = chosen && product ? product.imageCopies?.[chosen.id]?.copy ?? (product.copyImageId === chosen.id ? product.copy : undefined) : undefined
  const languageNeedsUpdate = !!storedSelectedCopy && !listingUsesEnglish(storedSelectedCopy)
  const copyError = product?.copyStage.error && /商品事实：(name|id|designName|direction|changes)$/.test(product.copyStage.error) ? '旧版文案尚未按新规则准备。请点击下方「准备当前文案」，图片已保留。' : product?.copyStage.error
  const readyCopy = !!product?.selectionConfirmed && product.facts.confirmed && product.facts.type !== 'unspecified' && (product.facts.type !== 'physical_felt' || product.facts.authenticityConfirmed)
  const copyEmpty = !product ? '先探索设计，选定主图后准备标题和文案。'
    : languageNeedsUpdate && !updatingCopy ? '这张图的旧稿需要整理，可重新准备或保留原稿。'
    : product.copyStage.status === 'failed' ? '文案未完成，图片和版本已保留。请根据上方原因处理后重试。'
    : product.copyStage.status === 'unknown' ? '上次文案请求结果不明，请先核对，避免连续重试。'
    : product.copyStage.status === 'cancelled' ? '文案任务已取消，已有图片仍可查看。'
    : product.copyStage.status === 'skipped' ? chosen ? '当前图片尚未准备文案，可点击下方按钮准备。' : '本次未启动文案，请先处理图片或分析阶段的问题。'
    : product.copyStage.status === 'running' ? '正在为当前图片准备文案，请稍候…' : '当前图片的文案正在等待准备，准备好后会自动出现。'
  const history = <CreationHistory products={products} selectedId={id} disabled={busy} notice={nameNotice} onSelect={selectProject} onDelete={deleteProject} onRename={renameProject} />
  return <div className={css.studio} data-reference-studio="" data-current-project={id || 'new'}>
    {imagePreview ? <CreationImageViewer images={imagePreview.images} index={imagePreview.index} onIndex={index => setImagePreview(current => current ? { ...current, index } : undefined)} onClose={() => setImagePreview(undefined)} /> : null}
    <header className={css.header}><div className={css.brand}><strong>元创 Etsy Studio</strong><small data-studio-version="">{PLUGIN_VERSION}</small></div><div className={css.actions}><button type="button" onClick={props.onAdvanced}>高级工具</button></div></header>
    {props.historyHost ? createPortal(history, props.historyHost) : null}
    <div className={css.workspace}>
    {!props.historyHost ? <aside className={css.historyFallback}>{history}</aside> : null}
    <div className={css.scroll}>
      <StudioModelPanel request={props.request} onSaved={props.onModelsSaved} onSaving={setModelSaving} />
      <section className={css.workbench} aria-label="参考图与创作设置">
        <div className={css.stage}>
        <DesignReferences value={references} onChange={value => { setReferenceDraft(value); requestKey.current = '' }} onError={setError} />
      {error ? <p className={css.error} role="alert">{error}</p> : null}
      {product?.planning ? <div className={css.progress} role="status"><span>{product.planning.status === 'completed' ? `✓ 已完成参考图分析与${product.referencePlan?.plans.length ?? count}方案规划` : product.planning.status === 'running' || product.planning.status === 'queued' ? `正在理解参考图并规划${product.images.filter(image => image.kind !== 'view').length}个方向…` : `参考图分析${stageText[product.planning.status]}`}</span>{product.planning.error ? <span className={css.error}>{product.planning.error}</span> : null}<span>{product.images.filter(image => image.generation.status === 'completed').length} 张图片已保存 · {copiesReady} 份图文已就绪</span>{activeTask ? <button type="button" onClick={() => { void action('cancel') }}>停止未完成任务</button> : null}</div> : null}
        <section><div className={css.sectionHeading}><h3>{product ? `设计探索（${product.images.filter(image => image.kind !== 'view' && image.files.length).length}）${product.round ? ` · 第${product.round}轮` : ''}` : `${count}个设计方案`}</h3><small>选中设计后可继续精修或确定主设计</small></div><div className={css.grid}>
          {cards.map(({ plan, image, index }) => {
            const pending = image?.generation.status === 'running'
            const selected = !!image && chosen?.id === image.id
            const copyState = product && image ? imageCopyStage(product, image) : undefined
            const oldQuality = !!image?.report && (image.qualityFactsRevision ?? 1) !== (product?.factsRevision ?? 1)
            return <article className={css.design} key={image?.id ?? plan.id} data-design-plan={plan.id} data-creation-image={image?.id ?? plan.id} data-selected={selected ? 'true' : undefined}>
              <div className={css.designImage}>{image?.files[0] && product ? <button type="button" className={css.previewTrigger} aria-label={`查看大图：${plan.name}`} onClick={() => openImage(image.id)}><img src={asset(product, image.files[0])} alt={`设计方案 ${index + 1}`} /><span className={css.previewHint}>点击查看大图</span></button> : <div className={css.placeholder}><span>0{index + 1}</span><small>{product ? product.planning?.status === 'running' ? '正在规划' : stageText[image?.generation.status ?? 'queued'] : '等待你的参考图'}</small></div>}{pending ? <span className={css.working}>正在生成新版本…</span> : null}{image?.report ? <span className={css.quality} data-quality={image.report.status}>{oldQuality ? '旧资料检查' : image.report.status === 'PASS' ? '可用建议' : image.report.status === 'REVISE' ? '建议修改' : image.report.status === 'REJECT' ? '需重点复核' : '待确认'}</span> : null}</div>
              <div className={css.designBody}><h4>{plan.name}</h4><span className={css.versionLabel}>{image?.parentImageId ? `修改版 · 版本 ${image.version ?? 2}` : '初始方案'}</span>{image?.files.length ? <span className={css.copyState} data-image-copy-state={copyState?.status}>{copyState?.status === 'completed' ? product?.imageCopies?.[image!.id]?.copy.fieldIssues?.length ? '部分文案待补齐' : '✓ 图文已就绪' : copyState?.status === 'failed' ? '文案未完成' : copyState?.status === 'unknown' ? '文案需核对' : copyState?.status === 'cancelled' ? '文案已停止' : copyState?.status === 'skipped' ? '可按需准备文案' : '图片已保存 · 文案准备中'}</span> : null}{image?.generation.error ? <p className={css.error}>{image.generation.error}</p> : null}<button type="button" className={selected ? css.selectedButton : ''} disabled={!image?.files.length || actionBusy || editor.dirty} onClick={() => { if (image) void action('select', { imageId: image.id }) }}>{selected ? '✓ 当前图片' : image?.parentImageId ? `选择修改版 ${index + 1} · 版本 ${image.version ?? 2}` : `选择方案 ${index + 1}`}</button>
              {image && ['failed', 'cancelled', 'unknown'].includes(image.generation.status) ? <button type="button" disabled={actionBusy} onClick={() => { void retryImage(image) }}>{image.generation.status === 'unknown' ? '确认后重新生成' : '重试这张图'}</button> : null}
              {image?.files[0] && product ? <div className={css.imageActions}><button type="button" onClick={() => openImage(image.id)}>查看大图</button><a href={asset(product, image.files[0])} download={previewEntries.find(entry => entry.id === `${image.id}:${image.files[0]}`)?.downloadName}>下载原图</a></div> : null}
              {plan.direction || image?.editInstruction ? <details className={css.report}><summary>{image?.parentImageId ? '查看修改说明' : '查看设计说明'}</summary><p>{image?.editInstruction || plan.direction}</p>{!image?.parentImageId && plan.changes.length ? <small>{plan.changes.join(' · ')}</small> : null}</details> : null}
              {image?.report ? <details className={css.report}><summary>检查建议</summary>{oldQuality ? <small>资料已更新，以下检查对应旧资料。</small> : null}<p>{image.report.summary}</p>{image.report.issues.map((issue, i) => <div key={i}><strong>{issue.problem}</strong><p>{issue.suggestion}</p></div>)}{image.report.uncertainties.map((text, i) => <small key={i}>{text}</small>)}</details> : image?.quality.error ? <details className={css.report}><summary>检查暂未完成</summary><p>{image.quality.error}</p></details> : null}
              </div>
            </article>
          })}
        </div><section className={css.modify}><div><h3>继续修改当前方案</h3><small>{chosen ? '只需说清楚想改什么，原图和每轮版本都会保留。' : '先选择一张生成成功的设计。'}</small></div><div className={css.editRow}><input aria-label="修改要求" value={instruction} onChange={event => setInstruction(event.target.value)} placeholder="例如：把围巾换成蓝色，其他保持不变" /><button type="button" disabled={!chosen || modelSaving || actionBusy || !instruction.trim() || !!product?.pendingSelection} onClick={() => { const submitted = instruction; void action('revise', { instruction: submitted, imageId: chosen?.id, generation: generationRequest() }).then(success => { if (success) setInstruction(current => current === submitted ? '' : current) }) }}>修改这张图</button></div></section>{product && chosen?.files.length ? <FinalDesignPanel key={`${product.id}:${chosen.id}`} product={product} chosen={chosen} busy={actionBusy || modelSaving || editor.dirty} request={generationRequest} action={action} preview={openImage} /> : null}</section>
        <aside className={css.copyPanel} data-reference-copy=""><div className={css.sectionHeading}><h3>{readyCopy ? '当前商品文案' : '标题与文案'}</h3><small>{updatingCopy ? '正在为当前选择更新…' : staleCopy ? '当前方案文案待更新' : saveState}</small></div><p className={css.caption}>文案跟随选中的设计。商品资料未确认时保持草稿。</p><div className={css.tabs} role="tablist" aria-label="商品文字内容">{(['titles', 'description', 'tags'] as const).map(key => <button key={key} type="button" role="tab" aria-selected={tab === key} data-active={tab === key ? 'true' : undefined} onClick={() => setTab(key)}>{key === 'titles' ? '标题' : key === 'description' ? '商品文案' : '标签'}</button>)}</div>
          {copyError ? <p className={css.error}>{copyError}</p> : null}{copy?.fieldIssues?.length ? <p className={css.caption} data-copy-field-issues="">{copy.fieldIssues.filter(issue => issue.field.startsWith(tab === 'titles' ? 'title' : tab === 'tags' ? 'tags' : 'description')).map(issue => issue.message).join('；')}</p> : null}
          {!copy ? <div className={css.copyEmpty} data-copy-state={product?.copyStage.status ?? 'empty'}>{copyEmpty}</div> : <div className={updatingCopy || staleCopy ? css.updating : ''}>
            {tab === 'titles' ? <div>{copy.titles.map((title, index) => <div className={css.title} key={index}><label><span><input type="radio" name="reference-title" checked={copy.selectedTitle === index} disabled={!!updatingCopy || !title.title.trim()} onChange={() => changeCopy({ selectedTitle: index })} />英文标题 {index + 1} · {[...title.title].length}/140</span>{editing ? <AutoSizeTextarea aria-label={`英文标题 ${index + 1}`} className={css.titleEditor} minRows={2} value={title.title} disabled={!!updatingCopy} onChange={event => changeCopy({ titles: copy.titles.map((item, i) => i === index ? { ...item, title: event.target.value, titleZh: '' } : item) })} /> : <strong data-title-index={index}>{title.title || '此标题待补齐，可编辑填写'}</strong>}</label><div className={css.translation}><span>中文译名</span>{editing ? <AutoSizeTextarea aria-label={`中文译名 ${index + 1}`} minRows={2} value={title.titleZh ?? ''} disabled={!!updatingCopy} onChange={event => changeCopy({ titles: copy.titles.map((item, i) => i === index ? { ...item, titleZh: event.target.value } : item) })} /> : <p data-title-translation={index}>{title.titleZh || '中文译名待补齐'}</p>}</div><small>{title.explanationZh}</small></div>)}</div> : null}
            {tab === 'description' ? editing ? <AutoSizeTextarea aria-label="英文商品文案" className={css.description} minRows={12} value={copy.description} disabled={!!updatingCopy} onChange={event => changeCopy({ description: event.target.value })} /> : <div className={css.description} data-copy-description="">{copy.description}</div> : null}
            {tab === 'tags' ? editing ? <AutoSizeTextarea aria-label="SEO 标签" className={css.tagsEditor} minRows={7} value={copy.tags.join('\n')} disabled={!!updatingCopy} onChange={event => changeCopy({ tags: event.target.value.split('\n') })} /> : <div className={css.tags}>{copy.tags.map(tag => <span key={tag}>{tag}</span>)}</div> : null}
            <div className={css.actions}><button type="button" disabled={!!updatingCopy || staleCopy} onClick={() => { void copyText() }}>复制整套文案</button><button type="button" disabled={!!updatingCopy || staleCopy} onClick={() => setEditing(value => !value)}>{editing ? '收起编辑' : '编辑文字'}</button>{dirty.current ? <button type="button" onClick={() => { void saveCopy() }}>保存修改</button> : null}{saveState.startsWith('尚未保存') ? <button type="button" onClick={() => { void editor.reloadKeepingDraft() }}>保留草稿并载入最新</button> : null}{editor.hasBackup && !editor.dirty ? <button type="button" onClick={() => { editor.restoreBackup(); setEditing(true) }}>恢复本地草稿</button> : null}</div><details className={css.report}><summary>待确认的商品信息</summary>{copy.humanConfirmation.map((text, index) => <p key={index}>{text}</p>)}</details>
          </div>}
          {product ? <div className={css.copyFooter}><a href={`${ETSY_API}/export?id=${encodeURIComponent(product.id)}`} download onClick={event => { event.preventDefault(); void exportCurrent() }}>导出图片与文案</a><button type="button" disabled={!!updatingCopy || !chosen || actionBusy} onClick={() => { void action('retry', { stage: 'copy', imageId: chosen?.id }) }}>{copy?.fieldIssues?.length ? '补齐未完成项' : copy ? '重生成当前文案' : '准备当前文案'}</button>{missingCopies > 0 ? <button type="button" disabled={!!activeTask || actionBusy} onClick={() => { void action('prepare-copies') }}>补齐本组文案（最多 {missingCopies} 次调用）</button> : null}</div> : null}
        </aside>
      <details className={css.advanced}><summary>商品资料与高级选项</summary><p>这些资料用于文案，不能从图片猜测。没有确认的字段可留空，先生成设计草稿。</p><label>实际交付方式<select aria-label="实际交付方式" value={facts.type} onChange={event => setFacts(previous => ({ ...previous, type: event.target.value as ProductType, confirmed: false, authenticityConfirmed: false }))}><option value="unspecified">待确认（先创作设计）</option><option value="physical_felt">实物商品</option><option value="digital_illustration">数字作品</option><option value="digital_portrait">定制数字作品</option></select></label><div className={css.facts}>{(['name', 'materials', 'dimensions', 'packaging', 'processing', 'delivery', 'personalization'] as const).map((key, index) => <label key={key}>{['商品名称（可自动拟定）', '真实材料／数字媒介', '尺寸／分辨率', '包装／文件内容', '制作周期', '交付说明', '可定制项'][index]}<input aria-label={`商品资料 ${key}`} value={facts[key]} onChange={event => setFacts(previous => ({ ...previous, [key]: event.target.value }))} /></label>)}</div><div className={css.checks}><label><input type="checkbox" checked={facts.confirmed} onChange={event => setFacts(previous => ({ ...previous, confirmed: event.target.checked }))} />非空商品资料已核实</label>{facts.type === 'physical_felt' ? <label><input type="checkbox" checked={facts.authenticityConfirmed === true} onChange={event => setFacts(previous => ({ ...previous, authenticityConfirmed: event.target.checked }))} />已确认实物可制作／实际供货</label> : null}<label><input type="checkbox" checked={autoCheck} onChange={event => setAutoCheck(event.target.checked)} />后台自动检查图片</label><label>调用上限<input type="number" min={minimumCalls} max={100} aria-label="调用上限" value={maxCalls} onChange={event => setMaxCalls(Number(event.target.value))} /></label></div><label><input type="checkbox" checked={copyTiming === 'all'} onChange={event => setCopyTiming(event.target.checked ? 'all' : 'selected')} />每张自动准备文案</label><p>本轮 {count} 张预计 {minimumCalls} 次调用。默认先探索图片，确定主设计后准备文案；也可手动为任意选图准备。多角度按需单独生成。</p>{product ? <div className={css.actions}><button type="button" onClick={() => setFacts(structuredClone(product.facts))}>载入当前商品资料</button><button type="button" onClick={() => { void updateFacts() }}>保存资料并更新文案</button><button type="button" onClick={() => { void action('budget', { maxCalls }) }}>调整当前项目上限</button><span>调用额度 {product.calls.length} / {product.options.maxCalls} · 实际金额以平台账单为准</span></div> : null}{product?.images.some(image => image.visualRules) ? <details className={css.report} data-visual-rules-status=""><summary>视觉规则与实际提示词</summary><p>摄影与构图 v1.0 · 以下为已提交任务的规则快照</p>{product.images.filter(image => image.visualRules).map((image, index) => <details key={image.id}><summary>{image.angle ? `${viewAngles.find(angle => angle.value === image.angle)?.label ?? image.angle} · 多角度一致性` : `图片 ${index + 1}`} · {image.visualRules!.adapter}</summary><p>材质：{image.visualRules!.materialPreset ?? (image.visualRules!.multiView?.anchor.inheritedModules.needle_felt_v2_0 ? 'needle_felt_v2_0' : image.visualRules!.multiView?.anchor.inheritedModules.needle_felt_v1_0_2 ? 'needle_felt_v1_0_2' : 'needle_felt_v1_0')}</p><p>部件：{image.visualRules!.profile.components.join('、')}</p><pre className={css.promptSnapshot}>{image.visualRules!.prompt}</pre></details>)}</details> : null}{product?.referencePlan ? <details className={css.report}><summary>查看自动分析与提示词</summary><p>{product.referencePlan.summary}</p><p>保留：{product.referencePlan.keep.join('、')}</p>{product.referencePlan.plans.map(plan => <div key={plan.id}><h4>{plan.name}</h4><p>{referenceGenerationPrompt(product.referencePlan!, plan, creativityMode(product.creativity), product.facts.requirements)}</p></div>)}</details> : null}</details>
        </div>
        <aside className={css.rail} aria-label="创作设置"><div className={css.controls}>
          <div className={css.taskResolutionRow} data-task-resolution-row="">
            <label>创作任务<select aria-label="创作任务" value={task} onChange={event => { setTask(event.target.value as CreationTask); if (!photoTouched.current) setPhotography(defaultPhotography(event.target.value)); requestKey.current = '' }}>{creationTasks.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <label>分辨率<select aria-label="输出分辨率" value={resolution} onChange={event => { setResolution(referenceResolution(event.target.value)); requestKey.current = '' }}>{referenceResolutions.map(value => <option key={value} value={value} disabled={only1K && value !== '1k'}>{value.toUpperCase()}</option>)}</select></label>
          </div>
          <small className={css.taskResolutionHint}>{creationTasks.find(item => item.value === task)?.hint}{only1K ? ' 当前型号仅支持 1K。' : ''}</small>
          {resolutionIssue ? <small className={css.resolutionWarning} role="status">{resolutionIssue}</small> : null}
          <div className={css.creativity}><strong>想改多少？</strong><div className={css.creativityOptions} role="radiogroup" aria-label="改动幅度">{creativityOptions.map(option => <button key={option.value} type="button" role="radio" aria-checked={creativity === option.value} onClick={() => setCreativity(option.value)}>{option.label}{option.value === 'balanced' ? <span>推荐</span> : null}</button>)}</div><small>{creativityOptions.find(option => option.value === creativity)?.detail}</small></div>
          <label>补充想法（可不填）<input aria-label="补充想法（可不填）" value={notes} onChange={event => setNotes(event.target.value)} placeholder="例如：更可爱一些、圣诞主题、减少复杂配饰" /></label>
          <PhotographyControls value={photography} onChange={value => { photoTouched.current = true; setPhotography(value); requestKey.current = '' }} />
          <small data-felt-material-default="">主体使用针刺羊毛毡；服装与配件按设计保留各自材料。按部件整理，不靠配件词表限制创作。</small>
          </div><div className={css.generateDock}><label className={css.countSlider}>探索数量 <strong>{count} 张</strong><input aria-label="探索图片数量" type="range" min={2} max={8} step={1} value={count} onChange={event => { setCount(Number(event.target.value)); requestKey.current = '' }} /><span><small>2张</small><small>8张</small></span></label><div className={css.generateRow}><button type="button" className={css.primary} disabled={busy || modelSaving || !references.length} onClick={() => { void create() }}>{busy ? '正在提交…' : product ? `再生成 ${count} 张` : `生成 ${count} 个方案`}</button><small>{product ? '上一轮保留，新一轮会避免重复方向' : '自动读图与规划，无需填写提示词'}</small></div>
        </div></aside>
      </section>
    </div>
    </div>
  </div>
}

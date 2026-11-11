import { useEffect, useRef, useState } from 'react'
import type { GenerateRequest, GeneratedImage } from '../protocol.ts'
import { ETSY_API, type EtsyProduct, type ProductFacts, type ProductType } from '../etsy/types.ts'
import type { ImageGenScope } from './settings-scope.ts'
import css from './etsy.module.css'
import { AutoSizeTextarea } from './AutoSizeTextarea.tsx'
import { etsyCall } from './etsy-api.ts'
export { etsyCall } from './etsy-api.ts'
import { useCopyEditor } from './useCopyEditor.ts'
import { listingText } from '../etsy/listing-text.ts'

const defaultFacts: ProductFacts = { name: '', type: 'physical_felt', requirements: '', materials: '', dimensions: '', packaging: '', processing: '', delivery: '', personalization: '', confirmed: false, authenticityConfirmed: false }
const labels: Record<string, string> = { queued: '等待', running: '处理中', completed: '完成', failed: '失败', cancelled: '已取消', unknown: 'UNKNOWN · 需核对', skipped: '未检测' }
const imageUrl = (id: string, file: string): string => `${ETSY_API}/image?id=${encodeURIComponent(id)}&file=${encodeURIComponent(file)}`
export function EtsyWorkbench(props: { request: () => GenerateRequest; existingImages?: GeneratedImage[]; allowGenerate?: boolean; scope?: ImageGenScope; onClose?: () => void; onEdit?: (dataUrl: string, prompt: string) => void }): React.JSX.Element {
  const [facts, setFacts] = useState<ProductFacts>(() => {
    try { return { ...defaultFacts, ...JSON.parse(localStorage.getItem('etsy-product-draft') || '{}') } } catch { return defaultFacts }
  })
  const [products, setProducts] = useState<EtsyProduct[]>([]), [selected, setSelected] = useState('')
  const [count, setCount] = useState(4), [maxCalls, setMaxCalls] = useState(24), [autoCheck, setAutoCheck] = useState(true)
  const [existingIndex, setExistingIndex] = useState(0)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [configOpen, setConfigOpen] = useState(false), [modelFields, setModelFields] = useState<Record<string, string>>({})
  const [hostModel, setHostModel] = useState<{ available: boolean; provider?: string; model?: string; vision?: boolean; message?: string }>()
  useEffect(() => {
    let disposed = false
    void etsyCall<{ available: boolean; provider?: string; model?: string; vision?: boolean; message?: string }>('models').then(value => { if (!disposed) setHostModel(value) }).catch(() => {})
    return () => { disposed = true }
  }, [configOpen])
  const busyRef = useRef(false), keyRef = useRef(''), selectedRef = useRef('')
  const storedProduct = products.find(item => item.id === selected)
  let imageModelName = '请在左侧选择'
  try { imageModelName = props.request().model || imageModelName } catch { /* 未选择模型时仍可复用已有图片。 */ }
  const accept = (value: EtsyProduct): void => {
    setProducts(previous => [value, ...previous.filter(item => item.id !== value.id)])
  }
  const editor = useCopyEditor(storedProduct, accept)
  const { draft, dirtyRef, saveState: saved, setSaveState: setSaved, save: saveDraft, change: edit } = editor
  const editingImage = storedProduct?.images.find(image => image.id === editor.editImageId)
  const product = editingImage && storedProduct ? { ...storedProduct, selectedImageId: editingImage.id, copyImageId: editingImage.id, copyStage: editingImage.copyStage ?? storedProduct.copyStage } : storedProduct
  const productRef = useRef(product); productRef.current = product
  useEffect(() => { try { localStorage.setItem('etsy-product-draft', JSON.stringify(facts)) } catch { /* 草稿空间不足不影响宿主任务。 */ } }, [facts])
  useEffect(() => {
    let disposed = false, refreshing = false
    const refresh = async (): Promise<void> => {
      if (refreshing) return
      refreshing = true
      try {
        const list = await etsyCall<EtsyProduct[]>('list')
        if (disposed) return
        setProducts(list)
        if (!selectedRef.current && list[0]) { selectedRef.current = list[0].id; setSelected(list[0].id) }
      } catch (caught) { if (!disposed) setError(caught instanceof Error ? caught.message : '读取商品任务失败') }
      finally { refreshing = false }
    }
    void refresh(); const timer = window.setInterval(() => { void refresh() }, 1200)
    return () => { disposed = true; clearInterval(timer) }
  }, [])
  const exportCurrent = async (): Promise<void> => {
    const current = productRef.current
    if (!current || !await saveDraft()) return
    const link = document.createElement('a')
    link.href = `${ETSY_API}/export?id=${encodeURIComponent(current.id)}${current.selectedImageId ? `&imageId=${encodeURIComponent(current.selectedImageId)}` : ''}`
    link.download = `etsy-${current.id}.zip`; link.click()
  }
  const copyCurrent = async (): Promise<void> => {
    if (!draft) return
    const imageId = product?.selectedImageId
    if (!await saveDraft()) return
    const committed = editor.committedCopy(imageId)
    if (!committed) return
    try { await navigator.clipboard.writeText(listingText(committed)) }
    catch { setError('复制失败，请选择文本后复制') }
  }
  const start = async (): Promise<void> => {
    if (busyRef.current || dirtyRef.current) return
    busyRef.current = true; setBusy(true); setError('')
    if (!keyRef.current.startsWith('generate-')) keyRef.current = `generate-${crypto.randomUUID()}`
    try {
      const generation = props.request()
      if (!generation.prompt.trim()) throw new Error('请先在原生图侧栏填写商品画面要求')
      const value = await etsyCall<EtsyProduct>('start', { requestKey: keyRef.current, facts, generation, count, maxCalls, autoCheck })
      selectedRef.current = value.id; setSelected(value.id); accept(value); editor.reset(); keyRef.current = ''
    } catch (caught) { setError(caught instanceof Error ? caught.message : '商品生成提交失败') }
    finally { busyRef.current = false; setBusy(false) }
  }
  const adopt = async (): Promise<void> => {
    const image = props.existingImages?.[existingIndex]
    if (!image || busyRef.current || dirtyRef.current) return
    busyRef.current = true; setBusy(true); setError('')
    if (!keyRef.current.startsWith('adopt-')) keyRef.current = `adopt-${crypto.randomUUID()}`
    try {
      const value = await etsyCall<EtsyProduct>('adopt', { requestKey: keyRef.current, image, facts, maxCalls, autoCheck })
      selectedRef.current = value.id; setSelected(value.id); accept(value); editor.reset(); keyRef.current = ''
    } catch (caught) { setError(caught instanceof Error ? caught.message : '复用图片失败') }
    finally { busyRef.current = false; setBusy(false) }
  }
  const action = async (name: string, extra: Record<string, unknown> = {}): Promise<void> => {
    if (!product) return
    if (dirtyRef.current) { setError('请先保存当前文案修改'); return }
    if (name === 'retry' && extra.confirmUnknown !== true) {
      const image = product.images.find(item => item.id === extra.imageId)
      const stage = extra.stage === 'generation' ? image?.generation : extra.stage === 'quality' ? image?.quality : image?.copyStage ?? product.copyStage
      if (stage?.status === 'unknown') { if (!window.confirm('上次请求结果不明，重试会增加一次调用，继续吗？')) return; extra = { ...extra, confirmUnknown: true } }
    }
    try { setError(''); accept(await etsyCall<EtsyProduct>(name, { id: product.id, ...extra })) }
    catch (caught) { setError(caught instanceof Error ? caught.message : '操作失败') }
  }
  const saveModels = async (): Promise<void> => {
    if (!props.scope) return
    try {
      const ops = Object.entries(modelFields).filter(([, value]) => value.trim() !== '').map(([field, value]) => ({ op: 'set' as const, path: [field], value: value.trim() }))
      for (const [field, value] of Object.entries(modelFields)) if (field.endsWith('ApiUrl') && value.trim()) {
        const url = new URL(value)
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('API 地址请填写无账号、密钥或查询参数的 HTTP(S) 基础地址')
      }
      await props.scope.mutateOps(ops)
      setModelFields({}); setSaved('模型配置已保存；密钥不回显'); setConfigOpen(false)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '模型配置保存失败') }
  }
  const field = (key: keyof ProductFacts, label: string): React.JSX.Element => <label>{label}<input value={String(facts[key])} onChange={event => setFacts(previous => ({ ...previous, [key]: event.target.value }))} /></label>
  return <div className={css.workbench} data-etsy-workbench="">
    <header className={css.header}><div><strong>Etsy 商品生产</strong><span>图片先显示，质检与文案在此自动更新</span></div><div className={css.actions}>
      <button type="button" onClick={() => setConfigOpen(value => !value)}>视觉／文案模型</button>
      {props.onClose ? <button type="button" onClick={props.onClose}>返回普通生图</button> : null}
    </div></header>
    <div className={css.scroll}>
      <p>生图／修图模型：<strong>{imageModelName}</strong>（使用左侧生图配置）</p>
      {hostModel?.available ? <p>文案／质检可复用模型：{hostModel.provider} / {hostModel.model} · {hostModel.vision ? '声明支持图片输入' : '尚未声明图片输入能力'}。独立文字／视觉配置留空时使用此模型。</p> : hostModel?.message ? <p>{hostModel.message}</p> : null}
      {configOpen ? <section className={css.card}>
        <h3>独立模型配置</h3><p>留空优先沿用已有提示词增强配置，否则复用 DSH 当前模型，无需重新填写登录信息。也可单独填写兼容 Chat Completions 的基础地址与模型 ID。视觉模型需要支持图片输入，已存密钥不会返回浏览器。</p>
        <div className={css.form}>{['Vision', 'Copy'].map(kind => <fieldset key={kind}><legend>{kind === 'Vision' ? '视觉质检' : '标题与文案'}</legend>{['ApiUrl', 'Model', 'ApiKey'].map(part => {
          const key = `etsy${kind}${part}`
          return <label key={key}>{part === 'ApiUrl' ? 'API 基础地址' : part === 'Model' ? '模型 ID' : 'API Key（仅更新时填写）'}<input type={part === 'ApiKey' ? 'password' : 'text'} autoComplete="off" value={modelFields[key] ?? ''} onChange={event => setModelFields(previous => ({ ...previous, [key]: event.target.value }))} /></label>
        })}</fieldset>)}</div><button type="button" disabled={!props.scope} onClick={() => { void saveModels() }}>保存到 DSH 宿主配置</button>
      </section> : null}
      <details className={css.card} open={!product}><summary>商品资料与生成设置</summary><div className={css.form}>
        {field('name', '商品名称')}
        <label>商品类型<select aria-label="商品类型" value={facts.type} onChange={event => setFacts(previous => ({ ...previous, type: event.target.value as ProductType }))}><option value="unspecified">交付方式待确认</option><option value="physical_felt">实体羊毛毡／实物商品</option><option value="digital_illustration">数字插画</option><option value="digital_portrait">定制数字肖像</option></select></label>
        {field('materials', '已确认材料／数字媒介')}{field('dimensions', '已确认尺寸／分辨率')}{field('packaging', '已确认包装／交付文件')}{field('processing', '已确认制作周期')}{field('delivery', '已确认交付说明')}{field('personalization', '已确认定制内容')}
        <label className={css.full}>补充商品要求<textarea value={facts.requirements} onChange={event => setFacts(previous => ({ ...previous, requirements: event.target.value }))} /></label>
        <label>图片数量<select aria-label="商品图片数量" value={count} onChange={event => setCount(Number(event.target.value))}>{[1, 2, 3, 4, 5, 6].map(value => <option key={value}>{value}</option>)}</select></label>
        <label>本商品调用次数上限<input aria-label="调用次数上限" type="number" min={count} max={100} value={maxCalls} onChange={event => setMaxCalls(Number(event.target.value))} /></label>
      </div><div className={css.checks}><label><input type="checkbox" checked={facts.confirmed} onChange={event => setFacts(previous => ({ ...previous, confirmed: event.target.checked }))} />以上非空商品参数已人工核实</label><label><input type="checkbox" checked={autoCheck} onChange={event => setAutoCheck(event.target.checked)} />自动质检</label></div>
      {facts.type === 'physical_felt' ? <label className={css.checks}><input type="checkbox" checked={facts.authenticityConfirmed === true} onChange={event => setFacts(previous => ({ ...previous, authenticityConfirmed: event.target.checked }))} />已人工确认实物可制作／实际供货；AI 概念图不等于实拍</label> : null}
      {product ? <div className={css.actions}><button type="button" onClick={() => setFacts(structuredClone(product.facts))}>载入当前商品资料</button><button type="button" onClick={() => { void action('facts', { facts, revision: product.revision }) }}>保存资料到当前商品</button><span>保存后可单独重生成文案，无需重新生图</span></div> : null}
      <p>使用左侧当前生图模型、提示词与图生图参考。原图和结果独立归档；自动修图将在后续阶段实现，当前不会自动重画。</p></details>
      <div className={css.actions}>{props.allowGenerate !== false ? <button className={css.primary} type="button" disabled={busy || !facts.name.trim()} onClick={() => { void start() }}>{busy ? '提交中…' : '生成商品'}</button> : <span>当前为电商套图结果，可直接复用下方所选图片生成质检与文案。</span>}
        {(props.existingImages?.length ?? 0) > 0 ? <><select aria-label="复用当前图片" value={existingIndex} onChange={event => setExistingIndex(Number(event.target.value))}>{props.existingImages!.map((_, index) => <option key={index} value={index}>当前第 {index + 1} 张图片</option>)}</select><button type="button" disabled={busy || !facts.name.trim()} onClick={() => { void adopt() }}>仅检测与生成文案（不重新生图）</button></> : null}
        <select aria-label="商品项目" value={selected} onChange={event => {
          if (dirtyRef.current) { setError('请先保存当前文案修改'); return }
          selectedRef.current = event.target.value; setSelected(event.target.value); editor.reset()
        }}><option value="">选择历史商品</option>{products.map(item => <option value={item.id} key={item.id}>{item.facts.name} · {new Date(item.createdAt).toLocaleTimeString()}</option>)}</select>
      </div>
      {error ? <p className={css.error} role="alert">{error}</p> : null}
      {product ? <>
        <div className={css.status}><strong>{product.facts.name}</strong><span>调用 {product.calls.length} / {product.options.maxCalls} · 金额未知，以供应商账单为准</span><span>文案：{labels[product.copyStage.status]}</span><span>{saved}</span>
          <button type="button" onClick={() => { void action('cancel') }} disabled={product.cancelled}>取消未完成任务</button><a href={`${ETSY_API}/export?id=${encodeURIComponent(product.id)}`} download onClick={event => { event.preventDefault(); void exportCurrent() }}>导出完整商品 ZIP</a></div>
        {product.errors.map((error, index) => <p className={css.error} key={index}>{error}</p>)}
        <div className={css.results}>
          <section><h3>图片与自动质检</h3><div className={css.images}>{product.images.map((item, index) => <article className={css.card} key={item.id} data-etsy-image={item.id}>
            {item.files.map(file => <img key={file} src={imageUrl(product.id, file)} alt={`${product.facts.name} 候选 ${index + 1}`} />)}
            <div className={css.actions}><strong>候选 {index + 1}</strong><span>{product.source === 'existing-image' ? '复用已生成图片' : labels[item.generation.status]}</span><span className={css.badge} data-quality={item.report?.status}>{item.report?.status ?? labels[item.quality.status]}</span></div>
            {item.generation.error ? <p className={css.error}>{item.generation.error}</p> : null}{['failed', 'cancelled', 'unknown'].includes(item.generation.status) ? <button type="button" onClick={() => { void action('retry', { stage: 'generation', imageId: item.id, generation: props.request() }) }}>重试这张图</button> : null}
            {item.quality.error ? <p className={css.error}>{item.quality.error}</p> : null}
            {item.report ? <div data-etsy-quality="">{(item.qualityFactsRevision ?? 1) !== (product.factsRevision ?? 1) ? <p className={css.error}>商品资料已更新，此检测对应旧资料，请重新检测。</p> : null}<p>{item.report.summary}</p><small>AI 建议，需人工复核 · {item.report.model}</small>{item.report.issues.map((issue, i) => <div className={css.issue} key={i}><strong>{issue.area}：{issue.problem}</strong><p>依据：{issue.evidence || '模型未提供可核对依据'}</p><p>建议：{issue.suggestion}</p></div>)}{item.report.uncertainties.map((uncertain, i) => <p key={i}>待核实：{uncertain}</p>)}</div> : null}
            {item.generation.status === 'completed' ? <div className={css.actions}><button type="button" disabled={item.quality.status === 'running'} onClick={() => { void action('retry', { stage: 'quality', imageId: item.id }) }}>重新检测（计入调用）</button>
              {props.onEdit && item.files[0] ? <button type="button" onClick={() => { void fetch(imageUrl(product.id, item.files[0])).then(response => response.blob()).then(blob => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob) })).then(url => props.onEdit!(url, item.report?.issues.map(issue => issue.suggestion).join('；') || product.request.prompt)).catch(() => setError('载入编辑参考图失败')) }}>按建议继续图生图</button> : null}
            </div> : null}
          </article>)}</div></section>
          <section className={css.card} data-etsy-copy=""><div className={css.actions}><h3>标题、文案与 SEO</h3><button type="button" disabled={product.copyStage.status === 'running'} onClick={() => { void action('retry', { stage: 'copy', imageId: product.selectedImageId }) }}>{draft?.fieldIssues?.length ? '补齐未完成项（计入调用）' : '重新生成文案（计入调用）'}</button></div>
            {product.copy && (product.copyFactsRevision ?? 1) !== (product.factsRevision ?? 1) ? <p className={css.error}>商品资料已更新，以下文案对应旧资料，请重新生成文案。</p> : null}
            {product.copyStage.error ? <p className={css.error}>{product.copyStage.error}</p> : null}{draft?.fieldIssues?.length ? <p data-copy-field-issues="">{draft.fieldIssues.map(issue => issue.message).join('；')}</p> : null}
            {!draft ? <p>{product.copyStage.status === 'failed' ? '文案未完成，成功图片已保留。请按上方错误处理后重试。' : product.copyStage.status === 'unknown' ? '文案请求结果不明，请先核对，避免重复调用。' : product.copyStage.status === 'skipped' || product.copyStage.status === 'cancelled' ? '本次文案未执行或已取消，已有结果仍保留。' : '首张图片生成成功后自动开始，结果将在这里出现。'}</p> : <>
              {draft.titles.map((row, index) => <div className={css.title} key={index}><label><input type="radio" name="etsy-title" checked={draft.selectedTitle === index} disabled={!row.title.trim()} onChange={() => edit({ selectedTitle: index })} />{row.strategy} · {[...row.title].length}/140</label><AutoSizeTextarea aria-label={`英文标题 ${index + 1}`} minRows={2} value={row.title} onChange={event => edit({ titles: draft.titles.map((title, i) => i === index ? { ...title, title: event.target.value, titleZh: '' } : title) })} /><small>中文译名：{row.titleZh || '中文译名待补齐'}</small><small>{row.explanationZh} · {row.keywords.join(', ')}</small></div>)}
              <label>英文商品描述<AutoSizeTextarea className={css.description} minRows={12} aria-label="英文商品描述" value={draft.description} onChange={event => edit({ description: event.target.value })} /></label>
              <label>SEO 标签（每行一个，最多 13 个，每个 20 字符）<AutoSizeTextarea minRows={7} aria-label="SEO 标签" value={draft.tags.join('\n')} onChange={event => edit({ tags: event.target.value.split('\n') })} /></label>
              <div className={css.actions}><button type="button" onClick={() => { void saveDraft() }}>保存文案</button><button type="button" onClick={() => { void copyCurrent() }}>复制整套文案</button>{saved.startsWith('尚未保存') ? <button type="button" onClick={() => { void editor.reloadKeepingDraft() }}>保留草稿并载入最新</button> : null}{editor.hasBackup && !editor.dirty ? <button type="button" onClick={() => editor.restoreBackup()}>恢复本地草稿</button> : null}</div>
              <h4>卖点</h4><ul>{draft.sellingPoints.map((item, i) => <li key={i}>{item}</li>)}</ul><h4>确认属性与交付</h4><dl>{Object.entries(draft.attributes).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl><p>{draft.deliveryNotes}</p><h4>人工确认清单</h4><ul>{draft.humanConfirmation.map((item, i) => <li key={i}>{item}</li>)}</ul>
            </>}
          </section>
        </div>
      </> : <p className={css.empty}>填写商品资料后点击一次「生成商品」。无需向聊天窗口发送图片。</p>}
    </div>
  </div>
}

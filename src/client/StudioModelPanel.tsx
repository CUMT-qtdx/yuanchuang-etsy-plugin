import { useEffect, useRef, useState } from 'react'
import type { GenerateRequest } from '../protocol.ts'
import type { StudioModelChoices } from '../etsy/types.ts'
import { etsyCall } from './EtsyWorkbench.tsx'
import { ModelPicker, type ModelPickerValue } from './ModelPicker.tsx'
import css from './reference-studio.module.css'

const analysisKey = (selection: StudioModelChoices['analysis']): string => selection.provider === '@default' ? 'default' : selection.provider ? JSON.stringify([selection.provider, selection.model]) : 'legacy'
export function StudioModelPanel(props: { request: () => GenerateRequest; onSaved?: (image: ModelPickerValue) => Promise<void>; onSaving: (saving: boolean) => void }): React.JSX.Element {
  const [view, setView] = useState<StudioModelChoices>(), [image, setImage] = useState<ModelPickerValue>({ channelId: '', model: '' })
  const [analysis, setAnalysis] = useState('legacy'), [saving, setSaving] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState('')
  const alive = useRef(true), serial = useRef(false)
  const apply = (next: StudioModelChoices): void => {
    setView(next); setAnalysis(analysisKey(next.analysis))
    let selected = next.image
    try { const request = props.request(); if (next.imageGroups.some(group => group.id === request.channelId && group.models.includes(request.model))) selected = { channelId: request.channelId!, model: request.model } } catch { /* 使用宿主默认图片模型。 */ }
    setImage(selected)
  }
  const load = async (): Promise<void> => {
    setLoading(true); setError('')
    try { const next = await etsyCall<StudioModelChoices>('model-choices'); if (alive.current) apply(next) }
    catch (caught) { if (alive.current) setError(caught instanceof Error ? caught.message : '模型列表读取失败') }
    finally { if (alive.current) setLoading(false) }
  }
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false } }, [])
  const save = async (nextImage: ModelPickerValue, nextAnalysis: string): Promise<void> => {
    if (serial.current || !view) return
    serial.current = true; setSaving(true); props.onSaving(true); setError('')
    try {
      const selected = nextAnalysis === 'legacy' ? { provider: '', model: '' } : nextAnalysis === 'default' ? { provider: '@default', model: '' } : (() => { const [provider, model] = JSON.parse(nextAnalysis) as string[]; return { provider, model } })()
      const next = await etsyCall<StudioModelChoices>('save-model-choices', { revision: view.revision, image: nextImage, analysis: selected })
      await props.onSaved?.(nextImage)
      if (alive.current) { setView(next); setImage(nextImage); setAnalysis(analysisKey(next.analysis)) }
    } catch (caught) { if (alive.current) setError(caught instanceof Error ? caught.message : '模型选择保存失败') }
    finally { serial.current = false; if (alive.current) setSaving(false); props.onSaving(false) }
  }
  const providerIds = [...new Set(view?.analysisModels.map(model => model.provider) ?? [])]
  const customSelectionMissing = analysis !== 'legacy' && analysis !== 'default' && !view?.analysisModels.some(model => JSON.stringify([model.provider, model.model]) === analysis)
  return <details className={css.modelPanel} data-studio-models="">
    <summary><strong>模型选择</strong><span>{saving ? '正在保存…' : view ? `生图：${image.model || '未配置'} · 分析：${view.analysisLabel || '未配置'}` : '生图／修图 + 规划／检查／文案'}</span></summary>
    <div className={css.modelFields}>
      <div><label>生图／修图模型</label><ModelPicker groups={view?.imageGroups ?? []} value={image} channelLabel="图片渠道" modelLabel="图片模型" channelPlaceholder="选择图片渠道" emptyLabel="请先添加图片渠道" ariaLabel="生图／修图模型" disabled={saving || !view?.writable} onChange={choice => { void save(choice, analysis) }} /><small>沿用原生图插件的图片渠道。</small></div>
      <label>规划／检查／文案模型<select aria-label="规划／检查／文案模型" value={analysis} disabled={saving || !view?.writable} onChange={event => { void save(image, event.target.value) }}>
        <option value="legacy">沿用原配置{view?.analysisLabel ? ` · ${view.analysisLabel}` : ''}</option><option value="default">跟随 DSH 默认模型{view?.defaultAnalysisLabel ? ` · ${view.defaultAnalysisLabel}` : ''}</option>
        {customSelectionMissing ? <option value={analysis}>当前模型 · {view?.analysis.model}（目录暂不可用）</option> : null}
        {providerIds.map(provider => <optgroup key={provider} label={view?.analysisModels.find(model => model.provider === provider)?.providerName}>{view?.analysisModels.filter(model => model.provider === provider).map(model => <option key={model.model} value={JSON.stringify([model.provider, model.model])} disabled={model.vision === false}>{model.name}{model.vision === false ? ' · 仅文字，不支持规划看图' : model.vision === undefined ? ' · 看图能力待核对' : ''}</option>)}</optgroup>)}
      </select><small>这三项共用一个支持看图的模型。</small></label>
    </div>
    <div className={css.modelFoot}><small>选择后自动保存。添加 DSH 供应商或图片渠道后，可刷新列表。</small><button type="button" disabled={saving || loading} onClick={() => { void load() }}>{loading ? '正在刷新…' : '刷新模型列表'}</button></div>
    {view?.warnings.map((message, index) => <small className={css.modelWarning} key={index}>{message}</small>)}{error ? <p className={css.error} role="alert">{error}</p> : null}
  </details>
}

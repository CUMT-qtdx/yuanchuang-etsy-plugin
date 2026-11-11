import { useEffect, useRef, useState } from 'react'
import type { EtsyProduct, ProductImage, ViewAngle, IdentitySpec, StudioModelChoices } from '../etsy/types.ts'
import type { GenerateRequest } from '../protocol.ts'
import { ETSY_API } from '../etsy/types.ts'
import { viewAngles } from '../etsy/creation-flow.ts'
import { viewCheckLabels } from '../etsy/multi-view/consistency-v1.ts'
import { materialCriteria } from '../etsy/multi-view/material-lock-v1.ts'
import { ensureMaterialSamples } from './material-samples.ts'
import { ensureSpatialIdentity } from './spatial-identity.ts'
import { chooseSurfaceModel, isSideBack } from '../etsy/multi-view/surface-continuity-v1.ts'
import { etsyCall } from './etsy-api.ts'
import css from './reference-studio.module.css'

export function FinalDesignPanel(props: { product: EtsyProduct; chosen: ProductImage; busy: boolean; request: () => GenerateRequest; action: (name: string, body?: Record<string, unknown>, onError?: (message: string) => void) => Promise<boolean>; preview: (imageId: string) => void }): React.JSX.Element {
  const { product, chosen } = props
  const design = product.finalDesigns?.find(design => design.id === product.finalDesignId && design.imageId === chosen.id) ?? [...product.finalDesigns ?? []].reverse().find(design => design.imageId === chosen.id)
  const [notes, setNotes] = useState(design?.notes ?? ''), [angles, setAngles] = useState<ViewAngle[]>(['three-quarter', 'left', 'right', 'back'])
  const [editId, setEditId] = useState(''), [instruction, setInstruction] = useState('')
  const [specEdit, setSpecEdit] = useState<{ spec: IdentitySpec; revision: number }>()
  const key = useRef(''), submitLock = useRef(false), card = useRef<HTMLDetailsElement>(null)
  const [submitting, setSubmitting] = useState(false), [actionError, setActionError] = useState('')
  const [materialProgress, setMaterialProgress] = useState('')
  const materialLock = useRef(false)
  const [surfaceGroups, setSurfaceGroups] = useState<StudioModelChoices['imageGroups']>([])
  const [catalogModel, setCatalogModel] = useState<StudioModelChoices['image']>()
  const [surfaceSaving, setSurfaceSaving] = useState(false)
  const surfaceSaveLock = useRef(false), modelDesign = useRef(design?.id)
  modelDesign.current = design?.id
  const preferredModel = props.request()
  const [surfaceModel, setSurfaceModel] = useState<Pick<GenerateRequest, 'channelId' | 'model'>>(() => ({ channelId: design?.sideBackModel?.channelId ?? props.request().channelId, model: design?.sideBackModel?.model ?? props.request().model }))
  useEffect(() => {
    let disposed = false
    void etsyCall<StudioModelChoices>('model-choices').then(choices => {
      if (disposed) return
      setSurfaceGroups(choices.imageGroups)
      setCatalogModel(choices.image)
    }).catch(() => { /* 模型列表暂不可用时，继续使用当前已选模型。 */ })
    return () => { disposed = true }
  }, [design?.id])
  useEffect(() => {
    setSurfaceModel(chooseSurfaceModel(surfaceGroups, preferredModel, design?.sideBackModel, catalogModel))
  }, [surfaceGroups, catalogModel, design?.id, design?.sideBackModel?.channelId, design?.sideBackModel?.model, preferredModel.channelId, preferredModel.model])
  const views = design ? product.images.filter(image => image.finalDesignId === design.id) : []
  const active = design && ['queued', 'running'].includes(design.planning.status)
  const revision = design?.specRevision ?? 1
  const pendingAngles = angles.filter(angle => !views.some(image => image.angle === angle && (image.identityRevision ?? 1) === revision && image.generation.status !== 'skipped' && (design?.spec || image.generation.status !== 'cancelled')))
  const runningViews = views.filter(image => ['queued', 'running'].includes(image.generation.status))
  const completedViews = views.filter(image => image.files.length)
  const waitingSlots = viewAngles.filter(angle => pendingAngles.includes(angle.value))
  const runAction = async (name: string, body: Record<string, unknown>): Promise<boolean> => {
    if (materialLock.current) return false
    setActionError('')
    try {
      const target = views.find(image => image.id === body.imageId)
      if (name === 'generate-views') body = { ...body, sideBackModel: surfaceModel }
      if ((name === 'revise' && body.viewRestart === true || name === 'retry' && body.stage === 'generation') && isSideBack(target?.angle)) body = { ...body, generation: { ...props.request(), ...surfaceModel } }
      const needsSamples = name === 'generate-views' ? (body.angles as ViewAngle[]).some(angle => !isSideBack(angle))
        : name === 'revise' ? body.materialOnly === true || body.viewRestart !== true || !isSideBack(target?.angle)
          : name === 'retry' && body.stage === 'generation' && (!isSideBack(target?.angle) || target?.materialRepair)
      if (design?.spec && !design.spec.spatial && ['generate-views','revise','retry'].includes(name)) {
        materialLock.current = true
        await ensureSpatialIdentity(product.id, design.id, setMaterialProgress)
      }
      if (design && needsSamples) {
        materialLock.current = true
        await ensureMaterialSamples(product.id, design.id, setMaterialProgress)
      }
      return await props.action(name, body, setActionError)
    }
    catch (error) { setActionError(error instanceof Error ? error.message : '操作未完成，请重试'); return false }
    finally { materialLock.current = false; setMaterialProgress('') }
  }
  useEffect(() => { setActionError(''); key.current = ''; setNotes(design?.notes ?? '') }, [design?.id, revision])
  const saveSurfaceModel = async (next: Pick<GenerateRequest, 'channelId' | 'model'>): Promise<void> => {
    if (!design || surfaceSaveLock.current) return
    const previous = surfaceModel, designId = design.id
    surfaceSaveLock.current = true; setSurfaceSaving(true); setSurfaceModel(next)
    try {
      const saved = await runAction('set-view-model', { designId, model: next })
      if (!saved && modelDesign.current === designId) setSurfaceModel(previous)
    } finally { surfaceSaveLock.current = false; setSurfaceSaving(false) }
  }
  const generate = async (): Promise<void> => {
    if (!design || submitLock.current || !pendingAngles.length) return
    const confirmUnknown = design.planning.status === 'unknown'
    if (confirmUnknown && !window.confirm('上次主设计分析结果不明，确认重新分析并生成所选角度？')) return
    submitLock.current = true; setSubmitting(true); setActionError('')
    key.current ||= `views-${crypto.randomUUID()}`
    try {
      const success = await runAction('generate-views', { designId: design.id, angles: pendingAngles, requestKey: key.current, generation: props.request(), confirmUnknown })
      if (success) { key.current = ''; if (card.current) card.current.open = false }
    } catch (error) { setActionError(error instanceof Error ? error.message : '图片任务未提交，请重试') }
    finally { submitLock.current = false; setSubmitting(false) }
  }
  const statusText = submitting ? '正在提交多角度生图任务…'
    : active ? '正在整理主图特征，完成后即可生成所选角度的图片。'
    : runningViews.length ? `正在逐张生成并检查，已有 ${completedViews.length} 张图片保存；先左侧、再右侧、背面及其他所选角度。`
    : !views.length ? '角度图片尚未生成。选好角度后，点击绿色按钮开始出图。'
    : completedViews.length ? `已保存 ${completedViews.length} 张角度图片，可点击放大、下载或单独调整。`
    : '本次角度图片尚未完成，请查看下方每张图片的状态。'
  return <section className={css.finalPanel} data-final-design="">
    <div className={css.sectionHeading}><h3>多角度图片</h3>{design ? <span className={css.copyState}>已确定当前图</span> : <small>选定主图，再生成不同角度</small>}</div>
    <div className={css.angleMaster}>
      <button type="button" className={css.angleMasterImage} aria-label="查看多角度主图" onClick={() => props.preview(chosen.id)}><img src={`${ETSY_API}/image?id=${encodeURIComponent(product.id)}&file=${encodeURIComponent(chosen.files[0])}`} alt="多角度生成基准图" /></button>
      <div><strong>{design ? '同一件产品 · 只换观察角度' : '先将当前图片确定为主设计'}</strong><p>{design ? '侧面、背面直接从完整主图生成，优先保留整张照片的材质观感；“只修材质”保留作后备。' : '主图确定后，选择需要的角度并点击生成图片。'}</p>{design?.multiViewAnchor ? <small data-view-anchor="">画幅：{design.multiViewAnchor.photography.aspect_ratio === 'auto' ? '跟随主图' : design.multiViewAnchor.photography.aspect_ratio} · {design.multiViewAnchor.photography.framing_policy === 'override_reference' ? `主图占比目标约${Math.round(design.multiViewAnchor.photography.subject_height_ratio * 100)}%` : '保留主图取景'} · 背景与光照跟随主图</small> : null}</div>
    </div>
    <div className={css.editRow}><input aria-label="固定形象细节" maxLength={2000} value={notes} onChange={event => setNotes(event.target.value)} placeholder="固定细节（可选）：如翅膀始终为条纹，手杖在角色右手" /><button type="button" disabled={props.busy || !!active || (!!design && design.notes === notes.trim())} onClick={() => { void runAction('confirm-design', { imageId: chosen.id, notes }) }}>{design ? '更新固定细节' : '确定为主设计'}</button></div>
    {actionError ? <p className={css.error} role="alert" data-angle-action-error="">{actionError}</p> : null}
    {materialProgress ? <p role="status" className={css.caption}>{materialProgress}</p> : null}
    {design?.materialReference?.samples.length ? <details className={css.report} data-material-samples=""><summary>主图材质参考 · {design.materialReference.samples.length}处原始局部</summary><p>{design.materialReference.fingerprint.summary}</p><div className={css.materialSamples}>{design.materialReference.samples.map(sample => <figure key={sample.file}><img src={`${ETSY_API}/image?id=${encodeURIComponent(product.id)}&file=${encodeURIComponent(sample.file)}`} alt={`${sample.region.label}原始材质`} /><figcaption>{sample.region.label} · {sample.width}×{sample.height}<br />{sample.region.appearance}</figcaption></figure>)}</div><small>局部样本供检查及后备材质修复使用；首次侧背面直接参考完整主图。</small></details> : null}
    {design ? <>
      {surfaceGroups.length ? <label className={css.surfaceModel}>侧面 / 背面模型<select aria-label="侧面背面模型" disabled={props.busy || surfaceSaving || submitting || !!materialProgress || runningViews.length > 0} value={JSON.stringify([surfaceModel.channelId, surfaceModel.model])} onChange={event => { const [channelId, model] = JSON.parse(event.target.value) as [string, string]; void saveSurfaceModel({ channelId, model }) }}>{surfaceGroups.flatMap(group => group.models.map(model => <option key={`${group.id}:${model}`} value={JSON.stringify([group.id, model])}>{group.name} · {model}</option>))}</select><small>单独用于侧面和背面；主图、正面和斜侧面继续使用上方模型。默认跟随当前生图模型；单独选择后随主设计保存。</small></label> : null}
      <div className={css.angleControls} role="group" aria-label="选择多角度图片">{viewAngles.map(angle => <label key={angle.value}><input type="checkbox" disabled={submitting} checked={angles.includes(angle.value)} onChange={event => { key.current = ''; setActionError(''); setAngles(previous => event.target.checked ? [...previous, angle.value] : previous.filter(value => value !== angle.value)) }} />{angle.label}</label>)}</div>
      <small className={css.directionHint} data-view-direction-hint="">以主图画面为准：左侧图脸朝右 →，右侧图脸朝左 ←。持物始终留在角色自身同一只手。</small>
      <div className={css.angleGenerateRow}><button className={css.angleGenerate} type="button" data-generate-angle-images="" disabled={props.busy || surfaceSaving || submitting || !!active || !!specEdit || !pendingAngles.length || notes.trim() !== design.notes} onClick={() => { void generate() }}>{submitting ? '正在提交图片任务…' : active ? '正在准备主图…' : !angles.length ? '请先选择角度' : pendingAngles.length ? `生成 ${pendingAngles.length} 张多角度图片` : runningViews.length ? '多角度图片生成中…' : '所选角度已有结果'}</button><small>{pendingAngles.length && !active ? '点击开始生图，图片会显示在下面' : '已有角度可在对应图片下调整或重做'}</small></div>
      <p className={css.angleStatus} role="status" data-angle-status="">{statusText}</p>
      {specEdit ? <p className={css.caption}>设定卡正在编辑，保存或取消后即可生成图片。</p> : notes.trim() !== design.notes ? <p className={css.caption}>固定细节已修改，请先点击“更新固定细节”。</p> : null}
      {design.planning.error ? <p className={css.error}>主图特征准备未完成：{design.planning.error}</p> : null}
      {(views.length || waitingSlots.length) ? <div className={css.angleGrid} data-angle-image-grid="">{views.map((image, i) => <article className={css.angleCard} key={image.id} data-angle-image={image.id}>
        <strong>{viewAngles.find(angle => angle.value === image.angle)?.label} {image.version && image.version > 1 ? `· 修改${image.version}` : ''}</strong>
        {!image.report?.viewpointCheck && image.files[0] && (image.angle === 'left' || image.angle === 'right') ? <small data-view-direction-state="UNKNOWN">朝向尚未检查 · 应朝画面{image.angle === 'left' ? '右 →' : '左 ←'}</small> : null}
        {image.report?.viewpointCheck ? <small data-view-direction-state={image.report.viewpointCheck.status} className={image.report.viewpointCheck.status === 'REVISE' ? css.error : undefined}>{image.report.viewpointCheck.status === 'REVISE' ? '朝向或配件位置需修正' : image.report.viewpointCheck.status === 'PASS' ? image.report.viewpointCheck.spatialChecks?.length ? '朝向与配件检查通过（建议）' : '朝向通过 · 配件待人工核对' : '朝向或配件待核对'} · 应朝画面{image.report.viewpointCheck.expectedFacing === 'screen-right' ? '右 →' : '左 ←'}</small> : null}
        {image.report?.reviewConflict ? <small className={css.error} data-review-conflict="">多次检查结论冲突，请人工核对</small> : null}
        {image.report?.viewChecks?.material ? <small data-view-material-state={image.report.viewChecks.material.status}>{image.report.viewChecks.material.status === 'REVISE' ? '材质存在变化，需核对' : image.report.viewChecks.material.status === 'PASS' ? '材质未发现明显偏差（AI建议）' : '材质尚不能确认一致'}</small> : null}
        {image.files[0] ? <button type="button" className={css.anglePreview} aria-label={`查看${viewAngles.find(angle => angle.value === image.angle)?.label}大图`} onClick={() => props.preview(image.id)}><img src={`${ETSY_API}/image?id=${encodeURIComponent(product.id)}&file=${encodeURIComponent(image.files[0])}`} alt={`${image.angle}视图`} /></button> : <div className={css.anglePlaceholder} data-angle-generation={image.generation.status}><span aria-hidden="true">▧</span><p>{image.generation.status === 'failed' ? '生成失败' : image.generation.status === 'unknown' ? '结果待核对' : image.generation.status === 'skipped' ? '等待重新准备' : image.generation.status === 'cancelled' ? '已停止' : image.generation.status === 'queued' ? '排队等待生图…' : '图片生成中…'}</p></div>}
        {image.generation.error ? <small className={css.error}>{image.generation.error}</small> : null}
        {image.files[0] && (image.angle === 'left' || image.angle === 'right') ? <button type="button" disabled={props.busy || !!materialProgress || !!specEdit} onClick={() => { void runAction('revise', { imageId: image.id, instruction: '按主图纠正侧面朝向与配件近远侧，保留原连接位置，远侧配件自然遮挡，不做镜像。', viewRestart: true, generation: props.request() }) }}>纠正朝向</button> : null}
        {image.files[0] && ['failed', 'unknown'].includes(image.quality.status) ? <small className={css.error}>检查未完成：{image.quality.error || '未收到完整结果'}<button type="button" disabled={props.busy || !!materialProgress} onClick={() => { void runAction('retry', { stage: 'quality', imageId: image.id }) }}>重新检查</button></small> : null}
        {image.files[0] ? <><small>{(image.identityRevision ?? 1) !== (design.specRevision ?? 1) ? '对应旧设定卡' : image.viewApproved ? '✓ 已核对一致' : '待核对一致性'}</small><div className={css.imageActions}><button type="button" disabled={props.busy || !!materialProgress || (image.identityRevision ?? 1) !== (design.specRevision ?? 1)} onClick={() => { void runAction('approve-view', { imageId: image.id, approved: !image.viewApproved }) }}>{image.viewApproved ? '撤回确认' : '核对一致'}</button><button type="button" onClick={() => { setEditId(image.id); setInstruction('') }}>调整</button><button type="button" disabled={props.busy || !!materialProgress || !!specEdit} onClick={() => { void runAction('revise', { imageId: image.id, instruction: '仅恢复为主图对应部件的材质；保留当前角度、造型、配件、背景、光线与构图。', materialOnly: true, generation: props.request() }) }}>只修材质</button><button type="button" disabled={props.busy || !!materialProgress || !!specEdit} onClick={() => { void runAction('revise', { imageId: image.id, instruction: '按主设计和当前设定卡重新生成这个角度，保持固定细节一致。', viewRestart: true, generation: props.request() }) }}>重做</button><a href={`${ETSY_API}/image?id=${encodeURIComponent(product.id)}&file=${encodeURIComponent(image.files[0])}`} download={`角度_${image.angle}_${i + 1}.${image.files[0].split('.').at(-1)}`}>下载</a></div></> : ['failed', 'cancelled', 'unknown'].includes(image.generation.status) ? <button type="button" disabled={props.busy || !!materialProgress} onClick={() => { const confirmUnknown = image.generation.status === 'unknown'; if (confirmUnknown && !window.confirm('上次生图结果不明，确认重新生成？')) return; void runAction('retry', { stage: 'generation', imageId: image.id, generation: props.request(), confirmUnknown }) }}>重试</button> : null}
        {image.report ? <details className={css.report}><summary>一致性检查建议 · {image.report.status === 'PASS' ? '未发现明显偏差' : image.report.status === 'UNKNOWN' ? '待核对' : '发现偏差'}</summary><p>{image.report.summary}</p>{image.report.viewpointCheck ? <><p>朝向依据：{image.report.viewpointCheck.evidence}</p>{image.report.viewpointCheck.spatialChecks?.map(check => <p key={check.label}>{check.label}：应在{check.expected === 'far' ? '远' : '近'}侧 · {check.status === 'PASS' ? '符合（建议）' : check.status === 'REVISE' ? '位置需修正' : '待核对'} · {check.evidence}</p>)}</> : null}{image.report.viewChecks ? Object.entries(viewCheckLabels).map(([key, label]) => { const check = image.report!.viewChecks![key as keyof typeof viewCheckLabels]; return <p key={key}>{label}：{check.status === 'PASS' ? '通过' : check.status === 'REVISE' ? '需修正' : '不确定'} · {check.evidence}</p> }) : null}{image.report.materialComparison ? Object.entries(materialCriteria).map(([key, label]) => { const check = image.report!.materialComparison![key as keyof typeof materialCriteria]; return <p key={key}>{label}：{check.status === 'MATCH' ? '接近主图' : check.status === 'DRIFT' ? '存在变化' : '不确定'} · {check.evidence}</p> }) : null}{image.report.issues.map((issue, i) => <p key={i}>{issue.problem}：{issue.suggestion}</p>)}{image.report.uncertainties.map((text, i) => <small key={i}>{text}</small>)}<small>AI检查仅供参考；只有你“核对一致”的角度才参与后续结构参考，材质始终跟随主图。</small></details> : image.files[0] ? <small>{['queued', 'running'].includes(image.quality.status) ? '正在检查一致性，完成后继续下一角度…' : '一致性检查未完成，当前图不会自动传给下一角度'}</small> : null}
      </article>)}{waitingSlots.map(angle => <article className={`${css.angleCard} ${css.angleWaitingCard}`} key={`waiting-${angle.value}`} data-angle-placeholder={angle.value}><strong>{angle.label}</strong><div className={css.anglePlaceholder}><span aria-hidden="true">▧</span><p>{submitting ? '正在提交…' : active ? '主图准备完成后可生成' : '等待点击生成图片'}</p><small>{angle.label}图片将显示在这里</small></div></article>)}</div> : null}
      {design.spec ? <details className={css.identityDetails} ref={card} data-identity-card=""><summary>形象设定（辅助信息）· 第{design.specRevision ?? 1}版</summary>{specEdit ? <div className={css.specEditor}><label>主体描述<textarea aria-label="设定卡主体描述" value={specEdit.spec.summary} onChange={event => setSpecEdit({ ...specEdit, spec: { ...specEdit.spec, summary: event.target.value } })} /></label><label>固定细节（每行一项）<textarea aria-label="设定卡固定细节" value={specEdit.spec.locks.join('\n')} onChange={event => setSpecEdit({ ...specEdit, spec: { ...specEdit.spec, locks: event.target.value.split('\n') } })} /></label><label>待核对细节（确认后可移到固定细节）<textarea aria-label="设定卡未知细节" value={specEdit.spec.unseen.join('\n')} onChange={event => setSpecEdit({ ...specEdit, spec: { ...specEdit.spec, unseen: event.target.value.split('\n') } })} /></label><div className={css.actions}><button type="button" disabled={props.busy} onClick={() => { void runAction('edit-identity', { designId: design.id, spec: { ...specEdit.spec, locks: specEdit.spec.locks.map(value => value.trim()).filter(Boolean), unseen: specEdit.spec.unseen.map(value => value.trim()).filter(Boolean) }, specRevision: specEdit.revision }).then(ok => { if (ok) setSpecEdit(undefined) }) }}>保存设定卡</button><button type="button" onClick={() => setSpecEdit(undefined)}>取消编辑</button></div></div> : <><p>{design.spec.summary}</p>{design.spec.locks.map((lock, i) => <p key={i}>{lock}</p>)}{design.spec.unseen.map((note, i) => <small key={i}>待核对：{note}</small>)}<button type="button" onClick={() => setSpecEdit({ spec: structuredClone(design.spec!), revision: design.specRevision ?? 1 })}>编辑设定卡</button></>}</details> : null}
      {editId ? <div className={css.editRow}><input aria-label="角度修正要求" value={instruction} onChange={event => setInstruction(event.target.value)} placeholder="例如：翅膀保持主图的条纹，不要变成圆点" /><button type="button" disabled={props.busy || !!specEdit || !instruction.trim()} onClick={() => { void runAction('revise', { imageId: editId, instruction, generation: props.request() }).then(success => { if (success) { setEditId(''); setInstruction('') } }) }}>修正这个角度</button><button type="button" onClick={() => setEditId('')}>取消</button></div> : null}
    </> : null}
  </section>
}

import { randomUUID } from 'node:crypto'
import type { GenerationTask, GenerateRequest, GeneratedImage } from '../protocol.ts'
import type { GenerationTaskQueue } from '../task-queue.ts'
import type { PromptModelConfig } from '../prompt-enhancer.ts'
import { EtsyStore } from './store.ts'
import { liveEtsyModels, mergeCopyRepair, validateCopy, validateReferencePlan, type EtsyModels } from './models.ts'
import { emptyStage, type CallRecord, type CopyContext, type EtsyProduct, type ProductImage, type ProductStart, type ReferencePlan, type Stage, type FinalDesign, type ViewAngle, type ReferenceInput } from './types.ts'
import { selectedCopy, productStages } from './selected-copy.ts'
import { listingUsesEnglish } from './copy-style.ts'
import { creativityMode, referenceGenerationPrompt, refinementPrompt } from './design-strategy.ts'
import { viewPrompt } from './creation-flow.ts'
import { FELT_RULES_VERSION, composeFeltPrompt, makeFeltContext, normalizeFeltProfile, profileForEdit, normalizeProfileV2 } from './felt/composer.ts'
import { CURRENT_MATERIAL, normalizeMaterialPreset } from './felt/material-v1-0-2.ts'
import { defaultPhotography, effectivePhotography, normalizePhotography, photographyBlock } from './felt/photography-options.ts'
import { isCheckedReference, multiViewPrompt, turntableOrder, type MultiViewContext } from './multi-view/consistency-v1.ts'
import { normalizeMaterialAppearance } from './multi-view/material-lock-v1.ts'
import { isSideBack, firstPassSurfacePrompt } from './multi-view/surface-continuity-v1.ts'
import { directionFor, validateViewpoint } from './multi-view/view-direction-v1.ts'
import { createDirectionGuide } from './multi-view/direction-guide.ts'
import { spatialLocks, reconcileSpatialReview } from './multi-view/spatial-v1.ts'

export interface WorkflowDeps {
  queue: GenerationTaskQueue
  models: () => { vision: PromptModelConfig; copy: PromptModelConfig }
  store?: EtsyStore
  client?: EtsyModels
  enabled?: () => boolean
  cleanupProject?: (id: string) => Promise<void>
  imageModel?: (request: GenerateRequest) => { model: string; subscription?: string }
}
export class EtsyWorkflow {
  readonly store: EtsyStore
  readonly ready: Promise<void>
  private products: EtsyProduct[] = []
  private serial: Promise<unknown> = Promise.resolve()
  private readonly controllers = new Map<string, AbortController>()
  private readonly generationTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly pending: Array<() => Promise<void>> = []
  private readonly unsubscribe: () => void
  private running = 0
  private disposed = false
  constructor(private readonly deps: WorkflowDeps) {
    this.store = deps.store ?? new EtsyStore()
    this.ready = this.recover()
    this.unsubscribe = deps.queue.subscribe(task => {
      // 使用现有队列的完成回调；异步业务失败不能打断原生生图队列。
      if (['completed', 'failed', 'cancelled'].includes(task.status)) void this.onGeneration(task).catch(error => {
        const product = this.products.find(product => product.images.some(image => image.taskId === task.id))
        if (product) this.recordAsyncFailure(product.id, error)
      })
    })
    void this.ready.then(() => {
      for (const product of this.products) if (!product.cancelled) {
        if (product.planning?.status === 'queued') this.enqueue(() => this.runPlanning(product.id))
        else if (product.referencePlan) this.enqueue(() => this.resumePlannedImages(product.id))
        for (const design of product.finalDesigns ?? []) {
          if (design.planning.status === 'queued') this.enqueue(() => this.runViewPlanning(product.id, design.id))
          else if (design.spec) this.enqueue(() => this.resumeViewImages(product.id, design.id))
        }
        this.schedule(product)
      }
    }).catch(() => {})
  }
  private async recover(): Promise<void> {
    this.products = await this.store.load()
    for (const product of this.products) {
      let changed = false
      for (const call of product.calls) if (call.status === 'running' || call.status === 'queued') {
        call.status = 'unknown'; call.error = '宿主中断，需核对上游状态后显式重试'; changed = true
      }
      for (const design of product.finalDesigns ?? []) if (design.planning.status === 'running') { design.planning.status = 'unknown'; design.planning.error = '主设计分析结果不明，请核对后重试'; changed = true }
      for (const design of product.finalDesigns ?? []) if (design.materialPlanning && ['queued', 'running'].includes(design.materialPlanning.status)) { design.materialPlanning.status = 'unknown'; design.materialPlanning.error = '主图材质分析中断，核对后可重试'; changed = true }
      for (const image of product.images) {
        if (image.kind === 'view' && image.generation.status === 'queued' && image.generation.attempts === 0) {
          const design = product.finalDesigns?.find(design => design.id === image.finalDesignId)
          if (design && (design.spec || design.planning.status === 'queued')) continue
          image.generation.status = 'skipped'; image.quality.status = 'skipped'; changed = true; continue
        }
        if (image.generation.status === 'queued' && (product.planning?.status === 'queued' || product.referencePlan) && image.generation.attempts === 0) continue
        if (['running', 'queued'].includes(image.generation.status)) {
          image.generation.status = 'unknown'; image.generation.error = '旧生成队列未持久化，禁止自动重发'; changed = true
        }
        if (image.quality.status === 'running') { image.quality.status = 'unknown'; image.quality.error = '检测请求结果不明'; changed = true }
        if (image.copyStage?.status === 'running') { image.copyStage.status = 'unknown'; image.copyStage.error = '文案请求结果不明，未自动重发'; changed = true }
        if (image.copyStage?.status === 'queued' && !['queued', 'running', 'completed'].includes(image.generation.status)) { image.copyStage.status = 'skipped'; changed = true }
      }
      if (product.planning?.status === 'running') {
        product.planning.status = 'unknown'; product.planning.error = '分析请求结果不明，未自动重发'; changed = true
        for (const image of product.images) if (image.kind !== 'view' && image.generation.attempts === 0) image.generation.status = 'skipped'
      }
      if (this.settleImageDependencies(product)) changed = true
      if (product.copyMode === 'per-image') this.syncSelectedCopy(product)
      else if (product.copyStage.status === 'running') { product.copyStage.status = 'unknown'; product.copyStage.error = '文案请求结果不明'; changed = true }
      if (product.copyStage.status === 'queued' && !product.images.some(image => image.generation.status === 'completed' || image.generation.status === 'queued')) {
        product.copyStage.status = 'skipped'; product.copyStage.error = '没有已确认成功的图片，文案未启动'; changed = true
      }
      if (changed) await this.store.save(product)
    }
  }
  private tx<T>(action: () => Promise<T>): Promise<T> {
    const result = this.serial.then(async () => { await this.ready; return action() })
    this.serial = result.catch(() => {})
    return result
  }
  private find(id: string): EtsyProduct {
    const product = this.products.find(item => item.id === id)
    if (!product) throw new Error('找不到商品项目')
    return product
  }
  async list(): Promise<EtsyProduct[]> {
    await this.ready; await this.serial
    return structuredClone(this.products)
  }
  async get(id: string): Promise<EtsyProduct> {
    await this.ready; await this.serial
    return structuredClone(this.find(id))
  }
  async configureModels(action: () => Promise<void>): Promise<void> {
    await this.tx(async () => {
      const busy = this.products.some(product => productStages(product).some(stage => ['queued', 'running'].includes(stage.status)))
      if (busy) throw new Error('请等待当前创作和文案任务完成后，再修改模型')
      await action()
    })
  }
  async remove(id: string): Promise<{ deleted: true; id: string }> {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new Error('无效商品 ID')
    return this.tx(async () => {
      const product = this.products.find(product => product.id === id)
      if (!product) return { deleted: true, id }
      const stages = productStages(product)
      if (stages.some(stage => stage && ['queued', 'running'].includes(stage.status)) || product.calls.some(call => this.controllers.has(call.id))) throw new Error('本组任务尚未结束，请先停止任务，稍候再删除')
      this.deps.queue.removeProject(id)
      await this.deps.cleanupProject?.(id)
      await this.store.remove(id)
      this.products = this.products.filter(product => product.id !== id)
      return { deleted: true, id }
    })
  }
  async start(input: ProductStart, existingImage?: GeneratedImage, reference?: { creativity: 'gentle' | 'balanced' | 'bold' }): Promise<EtsyProduct> {
    return this.tx(async () => {
      if (this.disposed) throw new Error('商品工作流已关闭')
      if (this.deps.enabled?.() === false) throw new Error('生图插件已停用，请先在设置中启用')
      const existing = this.products.find(product => product.requestKey === input.requestKey)
      if (existing) return structuredClone(existing)
      const { image, images, feltContext: _previousFelt, ...request } = input.generation
      request.materialPreset = normalizeMaterialPreset(request.materialPreset ?? CURRENT_MATERIAL)
      const photography = normalizePhotography(input.photography, { ...defaultPhotography(input.creationTask ?? 'redesign'), ...(request.size !== 'auto' ? { aspect_ratio: request.size } : {}) })
      photographyBlock(effectivePhotography(photography, input.facts.requirements), 'minimal', input.facts.requirements)
      const product: EtsyProduct = {
        schema: 1, source: reference ? 'reference' : existingImage ? 'existing-image' : 'generated', id: randomUUID(), requestKey: input.requestKey, createdAt: Date.now(), updatedAt: Date.now(), revision: 0,
        facts: structuredClone(input.facts), factsRevision: 1, visualRuleVersion: FELT_RULES_VERSION,
        photography,
        ...(reference ? { creationTask: input.creationTask ?? 'redesign', copyTiming: input.copyTiming ?? 'all' } : {}), request: { ...request, n: 1 }, referenceFiles: [],
        images: Array.from({ length: input.count }, () => ({ id: randomUUID(), generation: emptyStage(), quality: emptyStage(), files: [] })),
        copyStage: emptyStage(), copyVersions: [], calls: [], errors: [], cancelled: false,
        options: { autoCheck: input.autoCheck !== false, maxCalls: input.maxCalls ?? 24, maxStageAttempts: 3,
          timeoutMs: Math.max(1000, Math.min(300_000, input.timeoutMs ?? 90_000)), autoRevise: false },
      }
      if (input.previousProjectId) {
        const previous = this.find(input.previousProjectId)
        product.previousProjectId = previous.id; product.round = (previous.round ?? 1) + 1
        product.previousDirections = [...previous.previousDirections ?? [], ...previous.referencePlan?.plans.map(plan => plan.direction) ?? []].slice(-40)
      }
      const references = [image, ...(images ?? [])].filter((value): value is string => typeof value === 'string' && value !== '')
      for (const dataUrl of references.slice(0, 5)) {
        const match = /^data:(image\/(png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(dataUrl)
        if (!match) throw new Error('主体参考图格式不支持')
        product.referenceFiles.push(await this.store.saveImage(product.id, { mime: match[1], b64: match[3] }))
      }
      if (input.references) product.designReferences = product.referenceFiles.map((file, index) => ({ file, role: index === 0 ? 'subject' : input.references![index]?.role ?? 'detail', note: input.references![index]?.note ?? '' }))
      await this.store.save(product)
      this.products.unshift(product)
      if (reference) {
        product.copyMode = 'per-image'
        product.images.forEach(image => { image.copyStage = product.copyTiming === 'selected' ? { status: 'skipped', attempts: 0 } : emptyStage(); image.copyFactsRevision = product.factsRevision ?? 1 })
        product.planning = emptyStage(); product.creativity = reference.creativity; product.selectionRevision = 1
        await this.store.save(product); this.enqueue(() => this.runPlanning(product.id))
        return structuredClone(product)
      }
      if (existingImage) {
        if (product.images.length !== 1) throw new Error('复用图片一次只处理一张')
        const item = product.images[0]
        try {
          item.files.push(await this.store.saveImage(product.id, existingImage))
          item.generation = { status: 'completed', attempts: 0, finishedAt: Date.now() }
        } catch (error) {
          item.generation = { status: 'failed', attempts: 0, error: this.safeError(error) }
          item.quality.status = 'skipped'; product.copyStage.status = 'skipped'
          product.copyStage.error = '已有图片无法归档，未启动模型调用'
        }
        await this.store.save(product)
        this.schedule(product)
        return structuredClone(product)
      }
      for (const item of product.images) {
        await this.dispatchImage(product, item, { ...product.request, image, images })
      }
      await this.store.save(product)
      return structuredClone(product)
    })
  }
  private async dispatchImage(product: EtsyProduct, item: ProductImage, request: GenerateRequest): Promise<void> {
    if (product.cancelled || item.generation.status !== 'queued') return
    let call: CallRecord | undefined, submitted = false
    try {
      const plan = product.referencePlan?.plans.find(plan => plan.id === item.planId)
      const design = product.finalDesigns?.find(design => design.id === (item.finalDesignId ?? item.identityDesignId))
      const parent = product.images.find(image => image.id === item.parentImageId)
      const stage = item.kind === 'view' ? 'multi-view' : item.parentImageId ? 'refinement' : 'generation'
      const targetModel = this.deps.imageModel?.(request) ?? { model: request.upstream ?? request.model }
      const photo = normalizePhotography(request.photography ?? item.visualRules?.photography ?? request.feltContext?.photography ?? parent?.visualRules?.photography ?? product.photography, { ...defaultPhotography(product.creationTask, stage !== 'generation'), ...(request.size !== 'auto' ? { aspect_ratio: request.size } : {}) })
      const requirements = [product.facts.requirements, ...(product.designReferences ?? []).map(reference => reference.note), design?.notes].filter(Boolean).join('\n')
      const description = [plan?.name, plan?.direction, plan?.changes.join(' '), plan?.prompt, design?.spec?.summary, design?.spec?.locks.join(' '), product.facts.name].filter(Boolean).join('\n')
      const selectedMaterial = request.materialPreset ?? item.visualRules?.materialPreset ?? parent?.visualRules?.materialPreset ?? product.request.materialPreset ?? CURRENT_MATERIAL
      const sourceProfile = (stage === 'refinement' || item.editInstruction ? parent?.visualRules?.profile : undefined) ?? design?.spec?.feltProfile ?? plan?.feltProfile ?? product.referencePlan?.feltProfile
      const profile = selectedMaterial === 'needle_felt_v2_0' ? normalizeProfileV2(sourceProfile) : profileForEdit(sourceProfile, description, item.editInstruction ?? '')
      const viewContext = stage === 'multi-view' ? request.feltContext?.multiView : undefined
      const visualContext = makeFeltContext({ basePrompt: request.feltContext?.basePrompt ?? request.prompt, stage, task: product.creationTask ?? 'redesign',
        materialPreset: selectedMaterial,
        profile,
        description,
        userRequirements: viewContext ? design?.notes : requirements, latestInstruction: item.editInstruction, multiReference: !!request.images?.length, version: product.visualRuleVersion ?? FELT_RULES_VERSION, photography: photo, multiView: viewContext })
      const applied = composeFeltPrompt(visualContext, targetModel.model, targetModel.subscription)
      item.visualRules = applied
      request = { ...request, prompt: applied.prompt, feltContext: visualContext, size: applied.photography.aspect_ratio }
      item.renderSettings = { model: request.model, upstream: request.upstream, channelId: request.channelId, size: request.size, quality: request.quality, detail: request.detail }
      if (item.generation.attempts >= product.options.maxStageAttempts) throw new Error('已达到这张图片的重试次数上限')
      call = await this.reserve(product, 'generation', item.id, request.model)
      if (!call) throw new Error('达到商品调用次数上限')
      item.generation = { status: 'running', attempts: item.generation.attempts + 1, startedAt: Date.now() }
      await this.store.save(product)
      const task = this.deps.queue.submit({ ...request, n: 1, projectId: product.id, projectName: product.facts.name })
      submitted = true; item.taskId = task.id
      await this.store.save(product)
      const timer = setTimeout(() => { void this.generationTimeout(product.id, item.id).catch(error => this.recordAsyncFailure(product.id, error)) }, product.options.timeoutMs * 3)
      timer.unref?.(); this.generationTimers.set(task.id, timer)
    } catch (error) {
      // 已派发的请求不能自动重发；派发前失败则保留可重试的明确失败状态。
      item.generation.status = submitted ? 'unknown' : 'failed'
      item.generation.error = this.safeError(error); item.generation.finishedAt = Date.now()
      call ??= product.calls.findLast(record => record.stage === 'generation' && record.target === item.id && record.status === 'running')
      if (call) { call.status = item.generation.status; call.error = item.generation.error; call.finishedAt = Date.now() }
      if (submitted && item.taskId) this.deps.queue.cancel(item.taskId)
      this.settleImageDependencies(product); this.settleCopyWithoutImages(product)
      await this.persistFailure(product)
    }
  }
  private async resumePlannedImages(id: string): Promise<void> {
    await this.tx(async () => {
      const product = this.find(id)
      if (!product.referencePlan || product.cancelled || !product.images.some(image => image.kind !== 'view' && image.generation.status === 'queued')) return
      const references = await Promise.all(product.referenceFiles.map(file => this.store.dataUrl(id, file)))
      for (const image of product.images) {
        const plan = product.referencePlan.plans.find(plan => plan.id === image.planId)
        if (image.kind !== 'view' && plan && image.generation.status === 'queued') await this.dispatchImage(product, image, { ...product.request, mode: 'edit', image: references[0], images: references.slice(1), prompt: referenceGenerationPrompt(product.referencePlan, plan, creativityMode(product.creativity), product.facts.requirements, product.request.materialPreset ?? CURRENT_MATERIAL) })
      }
      await this.store.save(product)
    })
  }
  private async runPlanning(id: string): Promise<void> {
    let job: { product: EtsyProduct; call: CallRecord; config: PromptModelConfig } | undefined
    try { await this.tx(async () => {
      const product = this.find(id)
      if (product.cancelled || product.planning?.status !== 'queued') return
      const config = this.deps.models().vision
      if (this.deps.enabled?.() === false || !config.apiUrl || !config.model) {
        product.planning.status = 'failed'; product.planning.error = '请先在高级工具配置可看图的分析模型'
        product.images.forEach(image => { image.generation.status = 'skipped'; image.quality.status = 'skipped'; if (image.copyStage) image.copyStage.status = 'skipped' }); product.copyStage.status = 'skipped'
        await this.store.save(product); return
      }
      const call = await this.reserve(product, 'planning', id, config.model)
      if (!call) { product.planning.status = 'failed'; product.planning.error = '分析调用额度不足'; product.images.forEach(image => { image.generation.status = 'skipped'; image.quality.status = 'skipped'; if (image.copyStage) image.copyStage.status = 'skipped' }); product.copyStage.status = 'skipped'; await this.store.save(product); return }
      product.planning.status = 'running'; product.planning.attempts++; product.planning.startedAt = Date.now()
      await this.store.save(product); job = { product: structuredClone(product), call, config }
    }) } catch (error) {
      await this.tx(async () => {
        const current = this.find(id)
        if (current.planning) { current.planning.status = current.cancelled ? 'cancelled' : 'failed'; current.planning.error = '分析任务启动保存失败：' + this.safeError(error) }
        const call = current.calls.findLast(call => call.stage === 'planning' && call.status === 'running')
        if (call) { call.status = 'failed'; call.error = this.safeError(error); call.finishedAt = Date.now() }
        for (const image of current.images) if (image.kind !== 'view' && image.generation.attempts === 0) image.generation.status = 'skipped'
        this.settleImageDependencies(current); this.settleCopyWithoutImages(current)
        await this.persistFailure(current)
      })
      return
    }
    if (!job) return
    const { product, config, call } = job, controller = new AbortController()
    this.controllers.set(call.id, controller)
    const timer = setTimeout(() => controller.abort(new Error('参考图分析超时，未自动重试')), product.options.timeoutMs)
    try {
      const planner = this.deps.client?.plan ?? liveEtsyModels.plan!
      const references: ReferenceInput[] = await Promise.all(product.referenceFiles.map(async (file, index) => ({ dataUrl: await this.store.dataUrl(id, file), role: product.designReferences?.[index]?.role ?? (index === 0 ? 'subject' : 'detail'), note: product.designReferences?.[index]?.note ?? '' })))
      const count = product.images.filter(image => image.kind !== 'view').length
      const work = planner(config, product.facts, references[0].dataUrl, product.creativity ?? 'balanced', controller.signal, { count, task: product.creationTask ?? 'redesign', references, previousDirections: product.previousDirections,
        visualRuleVersion: product.visualRuleVersion ?? FELT_RULES_VERSION, materialPreset: product.request.materialPreset ?? CURRENT_MATERIAL, photography: effectivePhotography(normalizePhotography(product.photography, defaultPhotography(product.creationTask)), product.facts.requirements) })
      const aborted = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true }))
      const plan = validateReferencePlan({ ...await Promise.race([work, aborted]), materialPreset: product.request.materialPreset ?? CURRENT_MATERIAL }, count)
      await this.tx(async () => {
        const current = this.find(id)
        if (current.cancelled) return
        current.referencePlan = { ...plan, visualRuleVersion: product.visualRuleVersion ?? FELT_RULES_VERSION }
        if (current.facts.name.startsWith('参考图设计')) current.facts.name = plan.name
        current.planning!.status = 'completed'; current.planning!.finishedAt = Date.now(); call.status = 'completed'; call.finishedAt = Date.now()
        current.images.forEach((image, index) => { image.planId = plan.plans[index].id; image.version = 1 })
        await this.store.save(current)
      })
      await this.resumePlannedImages(id)
    } catch (error) {
      await this.tx(async () => {
        const current = this.find(id)
        current.planning!.status = current.cancelled ? 'cancelled' : controller.signal.aborted ? 'unknown' : 'failed'
        current.planning!.error = this.safeError(error); call.status = current.planning!.status; call.error = current.planning!.error; call.finishedAt = Date.now()
        for (const image of current.images) if (image.generation.attempts === 0) { image.generation.status = 'skipped'; image.quality.status = 'skipped' }
        for (const image of current.images) if (image.copyStage) { image.copyStage.status = 'skipped'; image.copyStage.error = '参考图分析未完成' }
        current.copyStage.status = current.cancelled ? 'cancelled' : 'skipped'; current.copyStage.error = '参考图分析未完成，未启动生图或文案'
        await this.persistFailure(current)
      })
    } finally { clearTimeout(timer); this.controllers.delete(call.id) }
  }
  private async reserve(product: EtsyProduct, stage: CallRecord['stage'], target: string, model: string): Promise<CallRecord | undefined> {
    if (product.cancelled || product.calls.length >= product.options.maxCalls) return undefined
    const call: CallRecord = { id: randomUUID(), stage, target, model, status: 'running', createdAt: Date.now(), cost: null }
    product.calls.push(call)
    await this.store.save(product)
    return call
  }
  private async onGeneration(task: GenerationTask): Promise<void> {
    await this.tx(async () => {
      clearTimeout(this.generationTimers.get(task.id)); this.generationTimers.delete(task.id)
      const product = this.products.find(product => product.images.some(image => image.taskId === task.id))
      if (!product) return
      const item = product.images.find(image => image.taskId === task.id)!
      if (item.generation.status !== 'running') return
      const call = product.calls.findLast(call => call.stage === 'generation' && call.target === item.id)!
      if (task.result?.visualRules) item.visualRules = task.result.visualRules
      if (task.status !== 'completed' || !task.result?.images.length) {
        item.generation.status = task.status === 'cancelled' ? 'cancelled' : 'failed'
        item.generation.error = task.error ?? '生成没有返回图片'
        item.quality.status = 'skipped'
        if (item.copyStage) item.copyStage.status = 'skipped'
        call.status = item.generation.status; call.error = item.generation.error
      } else {
        try {
          const outputs = task.result.images
          for (let index = 0; index < outputs.length; index++) {
            const outputItem: ProductImage = index === 0 ? item : { id: randomUUID(), taskId: task.id, planId: item.planId, version: (item.version ?? 1) + index, parentImageId: item.parentImageId, editInstruction: item.editInstruction, kind: item.kind, finalDesignId: item.finalDesignId, angle: item.angle, identityRevision: item.identityRevision, identityDesignId: item.identityDesignId, visualRules: item.visualRules, generation: { status: 'completed', attempts: 1 }, quality: emptyStage(), files: [] }
            outputItem.files.push(await this.store.saveImage(product.id, outputs[index]))
            outputItem.generation.status = 'completed'; outputItem.generation.finishedAt = Date.now()
            if (product.copyMode === 'per-image') { outputItem.copyStage ??= product.copyTiming === 'selected' || item.kind === 'view' ? { status: 'skipped', attempts: 0 } : emptyStage(); outputItem.copyFactsRevision = product.factsRevision ?? 1 }
            if (index > 0) product.images.push(outputItem)
          }
          call.status = 'completed'
          if (item.kind !== 'view' && !product.selectedImageId) { product.selectedImageId = item.id; product.selectionRevision = 1 }
          if (product.pendingSelection?.imageId === item.id && product.pendingSelection.revision === (product.selectionRevision ?? 1)) {
            this.chooseImage(product, item.id, true); delete product.pendingSelection
          }
        } catch (error) {
          item.generation.status = 'failed'; item.generation.error = this.safeError(error)
          if (item.copyStage) item.copyStage.status = 'skipped'
          call.status = 'failed'; call.error = item.generation.error
          product.errors.push('商品图片归档失败，原有生成结果可在普通历史中核查：' + item.generation.error)
        }
      }
      call.finishedAt = Date.now()
      if (product.pendingSelection?.imageId === item.id) delete product.pendingSelection
      this.settleImageDependencies(product); this.settleCopyWithoutImages(product)
      try { await this.store.save(product) }
      catch (error) {
        product.errors.push('图片状态保存失败：' + this.safeError(error))
        if (!await this.persistFailure(product)) {
          // 图片已归档但状态尚未落盘时，不派发新的付费分析任务。
          for (const stage of [item.quality, item.copyStage]) if (stage?.status === 'queued') {
            stage.status = 'failed'; stage.error = '图片状态尚未保存，请检查磁盘后重试'
          }
          if (product.copyMode === 'per-image') this.syncSelectedCopy(product)
          else if (product.copyStage.status === 'queued') { product.copyStage.status = 'failed'; product.copyStage.error = '图片状态尚未保存，请检查磁盘后重试' }
          return
        }
      }
      this.schedule(product)
    })
  }
  private async generationTimeout(id: string, imageId: string): Promise<void> {
    await this.tx(async () => {
      const product = this.find(id), image = product.images.find(image => image.id === imageId)!
      if (image.generation.status !== 'running') return
      image.generation.status = 'unknown'; image.generation.error = '生图超时，上游可能仍已计费；请先核对结果，不自动重发'
      image.quality.status = 'skipped'
      if (image.copyStage) image.copyStage.status = 'skipped'
      const call = product.calls.findLast(call => call.stage === 'generation' && call.target === image.id)
      if (call) { call.status = 'unknown'; call.error = image.generation.error; call.finishedAt = Date.now() }
      if (image.taskId) this.deps.queue.cancel(image.taskId)
      if (product.pendingSelection?.imageId === image.id) delete product.pendingSelection
      this.settleCopyWithoutImages(product)
      await this.store.save(product)
      if (image.kind === 'view') this.schedule(product)
    })
  }
  private settleImageDependencies(product: EtsyProduct): boolean {
    let changed = false
    for (const image of product.images) {
      if (['queued', 'running', 'completed'].includes(image.generation.status) && !product.cancelled) continue
      for (const stage of [image.quality, image.copyStage]) if (stage && stage.status === 'queued') {
        stage.status = product.cancelled ? 'cancelled' : 'skipped'
        stage.error = product.cancelled ? '后续任务已停止，已有结果保留' : '图片未成功，后续任务未启动'
        stage.finishedAt = Date.now(); changed = true
      }
    }
    return changed
  }
  private async persistFailure(product: EtsyProduct): Promise<boolean> {
    try { await this.store.save(product); return true }
    catch (error) { product.errors.push('保存失败，当前错误状态尚未写入磁盘：' + this.safeError(error)); return false }
  }
  private recordAsyncFailure(id: string, error: unknown): void {
    const product = this.products.find(product => product.id === id)
    if (product) product.errors.push('后台操作失败：' + this.safeError(error))
  }
  private settleCopyWithoutImages(product: EtsyProduct): void {
    if (product.copyStage.status === 'queued' && product.images.every(image => !['queued', 'running'].includes(image.generation.status)) && !product.images.some(image => image.generation.status === 'completed')) {
      product.copyStage.status = 'skipped'; product.copyStage.error = '全部图片未成功，文案未启动；已保留生成错误供核查'
    }
  }
  private schedule(product: EtsyProduct): void {
    if (this.disposed || product.cancelled) return
    if (product.copyMode === 'per-image') {
      // 每张图独立准备文案；同一图片只派发一次，整体并发仍受后台队列限制。
      for (const image of product.images) if (image.kind !== 'view' && image.generation.status === 'completed' && image.copyStage?.status === 'queued') {
        image.copyStage.status = 'running'
        this.enqueue(() => this.runStage(product.id, 'copy', image.id))
      }
      this.syncSelectedCopy(product)
    }
    for (const image of product.images) if (image.generation.status === 'completed' && image.quality.status === 'queued') {
      if (!product.options.autoCheck && image.kind !== 'view') image.quality.status = 'skipped'
      else {
        // 本地调度标记不代表外部调用；runStage 会在持久化事务内再次检查。
        image.quality.status = 'running'
        this.enqueue(() => this.runStage(product.id, 'quality', image.id))
      }
    }
    if (product.copyMode !== 'per-image' && product.copyStage.status === 'queued' && !product.calls.some(call => call.stage === 'copy' && call.status === 'running') && product.images.some(image => image.generation.status === 'completed')) {
      product.copyStage.status = 'running'
      this.enqueue(() => this.runStage(product.id, 'copy', product.id))
    }
    for (const design of product.finalDesigns ?? []) if (design.multiViewAnchor && design.spec && product.images.some(image => image.finalDesignId === design.id && image.generation.status === 'queued')) this.enqueue(() => this.resumeViewImages(product.id, design.id))
  }
  private chooseImage(product: EtsyProduct, imageId: string, confirmed: boolean): void {
    if (product.copyMode === 'per-image') {
      if (product.selectedImageId !== imageId) product.selectionRevision = (product.selectionRevision ?? 1) + 1
      product.selectedImageId = imageId; product.selectionConfirmed = confirmed; this.syncSelectedCopy(product); return
    }
    const previous = product.selectedImageId ?? product.images.find(image => image.generation.status === 'completed')?.id
    product.imageCopies ??= {}
    if (product.copy && product.copyStage.status === 'completed' && previous && (product.copyFactsRevision ?? 1) === (product.factsRevision ?? 1)) {
      product.imageCopies[product.copyImageId ?? previous] = { copy: structuredClone(product.copy), factsRevision: product.factsRevision ?? 1 }
    }
    if (previous !== imageId) product.selectionRevision = (product.selectionRevision ?? 1) + 1
    product.selectedImageId = imageId; product.selectionConfirmed = confirmed
    const cache = product.imageCopies[imageId]
    const validCache = cache?.factsRevision === (product.factsRevision ?? 1) && listingUsesEnglish(cache.copy)
    if (validCache) { product.copy = structuredClone(cache.copy); product.copyImageId = imageId; product.copyFactsRevision = cache.factsRevision }
    else { delete product.copy; delete product.copyImageId; delete product.copyFactsRevision }
    const active = product.calls.some(call => call.stage === 'copy' && call.status === 'running')
    if (active) { product.copyRefreshRequested = !validCache; return }
    product.copyStage = validCache ? { status: 'completed', attempts: 0 } : emptyStage()
  }
  async selectImage(id: string, imageId: string): Promise<EtsyProduct> {
    return this.tx(async () => {
      const product = this.find(id), image = product.images.find(image => image.id === imageId)
      if (!image?.files.length || image.generation.status !== 'completed' || image.kind === 'view') throw new Error('请选择已生成的设计方案')
      this.chooseImage(product, imageId, true)
      if (product.cancelled && product.copyStage.status === 'queued') product.copyStage.status = 'cancelled'
      await this.store.save(product); this.schedule(product)
      return structuredClone(product)
    })
  }
  async revise(id: string, instruction: string, normalized: GenerateRequest, imageId?: string, materialOnly = false, viewRestart = false): Promise<EtsyProduct> {
    return this.tx(async () => {
      const product = this.find(id), parent = imageId ? product.images.find(image => image.id === imageId) : product.images.find(image => image.id === product.selectedImageId) ?? product.images.find(image => image.generation.status === 'completed')
      if (product.calls.some(call => this.controllers.has(call.id) && call.status === 'cancelled')) throw new Error('正在结束上一次请求，请稍候再修改')
      if (product.calls.length >= product.options.maxCalls) throw new Error('调用额度已耗尽，已有图片和修改要求已保留')
      if (!parent?.files[0] || parent.generation.status !== 'completed') throw new Error('请先选择一张成功设计图')
      if (materialOnly && parent.kind !== 'view') throw new Error('仅角度图支持按主图恢复材质')
      if (viewRestart && parent.kind !== 'view') throw new Error('仅角度图支持从主图重新生成')
      product.selectedImageId ??= parent.id; product.selectionRevision ??= 1
      if (!instruction.trim() || instruction.length > 2000) throw new Error('请输入两千字以内的修改要求')
      if (product.images.some(image => image.parentImageId === parent.id && image.generation.status === 'running')) throw new Error('这张图正在修改，请稍候')
      if (product.copyMode !== 'per-image') {
        if (product.copyStage.status === 'running') throw new Error('请等待当前文案请求完成后再修改图片')
        product.imageCopies ??= {}
        if (product.copy && product.copyImageId) product.imageCopies[product.copyImageId] = { copy: structuredClone(product.copy), factsRevision: product.copyFactsRevision ?? 1 }
        product.copyMode = 'per-image'
        for (const previous of product.images) {
          const cache = product.imageCopies[previous.id]
          previous.copyStage = { status: cache?.factsRevision === (product.factsRevision ?? 1) && listingUsesEnglish(cache.copy) ? 'completed' : 'skipped', attempts: 0 }
          previous.copyFactsRevision = cache?.factsRevision
        }
      }
      const source = await this.store.dataUrl(id, parent.files[0])
      const references = await Promise.all(product.referenceFiles.slice(0, 4).map(file => this.store.dataUrl(id, file)))
      product.cancelled = false
      const image: ProductImage = { id: randomUUID(), planId: parent.planId, parentImageId: parent.id, editInstruction: instruction.trim(), version: product.images.filter(image => image.planId === parent.planId).length + 1, generation: emptyStage(), quality: emptyStage(), files: [] }
      if (product.copyMode === 'per-image') { image.copyStage = emptyStage(); image.copyFactsRevision = product.factsRevision ?? 1 }
      if (parent.kind === 'view') { image.kind = 'view'; image.version = (parent.version ?? 1) + 1; image.finalDesignId = parent.finalDesignId; image.angle = parent.angle; image.copyStage = { status: 'skipped', attempts: 0 } }
      if (materialOnly) image.materialRepair = true
      if (viewRestart && !materialOnly) image.viewRestart = true
      else if (product.copyTiming === 'selected') image.copyStage = { status: 'skipped', attempts: 0 }
      product.images.push(image); if (image.kind !== 'view') product.pendingSelection = { imageId: image.id, revision: product.selectionRevision ?? 1 }
      if (image.kind === 'view') {
        const design = product.finalDesigns?.find(value => value.id === image.finalDesignId)
        if (!design) throw new Error('主设计不存在')
        this.ensureViewAnchor(product, design)
        if (viewRestart && isSideBack(image.angle)) design.sideBackModel = { model: normalized.model, channelId: normalized.channelId }
        image.viewRequest = this.lockedViewRequest(product, design, normalized)
        this.enqueue(() => this.resumeViewImages(product.id, design.id))
      }
      else {
        const master = [...product.finalDesigns ?? []].reverse().find(design => design.imageId === parent.id) ?? product.finalDesigns?.find(design => design.id === parent.identityDesignId)
        if (master) image.identityDesignId = master.id
        await this.dispatchImage(product, image, { ...normalized, mode: 'edit', image: source, images: references,
          prompt: refinementPrompt(instruction) + (master?.spec ? `\nCurrent identity card (keep non-requested details; this edit overrides conflicting old details): ${JSON.stringify(master.spec)}` : '') })
      }
      await this.store.save(product)
      if (image.generation.status === 'failed' || image.generation.status === 'unknown') throw new Error(image.generation.error ?? '修改图片未能启动，修改要求已保留')
      return structuredClone(product)
    })
  }
  async prepareMaterial(id: string, designId: string, confirmUnknown = false): Promise<EtsyProduct> {
    return this.tx(async () => {
      const product = this.find(id), design = product.finalDesigns?.find(value => value.id === designId)
      if (!design?.spec || design.planning.status !== 'completed') throw new Error('请先完成主设计设定卡')
      if (design.materialReference?.sourceImageId === design.imageId) return structuredClone(product)
      const fingerprint = normalizeMaterialAppearance(design.spec.materialAppearance)
      if (fingerprint) {
        design.materialReference = { sourceImageId: design.imageId, fingerprint, samples: [], createdAt: Date.now() }
        design.materialPlanning = { status: 'completed', attempts: design.materialPlanning?.attempts ?? 0 }; await this.store.save(product); return structuredClone(product)
      }
      if (design.materialPlanning && ['queued', 'running'].includes(design.materialPlanning.status)) return structuredClone(product)
      if (design.materialPlanning?.status === 'unknown' && !confirmUnknown) throw new Error('上次材质分析结果不明，请核对后确认重试')
      if ((design.materialPlanning?.attempts ?? 0) >= product.options.maxStageAttempts || product.calls.length >= product.options.maxCalls) throw new Error('材质分析调用额度已耗尽')
      product.cancelled = false; design.materialPlanning = { status: 'queued', attempts: design.materialPlanning?.attempts ?? 0 }
      await this.store.save(product); this.enqueue(() => this.runMaterialPlanning(id, designId)); return structuredClone(product)
    })
  }
  private async runMaterialPlanning(id: string, designId: string): Promise<void> {
    let call: CallRecord | undefined, config: PromptModelConfig | undefined, source: string | undefined
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await this.tx(async () => {
        const product = this.find(id), design = product.finalDesigns?.find(value => value.id === designId)
        if (!design?.materialPlanning || design.materialPlanning.status !== 'queued' || product.cancelled) return
        config = this.deps.models().vision
        if (!config.apiUrl || !config.model) throw new Error('请先配置可看图的分析模型')
        const master = product.images.find(image => image.id === design.imageId)
        if (!master?.files[0]) throw new Error('主图文件缺失')
        source = await this.store.dataUrl(id, master.files[0])
        design.materialPlanning.status = 'running'; design.materialPlanning.attempts++
        call = await this.reserve(product, 'material', design.id, config.model)
        if (!call) throw new Error('主图材质分析额度不足')
        this.controllers.set(call.id, controller)
        timer = setTimeout(() => controller.abort(new Error('材质分析超时，未自动重试')), product.options.timeoutMs)
      })
      if (!call || !config || !source) return
      const job = (this.deps.client?.material ?? liveEtsyModels.material!)(config, source, controller.signal)
      const abort = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true }))
      const fingerprint = normalizeMaterialAppearance(await Promise.race([job, abort]))
      if (!fingerprint) throw new Error('材质取样区域无效')
      await this.tx(async () => {
        const product = this.find(id), design = product.finalDesigns!.find(value => value.id === designId)!
        if (product.cancelled) return
        design.materialReference = { sourceImageId: design.imageId, fingerprint, samples: [], createdAt: Date.now() }
        design.materialPlanning!.status = 'completed'; call!.status = 'completed'; call!.finishedAt = Date.now(); await this.store.save(product)
      })
    } catch (error) {
      await this.tx(async () => {
        const product = this.find(id), design = product.finalDesigns?.find(value => value.id === designId)
        if (!design?.materialPlanning) return
        const status = product.cancelled ? 'cancelled' : controller.signal.aborted ? 'unknown' : 'failed'
        design.materialPlanning.status = status; design.materialPlanning.error = this.safeError(error)
        const record = call ?? product.calls.findLast(value => value.stage === 'material' && value.target === designId && value.status === 'running')
        if (record) { record.status = status; record.error = design.materialPlanning.error; record.finishedAt = Date.now() }
        await this.persistFailure(product)
      })
    } finally { clearTimeout(timer); if (call) this.controllers.delete(call.id) }
  }
  async attachMaterialSamples(id: string, designId: string, sourceImageId: string, samples: Array<{ index: number; dataUrl: string; width: number; height: number }>): Promise<EtsyProduct> {
    return this.tx(async () => {
      const product = this.find(id), design = product.finalDesigns?.find(value => value.id === designId), reference = design?.materialReference
      if (!design || !reference || design.imageId !== sourceImageId || reference.sourceImageId !== sourceImageId) throw new Error('材质样本与当前主图不一致')
      if (reference.samples.length) return structuredClone(product)
      if (!Array.isArray(samples) || samples.length !== reference.fingerprint.regions.length) throw new Error('材质局部样本不完整')
      const decoded = samples.map((sample, index) => {
        const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(sample.dataUrl)
        if (sample.index !== index || !match || !Number.isInteger(sample.width) || !Number.isInteger(sample.height) || sample.width < 24 || sample.height < 24 || sample.width > 4096 || sample.height > 4096 || match[1].length > 6 * 1024 * 1024) throw new Error('材质样本格式无效')
        const bytes = Buffer.from(match[1], 'base64')
        if (bytes.length < 24 || bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.readUInt32BE(16) !== sample.width || bytes.readUInt32BE(20) !== sample.height) throw new Error('材质样本尺寸与PNG原始像素不符')
        return { ...sample, b64: match[1] }
      })
      const files = []
      for (const sample of decoded) files.push({ file: await this.store.saveImage(id, { b64: sample.b64, mime: 'image/png' }), region: reference.fingerprint.regions[sample.index], width: sample.width, height: sample.height })
      reference.samples = files
      try { await this.store.save(product) } catch (error) { reference.samples = []; throw error }
      return structuredClone(product)
    })
  }
  private ensureViewAnchor(product: EtsyProduct, design: FinalDesign): void {
    if (design.multiViewAnchor) return
    const master = product.images.find(image => image.id === design.imageId)
    if (!master?.files.length || master.generation.status !== 'completed') throw new Error('定稿主图缺失，无法生成一致视角')
    const request = master.renderSettings ?? product.request
    design.multiViewAnchor = { version: '1.0', imageId: master.id,
      photography: normalizePhotography(master.visualRules?.photography ?? product.photography, { ...defaultPhotography(product.creationTask, true), aspect_ratio: request.size || 'auto' }),
      profile: normalizeFeltProfile(master.visualRules?.profile ?? design.spec?.feltProfile),
      inheritedModules: Object.fromEntries(Object.entries(master.visualRules?.modules ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
      quality: request.quality, detail: request.detail }
  }
  private lockedViewRequest(product: EtsyProduct, design: FinalDesign, request: GenerateRequest): GenerateRequest {
    this.ensureViewAnchor(product, design)
    const anchor = design.multiViewAnchor!
    // 全局摄影控件只用于探索/主图精修；定稿视角锁住主图的摄影、构图与清晰度档。
    const { image: _image, images: _images, feltContext: _context, ...clean } = request
    return { ...clean, prompt: '', mode: 'edit', n: 1, size: anchor.photography.aspect_ratio, photography: anchor.photography, quality: anchor.quality ?? request.quality, detail: anchor.detail ?? request.detail }
  }
  async confirmDesign(id: string, imageId: string, notes: string): Promise<EtsyProduct> {
    return this.tx(async () => {
      const product = this.find(id), image = product.images.find(image => image.id === imageId)
      if (!image?.files.length || image.generation.status !== 'completed' || image.kind === 'view') throw new Error('请选择生成成功的设计图')
      if (notes.length > 2000) throw new Error('固定细节请控制在2000字内')
      const existing = product.finalDesigns?.find(design => design.imageId === imageId && design.notes === notes.trim())
      if (existing) { this.ensureViewAnchor(product, existing); product.finalDesignId = existing.id; this.chooseImage(product, imageId, true); await this.store.save(product); return structuredClone(product) }
      if (product.calls.length >= product.options.maxCalls) throw new Error('当前项目调用额度已用完，无法分析设定卡')
      const design: FinalDesign = { id: randomUUID(), imageId, notes: notes.trim(), createdAt: Date.now(), planning: emptyStage(), specRevision: 1, approvedImageIds: [], requests: [], request: { ...product.request } }
      this.ensureViewAnchor(product, design)
      product.cancelled = false
      product.finalDesigns ??= []; product.finalDesigns.push(design); product.finalDesignId = design.id
      this.chooseImage(product, imageId, true)
      // 只为选定主图准备文案；其余探索图片保持按需状态。
      if (product.copyTiming === 'selected' && image.copyStage?.status === 'skipped' && !product.imageCopies?.[imageId] && !product.cancelled && product.calls.length < product.options.maxCalls) image.copyStage = { status: 'queued', attempts: image.copyStage.attempts }
      await this.store.save(product); this.enqueue(() => this.runViewPlanning(id, design.id)); this.schedule(product)
      return structuredClone(product)
    })
  }
  async editIdentity(id: string, designId: string, spec: { summary: string; locks: string[]; unseen: string[] }, expectedRevision: number): Promise<EtsyProduct> {
    return this.tx(async () => {
      const product = this.find(id), design = product.finalDesigns?.find(design => design.id === designId)
      if (!design || !design.spec) throw new Error('设定卡尚未准备完成')
      if ((design.specRevision ?? 1) !== expectedRevision) throw new Error('设定卡已更新，请载入最新版本后编辑')
      if (['queued', 'running'].includes(design.planning.status) || product.images.some(image => image.finalDesignId === designId && ['queued', 'running'].includes(image.generation.status))) throw new Error('请等本组角度生成结束后编辑设定卡')
      if (!spec.summary.trim() || !spec.locks.length || [...spec.locks, ...spec.unseen, spec.summary].some(value => typeof value !== 'string' || !value.trim() || value.length > 2000)) throw new Error('设定卡需包含主体描述和固定细节，每项不超过2000字')
      design.specHistory ??= []; design.specHistory.push(structuredClone(design.spec))
      design.spec = { ...structuredClone(spec), spatial: design.spec.spatial, visualRuleVersion: design.spec.visualRuleVersion ?? product.visualRuleVersion ?? FELT_RULES_VERSION, feltProfile: normalizeFeltProfile(undefined, `${spec.summary} ${spec.locks.join(' ')}`) }; design.specRevision = (design.specRevision ?? 1) + 1; design.approvedImageIds = []
      for (const image of product.images) if (image.finalDesignId === designId) image.viewApproved = false
      await this.store.save(product); return structuredClone(product)
    })
  }
  async prepareSpatial(id: string, designId: string, confirmUnknown = false): Promise<EtsyProduct> {
    return this.tx(async () => {
      const product = this.find(id), design = product.finalDesigns?.find(value => value.id === designId)
      if (!design?.spec) throw new Error('主设计特征尚未就绪')
      if (design.spec.spatial || ['queued','running'].includes(design.planning.status)) return structuredClone(product)
      if (product.images.some(image => image.finalDesignId === designId && ['queued','running'].includes(image.generation.status))) throw new Error('请等待当前角度任务完成后补查位置')
      if (design.planning.status === 'unknown' && !confirmUnknown) throw new Error('上次主图位置分析结果不明，请核对后重试')
      if (design.planning.attempts >= product.options.maxStageAttempts || product.calls.length >= product.options.maxCalls) throw new Error('主图分析重试次数或调用额度已用完')
      const previous = structuredClone(design.planning), revision = product.revision, updatedAt = product.updatedAt, cancelled = product.cancelled
      product.cancelled = false; design.planning = { ...design.planning, status: 'queued', error: undefined }
      try { await this.store.save(product) }
      catch (error) { design.planning = previous; product.revision = revision; product.updatedAt = updatedAt; product.cancelled = cancelled; throw error }
      this.enqueue(() => this.runViewPlanning(id, designId))
      return structuredClone(product)
    })
  }
  async updateBudget(id: string, maxCalls: number): Promise<EtsyProduct> {
    return this.tx(async () => {
      const product = this.find(id)
      if (!Number.isInteger(maxCalls) || maxCalls < product.calls.length || maxCalls > 100) throw new Error('调用上限须为已用次数到100之间的整数')
      product.options.maxCalls = maxCalls
      await this.store.save(product); return structuredClone(product)
    })
  }
  async generateViews(id: string, designId: string, angles: ViewAngle[], key: string, request: GenerateRequest, confirmUnknown = false, sideBackRequest?: GenerateRequest): Promise<EtsyProduct> {
    return this.tx(async () => {
      const product = this.find(id), design = product.finalDesigns?.find(design => design.id === designId)
      if (!design) throw new Error('请先确定主设计')
      if (product.calls.some(call => this.controllers.has(call.id) && call.status === 'cancelled')) throw new Error('正在结束上一次请求，请稍候再生成')
      if (!/^[a-zA-Z0-9-]{8,100}$/.test(key)) throw new Error('无效请求标识')
      if (design.requests.some(job => job.key === key)) return structuredClone(product)
      if (['running', 'queued'].includes(design.planning.status)) throw new Error('正在整理主设计，请稍候')
      if (design.planning.status === 'unknown' && !confirmUnknown) throw new Error('上次主设计分析结果不明，请核对后确认重试')
      if (!design.spec && design.planning.attempts >= product.options.maxStageAttempts) throw new Error('主设计分析重试次数已用完')
      const pendingAngles = turntableOrder.filter(angle => angles.includes(angle) && !product.images.some(image => image.finalDesignId === designId && image.angle === angle && (image.identityRevision ?? 1) === (design.specRevision ?? 1) && image.generation.status !== 'skipped' && (design.spec || image.generation.status !== 'cancelled')))
      if (!pendingAngles.length) return structuredClone(product)
      const required = (design.spec ? 0 : 1) + pendingAngles.length * 2
      if (product.calls.length + required > product.options.maxCalls) throw new Error(`本次多角度需要约${required}次调用，剩余额度不足；可在高级选项调整当前项目上限`)
      product.cancelled = false
      design.request = this.lockedViewRequest(product, design, request)
      if (sideBackRequest) design.sideBackModel = { channelId: sideBackRequest.channelId, model: sideBackRequest.model }
      const targets = pendingAngles.map(angle => {
        const image: ProductImage = { id: randomUUID(), kind: 'view', finalDesignId: design.id, angle, identityRevision: design.specRevision ?? 1, parentImageId: design.imageId, version: 1, files: [], generation: emptyStage(), quality: emptyStage(), copyStage: { status: 'skipped', attempts: 0 }, viewApproved: false, viewRequest: structuredClone(isSideBack(angle) && sideBackRequest ? this.lockedViewRequest(product, design, sideBackRequest) : design.request) }
        product.images.push(image); return image.id
      })
      design.requests.push({ key, imageIds: targets })
      design.planning = { ...design.planning, status: design.spec ? 'completed' : 'queued', error: undefined }
      await this.store.save(product)
      if (design.spec) this.enqueue(() => this.resumeViewImages(id, design.id))
      else this.enqueue(() => this.runViewPlanning(id, design.id))
      return structuredClone(product)
    })
  }
  async approveView(id: string, imageId: string, approved: boolean): Promise<EtsyProduct> {
    return this.tx(async () => {
      const product = this.find(id), image = product.images.find(image => image.id === imageId)
      const design = product.finalDesigns?.find(design => design.id === image?.finalDesignId)
      if (!design || !image?.files.length || image.generation.status !== 'completed') throw new Error('请选择已生成的角度图')
      if ((image.identityRevision ?? 1) !== (design.specRevision ?? 1)) throw new Error('这张图对应旧设定卡，请先按最新设定生成')
      image.viewApproved = approved
      design.approvedImageIds = design.approvedImageIds.filter(value => value !== imageId)
      if (approved) design.approvedImageIds.push(imageId)
      await this.store.save(product); return structuredClone(product)
    })
  }
  async setViewModel(id: string, designId: string, request: GenerateRequest): Promise<EtsyProduct> {
    return this.tx(async () => {
      const product = this.find(id), design = product.finalDesigns?.find(value => value.id === designId)
      if (!design) throw new Error('主设计不存在')
      if (product.images.some(image => image.finalDesignId === designId && ['queued', 'running'].includes(image.generation.status))) throw new Error('请等当前角度生成完成后再切换模型')
      const previous = design.sideBackModel, revision = product.revision, updatedAt = product.updatedAt
      design.sideBackModel = { channelId: request.channelId, model: request.model }
      try { await this.store.save(product) }
      catch (error) {
        // 只回滚本次选择及存档版本，保留其他任务正在持有的对象引用。
        if (previous) design.sideBackModel = previous
        else delete design.sideBackModel
        product.revision = revision; product.updatedAt = updatedAt
        throw error
      }
      return structuredClone(product)
    })
  }
  private viewReferenceItems(product: EtsyProduct, design: FinalDesign, excludeId?: string, correction?: ProductImage): Array<{ id: string; file: string; role: MultiViewContext['references'][number]['role'] }> {
    const master = product.images.find(image => image.id === design.imageId)
    if (!master?.files[0]) throw new Error('定稿主图缺失')
    const items: Array<{ id: string; file: string; role: MultiViewContext['references'][number]['role'] }> = [{ id: master.id, file: master.files[0], role: 'identity-anchor' }]
    for (const sample of design.materialReference?.samples ?? []) items.push({ id: sample.file, file: sample.file, role: 'material-detail' })
    if (correction?.files[0] && correction.id !== master.id) items.push({ id: correction.id, file: correction.files[0], role: 'angle-correction' })
    const seen = new Set<ViewAngle>()
    // 同一角度只取最新合格版本；检查不完整或有问题的图不传播给下一角度。
    const candidates = product.images.filter(image => image.finalDesignId === design.id && image.id !== excludeId && image.id !== correction?.id && image.viewApproved && isCheckedReference(image, design.specRevision ?? 1)).reverse().filter(image => { if (!image.angle || seen.has(image.angle)) return false; seen.add(image.angle); return true }).reverse()
    const slots = Math.max(0, 5 - items.length)
    for (const image of slots ? candidates.slice(-slots) : []) items.push({ id: image.id, file: image.files[0], role: 'human-confirmed' })
    for (const reference of product.designReferences ?? []) if (reference.role === 'view' && items.length < 5) items.push({ id: reference.file, file: reference.file, role: 'hidden-structure' })
    return items
  }
  private async viewReferences(product: EtsyProduct, design: FinalDesign, excludeId?: string): Promise<string[]> {
    return Promise.all(this.viewReferenceItems(product, design, excludeId).map(item => this.store.dataUrl(product.id, item.file)))
  }
  private async dispatchView(product: EtsyProduct, image: ProductImage, request: GenerateRequest): Promise<void> {
    const design = product.finalDesigns?.find(design => design.id === image.finalDesignId)
    if (!design?.spec || !image.angle) throw new Error('主设计特征尚未准备完成')
    if (design.multiViewAnchor) {
      const direct = isSideBack(image.angle) && !image.materialRepair && (!image.editInstruction || image.viewRestart)
      const correction = !direct && image.editInstruction && image.parentImageId !== design.imageId ? product.images.find(candidate => candidate.id === image.parentImageId) : undefined
      const sources = this.viewReferenceItems(product, design, image.id, correction).filter(source => !direct || source.role === 'identity-anchor')
      const direction = directionFor(image.angle)
      if (direction && !image.materialRepair) {
        design.directionGuides ??= []
        let guide = design.directionGuides.find(value => value.facing === direction.expectedFacing)
        if (!guide) {
          guide = { facing: direction.expectedFacing, file: await this.store.saveImage(product.id, { b64: createDirectionGuide(direction.expectedFacing).toString('base64'), mime: 'image/png' }), version: '1.0' }
          design.directionGuides.push(guide)
        }
        sources.splice(1, 0, { id: guide.file, file: guide.file, role: 'view-direction-guide' }); sources.splice(5)
      }
      const references = await Promise.all(sources.map(source => this.store.dataUrl(product.id, source.file)))
      const multiView: MultiViewContext = { anchor: structuredClone(design.multiViewAnchor), angle: image.angle, direction: directionFor(image.angle), fixedDetails: design.notes, identity: structuredClone(design.spec), correction: direct ? undefined : image.editInstruction, materialRepair: image.materialRepair, materialReference: !direct && design.materialReference ? structuredClone(design.materialReference) : undefined, ...(direct ? { surfaceStrategy: 'hero-direct-v1' as const, manualLocks: (design.specRevision ?? 1) > 1 ? design.spec.locks : undefined } : {}), references: sources.map((source, index) => ({ id: source.id, role: source.role, image: index + 1 })) }
      const prompt = direct ? firstPassSurfacePrompt(multiView) : multiViewPrompt(multiView)
      image.identityRevision = design.specRevision ?? 1
      await this.dispatchImage(product, image, { ...this.lockedViewRequest(product, design, request), image: references[0], images: references.slice(1), prompt,
        feltContext: makeFeltContext({ basePrompt: prompt, stage: 'multi-view', profile: multiView.anchor.profile, photography: multiView.anchor.photography, multiView }) })
      return
    }
    let references = await this.viewReferences(product, design), correctionSource = false
    if (image.editInstruction && image.parentImageId !== design.imageId) {
      const parent = product.images.find(candidate => candidate.id === image.parentImageId)
      if (parent?.files[0]) { references = [references[0], await this.store.dataUrl(product.id, parent.files[0]), ...references.slice(1)].slice(0, 5); correctionSource = true }
    }
    image.identityRevision = design.specRevision ?? 1
    await this.dispatchImage(product, image, { ...request, mode: 'edit', image: references[0], images: references.slice(1), prompt: viewPrompt(design, image.angle, image.editInstruction, correctionSource), n: 1 })
  }
  private async resumeViewImages(id: string, designId: string): Promise<void> {
    await this.tx(async () => {
      const product = this.find(id), design = product.finalDesigns?.find(design => design.id === designId)
      if (product.cancelled || !design?.spec) return
      if (!product.images.some(image => image.finalDesignId === designId && image.generation.status === 'queued')) return
      if (design.multiViewAnchor && product.images.some(image => image.finalDesignId === design.id && (image.generation.status === 'running' || (image.generation.status === 'completed' && ['queued', 'running'].includes(image.quality.status))))) return
      for (const image of product.images) if (image.finalDesignId === designId && image.generation.status === 'queued') {
        try { await this.dispatchView(product, image, image.viewRequest ?? design.request) }
        catch (error) { image.generation.status = 'failed'; image.generation.error = this.safeError(error); image.quality.status = 'skipped' }
        if (design.multiViewAnchor && (image.generation as Stage).status === 'running') break
      }
      await this.store.save(product)
    })
  }
  private async runViewPlanning(id: string, designId: string): Promise<void> {
    let call: CallRecord | undefined, config: PromptModelConfig | undefined, design: FinalDesign | undefined
    const controller = new AbortController()
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await this.tx(async () => {
        const product = this.find(id), current = product.finalDesigns?.find(design => design.id === designId)
        if (!current || current.planning.status !== 'queued' || product.cancelled) return
        config = this.deps.models().vision
        if (!config.apiUrl || !config.model) throw new Error('请配置可看图的分析模型')
        current.planning.status = 'running'; current.planning.attempts++
        call = await this.reserve(product, 'identity', designId, config.model)
        if (!call) throw new Error('主设计分析调用额度不足')
        design = structuredClone(current); this.controllers.set(call.id, controller)
        timeout = setTimeout(() => controller.abort(new Error('主设计分析超时，请核对后重试')), product.options.timeoutMs)
      })
      if (!design || !call || !config) return
      if (controller.signal.aborted) throw controller.signal.reason
      const product = await this.get(id), image = product.images.find(image => image.id === design!.imageId)!
      const client = this.deps.client?.identity ?? liveEtsyModels.identity!
      const work = client(config, await this.store.dataUrl(id, image.files[0]), design.notes, controller.signal, { materialPreset: image.visualRules?.materialPreset })
      const abort = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true }))
      const spec = await Promise.race([work, abort])
      if (!spec.summary || !spec.locks.length) throw new Error('主设计特征返回不完整')
      await this.tx(async () => {
        const currentProduct = this.find(id), current = currentProduct.finalDesigns!.find(design => design.id === designId)!
        if (currentProduct.cancelled) return
        if (current.spec) {
          if (!spec.spatial) throw new Error('主图位置分析未返回画面位置，未提交生图')
          current.specHistory ??= []; current.specHistory.push(structuredClone(current.spec))
          // 旧设定卡仅补充位置并移除未经人工确认的左右推断，不覆盖人工细节和材质记录。
          current.spec = { ...current.spec, spatial: spec.spatial, locks: (current.specRevision ?? 1) > 1 ? current.spec.locks : spatialLocks(current.spec.locks, spec.spatial) }
        } else current.spec = spec
        current.planning.status = 'completed'; call!.status = 'completed'; call!.finishedAt = Date.now()
        await this.store.save(currentProduct)
      })
      await this.resumeViewImages(id, designId)
    } catch (error) {
      await this.tx(async () => {
        const product = this.find(id), current = product.finalDesigns?.find(design => design.id === designId)
        if (!current) return
        current.planning.status = product.cancelled ? 'cancelled' : controller.signal.aborted ? 'unknown' : 'failed'
        current.planning.error = this.safeError(error)
        const record = call ?? product.calls.findLast(record => record.stage === 'identity' && record.target === designId && record.status === 'running')
        if (record) { record.status = current.planning.status; record.error = current.planning.error; record.finishedAt = Date.now() }
        for (const image of product.images) if (image.finalDesignId === designId && image.generation.status === 'queued') { image.generation.status = 'skipped'; image.quality.status = 'skipped' }
        await this.persistFailure(product)
      })
    } finally { clearTimeout(timeout); if (call) this.controllers.delete(call.id) }
  }
  async prepareCopies(id: string): Promise<EtsyProduct> {
    return this.tx(async () => {
      const product = this.find(id)
      if (product.calls.some(call => this.controllers.has(call.id) && call.status === 'cancelled')) throw new Error('正在结束上一次请求，请稍候再补齐文案')
      if (productStages(product).some(stage => ['queued', 'running'].includes(stage.status))) throw new Error('请等待当前任务完成后再补齐文案')
      product.imageCopies ??= {}
      if (product.copy && product.copyImageId) product.imageCopies[product.copyImageId] = { copy: structuredClone(product.copy), factsRevision: product.copyFactsRevision ?? 1 }
      const revision = product.factsRevision ?? 1
      const cacheReady = (image: ProductImage): boolean => {
        const cache = product.imageCopies?.[image.id]
        return !!cache && cache.factsRevision === revision && (image.copyFactsRevision === undefined || image.copyFactsRevision === revision) && listingUsesEnglish(cache.copy)
          && (product.copyMode !== 'per-image' || image.copyStage?.status === 'completed')
      }
      const missing = product.images.filter(image => image.kind !== 'view' && image.generation.status === 'completed' && image.files.length && !cacheReady(image))
      const eligible = missing.filter(image => {
        if (image.copyStage?.status === 'unknown') return false
        const changedFacts = image.copyFactsRevision !== undefined && image.copyFactsRevision !== revision
        return changedFacts || (image.copyStage?.attempts ?? 0) < product.options.maxStageAttempts
      })
      if (missing.length && !eligible.length) throw new Error('未完成文案的重试次数已耗尽或结果不明，请核对单图状态后处理')
      if (product.calls.length + eligible.length > product.options.maxCalls) throw new Error('剩余调用额度不足以补齐本组文案；已有结果已保留')
      product.cancelled = false; product.copyMode = 'per-image'
      for (const image of product.images) {
        const cache = product.imageCopies[image.id]
        if (!missing.includes(image) && cache?.factsRevision === revision && listingUsesEnglish(cache.copy)) {
          image.copyStage = { ...(image.copyStage ?? { attempts: 0 }), status: 'completed' }
          delete image.copyStage.error
        } else if (eligible.includes(image)) {
          // 补齐不能重置同一资料版本的失败次数，否则绕过每图重试上限。
          const changedFacts = image.copyFactsRevision !== undefined && image.copyFactsRevision !== revision
          image.copyStage = { status: 'queued', attempts: changedFacts ? 0 : image.copyStage?.attempts ?? 0 }
          image.copyFactsRevision = revision
        } else if (!image.copyStage && !image.files.length) image.copyStage = { status: 'skipped', attempts: 0 }
      }
      this.syncSelectedCopy(product); await this.store.save(product); this.schedule(product)
      return structuredClone(product)
    })
  }
  private enqueue(run: () => Promise<void>): void { this.pending.push(run); this.drain() }
  private drain(): void {
    while (!this.disposed && this.running < 3 && this.pending.length > 0) {
      const run = this.pending.shift()!
      this.running++
      void run().catch(() => {}).finally(() => { this.running--; this.drain() })
    }
  }
  private safeError(error: unknown): string {
    let message = error instanceof Error ? error.message : String(error)
    try {
      for (const config of Object.values(this.deps.models())) if (config.apiKey) message = message.split(config.apiKey).join('[密钥已隐藏]')
    } catch { /* 配置不可用时仍保留脱敏错误。 */ }
    return message.replace(/Bearer\s+\S+/gi, 'Bearer [已隐藏]').slice(0, 1200)
  }
  private async runStage(id: string, kind: 'quality' | 'copy', target: string): Promise<void> {
    let context: { product: EtsyProduct; stage: Stage; image?: ProductImage; call: CallRecord; config: PromptModelConfig; copyImage?: ProductImage } | undefined
    try { await this.tx(async () => {
      const product = this.find(id)
      const perImage = kind === 'copy' && product.copyMode === 'per-image'
      const image = kind === 'quality' || perImage ? product.images.find(image => image.id === target) : undefined
      const stage = kind === 'copy' ? perImage ? image?.copyStage : product.copyStage : image?.quality
      if (!stage) return
      if (product.cancelled || stage.status !== 'running') return
      if (kind === 'copy' && product.calls.some(call => call.stage === 'copy' && call.status === 'running' && (!perImage || call.target === target))) return
      let config: PromptModelConfig
      try {
        if (this.deps.enabled?.() === false) throw new Error('生图插件已停用')
        config = this.deps.models()[kind === 'quality' ? 'vision' : 'copy']
      } catch (error) {
        stage.status = 'failed'; stage.error = this.safeError(error); if (perImage) this.syncSelectedCopy(product); await this.store.save(product); return
      }
      if (!config.apiUrl || !config.model) {
        stage.status = 'failed'; stage.error = `请先配置${kind === 'quality' ? '视觉质检' : '商品文案'}模型，图片已保留`
        if (perImage) this.syncSelectedCopy(product); await this.store.save(product); return
      }
      if (stage.attempts >= product.options.maxStageAttempts) {
        stage.status = 'failed'; stage.error = '已达到该阶段的重试次数上限'; if (perImage) this.syncSelectedCopy(product); await this.store.save(product); return
      }
      const call = await this.reserve(product, kind, target, config.model)
      if (!call) { stage.status = 'failed'; stage.error = '达到商品调用次数上限'; if (perImage) this.syncSelectedCopy(product); await this.store.save(product); return }
      stage.attempts++; stage.startedAt = Date.now(); delete stage.error
      await this.store.save(product)
      if (perImage) this.syncSelectedCopy(product)
      context = { product: structuredClone(product), stage, image, call, config, copyImage: perImage ? image : product.images.find(image => image.id === product.selectedImageId) ?? product.images.find(image => image.generation.status === 'completed') }
    }) } catch (error) {
      await this.tx(async () => {
        const product = this.find(id), perImage = kind === 'copy' && product.copyMode === 'per-image'
        const image = product.images.find(image => image.id === target)
        const stage = kind === 'copy' ? perImage ? image?.copyStage : product.copyStage : image?.quality
        if (stage) { stage.status = product.cancelled ? 'cancelled' : 'failed'; stage.error = '任务启动保存失败：' + this.safeError(error); stage.finishedAt = Date.now() }
        const call = product.calls.findLast(call => call.stage === kind && call.target === target && call.status === 'running')
        if (call) { call.status = stage?.status ?? 'failed'; call.error = stage?.error; call.finishedAt = Date.now() }
        if (perImage) this.syncSelectedCopy(product)
        await this.persistFailure(product)
        if (kind === 'quality') this.schedule(product)
      })
      return
    }
    if (!context) { if (kind === 'quality') await this.tx(async () => this.schedule(this.find(id))); return }
    const { product, config, call } = context
    const controller = new AbortController()
    this.controllers.set(call.id, controller)
    const timeout = setTimeout(() => controller.abort(new Error('请求超时，上游可能仍已计费，核对后再重试')), product.options.timeoutMs)
    try {
      const client = this.deps.client ?? liveEtsyModels
      const previousCopy = context.copyImage ? product.imageCopies?.[context.copyImage.id] : undefined
      const copyContext: CopyContext | undefined = context.copyImage && (product.source === 'reference' || product.selectionConfirmed) ? {
        imageId: context.copyImage.id, plan: product.referencePlan?.plans.find(plan => plan.id === context!.copyImage!.planId), image: await this.store.dataUrl(id, context.copyImage.files[0]), editInstruction: context.copyImage.editInstruction, parentImageId: context.copyImage.parentImageId,
        ...(previousCopy?.factsRevision === (product.factsRevision ?? 1) && previousCopy.copy.fieldIssues?.length ? { repair: structuredClone(previousCopy.copy) } : {}),
      } : undefined
      const viewDesign = context.image?.kind === 'view' ? product.finalDesigns?.find(design => design.id === context!.image!.finalDesignId) : undefined
      let reviewSources = viewDesign ? this.viewReferenceItems(product, viewDesign, context.image?.id).filter(source => source.role !== 'material-detail' && source.role !== 'view-direction-guide') : undefined
      const reviewContext = context.image?.visualRules?.multiView
      const direction = context.image?.angle ? directionFor(context.image.angle) : undefined
      const opposite = direction && viewDesign ? [...product.images].reverse().find(image => image.finalDesignId === viewDesign.id && image.angle === (direction.angle === 'left' ? 'right' : 'left') && (image.identityRevision ?? 1) === (context!.image!.identityRevision ?? 1) && image.generation.status === 'completed' && image.files[0]) : undefined
      let exactOppositeDuplicate = false
      if (opposite && reviewSources) {
        // 另一侧仅用于成对检查；即使未获确认也可用于判断重复，绝不作为生图参考。
        reviewSources = reviewSources.filter(source => source.id !== opposite.id).slice(0, 4)
        reviewSources.push({ id: opposite.id, file: opposite.files[0], role: 'opposite-view-check' })
        const [candidateBytes, otherBytes] = await Promise.all([this.store.readImage(id, context.image!.files[0]), this.store.readImage(id, opposite.files[0])])
        exactOppositeDuplicate = candidateBytes.data.equals(otherBytes.data)
      }
      const multiView = reviewContext && reviewSources ? { ...reviewContext, direction, oppositeViewId: opposite?.id, exactOppositeDuplicate, references: reviewSources.map((source, index) => ({ id: source.id, role: source.role, image: index + 2 })) } : undefined
      const work = async () => kind === 'copy'
        ? await client.copy(config, product.facts, controller.signal, copyContext)
        : await client.vision(config, product.facts, await this.store.dataUrl(id, context!.image!.files[0]),
          reviewSources ? await Promise.all(reviewSources.map(source => this.store.dataUrl(id, source.file))) : await Promise.all(product.referenceFiles.slice(0, 5).map(file => this.store.dataUrl(id, file))),
          viewDesign ? [] : await Promise.all(product.images.filter(image => image.id !== target && image.kind !== 'view').flatMap(image => image.files).slice(0, 3).map(file => this.store.dataUrl(id, file))), controller.signal,
          { identity: viewDesign?.spec, angle: context!.image?.angle, ...(viewDesign ? {} : { creativity: product.creativity, plan: product.referencePlan?.plans.find(plan => plan.id === context!.image!.planId) }), editInstruction: context!.image!.editInstruction, photography: context!.image!.visualRules?.photography, materialPreset: context!.image!.visualRules?.materialPreset, multiView })
      const aborted = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason ?? new Error('请求取消')), { once: true }))
      const result = await Promise.race([work(), aborted])
      await this.tx(async () => {
        const current = this.find(id)
        const perImage = kind === 'copy' && current.copyMode === 'per-image'
        const currentImage = current.images.find(image => image.id === target)
        const stage = kind === 'copy' ? perImage ? currentImage!.copyStage! : current.copyStage : currentImage!.quality
        if (current.cancelled) { call.status = 'cancelled'; return }
        if (perImage) {
          current.imageCopies ??= {}
          const previous = current.imageCopies[target]?.copy
          if (previous) { currentImage!.copyVersions ??= []; currentImage!.copyVersions.push(structuredClone(previous)) }
          const generated = result as NonNullable<EtsyProduct['copy']>
          const repaired = previous?.fieldIssues?.length && current.imageCopies[target]?.factsRevision === (product.factsRevision ?? 1) ? mergeCopyRepair(previous, generated) : generated
          current.imageCopies[target] = { copy: structuredClone(repaired), factsRevision: product.factsRevision ?? 1 }
          stage.status = 'completed'; stage.finishedAt = Date.now(); delete stage.error
          currentImage!.copyFactsRevision = product.factsRevision ?? 1
          this.syncSelectedCopy(current)
        } else if (kind === 'copy') {
          const sourceId = context!.copyImage?.id
          current.imageCopies ??= {}
          const previous = sourceId ? current.imageCopies[sourceId] : undefined
          const generated = result as NonNullable<EtsyProduct['copy']>
          const repaired = previous?.copy.fieldIssues?.length && previous.factsRevision === (product.factsRevision ?? 1) ? mergeCopyRepair(previous.copy, generated) : generated
          if (sourceId) current.imageCopies[sourceId] = { copy: structuredClone(repaired), factsRevision: product.factsRevision ?? 1 }
          const selected = current.selectedImageId ?? sourceId
          if (selected !== sourceId || (current.factsRevision ?? 1) !== (product.factsRevision ?? 1)) {
            this.restoreSelectedCopy(current)
          } else {
            if (current.copy) current.copyVersions.push(structuredClone(current.copy))
            current.copy = repaired; current.copyImageId = sourceId
            current.copyFactsRevision = product.factsRevision ?? 1
            stage.status = 'completed'; stage.finishedAt = Date.now(); delete stage.error
          }
          current.copyRefreshRequested = false
        } else {
          const image = current.images.find(image => image.id === target)!
          if (image.report) { image.qualityHistory ??= []; image.qualityHistory.push(structuredClone(image.report)); image.qualityHistory = image.qualityHistory.slice(-8) }
          image.report = reconcileSpatialReview(result as NonNullable<ProductImage['report']>, image.qualityHistory ?? []); image.qualityFactsRevision = product.factsRevision ?? 1
          if (direction && opposite && exactOppositeDuplicate && image.report) {
            image.report.viewpointCheck = validateViewpoint(image.report.viewpointCheck, direction, opposite.id, true)
            image.report.status = 'REVISE'
            image.report.issues.push({ area: 'viewpoint', problem: '左右侧返回了相同图片文件', suggestion: '重新生成该侧，保持规定朝向和同一持物手', evidence: '归档图片字节完全相同' })
          }
        }
        if (kind !== 'copy') { stage.status = 'completed'; stage.finishedAt = Date.now(); delete stage.error }
        call.status = 'completed'; call.finishedAt = Date.now()
        await this.store.save(current)
        this.schedule(current)
      })
    } catch (error) {
      await this.tx(async () => {
        const current = this.find(id)
        const perImage = kind === 'copy' && current.copyMode === 'per-image'
        const stage = kind === 'copy' ? perImage ? current.images.find(image => image.id === target)!.copyStage! : current.copyStage : current.images.find(image => image.id === target)!.quality
        const status = current.cancelled ? 'cancelled' : controller.signal.aborted ? 'unknown' : 'failed'
        call.status = status; call.error = this.safeError(error); call.finishedAt = Date.now()
        if (perImage) { stage.status = status; stage.error = call.error; stage.finishedAt = Date.now(); this.syncSelectedCopy(current) }
        else if (kind === 'copy' && current.selectedImageId && current.selectedImageId !== context!.copyImage?.id && !current.cancelled) this.restoreSelectedCopy(current)
        else { stage.status = status; stage.error = call.error; stage.finishedAt = Date.now() }
        await this.persistFailure(current)
        this.schedule(current)
      })
    } finally { clearTimeout(timeout); this.controllers.delete(call.id) }
  }
  private restoreSelectedCopy(product: EtsyProduct): void {
    const cache = product.selectedImageId ? product.imageCopies?.[product.selectedImageId] : undefined
    if (cache?.factsRevision === (product.factsRevision ?? 1) && listingUsesEnglish(cache.copy)) {
      product.copy = structuredClone(cache.copy); product.copyImageId = product.selectedImageId; product.copyFactsRevision = cache.factsRevision
      product.copyStage = { status: 'completed', attempts: 0 }
    } else { delete product.copy; delete product.copyImageId; delete product.copyFactsRevision; product.copyStage = emptyStage() }
  }
  private syncSelectedCopy(product: EtsyProduct): void {
    const image = product.images.find(image => image.id === product.selectedImageId) ?? product.images.find(image => image.generation.status === 'completed')
    const copy = selectedCopy(product)
    if (image?.copyStage) product.copyStage = { ...image.copyStage }
    if (copy && image) { product.copy = structuredClone(copy); product.copyImageId = image.id; product.copyFactsRevision = product.factsRevision ?? 1 }
    else { delete product.copy; delete product.copyImageId; delete product.copyFactsRevision }
  }
  async retry(id: string, kind: 'generation' | 'quality' | 'copy', imageId?: string, confirmUnknown = false, generation?: GenerateRequest): Promise<EtsyProduct> {
    return this.tx(async () => {
      const product = this.find(id)
      if (product.calls.some(call => this.controllers.has(call.id) && call.status === 'cancelled')) throw new Error('正在结束上一次请求，请稍候再重试')
      if (kind === 'generation') {
        const image = product.images.find(image => image.id === imageId)
        if (!image) throw new Error('请选择需要重试的图片')
        if (['queued', 'running', 'completed'].includes(image.generation.status)) return structuredClone(product)
        if (image.generation.status === 'unknown' && !confirmUnknown) throw new Error('上次生图结果不明，请核对上游结果并确认重新调用后重试')
        if (image.generation.attempts >= product.options.maxStageAttempts || product.calls.length >= product.options.maxCalls) throw new Error('重试次数或调用额度已耗尽')
        if (image.kind === 'view') {
          product.cancelled = false; image.generation = { status: 'queued', attempts: image.generation.attempts }; image.quality = { status: 'queued', attempts: image.quality.attempts }; image.viewApproved = false
          const design = product.finalDesigns?.find(value => value.id === image.finalDesignId)
          if (!design) throw new Error('主设计不存在')
          if (generation && isSideBack(image.angle) && !image.materialRepair) design.sideBackModel = { model: generation.model, channelId: generation.channelId }
          image.viewRequest = this.lockedViewRequest(product, design, generation ?? image.viewRequest ?? design.request)
          await this.store.save(product); this.enqueue(() => this.resumeViewImages(product.id, design.id)); return structuredClone(product)
        }
        const plan = product.referencePlan?.plans.find(plan => plan.id === image.planId)
        if (product.source === 'reference' && !plan) throw new Error('参考图分析尚未完成，请重新生成方案')
        const parent = image.parentImageId ? product.images.find(item => item.id === image.parentImageId) : undefined
        const references = await Promise.all(product.referenceFiles.slice(0, parent ? 4 : 5).map(file => this.store.dataUrl(id, file)))
        const source = parent?.files[0] ? await this.store.dataUrl(id, parent.files[0]) : references[0]
        const request: GenerateRequest = { ...product.request,
          materialPreset: generation?.materialPreset ?? image.visualRules?.materialPreset ?? product.request.materialPreset ?? CURRENT_MATERIAL,
          ...(generation ? { model: generation.model, upstream: generation.upstream, channelId: generation.channelId, size: generation.size, quality: generation.quality, detail: generation.detail, photography: generation.photography ?? { ...normalizePhotography(image.visualRules?.photography ?? product.photography, defaultPhotography(product.creationTask, true)), ...(generation.size && generation.size !== 'auto' ? { aspect_ratio: generation.size } : {}) } } : {}),
          ...(source ? { mode: 'edit', image: source, images: parent ? references : references.slice(1) } : {}),
          prompt: image.editInstruction ? refinementPrompt(image.editInstruction) : plan && product.referencePlan ? referenceGenerationPrompt(product.referencePlan, plan, creativityMode(product.creativity), product.facts.requirements, generation?.materialPreset ?? image.visualRules?.materialPreset ?? product.request.materialPreset ?? CURRENT_MATERIAL) : product.request.prompt }
        product.cancelled = false
        image.generation = { status: 'queued', attempts: image.generation.attempts }
        image.quality = { status: 'queued', attempts: image.quality.attempts }
        if (product.copyMode === 'per-image') { image.copyStage = { status: product.copyTiming === 'selected' ? 'skipped' : 'queued', attempts: image.copyStage?.attempts ?? 0 }; image.copyFactsRevision = product.factsRevision ?? 1 }
        else if (!product.copy) product.copyStage = { status: 'queued', attempts: product.copyStage.attempts }
        await this.dispatchImage(product, image, request)
        await this.store.save(product)
        if (image.generation.status === 'failed' || image.generation.status === 'unknown') throw new Error(image.generation.error ?? '图片重试未能启动')
        return structuredClone(product)
      }
      if (kind === 'copy' && !product.images.some(image => image.generation.status === 'completed')) throw new Error('请先取得成功图片，再生成商品文案')
      const perImage = kind === 'copy' && product.copyMode === 'per-image'
      const image = product.images.find(image => image.id === (imageId ?? (perImage ? product.selectedImageId : undefined)))
      if (kind === 'quality' && (!image || image.generation.status !== 'completed')) throw new Error('没有可检测的图片')
      if (perImage && image?.kind === 'view') throw new Error('角度展示沿用主设计文案，无需独立生成')
      if (perImage && (!image?.files.length || !image.copyStage)) throw new Error('请选择需要准备文案的成功图片')
      const stage = kind === 'copy' ? perImage ? image!.copyStage! : product.copyStage : image!.quality
      if (stage.status === 'running' || stage.status === 'queued') return structuredClone(product)
      if (stage.status === 'unknown' && !confirmUnknown) throw new Error('上次请求结果不明，请核对上游结果并确认重新调用后重试')
      if (stage.attempts >= product.options.maxStageAttempts || product.calls.length >= product.options.maxCalls) throw new Error('重试次数或调用额度已耗尽')
      product.cancelled = false; stage.status = 'queued'; delete stage.error
      if (kind === 'quality') product.options.autoCheck = true
      if (perImage) this.syncSelectedCopy(product)
      await this.store.save(product); this.schedule(product)
      return structuredClone(product)
    })
  }
  async cancel(id: string): Promise<EtsyProduct> {
    return this.tx(async () => {
      const product = this.find(id); product.cancelled = true
      delete product.pendingSelection
      for (const design of product.finalDesigns ?? []) if (['queued', 'running'].includes(design.planning.status)) design.planning.status = 'cancelled'
      for (const design of product.finalDesigns ?? []) if (design.materialPlanning && ['queued', 'running'].includes(design.materialPlanning.status)) design.materialPlanning.status = 'cancelled'
      if (product.planning && ['queued', 'running'].includes(product.planning.status)) product.planning.status = 'cancelled'
      for (const image of product.images) {
        if (['queued', 'running'].includes(image.generation.status)) {
          image.generation.status = 'cancelled'
          if (image.taskId) this.deps.queue.cancel(image.taskId)
        }
        if (['queued', 'running'].includes(image.quality.status)) image.quality.status = 'cancelled'
        if (image.copyStage && ['queued', 'running'].includes(image.copyStage.status)) image.copyStage.status = 'cancelled'
      }
      if (['queued', 'running'].includes(product.copyStage.status)) product.copyStage.status = 'cancelled'
      if (product.copyMode === 'per-image') this.syncSelectedCopy(product)
      for (const call of product.calls) if (call.status === 'running' || call.status === 'queued') {
        call.status = 'cancelled'; this.controllers.get(call.id)?.abort(new Error('用户取消；不代表上游取消计费'))
      }
      await this.store.save(product); return structuredClone(product)
    })
  }
  async editCopy(id: string, patch: Record<string, unknown>, revision: number, binding?: { imageId: string; baseCopy: string; factsRevision: number }): Promise<EtsyProduct> {
    return this.tx(async () => {
      const product = this.find(id), perImage = product.copyMode === 'per-image'
      const image = perImage && binding ? product.images.find(image => image.id === binding.imageId) : undefined
      const cache = image ? product.imageCopies?.[image.id] : undefined
      if (perImage) {
        if (!binding || !image || !cache) throw new Error('保存缺少当前图片绑定，请刷新后重试；本地草稿已保留')
        if (binding.factsRevision !== (product.factsRevision ?? 1) || cache.factsRevision !== binding.factsRevision) throw new Error('商品资料已更新，请核对后重新保存；本地草稿已保留')
        if (image.copyStage?.status !== 'completed') throw new Error('这张图片的文案尚未完成，请稍候保存；本地草稿已保留')
        if (JSON.stringify(cache.copy) !== binding.baseCopy) throw new Error('这张图片的文案已更新，请刷新或合并修改后保存；本地草稿已保留')
      } else if (product.revision !== revision) throw new Error('商品已更新，请刷新后再保存编辑')
      const previous = perImage ? cache!.copy : product.copy
      if (!previous) throw new Error('商品文案尚未生成')
      if (!perImage && (product.copyStage.status === 'running' || (product.copyImageId && product.selectedImageId && product.copyImageId !== product.selectedImageId))) throw new Error('请等待当前方案文案更新完成后再编辑')
      const merged = { ...previous, ...Object.fromEntries(Object.entries(patch).filter(([key]) => ['titles', 'description', 'tags'].includes(key))) }
      const copy = validateCopy(merged, product.facts, { mode: 'edit' })
      const selected = Number.isInteger(patch.selectedTitle) ? Number(patch.selectedTitle) : previous.selectedTitle
      if (copy.titles[selected]?.title) copy.selectedTitle = selected
      // 只记录本次编辑会改变的字段；整体替换 product 会让并发中的 call/image 引用失效，
      // 保存失败后的回滚应该保留其他后台任务已经写入的状态。
      const before = {
        revision: product.revision,
        updatedAt: product.updatedAt,
        copy: product.copy ? structuredClone(product.copy) : undefined,
        copyImageId: product.copyImageId,
        copyFactsRevision: product.copyFactsRevision,
        copyVersions: structuredClone(product.copyVersions),
        imageCopies: product.imageCopies ? structuredClone(product.imageCopies) : undefined,
        imageCopyVersions: perImage && image?.copyVersions ? structuredClone(image.copyVersions) : undefined,
      }
      product.copyVersions.push(structuredClone(previous))
      if (perImage) {
        image!.copyVersions ??= []; image!.copyVersions.push(structuredClone(previous))
        product.imageCopies![image!.id] = { copy: structuredClone(copy), factsRevision: product.factsRevision ?? 1 }
        this.syncSelectedCopy(product)
      } else {
        product.copy = copy
        if (product.copyImageId) { product.imageCopies ??= {}; product.imageCopies[product.copyImageId] = { copy: structuredClone(copy), factsRevision: product.factsRevision ?? 1 } }
      }
      try { await this.store.save(product) }
      catch (error) {
        product.revision = before.revision; product.updatedAt = before.updatedAt
        if (before.copy === undefined) delete product.copy; else product.copy = before.copy
        if (before.copyImageId === undefined) delete product.copyImageId; else product.copyImageId = before.copyImageId
        if (before.copyFactsRevision === undefined) delete product.copyFactsRevision; else product.copyFactsRevision = before.copyFactsRevision
        product.copyVersions.splice(0, product.copyVersions.length, ...before.copyVersions)
        if (before.imageCopies === undefined) delete product.imageCopies
        else { product.imageCopies ??= {}; for (const key of Object.keys(product.imageCopies)) delete product.imageCopies[key]; Object.assign(product.imageCopies, before.imageCopies) }
        if (perImage && image) {
          if (before.imageCopyVersions === undefined) delete image.copyVersions
          else { image.copyVersions ??= []; image.copyVersions.splice(0, image.copyVersions.length, ...before.imageCopyVersions) }
        }
        throw error
      }
      return structuredClone(product)
    })
  }
  async editFacts(id: string, facts: EtsyProduct['facts'], revision: number): Promise<EtsyProduct> {
    return this.tx(async () => {
      const product = this.find(id)
      if (product.revision !== revision) throw new Error('商品已更新，请刷新后再保存资料')
      if (productStages(product).some(stage => ['queued', 'running'].includes(stage.status))) throw new Error('请等待当前商品的生成和分析结束后再更新资料')
      product.facts = structuredClone(facts); product.factsRevision = (product.factsRevision ?? 1) + 1
      product.copyStage.attempts = 0
      if (product.cancelled) product.copyStage = { status: 'skipped', attempts: 0, error: '资料已更新，可显式重新准备文案' }
      if (product.copyMode === 'per-image') {
        for (const image of product.images) if (image.kind !== 'view' && image.generation.status === 'completed') { image.copyStage = product.cancelled || product.copyTiming === 'selected' ? { status: 'skipped', attempts: 0, error: '资料已更新，可显式重新准备文案' } : emptyStage(); image.copyFactsRevision = product.factsRevision }
        this.syncSelectedCopy(product)
      }
      await this.store.save(product)
      if (product.copyMode === 'per-image') this.schedule(product)
      return structuredClone(product)
    })
  }
  // 重命名只改列表显示名：不触碰 facts（文案输入）、factsRevision、文案缓存与图片。
  async rename(id: string, name: string): Promise<EtsyProduct> {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new Error('无效商品 ID')
    const displayName = typeof name === 'string' ? name.trim() : ''
    if (!displayName) throw new Error('请输入创作名称')
    if ([...displayName].length > 80) throw new Error('创作名称请控制在 80 字以内')
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(displayName)) throw new Error('创作名称不能包含控制字符')
    return this.tx(async () => {
      const product = this.find(id)
      product.displayName = displayName
      // 显示名不参与文案/编辑的乐观锁，避免让未保存的文案草稿失效。
      await this.store.save(product, { bumpRevision: false })
      return structuredClone(product)
    })
  }
  async idle(): Promise<void> {
    for (let i = 0; i < 1500; i++) {
      const observed = this.serial
      await observed
      // 等待期间可能又收到生图回调并排入文案任务，需先等待新的事务再判空闲。
      if (observed !== this.serial) continue
      if (!this.running && !this.pending.length && !this.deps.queue.list().some(task => ['queued', 'running'].includes(task.status))) return
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    throw new Error('等待工作流空闲超时')
  }
  dispose(): void {
    this.disposed = true; this.unsubscribe(); this.pending.length = 0
    for (const controller of this.controllers.values()) controller.abort(new Error('宿主退出，请核对请求状态'))
    for (const timer of this.generationTimers.values()) clearTimeout(timer)
    this.generationTimers.clear()
  }
}

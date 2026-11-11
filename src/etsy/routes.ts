import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { GenerateRequest } from '../protocol.ts'
import { PLUGIN_VERSION } from '../protocol.ts'
import { ETSY_API, type ProductFacts, type ProductStart, type StudioModelControls, type ReferenceInput, type ViewAngle } from './types.ts'
import type { EtsyWorkflow } from './workflow.ts'
import { exportProduct } from './export.ts'
import { creationTask, viewAngles } from './creation-flow.ts'
import { defaultPhotography, normalizePhotography } from './felt/photography-options.ts'
import { normalizeMaterialPreset } from './felt/material-v1-0-2.ts'

const send = (res: ServerResponse, value: unknown): void => {
  res.setHeader('content-type', 'application/json; charset=utf-8'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(value))
}
async function read(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []; let length = 0
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk); length += bytes.length
    if (length > 32 * 1024 * 1024) throw new Error('商品请求超过大小限制')
    chunks.push(bytes)
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('无效商品请求')
  return value as Record<string, unknown>
}
export function parseProductStart(body: Record<string, unknown>, generation: GenerateRequest): ProductStart {
  const raw = body.facts as Record<string, unknown> | undefined
  if (!raw || !['unspecified', 'physical_felt', 'digital_illustration', 'digital_portrait'].includes(String(raw.type))) throw new Error('请选择实际商品类型')
  const facts = { type: raw.type, confirmed: raw.confirmed === true, authenticityConfirmed: raw.authenticityConfirmed === true } as ProductFacts
  for (const field of ['name', 'requirements', 'materials', 'dimensions', 'packaging', 'processing', 'delivery', 'personalization'] as const) {
    const value = typeof raw[field] === 'string' ? raw[field].trim() : ''
    if (value.length > 5000) throw new Error('商品资料字段过长')
    facts[field] = value
  }
  if (!facts.name) throw new Error('请输入商品名称')
  const key = String(body.requestKey ?? '')
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(key)) throw new Error('无效请求标识')
  const count = Number(body.count), maxCalls = Number(body.maxCalls ?? 24)
  if (!Number.isInteger(count) || count < 1 || count > 8) throw new Error('每次支持 1 到 8 张商品图片')
  if (!Number.isInteger(maxCalls) || maxCalls < count || maxCalls > 100) throw new Error('调用上限必须为图片数量到 100 之间的整数')
  return { requestKey: key, facts, generation: { ...generation, n: 1 }, count, maxCalls, autoCheck: body.autoCheck !== false }
}
export function makeEtsyRoutes(deps: {
  workflow: EtsyWorkflow
  guard: (req: IncomingMessage, res: ServerResponse, method: string) => boolean
  parse: (body: unknown) => GenerateRequest | undefined
  normalize: (request: GenerateRequest) => { ok: true; request: GenerateRequest } | { ok: false; message: string }
  hostStatus?: () => Promise<unknown>
  modelControls?: StudioModelControls
}): WebRoute[] {
  const { workflow, guard } = deps
  // 仅商品工作流接收材质版本；普通画布与供应商协议不增加参数。
  const parse = (value: unknown): GenerateRequest | undefined => {
    const request = deps.parse(value)
    const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
    return request && { ...request, ...(raw.materialPreset !== undefined ? { materialPreset: normalizeMaterialPreset(raw.materialPreset) } : {}) }
  }
  const action = (name: string, run: (body: Record<string, unknown>) => Promise<unknown>): WebRoute => ({
    kind: 'exact', path: `${ETSY_API}/${name}`,
    handler: async (req, res) => {
      if (!guard(req, res, 'POST')) return
      try { send(res, { ok: true, value: await run(await read(req)) }) }
      catch (error) { send(res, { ok: false, message: error instanceof Error ? error.message : '商品工作流失败' }) }
    },
  })
  return [
    action('studio-info', async () => ({ name: '元创 Etsy Studio 2', version: PLUGIN_VERSION, materialPolicy: 'needle_felt_v2_0' })),
    action('models', async () => deps.hostStatus?.() ?? { available: false, message: '当前宿主未提供默认模型桥接' }),
    action('model-choices', async () => { if (!deps.modelControls) throw new Error('当前宿主未提供模型选择设置'); return deps.modelControls.read() }),
    action('save-model-choices', async body => { if (!deps.modelControls) throw new Error('当前宿主未提供模型选择设置'); return deps.modelControls.save(body) }),
    action('list', async () => workflow.list()),
    action('get', async body => workflow.get(String(body.id))),
    action('delete', async body => workflow.remove(String(body.id))),
    action('rename', async body => workflow.rename(String(body.id), typeof body.name === 'string' ? body.name : '')),
    action('reference', async body => {
      const count = Number(body.count ?? 4), copyTiming = body.copyTiming === 'selected' ? 'selected' : 'all'
      if (!Number.isInteger(count) || count < 2 || count > 8) throw new Error('探索数量请选择 2 到 8 张')
      const minimum = 1 + count * (1 + (body.autoCheck === false ? 0 : 1) + (copyTiming === 'all' ? 1 : 0))
      if (Number(body.maxCalls ?? 24) < minimum) throw new Error(`当前设置至少需要 ${minimum} 次调用额度`)
      const suppliedReferences = Array.isArray(body.references) ? body.references : [{ dataUrl: body.image, role: 'subject', note: '' }]
      if (!suppliedReferences.length || suppliedReferences.length > 5) throw new Error('请上传 1 到 5 张参考图')
      let total = 0
      const references: ReferenceInput[] = suppliedReferences.map((value, index) => {
        const row = value as Record<string, unknown>, dataUrl = row?.dataUrl
        if (typeof dataUrl !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(dataUrl)) throw new Error('参考图需要 JPG、PNG 或 WebP 格式')
        const bytes = Buffer.byteLength(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'); total += bytes
        if (bytes > 10 * 1024 * 1024) throw new Error('每张参考图不能超过 10 MiB')
        const role = index === 0 ? 'subject' : row.role
        if (!['subject', 'detail', 'material', 'palette', 'view'].includes(String(role)) || (index > 0 && role === 'subject')) throw new Error('请为辅助图选择用途')
        const note = typeof row.note === 'string' ? row.note.trim() : ''
        if (note.length > 500) throw new Error('每张参考图说明请控制在500字内')
        return { dataUrl, role: role as ReferenceInput['role'], note }
      })
      if (total > 20 * 1024 * 1024) throw new Error('参考图合计不能超过 20 MiB')
      const raw = body.generation && typeof body.generation === 'object' ? body.generation as Record<string, unknown> : {}
      const photo = normalizePhotography(body.photography ?? raw.photography, { ...defaultPhotography(creationTask(body.creationTask)), ...(typeof raw.size === 'string' && raw.size !== 'auto' ? { aspect_ratio: raw.size } : {}) })
      const parsed = parse({ ...raw, model: typeof raw.model === 'string' ? raw.model : '', prompt: 'reference planning pending', mode: 'edit', image: references[0].dataUrl, images: references.slice(1).map(reference => reference.dataUrl), n: 1, size: photo.aspect_ratio, quality: raw.quality ?? 'auto', detail: raw.detail ?? '' })
      if (!parsed) throw new Error('生图模型配置无效，请检查图片渠道')
      const normalized = deps.normalize(parsed)
      if (!normalized.ok) throw new Error(normalized.message)
      const supplied = body.facts && typeof body.facts === 'object' ? body.facts as Record<string, unknown> : {}
      const facts = { ...supplied, type: supplied.type ?? 'unspecified', name: String(supplied.name || `参考图设计 ${Date.now()}`), requirements: typeof body.notes === 'string' ? body.notes.trim() : '' }
      const input = parseProductStart({ ...body, facts, count }, normalized.request)
      Object.assign(input, { references, photography: photo, creationTask: creationTask(body.creationTask), copyTiming, ...(typeof body.previousProjectId === 'string' ? { previousProjectId: body.previousProjectId } : {}) })
      const creativity = body.creativity === 'gentle' || body.creativity === 'bold' ? body.creativity : 'balanced'
      return workflow.start(input, undefined, { creativity })
    }),
    action('confirm-design', async body => workflow.confirmDesign(String(body.id), String(body.imageId), String(body.notes ?? ''))),
    action('prepare-material', async body => workflow.prepareMaterial(String(body.id), String(body.designId), body.confirmUnknown === true)),
    action('prepare-spatial', async body => workflow.prepareSpatial(String(body.id), String(body.designId), body.confirmUnknown === true)),
    action('attach-material-samples', async body => workflow.attachMaterialSamples(String(body.id), String(body.designId), String(body.sourceImageId), body.samples as Array<{ index: number; dataUrl: string; width: number; height: number }>)),
    action('edit-identity', async body => {
      const spec = body.spec as Record<string, unknown>
      if (!spec || typeof spec.summary !== 'string' || !Array.isArray(spec.locks) || !Array.isArray(spec.unseen) || spec.locks.length > 30 || spec.unseen.length > 30) throw new Error('无效设定卡')
      return workflow.editIdentity(String(body.id), String(body.designId), spec as unknown as { summary: string; locks: string[]; unseen: string[] }, Number(body.specRevision))
    }),
    action('generate-views', async body => {
      const product = await workflow.get(String(body.id)), raw = body.generation as Record<string, unknown> | undefined
      const design = product.finalDesigns?.find(value => value.id === String(body.designId))
      const master = product.images.find(value => value.id === design?.imageId)
      const photo = normalizePhotography(design?.multiViewAnchor?.photography ?? master?.visualRules?.photography ?? product.photography, defaultPhotography(product.creationTask, true))
      const request = raw ? parse({ ...product.request, model: raw.model, channelId: raw.channelId, size: photo.aspect_ratio }) : product.request
      if (!request) throw new Error('图片模型配置无效')
      const normalized = deps.normalize(request)
      if (!normalized.ok) throw new Error(normalized.message)
      if (!Array.isArray(body.angles) || !body.angles.length || body.angles.length > 5 || body.angles.some(value => !viewAngles.some(angle => angle.value === value))) throw new Error('请选择需要的展示角度')
      let surfaceRequest: GenerateRequest | undefined
      const surface = (body.sideBackModel ?? design?.sideBackModel) as Record<string, unknown> | undefined
      if (surface && typeof surface === 'object') {
        const parsed = parse({ ...normalized.request, upstream: undefined, model: surface.model, channelId: surface.channelId })
        if (!parsed) throw new Error('侧面/背面模型无效')
        const resolved = deps.normalize(parsed)
        if (!resolved.ok) throw new Error(resolved.message)
        surfaceRequest = { ...resolved.request, photography: photo }
      }
      return workflow.generateViews(product.id, String(body.designId), [...new Set(body.angles)] as ViewAngle[], String(body.requestKey), { ...normalized.request, photography: photo }, body.confirmUnknown === true, surfaceRequest)
    }),
    action('approve-view', async body => workflow.approveView(String(body.id), String(body.imageId), body.approved !== false)),
    action('set-view-model', async body => {
      const product = await workflow.get(String(body.id)), choice = body.model as Record<string, unknown> | undefined
      if (!choice || typeof choice.model !== 'string' || typeof choice.channelId !== 'string') throw new Error('请选择侧面/背面模型')
      const parsed = parse({ ...product.request, model: choice.model, channelId: choice.channelId, upstream: undefined })
      if (!parsed) throw new Error('图片模型无效')
      const normalized = deps.normalize(parsed)
      if (!normalized.ok) throw new Error(normalized.message)
      return workflow.setViewModel(product.id, String(body.designId), normalized.request)
    }),
    action('budget', async body => workflow.updateBudget(String(body.id), Number(body.maxCalls))),
    action('select', async body => workflow.selectImage(String(body.id), String(body.imageId))),
    action('prepare-copies', async body => workflow.prepareCopies(String(body.id))),
    action('revise', async body => {
      const product = await workflow.get(String(body.id))
      const override = body.generation && typeof body.generation === 'object' ? body.generation as Record<string, unknown> : undefined
      const parent = product.images.find(value => value.id === (body.imageId ?? product.selectedImageId))
      const photo = normalizePhotography(override?.photography, parent?.visualRules?.photography ?? product.photography ?? defaultPhotography(product.creationTask, true))
      const request = override ? parse({ ...product.request, model: override.model, channelId: override.channelId, materialPreset: override.materialPreset ?? parent?.visualRules?.materialPreset ?? product.request.materialPreset, size: photo.aspect_ratio }) : { ...product.request, materialPreset: parent?.visualRules?.materialPreset ?? product.request.materialPreset }
      if (!request) throw new Error('修图模型选择无效')
      const normalized = deps.normalize(request)
      if (!normalized.ok) throw new Error(normalized.message)
      return workflow.revise(product.id, String(body.instruction ?? ''), { ...normalized.request, photography: photo }, typeof body.imageId === 'string' ? body.imageId : undefined, body.materialOnly === true, body.viewRestart === true)
    }),
    action('adopt', async body => {
      const image = body.image as { b64?: unknown; mime?: unknown } | undefined
      if (!image || typeof image.b64 !== 'string' || typeof image.mime !== 'string' || !/^image\/(png|jpeg|webp|gif)$/.test(image.mime)) throw new Error('缺少可复用的已生成图片')
      const facts = body.facts as Record<string, unknown> | undefined
      const generation: GenerateRequest = { mode: 'text', model: 'saved-image', prompt: String(facts?.requirements || facts?.name || '已生成图片'), n: 1, size: 'auto', quality: 'auto', detail: '' }
      const parsed = parseProductStart({ ...body, count: 1 }, generation)
      return workflow.start(parsed, { b64: image.b64, mime: image.mime })
    }),
    action('start', async body => {
      const parsed = parse(body.generation)
      if (!parsed) throw new Error('生图参数无效，请使用现有生图配置')
      const normalized = deps.normalize(parsed)
      if (!normalized.ok) throw new Error(normalized.message)
      return workflow.start(parseProductStart(body, normalized.request))
    }),
    action('cancel', async body => workflow.cancel(String(body.id))),
    action('retry', async body => {
      if (body.stage !== 'generation' && body.stage !== 'quality' && body.stage !== 'copy') throw new Error('不支持的重试阶段')
      let generation: GenerateRequest | undefined
      if (body.stage === 'generation' && body.generation && typeof body.generation === 'object') {
        const product = await workflow.get(String(body.id)), override = body.generation as Record<string, unknown>
        const image = product.images.find(value => value.id === body.imageId)
        const photo = normalizePhotography(override.photography, image?.visualRules?.photography ?? product.photography ?? { ...defaultPhotography(product.creationTask, true), ...(typeof override.size === 'string' ? { aspect_ratio: override.size } : {}) })
        const request = parse({ ...product.request, ...Object.fromEntries(['model', 'channelId', 'quality', 'detail', 'materialPreset'].filter(key => override[key] !== undefined).map(key => [key, override[key]])), size: photo.aspect_ratio })
        if (!request) throw new Error('重试图片的模型选择无效')
        const normalized = deps.normalize(request)
        if (!normalized.ok) throw new Error(normalized.message)
        generation = { ...normalized.request, photography: photo }
      }
      return workflow.retry(String(body.id), body.stage, typeof body.imageId === 'string' ? body.imageId : undefined, body.confirmUnknown === true, generation)
    }),
    action('edit', async body => workflow.editCopy(String(body.id), body.patch as Record<string, unknown>, Number(body.revision), typeof body.imageId === 'string' && typeof body.baseCopy === 'string' && Number.isInteger(body.factsRevision) ? { imageId: body.imageId, baseCopy: body.baseCopy, factsRevision: Number(body.factsRevision) } : undefined)),
    action('facts', async body => {
      const product = await workflow.get(String(body.id))
      const parsed = parseProductStart({ facts: body.facts, requestKey: product.requestKey, count: 1, maxCalls: product.options.maxCalls }, product.request)
      return workflow.editFacts(product.id, parsed.facts, Number(body.revision))
    }),
    {
      kind: 'exact', path: `${ETSY_API}/image`, handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        try {
          const url = new URL(req.url ?? '', 'http://127.0.0.1')
          const image = await workflow.store.readImage(url.searchParams.get('id') ?? '', url.searchParams.get('file') ?? '')
          res.setHeader('content-type', image.mime); res.setHeader('x-content-type-options', 'nosniff'); res.setHeader('cache-control', 'private, max-age=86400'); res.end(image.data)
        } catch { res.writeHead(404); res.end('图片不存在') }
      },
    },
    {
      kind: 'exact', path: `${ETSY_API}/export`, handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        try {
          const params = new URL(req.url ?? '', 'http://127.0.0.1').searchParams
          const id = params.get('id') ?? '', imageId = params.get('imageId')
          const product = await workflow.get(id)
          if (imageId) {
            const image = product.images.find(image => image.id === imageId)
            if (!image?.files.length || image.generation.status !== 'completed') throw new Error('请选择已完成的图片后导出')
            // 导出只修改读取快照，不改变其他窗口共享的当前选择。
            product.selectedImageId = imageId
            const cache = product.imageCopies?.[imageId]
            if (cache?.factsRevision === (product.factsRevision ?? 1)) {
              product.copy = cache.copy; product.copyImageId = imageId; product.copyFactsRevision = cache.factsRevision
            } else { delete product.copy; delete product.copyImageId; delete product.copyFactsRevision }
          }
          const zip = await exportProduct(product, workflow.store)
          res.setHeader('content-type', 'application/zip'); res.setHeader('content-disposition', `attachment; filename="etsy-${product.id}.zip"`); res.setHeader('cache-control', 'no-store'); res.end(zip)
        } catch (error) { res.statusCode = 400; send(res, { ok: false, message: error instanceof Error ? error.message : '导出失败' }) }
      },
    },
  ]
}

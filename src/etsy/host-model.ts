import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { imageDataRoot } from '../image-storage-path.ts'
import { stripReasoning, type ChatOptions, type PromptModelConfig } from '../prompt-enhancer.ts'
import type { EtsyModelSettings, StudioModelChoices } from './types.ts'

export const HOST_MODEL_URL = 'dsh-host://selected-model'
export interface HostPromptConfig extends PromptModelConfig { hostProvider?: string; hostModel?: string }
export function chooseEtsyModel(value: { apiUrl?: string; apiKey?: string; model?: string }, fallback: HostPromptConfig): HostPromptConfig {
  const apiUrl = value.apiUrl?.trim() || fallback.apiUrl
  if (apiUrl === HOST_MODEL_URL) {
    const hostModel = value.model?.trim() || fallback.hostModel
    return { apiUrl, apiKey: '', model: hostModel ? `${fallback.hostProvider}/${hostModel}` : '', hostProvider: fallback.hostProvider, hostModel }
  }
  let sameOrigin = false
  try { sameOrigin = new URL(apiUrl).origin === new URL(fallback.apiUrl).origin && /^https?:/.test(apiUrl) } catch { /* 空配置由阶段预检查报告。 */ }
  return { apiUrl, apiKey: value.apiKey?.trim() || (sameOrigin ? fallback.apiKey : ''), model: value.model?.trim() || (sameOrigin ? fallback.model : '') }
}
interface Selection { provider?: string; model?: string }
interface Metadata { inputModalities?: readonly string[]; reasoning?: { efforts?: readonly { id: string }[] } }
interface HostChunk { type: string; text?: string; usage?: unknown; reason?: { kind: string; failure?: { code?: string; message?: string } } }
export interface EtsyHostServices {
  selection: { currentSelection(): Selection }
  llm: {
    listProviders?(): Array<{ id: string; name: string }>
    listModels?(provider: string): Promise<Array<{ id: string; name?: string; inputModalities?: readonly string[] }>>
    resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<Metadata>
    stream(options: { provider: string; model: string; system: string; messages: unknown[]; maxTokens?: number; reasoningEffort?: string; signal?: AbortSignal }): AsyncIterable<HostChunk>
  }
  attachments: { saveImage(input: { data: Uint8Array; mediaType: ImageMediaType; name?: string }): Promise<ImageAttachmentRef> }
}
// 通过 DSH 已注册适配器复用账户，不复制或读取登录令牌。
export class EtsyHostModel {
  private services?: EtsyHostServices
  constructor(private readonly logRoot: () => string = () => path.join(imageDataRoot(), 'etsy-model-calls')) {}
  attach(services: EtsyHostServices): () => void {
    this.services = services
    return () => { if (this.services === services) this.services = undefined }
  }
  config(provider?: string, model?: string): HostPromptConfig | undefined {
    if ((provider !== undefined || model !== undefined) && (!provider || !model)) return undefined
    const selection = provider && model ? { provider, model } : this.services?.selection.currentSelection()
    if (!selection?.provider || !selection.model) return undefined
    return { apiUrl: HOST_MODEL_URL, apiKey: '', model: `${selection.provider}/${selection.model}`, hostProvider: selection.provider, hostModel: selection.model }
  }
  async catalog(): Promise<{ models: StudioModelChoices['analysisModels']; warnings: string[] }> {
    const llm = this.services?.llm
    if (!llm?.listProviders || !llm.listModels) return { models: [], warnings: ['当前宿主尚未提供模型目录，可继续沿用现有配置。'] }
    const providers = llm.listProviders(), warnings: string[] = []
    const results = await Promise.allSettled(providers.map(async provider => {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const models = await Promise.race([llm.listModels!(provider.id), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('模型目录超时')), 8000) })])
        return models.map(model => ({ provider: provider.id, providerName: provider.name, model: model.id, name: model.name || model.id,
          ...(model.inputModalities === undefined ? {} : { vision: model.inputModalities.includes('image') }) }))
      } finally { clearTimeout(timer) }
    }))
    const models = results.flatMap((result, index) => {
      if (result.status === 'fulfilled') return result.value
      warnings.push(`供应商「${providers[index]!.name}」的模型目录暂不可用，请稍后刷新。`); return []
    })
    return { models, warnings }
  }
  async validateVisionSelection(provider: string, model: string): Promise<void> {
    if (!this.services) throw new Error('DSH 模型服务尚未就绪')
    const selected = provider === '@default' ? this.config() : this.config(provider, model)
    if (!selected?.hostProvider || !selected.hostModel) throw new Error('请先在 DSH 中配置默认模型')
    const metadata = await this.services.llm.resolveModelInfo(selected.hostProvider, selected.hostModel)
    if (!metadata.inputModalities?.includes('image')) throw new Error('规划／检查／文案共用模型需要支持图片输入，请选择可看图的模型')
  }
  async status(): Promise<{ available: boolean; provider?: string; model?: string; inputModalities?: readonly string[]; vision?: boolean; message?: string }> {
    const config = this.config()
    if (!config || !this.services) return { available: false, message: 'DSH 默认模型服务尚未就绪' }
    try {
      const metadata = await this.services.llm.resolveModelInfo(config.hostProvider!, config.hostModel!)
      return { available: true, provider: config.hostProvider, model: config.hostModel, inputModalities: metadata.inputModalities ?? [], vision: metadata.inputModalities?.includes('image') === true }
    } catch (error) { return { available: false, provider: config.hostProvider, model: config.hostModel, message: error instanceof Error ? error.message : '无法查询模型能力' } }
  }
  async complete(config: PromptModelConfig, options: ChatOptions): Promise<string> {
    const selected = config as HostPromptConfig, services = this.services
    if (!services || !selected.hostProvider || !selected.hostModel) throw new Error('DSH 默认模型尚未就绪，请检查原有模型设置')
    const metadata = await services.llm.resolveModelInfo(selected.hostProvider, selected.hostModel, options.signal)
    const parts = typeof options.content === 'string' ? [{ type: 'text' as const, text: options.content }] : options.content
    if (parts.some(part => part.type === 'image_url') && metadata.inputModalities?.includes('image') !== true) {
      throw new Error(`DSH 模型 ${config.model} 未声明图片输入能力，不能用文字占位替代视觉检测；请单独选择视觉模型`)
    }
    const content: Array<{ type: 'text'; text: string } | { type: 'image'; attachment: ImageAttachmentRef }> = []
    for (const part of parts) {
      if (part.type === 'text') content.push(part)
      else {
        const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(part.image_url.url)
        if (!match) throw new Error('宿主视觉检测只接受已归档的图片数据')
        const attachment = await services.attachments.saveImage({ data: Buffer.from(match[2], 'base64'), mediaType: match[1] as ImageMediaType, name: 'etsy-quality-reference' })
        content.push({ type: 'image', attachment })
      }
    }
    const request = { provider: selected.hostProvider, model: selected.hostModel, system: options.system,
      messages: [{ role: 'user', content }], maxTokens: options.maxTokens,
      ...(metadata.reasoning?.efforts?.some(effort => effort.id === 'off') ? { reasoningEffort: 'off' } : {}) }
    const directory = this.logRoot(), id = randomUUID()
    await mkdir(directory, { recursive: true })
    const record: Record<string, unknown> = { id, createdAt: Date.now(), request, status: 'running' }
    const file = path.join(directory, `${id}.json`)
    // 精确记录模型可见内容与附件引用；认证由 DSH 适配器内部处理，不进入记录。
    await writeFile(file, JSON.stringify(record, null, 2), { mode: 0o600 })
    let answer = '', terminal = false
    try {
      for await (const chunk of services.llm.stream({ ...request, signal: options.signal })) {
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') answer += chunk.text
        if (chunk.type === 'usage') record.usage = chunk.usage
        if (chunk.type === 'finish') {
          terminal = true
          if (chunk.reason?.kind !== 'stop') throw new Error(`${chunk.reason?.failure?.code ?? chunk.reason?.kind ?? 'UNKNOWN'}: ${chunk.reason?.failure?.message ?? '模型未正常完成输出'}`)
        }
      }
      answer = stripReasoning(answer)
      if (!terminal || !answer) throw new Error('DSH 模型没有返回完整的可见文本')
      record.status = 'completed'; record.answer = answer; record.finishedAt = Date.now()
      await writeFile(file, JSON.stringify(record, null, 2), { mode: 0o600 })
      return answer
    } catch (error) {
      record.status = options.signal?.aborted ? 'unknown' : 'failed'; record.finishedAt = Date.now()
      // 不记录提供方原始错误体，避免其中混入敏感诊断信息。
      record.failure = '模型调用失败，请结合商品阶段错误核查'
      await writeFile(file, JSON.stringify(record, null, 2), { mode: 0o600 })
      throw error
    }
  }
}

// 统一分析选择覆盖规划、视觉检查与文案；留空保留已有独立 API 配置。
export function resolveEtsyModels(settings: EtsyModelSettings, fallback: HostPromptConfig, host: EtsyHostModel): { vision: HostPromptConfig; copy: HostPromptConfig } {
  if (settings.etsyAnalysisProvider) {
    const shared = settings.etsyAnalysisProvider === '@default' ? host.config() : host.config(settings.etsyAnalysisProvider, settings.etsyAnalysisModel)
    const config = shared ?? { apiUrl: HOST_MODEL_URL, apiKey: '', model: '' }
    return { vision: config, copy: config }
  }
  return {
    vision: chooseEtsyModel({ apiUrl: settings.etsyVisionApiUrl, apiKey: settings.etsyVisionApiKey, model: settings.etsyVisionModel }, fallback),
    copy: chooseEtsyModel({ apiUrl: settings.etsyCopyApiUrl, apiKey: settings.etsyCopyApiKey, model: settings.etsyCopyModel }, fallback),
  }
}

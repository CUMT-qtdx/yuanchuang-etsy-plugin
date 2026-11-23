/** OpenAI-compatible chat helpers used by the optional prompt-enhancement UI. */

import { isLikelyImageModelId } from './model-catalog.ts'
import { isChatCompletionsUrl, resolveChannelProtocol, type ChannelProtocolPreference } from './protocol.ts'

export interface PromptModelConfig {
  apiUrl: string
  apiKey: string
  model: string
}

/** Credentials shared by OpenAI-compatible `/models` discovery. */
export interface ModelListConfig {
  apiUrl: string
  apiKey: string
  apiUrlFull?: boolean
  protocol?: ChannelProtocolPreference
}

function endpoint(base: string, suffix: string): string {
  return `${base.replace(/\/+$/, '')}${suffix}`
}

function headers(apiKey: string): HeadersInit {
  return {
    'content-type': 'application/json',
    ...apiKey.trim() === '' ? {} : { authorization: `Bearer ${apiKey.trim()}` },
  }
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json().catch(() => undefined)
  if (!response.ok || body === undefined || body === null || typeof body !== 'object') {
    const message = body !== null && typeof body === 'object' && typeof (body as { error?: { message?: unknown } }).error?.message === 'string'
      ? (body as { error: { message: string } }).error.message
      : `HTTP ${response.status}`
    throw new Error(message)
  }
  return body as Record<string, unknown>
}

type ModelRecord = Record<string, unknown> & { id: string }

/** Candidate /models URLs for a configured base URL, most specific first. */
function modelListUrls(config: ModelListConfig): string[] {
  const base = config.apiUrl.trim().replace(/\/+$/, '')
  if (base === '') throw new Error('API URL is required')
  const urls: string[] = []
  if (resolveChannelProtocol(base, config.protocol) === 'gemini-native') {
    const url = new URL(base)
    const root = url.pathname.replace(/\/models\/[^/]+:generateContent\/?$/, '').replace(/\/(?:v1beta|v1)(?:\/models)?\/?$/, '').replace(/\/+$/, '')
    url.search = ''; url.hash = ''
    url.pathname = `${root}/v1/models`; urls.push(url.toString())
    url.pathname = `${root}/v1beta/models`; urls.push(url.toString())
    return urls
  }
  if (resolveChannelProtocol(base, config.protocol) === 'chat-completions' && isChatCompletionsUrl(base)) {
    const url = new URL(base)
    url.pathname = `${url.pathname.replace(/\/chat\/completions\/?$/, '')}/models`
    url.search = ''
    url.hash = ''
    urls.push(url.toString())
    return urls
  }
  urls.push(endpoint(base, '/models'))
  try {
    const url = new URL(base)
    const path = url.pathname.replace(/\/+$/, '')
    // Some gateways serve their marketing site at /models and the API only
    // under /v1. Try that conventional suffix when the configured base does
    // not already end in a version segment.
    if (!/\/v\d+(?:[a-z0-9._-]*)?$/i.test(path)) {
      url.pathname = `${path === '' || path === '/' ? '' : path}/v1/models`
      url.search = ''
      url.hash = ''
      urls.push(url.toString())
    }
  } catch {
    // Non-URL bases fall back to the original string concatenation behavior.
  }
  return [...new Set(urls)]
}

function errorMessageOf(body: unknown, fallback: string): string {
  if (body === null || typeof body !== 'object') return fallback
  const record = body as Record<string, unknown>
  const error = record.error
  if (error !== null && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message
  }
  return typeof record.message === 'string' && record.message.trim() !== '' ? record.message : fallback
}

function modelRecordsOf(body: unknown): ModelRecord[] | undefined {
  const candidate = Array.isArray(body)
    ? body
    : body !== null && typeof body === 'object' && Array.isArray((body as { data?: unknown }).data)
      ? (body as { data: unknown[] }).data
      : body !== null && typeof body === 'object' && Array.isArray((body as { models?: unknown }).models)
        ? (body as { models: unknown[] }).models
        : undefined
  if (candidate === undefined) return undefined
  return candidate.flatMap(item => {
    const id = typeof item === 'string'
      ? item.trim()
      : item !== null && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string'
        ? (item as { id: string }).id.trim()
        : item !== null && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string'
          ? (item as { name: string }).name.replace(/^models\//, '').trim()
          : ''
    return id === '' ? [] : [{ ...(typeof item === 'object' && item !== null ? item as Record<string, unknown> : {}), id }]
  })
}

interface ModelListAttempt {
  records?: ModelRecord[]
  error?: Error
  retryable: boolean
}

async function fetchModelRecords(url: string, apiKey: string): Promise<ModelListAttempt> {
  const response = await fetch(url, { headers: headers(apiKey) })
  const text = await response.text().catch(() => '')
  let body: unknown
  try {
    body = text.trim() === '' ? undefined : JSON.parse(text) as unknown
  } catch {
    body = undefined
  }
  if (!response.ok) {
    const fallback = `HTTP ${response.status}`
    return {
      error: new Error(errorMessageOf(body, fallback)),
      retryable: response.status === 404 || response.status === 405,
    }
  }
  if (body === undefined) {
    const type = response.headers.get('content-type') ?? 'unknown content-type'
    const sample = text.replace(/\s+/g, ' ').trim().slice(0, 160)
    return {
      error: new Error(`模型接口返回了非 JSON 响应（HTTP ${response.status}, ${type}）${sample === '' ? '' : `：${sample}`}`),
      retryable: true,
    }
  }
  const records = modelRecordsOf(body)
  if (records === undefined) {
    return {
      error: new Error(errorMessageOf(body, '模型接口响应中没有 data/models 列表')),
      retryable: true,
    }
  }
  return { records, retryable: false }
}

async function listModelRecords(config: ModelListConfig): Promise<ModelRecord[]> {
  const urls = modelListUrls(config)
  let lastError: Error | undefined
  for (const url of urls) {
    let attempt: ModelListAttempt
    try {
      attempt = await fetchModelRecords(url, config.apiKey)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      continue
    }
    if (attempt.records !== undefined) return attempt.records
    lastError = attempt.error
    if (!attempt.retryable) throw attempt.error
  }
  throw lastError ?? new Error('模型接口不可用')
}

function textOf(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function hasImageGenerationCapability(record: ModelRecord): boolean | undefined {
  const capability = record.capabilities
  if (capability !== null && typeof capability === 'object') {
    const values = capability as Record<string, unknown>
    for (const key of ['image_generation', 'imageGeneration', 'text_to_image', 'textToImage', 'image_gen']) {
      if (typeof values[key] === 'boolean') return values[key]
    }
    const serialized = JSON.stringify(values).toLowerCase()
    if (/image[ _-]?generation|text[ _-]?to[ _-]?image/.test(serialized)) return true
  }

  const taskText = [
    ...textOf(record.task),
    ...textOf(record.task_type),
    ...textOf(record.taskType),
    ...textOf(record.type),
    ...textOf(record.model_type),
    ...textOf(record.modelType),
    ...textOf(record.tasks),
    ...textOf(record.description),
  ].join(' ').toLowerCase()
  if (/image[ _-]?generation|text[ _-]?to[ _-]?image|image[ _-]?gen/.test(taskText)) return true
  if (/^image(?:[ _-]?generation)?$/.test(taskText.trim())) return true
  if (/embedding|rerank|moderation|transcri|speech|audio|video|chat[ _-]?completion/.test(taskText)) return false

  for (const key of ['output_modalities', 'outputModalities', 'supported_output_modalities']) {
    const modalities = textOf(record[key]).map(value => value.toLowerCase())
    if (modalities.length > 0) return modalities.includes('image')
  }
  return undefined
}

function isImageModelRecord(record: ModelRecord): boolean {
  return hasImageGenerationCapability(record) ?? isLikelyImageModelId(record.id)
}

/** List candidates exposed by an OpenAI-compatible endpoint. */
export async function listOpenAIModels(config: ModelListConfig): Promise<string[]> {
  return [...new Set((await listModelRecords(config)).map(record => record.id))]
    .sort((a, b) => a.localeCompare(b))
}

/** List only models that advertise or conventionally represent image generation. */
export async function listImageModels(config: ModelListConfig): Promise<string[]> {
  const native = resolveChannelProtocol(config.apiUrl, config.protocol) === 'gemini-native'
  return [...new Set((await listModelRecords(config)).filter(record => isImageModelRecord(record) || (native && hasImageGenerationCapability(record) !== false && /^gemini-nano-banana-/i.test(record.id))).map(record => record.id))]
    .sort((a, b) => a.localeCompare(b))
}

/** List chat models exposed by an OpenAI-compatible endpoint. */
export async function listPromptModels(config: PromptModelConfig): Promise<string[]> {
  return listOpenAIModels(config)
}

/** Remove reasoning-model artifacts from a chat model's visible content:
 *  complete `<think>…</think>` blocks first, then anything from a dangling
 *  unclosed `<think>` to the end of the text. Reasoning models served through
 *  OpenAI-compatible endpoints (MiniMax M3, DeepSeek R1, Qwen QVQ, …) inline
 *  these blocks in `message.content`; leaking them into the prompt box both
 *  pollutes the prompt and can push it past image models' length limits. */
export function stripReasoning(text: string): string {
  const withoutClosed = text.replace(/<think>[\s\S]*?<\/think>/gi, '')
  const dangling = /<think>/i.exec(withoutClosed)
  return (dangling === null ? withoutClosed : withoutClosed.slice(0, dangling.index)).trim()
}

/** One OpenAI-style multimodal user part (`text` or an `image_url` data URL). */
export type ChatPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }

/** One chat-completion request over the configured OpenAI-compatible endpoint. */
export interface ChatOptions {
  system: string
  /** Either a plain string or multimodal parts. */
  content: string | ChatPart[]
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}

/**
 * Run one chat completion and return the cleaned visible answer.
 *
 * Shared by prompt enhancement, the canvas light-tier skill runner and the
 * layer analyzer: it owns the endpoint, auth, error shaping (an upstream
 * `error.message` is surfaced verbatim) and the reasoning-strip step, so every
 * caller sees the same behaviour.
 * @param config - endpoint, secret and model.
 * @param options - prompt parts plus optional sampling controls.
 * @returns the model's visible answer, with reasoning artifacts removed.
 */
export async function chatComplete(config: PromptModelConfig, options: ChatOptions): Promise<string> {
  if (config.apiUrl.trim() === '' || config.model.trim() === '') {
    throw new Error('chat model is not configured (left sidebar > Image settings > Prompt enhancement)')
  }
  const response = await fetch(endpoint(config.apiUrl, '/chat/completions'), {
    method: 'POST',
    headers: headers(config.apiKey),
    body: JSON.stringify({
      model: config.model.trim(),
      temperature: options.temperature ?? 0.4,
      ...options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens },
      messages: [
        { role: 'system', content: options.system },
        {
          role: 'user',
          content: typeof options.content === 'string' ? options.content : options.content,
        },
      ],
    }),
    ...options.signal === undefined ? {} : { signal: options.signal },
  })
  const body = await responseJson(response)
  const choices = Array.isArray(body.choices) ? body.choices : []
  const content = choices[0] !== null && typeof choices[0] === 'object'
    ? (choices[0] as { message?: { content?: unknown } }).message?.content
    : undefined
  if (typeof content !== 'string' || content.trim() === '') throw new Error('chat model returned an empty answer')
  const answer = stripReasoning(content)
  if (answer === '') throw new Error('chat model returned only reasoning content (empty <think> payload)')
  return answer
}

/** 从指定起始下标提取第一段括号配平的 JSON 对象或数组文本，忽略字符串内的括号。 */
function extractBalancedJson(text: string, start: number): string {
  const open = text[start]
  if (open !== '{' && open !== '[') return ''
  const stack: string[] = [open === '{' ? '}' : ']']
  let inString = false
  let escaped = false
  for (let i = start + 1; i < text.length; i += 1) {
    const ch = text[i]!
    if (inString) {
      if (escaped) { escaped = false; continue }
      if (ch === '\\') { escaped = true; continue }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{') stack.push('}')
    else if (ch === '[') stack.push(']')
    else if (ch === '}' || ch === ']') {
      if (stack[stack.length - 1] === ch) {
        stack.pop()
        if (stack.length === 0) return text.slice(start, i + 1)
      }
    }
  }
  // 模型偶发漏掉末尾 1～2 个闭合括号时自动补齐；截断在字符串内部时不猜测补全。
  if (!inString && stack.length > 0 && stack.length <= 3) {
    return text.slice(start) + stack.reverse().join('')
  }
  return ''
}

/** 仅修复常见的非标准 JSON 标点（未加双引号的键名、裸枚举值、尾逗号、字符串内裸换行），绝不伪造字段内容。 */
function repairRelaxedJson(raw: string): string {
  // 1) 转义字符串字面量内部未转义的换行与制表符，保留字符串外原样。
  let escapedStrings = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]!
    if (inString) {
      if (escaped) { escapedStrings += ch; escaped = false; continue }
      if (ch === '\\') { escapedStrings += ch; escaped = true; continue }
      if (ch === '"') { escapedStrings += ch; inString = false; continue }
      if (ch === '\n') { escapedStrings += '\\n'; continue }
      if (ch === '\r') { escapedStrings += '\\r'; continue }
      if (ch === '\t') { escapedStrings += '\\t'; continue }
      escapedStrings += ch
      continue
    }
    if (ch === '"') inString = true
    escapedStrings += ch
  }

  // 2) 仅在字符串外部做语法归一化，避免误改字符串正文。
  let out = ''
  inString = false
  escaped = false
  let tokenStart = 0
  const flushOutside = (segment: string): string => segment
    // 未加引号的对象键名：{status: -> {"status": , issues: -> ,"issues":
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_-]*)(\s*:)/g, '$1"$2"$3')
    // 裸状态/方向枚举值：:PASS, -> :"PASS",
    .replace(/(:\s*)(PASS|REVISE|REJECT|UNKNOWN|DRIFT|near|far|uncertain)(?=\s*[,}\]])/g, '$1"$2"')
    // 去除对象或数组末尾多余逗号
    .replace(/,(\s*[}\]])/g, '$1')

  for (let i = 0; i < escapedStrings.length; i += 1) {
    const ch = escapedStrings[i]!
    if (inString) {
      if (escaped) { escaped = false; continue }
      if (ch === '\\') { escaped = true; continue }
      if (ch === '"') {
        out += escapedStrings.slice(tokenStart, i + 1)
        inString = false
        tokenStart = i + 1
      }
      continue
    }
    if (ch === '"') {
      // 处理模型偶发的 `,"}` / `,"]` 孤立引号笔误（逗号后紧跟无闭合引号并直接收尾）。
      const before = escapedStrings.slice(tokenStart, i)
      const tailMatch = /^"\s*([}\]])/.exec(escapedStrings.slice(i))
      if (/,\s*$/.test(before) && tailMatch !== null) {
        out += flushOutside(before.replace(/,\s*$/, ''))
        tokenStart = i + 1
        continue
      }
      out += flushOutside(before)
      inString = true
      tokenStart = i
    }
  }
  if (tokenStart < escapedStrings.length) {
    out += inString ? escapedStrings.slice(tokenStart) : flushOutside(escapedStrings.slice(tokenStart))
  }
  return out
}

/** Strip a fenced code block and pull the outermost JSON object/array out. */
export function jsonPayload(content: string): unknown {
  const cleaned = stripReasoning(content).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const objectStart = cleaned.indexOf('{')
  const objectEnd = cleaned.lastIndexOf('}')
  const arrayStart = cleaned.indexOf('[')
  const arrayEnd = cleaned.lastIndexOf(']')
  const useArray = arrayStart >= 0 && (objectStart < 0 || arrayStart < objectStart)
  const start = useArray ? arrayStart : objectStart
  const end = useArray ? arrayEnd : objectEnd
  if (start < 0) return undefined

  const candidates: string[] = []
  if (end > start) candidates.push(cleaned.slice(start, end + 1))
  const balanced = extractBalancedJson(cleaned, start)
  if (balanced !== '' && balanced !== candidates[0]) candidates.push(balanced)

  for (const candidate of candidates) {
    try { return JSON.parse(candidate) as unknown } catch { /* 继续尝试容错修复 */ }
  }
  for (const candidate of candidates) {
    const repaired = repairRelaxedJson(candidate)
    try { return JSON.parse(repaired) as unknown } catch { /* 继续尝试对修复后的文本重新提取配平片段 */ }
    const rebalanced = extractBalancedJson(repaired, 0)
    if (rebalanced !== '') {
      try { return JSON.parse(rebalanced) as unknown } catch { /* 放弃 */ }
    }
  }
  return undefined
}

/** Expand a concise image request into a production-ready image prompt. */
export async function enhancePrompt(config: PromptModelConfig, prompt: string): Promise<string> {
  return chatComplete(config, {
    temperature: 0.7,
    system: 'You are an expert image-prompt editor. Expand the user request into one vivid, specific image-generation prompt. Preserve intent and language. Add only useful visual detail: subject, composition, lighting, materials, color, camera/style and quality. Return only the finished prompt, with no preface or markdown.',
    content: prompt,
  })
}

/** Polish one existing generation prompt without changing its purpose. */
export async function polishPrompt(config: PromptModelConfig, prompt: string): Promise<string> {
  return chatComplete(config, {
    temperature: 0.35,
    system: '你是电商生图提示词编辑。请在保持图片用途、商品事实、平台、语言和原有结构不变的前提下，润色文字并补充可执行的视觉细节，减少重复和空泛表达。只输出最终提示词，不要解释、标题或 Markdown。',
    content: prompt,
  })
}

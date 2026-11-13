// 简化工作台沿用既有 quality 字段，不新增第二套分辨率参数。
import { resolveChannelProtocol, type ChannelConfig, type GenerateRequest } from '../protocol.ts'
export const REFERENCE_RESOLUTION_KEY = 'etsy-reference-resolution'
export const referenceResolutions = ['1k', '2k', '4k'] as const
export type ReferenceResolution = typeof referenceResolutions[number]
export function referenceResolution(value: unknown, fallback: ReferenceResolution = '2k'): ReferenceResolution {
  const normalized = typeof value === 'string' ? value.toLowerCase() : ''
  return (referenceResolutions as readonly string[]).includes(normalized) ? normalized as ReferenceResolution : fallback
}
export function referenceModelOnly1K(model: string): boolean {
  return /gemini-(?:2\.5-flash|3\.1-flash-lite)-image|nanobanana2-lite/i.test(model)
}
export function referenceResolutionIssue(request: GenerateRequest, channels?: readonly ChannelConfig[]): string {
  if (referenceResolution(request.quality) === '1k') return ''
  const channel = channels?.find(channel => channel.id === request.channelId)
  const model = channel?.models.find(model => model.alias === request.model)?.id ?? request.upstream ?? request.model
  if (referenceModelOnly1K(model)) return '当前型号仅支持 1K，请选择其他型号使用 2K / 4K。'
  if (/^(?:gemini|nanobanana|nano-banana)/i.test(model) && channel && resolveChannelProtocol(channel.apiUrl, channel.protocol) === 'chat-completions') return '该 Chat 渠道不传分辨率；2K / 4K 请在模型选择中使用 Gemini 原生渠道。'
  return ''
}

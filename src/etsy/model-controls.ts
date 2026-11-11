import { describeModel } from '../model-catalog.ts'
import type { ChannelsView } from '../generation-runtime.ts'
import type { EtsyHostModel } from './host-model.ts'
import type { EtsyModelSettings, StudioModelChoices, StudioModelControls } from './types.ts'

type SettingsOp = { op: 'set'; path: string[]; value: string }
export function createStudioModelControls(deps: {
  settings: () => EtsyModelSettings & { defaultChannelId?: string; defaultModel?: string }
  revision: () => number | undefined
  writable: () => boolean
  channels: () => ChannelsView
  host: EtsyHostModel
  resolved: () => { vision: { model: string }; copy: { model: string } }
  busy: () => Promise<boolean>
  mutate: (ops: SettingsOp[], revision?: number) => Promise<void>
}): StudioModelControls {
  const imageGroups = (): StudioModelChoices['imageGroups'] => deps.channels().channels.flatMap(channel => {
    const models = channel.models.filter(model => describeModel(model.id).supportsEdit).map(model => model.alias)
    return models.length ? [{ id: channel.id, name: channel.name || channel.id, models }] : []
  })
  const read = async (): Promise<StudioModelChoices> => {
    const catalog = await deps.host.catalog()
    const settings = deps.settings(), revision = deps.revision(), resolved = deps.resolved(), groups = imageGroups()
    const group = groups.find(group => group.id === settings.defaultChannelId) ?? groups[0]
    return { revision, writable: deps.writable(), imageGroups: groups,
      image: { channelId: group?.id ?? '', model: group?.models.includes(settings.defaultModel ?? '') ? settings.defaultModel! : group?.models[0] ?? '' },
      analysis: { provider: settings.etsyAnalysisProvider || '', model: settings.etsyAnalysisModel || '' },
      analysisLabel: resolved.vision.model === resolved.copy.model ? resolved.vision.model : `${resolved.vision.model} / ${resolved.copy.model}`,
      defaultAnalysisLabel: deps.host.config()?.model ?? '尚未配置', analysisModels: catalog.models, warnings: catalog.warnings }
  }
  return { read, async save(body) {
    if (!deps.writable()) throw new Error('当前宿主模型设置不可写')
    if (await deps.busy()) throw new Error('请等待当前创作和文案任务完成后，再修改模型')
    const image = body.image as { channelId?: unknown; model?: unknown } | undefined
    const analysis = body.analysis as { provider?: unknown; model?: unknown } | undefined
    if (!image || typeof image.channelId !== 'string' || typeof image.model !== 'string' || !imageGroups().some(group => group.id === image.channelId && group.models.includes(String(image.model)))) throw new Error('请选择已配置且支持修图的图片渠道和模型')
    if (!analysis || typeof analysis.provider !== 'string' || typeof analysis.model !== 'string' || analysis.provider.length > 200 || analysis.model.length > 300 || /[\r\n]/.test(analysis.provider + analysis.model)) throw new Error('分析模型选择无效')
    if (analysis.provider) {
      if (analysis.provider !== '@default' && !analysis.model) throw new Error('请选择分析模型')
      await deps.host.validateVisionSelection(analysis.provider, analysis.model)
    } else if (analysis.model) throw new Error('请选择对应供应商')
    await deps.mutate([
      { op: 'set', path: ['defaultChannelId'], value: image.channelId }, { op: 'set', path: ['defaultModel'], value: image.model },
      { op: 'set', path: ['etsyAnalysisProvider'], value: analysis.provider }, { op: 'set', path: ['etsyAnalysisModel'], value: analysis.provider === '@default' ? '' : analysis.model },
    ], typeof body.revision === 'number' ? body.revision : undefined)
    return read()
  } }
}

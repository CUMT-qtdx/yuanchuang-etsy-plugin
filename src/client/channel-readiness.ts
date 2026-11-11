import { isSubscriptionProvider, type SubscriptionProvider } from '../protocol.ts'

// 此处只判断配置是否就绪；不代表额度充足或真实生成验收通过。
export function imageChannelConfigured(channel: { auth?: string; subscription?: string; apiUrl: string; models: ReadonlyArray<{ alias: string; id: string }> }, keySet: boolean, subscriptions: Partial<Record<SubscriptionProvider, { state: string }>> = {}): boolean {
  if (!channel.models.some(model => model.alias.trim() && model.id.trim())) return false
  if (channel.auth === 'subscription') return isSubscriptionProvider(channel.subscription) && subscriptions[channel.subscription]?.state === 'logged-in'
  return channel.apiUrl.trim() !== '' && keySet
}

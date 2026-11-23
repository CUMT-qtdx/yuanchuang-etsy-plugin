// 记录左侧创作分组的本机折叠状态，切换面板或重开后保留习惯。
const COLLAPSED_KEY = 'etsy-creation-collapsed-groups'

const storage = (): Storage | undefined => {
  try { return globalThis.localStorage } catch { return undefined }
}

export function readCollapsedGroups(): Set<string> {
  try {
    const raw = storage()?.getItem(COLLAPSED_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((item): item is string => typeof item === 'string' && item !== ''))
  } catch { return new Set() }
}

export function writeCollapsedGroups(ids: ReadonlySet<string>): void {
  try { storage()?.setItem(COLLAPSED_KEY, JSON.stringify([...ids])) } catch { /* 忽略隐私模式写入失败 */ }
}

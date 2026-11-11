import type { EtsyProduct } from '../etsy/types.ts'

// 宿主尚未重启、后端 rename 路由还不存在时，显示名先落在本机。
// 重启后 ReferenceStudio 会把待同步名称写回创作档案，再清除本机记录。
const STORAGE_KEY = 'etsy-creation-display-names'
export type LocalNames = Record<string, string>

const storage = (): Storage | undefined => {
  try { return globalThis.localStorage } catch { return undefined }
}

const parse = (raw: string | null): LocalNames => {
  if (!raw) return {}
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([id, name]) => /^[a-zA-Z0-9-]{1,80}$/.test(id) && typeof name === 'string' && name.trim() !== '')
      .map(([id, name]) => [id, String(name).trim().slice(0, 80)]))
  } catch { return {} }
}

export function readLocalNames(): LocalNames {
  try { return parse(storage()?.getItem(STORAGE_KEY) ?? null) } catch { return {} }
}

const write = (names: LocalNames): void => {
  try { storage()?.setItem(STORAGE_KEY, JSON.stringify(names)) } catch { /* 隐私模式下本机存储不可用，本次会话内仍生效。 */ }
}

export function writeLocalName(id: string, name: string): void {
  const value = name.trim()
  if (!value) return
  write({ ...readLocalNames(), [id]: value })
}

export function clearLocalName(id: string): void {
  const names = readLocalNames()
  if (!(id in names)) return
  delete names[id]
  write(names)
}

// 本机名称只覆盖列表显示名，不改动图片、文案、资料和版本号。
// 列表每秒刷新，调用方可一次读取后复用，避免每个项目都解析一次本机存储。
export function withLocalName(product: EtsyProduct, names: LocalNames = readLocalNames()): EtsyProduct {
  const name = names[product.id]
  return name && product.displayName !== name ? { ...product, displayName: name } : product
}

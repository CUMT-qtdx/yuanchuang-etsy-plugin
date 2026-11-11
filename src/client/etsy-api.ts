import { ETSY_API } from '../etsy/types.ts'

// 宿主进程在启动时就固定了路由表。直接覆盖磁盘上的插件文件后，浏览器端
// client.js 会被重新读取，但 Node 侧仍加载旧路由：新增接口会返回 404 的
// 纯文本 not found（或代理层的 unauthorized），而不是插件约定的 JSON。
export class EtsyRouteError extends Error {
  readonly action: string
  readonly status: number
  constructor(action: string, status: number, detail: string) {
    super(`接口 ${action} 未就绪（HTTP ${status}${detail ? ` ${detail}` : ''}）：宿主可能仍在运行旧版插件，请完全退出并重启 DeepSeek Harness 后重试`)
    this.name = 'EtsyRouteError'
    this.action = action
    this.status = status
  }
}

interface EtsyResponse<T> { ok?: boolean; message?: string; value?: T }

export async function etsyCall<T>(action: string, body: unknown = {}): Promise<T> {
  const response = await fetch(`${ETSY_API}/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  // 先按文本读取，避免非 JSON 响应变成 "Unexpected token 'o' is not valid JSON"。
  const raw = await response.text()
  let result: EtsyResponse<T> | undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) result = parsed as EtsyResponse<T>
  } catch { /* 宿主回退页、错误页和空响应都不是 JSON。 */ }
  if (!result) {
    const detail = raw.trim().replace(/\s+/g, ' ').slice(0, 120)
    if (response.status === 404 || response.status === 401 || /^(?:not found|unauthorized|cannot post|no route)/i.test(detail)) throw new EtsyRouteError(action, response.status, detail)
    throw new Error(`接口 ${action} 返回了无法识别的响应（HTTP ${response.status}）${detail ? `：${detail}` : ''}`)
  }
  if (!response.ok || !result.ok) throw new Error(result.message || `HTTP ${response.status}`)
  return result.value as T
}

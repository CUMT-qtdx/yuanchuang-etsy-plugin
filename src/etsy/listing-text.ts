import type { EtsyCopy } from './types.ts'
import { cleanListingTitle, formatProductDescription } from './copy-style.ts'

// 复制和导出共用公开文字；未完成项只进入复核文件，不混进商品正文。
export function listingText(copy: EtsyCopy): string {
  const title = copy.titles[copy.selectedTitle]?.title.trim() || copy.titles.find(row => row.title.trim())?.title || ''
  return [cleanListingTitle(title), formatProductDescription(copy.description), copy.tags.join(', ')].filter(value => value.trim()).join('\n\n')
}
export function copyReviewText(copy: EtsyCopy): string {
  return [...copy.humanConfirmation, ...(copy.fieldIssues ?? []).map(issue => `待补齐：${issue.message}`)].join('\n')
}

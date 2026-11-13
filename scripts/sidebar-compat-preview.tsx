// 使用实际的侧栏挂载代码，避免测试页提前放好历史容器而漏掉宿主结构差异。
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ImageGenController } from '../src/client/controller.ts'
import { mountSidebarEntry } from '../src/client/sidebar-entry.ts'
import { ReferenceStudio } from '../src/client/ReferenceStudio.tsx'
const controller = new ImageGenController()
mountSidebarEntry(controller, '会话', '切换会话', '生图', '切换生图')
controller.subscribe(() => document.documentElement.toggleAttribute('data-dsh-imagegen-active', controller.getSnapshot().panelOpen))
controller.open()
function Preview(): React.JSX.Element {
  const [open, setOpen] = useState(true)
  useEffect(() => controller.subscribe(() => setOpen(controller.getSnapshot().panelOpen)), [])
  return <div style={{ height: '100%', display: open ? 'block' : 'none' }}><ReferenceStudio historyHost={document.querySelector<HTMLElement>('[data-dsh-imagegen-history-host]')} request={() => ({ mode: 'edit', channelId: 'mock', model: 'mock-image', prompt: '', size: 'auto', quality: '2k', detail: '', n: 1 })} onAdvanced={() => {}} /></div>
}
createRoot(document.getElementById('root')!).render(<Preview />)

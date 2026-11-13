import { createRoot } from 'react-dom/client'
import { AppUpdateButton } from '../src/client/AppUpdateButton.tsx'
createRoot(document.getElementById('root')!).render(<div style={{ padding: '28px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', background: '#f7faf8', height: '100vh', boxSizing: 'border-box', fontFamily: 'Microsoft YaHei' }}><strong>元创 Etsy Studio · 更新流程验收</strong><AppUpdateButton /></div>)

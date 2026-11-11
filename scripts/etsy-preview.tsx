import { createRoot } from 'react-dom/client'
import { EtsyWorkbench } from '../src/client/EtsyWorkbench.tsx'
const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
createRoot(document.getElementById('root')!).render(<EtsyWorkbench request={() => ({ mode: 'edit', model: 'mock-image', channelId: 'mock', prompt: '羊毛毡猫，红围巾，保持真实材质', size: 'auto', quality: 'auto', n: 1, image: `data:image/png;base64,${pixel}` })} />)

import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { ReferenceStudio } from '../src/client/ReferenceStudio.tsx'
function Preview(): React.JSX.Element {
  const params = new URLSearchParams(location.search)
  const [image, setImage] = useState<{ channelId: string; model: string }>(() => params.get('model') ? { channelId: 'mock', model: params.get('model')! } : JSON.parse(localStorage.getItem('reference-mock-image-choice') || '{"channelId":"mock","model":"mock-image"}'))
  const protocol = params.get('protocol') === 'chat' ? 'chat-completions' : 'gemini-native'
  return <ReferenceStudio channels={[{ id: 'mock', preset: '', name: '隔离测试渠道', apiUrl: 'https://mock.example', protocol, models: [{ alias: image.model, id: image.model }] }]} historyHost={document.getElementById('history-host')} onModelsSaved={async choice => { setImage(choice); localStorage.setItem('reference-mock-image-choice', JSON.stringify(choice)) }} request={() => ({ mode: 'edit', ...image, prompt: '', size: 'auto', quality: 'auto', detail: '', n: 1 })} onAdvanced={() => { document.body.dataset.advanced = 'opened' }} />
}
createRoot(document.getElementById('root')!).render(<Preview />)

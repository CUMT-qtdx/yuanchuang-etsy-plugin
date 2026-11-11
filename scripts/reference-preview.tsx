import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { ReferenceStudio } from '../src/client/ReferenceStudio.tsx'
function Preview(): React.JSX.Element {
  const [image, setImage] = useState<{ channelId: string; model: string }>(() => JSON.parse(localStorage.getItem('reference-mock-image-choice') || '{"channelId":"mock","model":"mock-image"}'))
  return <ReferenceStudio historyHost={document.getElementById('history-host')} onModelsSaved={async choice => { setImage(choice); localStorage.setItem('reference-mock-image-choice', JSON.stringify(choice)) }} request={() => ({ mode: 'edit', ...image, prompt: '', size: 'auto', quality: 'auto', detail: '', n: 1 })} onAdvanced={() => { document.body.dataset.advanced = 'opened' }} />
}
createRoot(document.getElementById('root')!).render(<Preview />)

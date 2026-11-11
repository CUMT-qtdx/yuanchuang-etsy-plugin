/** Real upload component/hook, local API only. Nothing calls a model. */
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ReferenceImages } from '../src/client/ReferenceImages.tsx'
import { clipboardImageFiles, editReferenceLimit, useEditReferences } from '../src/client/reference-images.ts'
import { tt } from '../src/client/helpers.ts'
const base = { apiUrl: 'https://example.test/v1', apiUrlFull: false, models: [] }
const policies = [
  ['gpt-image-2', base, 5], ['grok-imagine-image', base, 1], ['nanobanana2', base, 1], ['dall-e-2', base, 1],
  ['qwen-image-edit', base, 1], ['qwen-image-edit', {...base, apiUrl:'https://api-inference.modelscope.cn'}, 5],
  ['image-01', base, 1], ['seedream-5.0', base, 5], ['custom-alias', {...base,models:[{alias:'custom-alias',id:'grok-imagine-image'}]}, 1],
  ['grok-imagine-image', {...base,protocol:'chat-completions'}, 5], ['grok-imagine-image', {...base,auth:'subscription'}, 5],
] as const
// Expose only fixture assertions, never image content, for browser tests.
;(window as unknown as { checkPolicies: () => boolean }).checkPolicies = () => policies.every(([model, channel, expected]) => editReferenceLimit(model, {...channel,models:[...channel.models]}) === expected)
function Fixture() {
  const [error, setError] = useState<string|null>(null)
  const references = useEditReferences(setError)
  const [model, setModel] = useState('gpt-image-2')
  const [prompt, setPrompt] = useState('保留图1的产品外观，参考图2的暖色光影，放入图3的桌面场景。')
  const [submitted, setSubmitted] = useState(false)
  const limit = editReferenceLimit(model, base)
  const notice = references.images.length > limit ? tt('edit.modelLimit', { count:limit }) : null
  return <><header className="fixture-header"><strong>DSH Image Studio</strong><span>普通生图</span><span>无限画布</span><span>电商模式</span><span>素材库</span></header>
    <main className="fixture-workspace" onPaste={event=>{const files=clipboardImageFiles(event.clipboardData);if(files.length){event.preventDefault();references.add(files)}}}>
      <aside className="fixture-config"><div className="fixture-modes"><span>文生图</span><strong>图生图</strong></div>
        <select aria-label="模型" value={model} onChange={event=>setModel(event.target.value)}><option value="gpt-image-2">GPT Image 2</option><option value="grok-imagine-image">Grok Imagine</option></select>
        <div className="fixture-card"><ReferenceImages images={references.images} reading={references.reading} onAdd={references.add} onRemove={references.remove} onClear={references.clear} notice={notice}/></div>
        <div className="fixture-card"><strong>提示词</strong><textarea aria-label="提示词" value={prompt} onChange={event=>setPrompt(event.target.value)}/><small>AI 润色</small></div>
        <div className="fixture-card"><span>画面比例</span><div className="fixture-ratios"><strong>1:1</strong><span>3:4</span><span>16:9</span></div><p>画质　自动</p></div>
        {error ? <p role="alert" className="fixture-error">{error}</p> : null}
        <button className="fixture-generate" disabled={references.reading || notice !== null || !references.images.length} onClick={async()=>{ const [first,...extras]=references.images; await fetch('/submit',{method:'POST',body:JSON.stringify({mode:'edit',prompt,model,image:first!.dataUrl,...extras.length?{images:extras.map(image=>image.dataUrl)}:{},refName:references.images.map(image=>image.name).join('、')})});setSubmitted(true)}}>开始生成</button>
        <button className="fixture-reset" onClick={()=>{references.clear();setPrompt('');setSubmitted(false)}}>新建创作</button>
        {submitted?<output>已提交</output>:null}
      </aside><section className="fixture-stage"><span>图生图</span><h1>让参考图成为创作起点</h1><p>按编号描述每张图片的用途</p><div className="fixture-examples"><img src="/sample/0.png"/><img src="/sample/1.png"/><img src="/sample/2.png"/></div><small>多张参考 · 一个创意</small><button className="fixture-template">▧ 模板</button></section>
    </main></>
}
createRoot(document.getElementById('root')!).render(<Fixture />)

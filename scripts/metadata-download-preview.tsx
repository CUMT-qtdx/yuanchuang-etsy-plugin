import { createRoot } from 'react-dom/client'
import { ImageDownloadLink } from '../src/client/ImageDownloadLink.tsx'
import { downloadCanvasFile, downloadImages, downloadImageZip } from '../src/client/metadata-download.ts'
import { ReferenceStudio } from '../src/client/ReferenceStudio.tsx'

const files = ['base.jpg', 'base.png', 'base.webp']
function Preview(): React.JSX.Element {
  if (location.pathname === '/studio') return <ReferenceStudio request={() => ({ mode: 'edit', model: 'mock-image', prompt: '', size: 'auto', quality: 'auto', n: 1 })} onAdvanced={() => {}} />
  return <main><h1>导出路径验收</h1>
    {files.map(name => <p key={name}><ImageDownloadLink href={`/image/${name}`} download={name}>下载 {name}</ImageDownloadLink></p>)}
    <p><button onClick={() => { void downloadImages(files.map(name => ({ url: `/image/${name}`, name }))).catch(() => {}) }}>批量下载三张</button></p>
    <p><button onClick={() => { void downloadImageZip('/api/dsh-imagegen/etsy/export?id=' + new URLSearchParams(location.search).get('id'), 'test.zip').catch(() => {}) }}>下载商品 ZIP</button></p>
    <p><ImageDownloadLink href="/image/c2pa.png" download="c2pa.png">下载 C2PA 原文件</ImageDownloadLink></p>
    <p><ImageDownloadLink href="/image/partial.png" download="partial.png">下载 C2PA 部分清理文件</ImageDownloadLink></p>
    <p><ImageDownloadLink href="/image/broken.png" download="broken.png">下载损坏图片</ImageDownloadLink></p>
    <p><ImageDownloadLink href="/missing" download="missing.png">下载不存在图片</ImageDownloadLink></p>
    <p><button onClick={() => { void downloadImages([{ url: '/image/broken.png', name: 'bad.png' }, { url: '/image/base.png', name: 'good.png' }, { url: '/missing', name: 'missing.png' }, { url: '/image/base.webp', name: 'good.webp' }]).catch(() => {}) }}>批次含失败图片</button></p>
    <p><button onClick={() => { void downloadImages([{ url: '/image/broken.png', name: 'bad.png' }, { url: '/missing', name: 'missing.png' }]).catch(() => {}) }}>批次全部失败</button></p>
    <p><button onClick={() => { void downloadImages([{ url: '/image/broken.png', name: 'bad.png' }, { url: '/image/c2pa.png', name: 'c2pa.png' }]).catch(() => {}) }}>凭证保护与失败混合</button></p>
    <p><button onClick={() => { void downloadCanvasFile('/image/base.webp', '画布图片.webp', 'image/webp').catch(() => {}) }}>画布文件节点下载</button></p>
  </main>
}
createRoot(document.getElementById('root')!).render(<Preview />)

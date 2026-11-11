/** Actual gallery styles, shared Select and template entry, with local samples. */
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Select } from '../src/client/Select'
import { TemplateLibraryButton } from '../src/client/TemplateLibrary'
import css from '../src/client/panel.module.css'
function Fixture() {
  const [sort, setSort] = useState('newest')
  const legacy = new URLSearchParams(location.search).has('legacy')
  return <div className="fixture"><header className="header"><strong>DSH Image Studio</strong><span>普通生图　　无限画布　　电商模式　　素材库</span></header><main className="stage">
    <aside className="filters"><strong>分类</strong><p>全部素材　25</p><p>文生图　18</p><p>图生图　7</p><hr /><strong>画面比例</strong><p>全部作品　1:1　3:4</p></aside>
    <section className={css.canvas} data-gallery="true"><div className={css.galleryWorkspace}>
      <header className={css.galleryToolbar} style={legacy ? { flexWrap: 'nowrap' } : undefined}>
        <div><h3 className={css.galleryHeading}>全部素材</h3><span className={css.galleryCount}>共 25 幅</span></div>
        <div className={css.galleryToolbarActions}>
          <input className={css.gallerySearch} placeholder="搜索作品或模型…" />
          <button className={css.gallerySelectMode}>上传素材</button><button className={css.gallerySelectMode}>选择作品</button>
          <div className={css.galleryViewToggle}><button data-active="">▦ 瀑布流</button><button>▤ 整齐网格</button></div>
          <Select variant={legacy ? 'field' : 'toolbar'} style={legacy ? { width: '100%', maxWidth: 'none' } : undefined} className={css.gallerySort} value={sort} onChange={setSort} aria-label="排序"><option value="newest">最新发布</option><option value="oldest">最早发布</option></Select>
          <button className={css.galleryClear}>打开文件夹</button><button className={css.galleryClear}>清空素材库</button>
        </div>
      </header>
      <div className={css.galleryMasonry} data-view="masonry">{Array.from({ length: 9 }, (_, index) => <article key={index} className={css.galleryCard}><button className={css.galleryImageButton}><img className={css.galleryImage} src={`/sample/${index}.svg`} alt={`本地示例 ${index + 1}`} /><span className={css.galleryBadge}>文生图</span></button><div className={css.galleryCardActions}><button className={css.galleryCardAction}>加入对话</button><button className={css.galleryCardAction}>加入画布</button></div><div className={css.galleryCardFooter}><div className={css.galleryCardInfo}><strong>本地布局验收素材 {index + 1}</strong><small>gpt-image-2 · 2026-10-18</small></div></div></article>)}</div>
    </div></section><TemplateLibraryButton onClick={() => {}} expanded={false} />
  </main></div>
}
createRoot(document.getElementById('root')!).render(<Fixture />)

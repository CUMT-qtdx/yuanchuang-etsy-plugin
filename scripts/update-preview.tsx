import { createRoot } from 'react-dom/client'
import { AppUpdateButton } from '../src/client/AppUpdateButton.tsx'

createRoot(document.getElementById('root')!).render(
  <div style={{ minHeight: '100vh', background: '#f6f8f7', color: '#24362c', fontFamily: '"Microsoft YaHei", sans-serif', display: 'flex', flexDirection: 'column' }}>
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 28px', background: '#fff', borderBottom: '1px solid #e4ece7' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <strong style={{ fontSize: 18 }}>元创 Etsy Studio</strong>
        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 999, background: '#e8f3ec', color: '#2d6347' }}>2.1.4-etsy</span>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <AppUpdateButton />
        <button type="button" style={{ border: '1px solid #d2e2d7', borderRadius: 9, padding: '7px 12px', background: '#fff', color: '#315e46' }}>高级工具</button>
      </div>
    </header>
    <main style={{ flex: 1, display: 'grid', gridTemplateColumns: '240px 1fr', gap: 20, padding: 24 }}>
      <aside style={{ background: '#fff', border: '1px solid #e4ece7', borderRadius: 12, padding: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 12 }}>我的创作</div>
        <div style={{ display: 'grid', gap: 8, fontSize: 13, color: '#46584d' }}>
          <div style={{ padding: '8px 10px', borderRadius: 8, background: '#ecf6ef', fontWeight: 600 }}>圣诞精灵毛毡摆件</div>
          <div style={{ padding: '8px 10px', borderRadius: 8, background: '#f7faf8' }}>雪人毛毡小挂饰</div>
          <div style={{ padding: '8px 10px', borderRadius: 8, background: '#f7faf8' }}>蘑菇森林小精灵</div>
        </div>
      </aside>
      <section style={{ background: '#fff', border: '1px solid #e4ece7', borderRadius: 12, padding: 24 }}>
        <h2 style={{ margin: '0 0 12px', fontSize: 16 }}>创作工作区</h2>
        <p style={{ margin: 0, color: '#5f7267', fontSize: 13 }}>平台界面保持在弹窗背景中，点击「取消」可直接继续使用当前版本。</p>
      </section>
    </main>
  </div>,
)

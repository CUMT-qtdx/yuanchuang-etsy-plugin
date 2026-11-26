import { aspectRatios, photographyPresets, type PhotographySettings } from '../etsy/felt/photography-options.ts'
import { occupancyPresets } from '../etsy/felt/composition-v1.ts'
import { compositionTarget } from '../etsy/felt/photography-contract.ts'
import css from './reference-studio.module.css'

export function PhotographyControls(props: { value: PhotographySettings; onChange: (value: PhotographySettings) => void }): React.JSX.Element {
  const { value, onChange } = props
  const set = (patch: Partial<PhotographySettings>): void => {
    const controls = new Set(value.explicit_controls ?? [])
    if ('photography_preset' in patch || 'custom_background' in patch) controls.add('background')
    if ('framing_policy' in patch || 'subject_height_ratio' in patch) controls.add('framing')
    if ('aspect_ratio' in patch) controls.add('aspect')
    onChange({ ...value, ...patch, explicit_controls: [...controls] })
  }
  const target = compositionTarget(value)
  const aspect = /^(\d+)[:x](\d+)$/.exec(value.aspect_ratio)
  const sceneHelp = {
    'preserve-original': '保留参考图环境；商品占比仍按构图设置处理。',
    'natural-tabletop': '温润原木桌面搭配柔和窗光与虚化室内景深（小挂饰未手动指定时自动切换悬挂实景）。',
    'home-lifestyle': '真实自然采光家居软装与纵深虚化，自动匹配主光与接触阴影。',
    'seasonal-lifestyle': '按商品主题自动匹配实景氛围（圣诞/森系/秋日/书房/温馨家居），环境光与商品自然融合。',
    'hanging-display': '挂在松枝、横拉麻绳或挂钩上自然垂挂展示，保留顶部挂绳空间，适合毛毡挂件。',
    'flat-lay': '90° 正上方俯拍平铺展示（木板/亚麻/干净浅底），挂绳自然舒展，适合单件或成套挂饰。',
    'white-studio': '纯白无缝背景与白色承托面，柔和包裹光与自然底影，移除原图木桌和房间。',
    custom: '把描述转成真实拍摄场景并重新匹配光线与阴影，不改变商品本身设计。',
  }
  return <section className={css.photographyControls} data-photography-controls="">
    <div className={css.photoTitle}>摄影与构图 <small>{value.preserve_background || value.photography_preset === 'preserve-original' ? '原背景' : photographyPresets.find(preset => preset.value === value.photography_preset)?.label} · {value.framing_policy === 'preserve_reference' ? '原构图' : `主体约${Math.round(value.subject_height_ratio * 100)}%`}</small></div>
    <div className={css.photographyFields}>
      <label>摄影背景<select aria-label="摄影背景" value={value.photography_preset} onChange={event => set({ photography_preset: event.target.value as PhotographySettings['photography_preset'], preserve_background: event.target.value === 'preserve-original' })}>{photographyPresets.map(preset => <option key={preset.value} value={preset.value}>{preset.label}</option>)}</select></label>
      <label>图片画幅<select aria-label="图片画幅" value={value.aspect_ratio} onChange={event => set({ aspect_ratio: event.target.value })}>{aspectRatios.map(ratio => <option key={ratio} value={ratio}>{ratio === 'auto' ? '沿用参考 / 自动' : ratio}</option>)}</select></label>
      <label>构图方式<select aria-label="构图方式" value={value.framing_policy} onChange={event => set({ framing_policy: event.target.value as PhotographySettings['framing_policy'] })}><option value="preserve_reference">保留原构图</option><option value="override_reference">使用新的主体占比</option></select></label>
    </div>
    <small data-photography-scene-help>{sceneHelp[value.photography_preset]}</small>
    {value.photography_preset === 'custom' ? <label>自定义背景<textarea aria-label="自定义摄影背景" maxLength={1000} value={value.custom_background ?? ''} onChange={event => set({ custom_background: event.target.value })} placeholder="例如：圣诞节温馨壁炉与松枝暖光氛围、秋日森林苔藓木桩、浅灰石台与柔和窗光" /><small>描述期望的场景氛围即可，系统会按新场景重配光线与阴影，主体造型仍由参考图决定。</small></label> : null}
    {value.framing_policy === 'override_reference' ? <div className={css.occupancy}><div className={css.actions}>{occupancyPresets.map(preset => <button type="button" key={preset.ratio} aria-pressed={value.subject_height_ratio === preset.ratio} onClick={() => set({ subject_height_ratio: preset.ratio })}>{preset.label}</button>)}</div><label>整组商品高度约 <strong>{Math.round(value.subject_height_ratio * 100)}%</strong><input aria-label="主体高度占比" type="range" min={35} max={90} step={5} value={Math.round(value.subject_height_ratio * 100)} onChange={event => set({ subject_height_ratio: Number(event.target.value) / 100 })} /></label>{target ? <div className={css.framingPreviewRow}><div className={css.framingPreview} data-composition-preview aria-label={`构图示意：整组商品从画面${Math.round(target.top*100)}%到${Math.round(target.bottom*100)}%`} style={{ aspectRatio: aspect ? `${aspect[1]}/${aspect[2]}` : '1' }}><span style={{ top: `${target.top*100}%`, height: `${target.heightRatio*100}%` }} /></div><small>蓝色范围表示整组商品高度，包含所有商品和配件，不含阴影。50% 是占画面一半高度，不是把原图缩小一半。</small></div> : null}<small>生成时使用该构图目标；实际占比仍需核对。商品内部比例保持不变。</small></div> : null}
  </section>
}

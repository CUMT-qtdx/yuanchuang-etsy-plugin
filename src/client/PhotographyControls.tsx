import { aspectRatios, photographyPresets, type PhotographySettings } from '../etsy/felt/photography-options.ts'
import { occupancyPresets } from '../etsy/felt/composition-v1.ts'
import css from './reference-studio.module.css'

export function PhotographyControls(props: { value: PhotographySettings; onChange: (value: PhotographySettings) => void }): React.JSX.Element {
  const { value, onChange } = props
  const set = (patch: Partial<PhotographySettings>): void => onChange({ ...value, ...patch })
  return <details className={css.photographyControls} data-photography-controls="">
    <summary>摄影与构图 <small>{value.preserve_background || value.photography_preset === 'preserve-original' ? '原背景' : photographyPresets.find(preset => preset.value === value.photography_preset)?.label} · {value.framing_policy === 'preserve_reference' ? '原构图' : `主体约${Math.round(value.subject_height_ratio * 100)}%`}</small></summary>
    <div className={css.photographyFields}>
      <label>摄影背景<select aria-label="摄影背景" value={value.photography_preset} onChange={event => set({ photography_preset: event.target.value as PhotographySettings['photography_preset'], preserve_background: event.target.value === 'preserve-original' })}>{photographyPresets.map(preset => <option key={preset.value} value={preset.value}>{preset.label}</option>)}</select></label>
      <label>图片画幅<select aria-label="图片画幅" value={value.aspect_ratio} onChange={event => set({ aspect_ratio: event.target.value })}>{aspectRatios.map(ratio => <option key={ratio} value={ratio}>{ratio === 'auto' ? '沿用参考 / 自动' : ratio}</option>)}</select></label>
      <label>构图方式<select aria-label="构图方式" value={value.framing_policy} onChange={event => set({ framing_policy: event.target.value as PhotographySettings['framing_policy'] })}><option value="preserve_reference">保留原构图</option><option value="override_reference">使用新的主体占比</option></select></label>
    </div>
    {value.photography_preset === 'custom' ? <label>自定义背景<textarea aria-label="自定义摄影背景" maxLength={1000} value={value.custom_background ?? ''} onChange={event => set({ custom_background: event.target.value })} placeholder="例如：浅灰水泥台面，后方米白墙，柔和左侧窗光；不加其他道具" /><small>描述环境即可，主体造型仍由参考图和你的要求决定。</small></label> : null}
    {value.framing_policy === 'override_reference' ? <div className={css.occupancy}><div className={css.actions}>{occupancyPresets.map(preset => <button type="button" key={preset.ratio} aria-pressed={value.subject_height_ratio === preset.ratio} onClick={() => set({ subject_height_ratio: preset.ratio })}>{preset.label}</button>)}</div><label>主体高度约 <strong>{Math.round(value.subject_height_ratio * 100)}%</strong><input aria-label="主体高度占比" type="range" min={35} max={90} step={5} value={Math.round(value.subject_height_ratio * 100)} onChange={event => set({ subject_height_ratio: Number(event.target.value) / 100 })} /></label><small>调整整体在画面中的大小，不改变头身比例；横向主体优先完整入镜。</small></div> : null}
  </details>
}

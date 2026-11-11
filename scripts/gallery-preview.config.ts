import { fileURLToPath } from 'node:url'
import templateConfig from './template-preview.config.ts'
export default { ...templateConfig, name: 'gallery-preview', entry: { preview: fileURLToPath(new URL('./gallery-preview.tsx', import.meta.url)) }, outDir: fileURLToPath(new URL('../.gallery-preview', import.meta.url)) }

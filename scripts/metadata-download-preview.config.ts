import { fileURLToPath } from 'node:url'
import config from './reference-preview.config.ts'
export default { ...config, name: 'metadata-download-preview', entry: { preview: fileURLToPath(new URL('./metadata-download-preview.tsx', import.meta.url)) }, outDir: fileURLToPath(new URL('../.metadata-preview', import.meta.url)) }

import configs from '../tsdown.config.ts'
import { fileURLToPath } from 'node:url'
export default { ...configs[0], entry: { host: fileURLToPath(new URL('./etsy-test-entry.ts', import.meta.url)) }, outDir: fileURLToPath(new URL('../.etsy-test', import.meta.url)), clean: true }

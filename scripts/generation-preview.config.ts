import { fileURLToPath } from 'node:url'
import configs from '../tsdown.config.ts'
export default {
  ...configs[1], name: 'generation-preview',
  entry: { preview: fileURLToPath(new URL('./generation-preview.tsx', import.meta.url)) },
  outDir: fileURLToPath(new URL('../.generation-preview', import.meta.url)),
  format: 'iife', sourcemap: false, clean: true,
  deps: { alwaysBundle: ['react', 'react-dom'] },
  outputOptions: { entryFileNames: 'preview.js', banner: '', footer: '', intro: '' },
}

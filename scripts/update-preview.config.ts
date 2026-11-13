import configs from '../tsdown.config.ts'
import { fileURLToPath } from 'node:url'
export default { ...configs[1], name: 'update-preview', entry: { preview: fileURLToPath(new URL('./update-preview.tsx', import.meta.url)) }, outDir: fileURLToPath(new URL('../.update-preview', import.meta.url)), format: 'iife', sourcemap: false, clean: true, deps: { alwaysBundle: ['react', 'react-dom'] }, outputOptions: { entryFileNames: 'preview.js', banner: '', footer: '', intro: '' } }

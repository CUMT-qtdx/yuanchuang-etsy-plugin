import { fileURLToPath } from 'node:url'
import configs from '../tsdown.config.ts'
export default { ...configs[1], name: 'reference-studio', entry: { preview: fileURLToPath(new URL('./reference-preview.tsx', import.meta.url)) }, outDir: fileURLToPath(new URL('../.reference-preview', import.meta.url)), format: 'iife', sourcemap: false, clean: true, deps: { alwaysBundle: ['react', 'react-dom'] }, outputOptions: { entryFileNames: 'preview.js', banner: '', footer: '', intro: '' } }

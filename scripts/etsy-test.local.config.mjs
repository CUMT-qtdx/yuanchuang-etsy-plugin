// 离线测试宿主配置：不加载主 tsdown 配置，避免开发目录损坏的 lightningcss 链接影响测试。
import { fileURLToPath } from 'node:url'

export default {
  entry: { host: fileURLToPath(new URL('./etsy-test-entry.ts', import.meta.url)) },
  outDir: fileURLToPath(new URL('../.etsy-test', import.meta.url)),
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: true,
  outputOptions: { entryFileNames: '[name].js' },
  deps: {
    neverBundle: [
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-settings',
      '@deepseek-ai/dsh-tools',
      '@deepseek-ai/dsh-attachment',
      '@deepseek-ai/dsh-credentials',
      '@deepseek-ai/dsh-llm',
      '@deepseek-ai/dsh-llm/message',
      '@deepseek-ai/schemastery',
    ],
  },
}

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: { port: 5173, host: true },
  build: {
    // 生成 source map for 生产 Sentry 反混淆
    // 注：vite build 默认开启 sourcemap（hidden: false => inline=false, generatate=true）
    // 用 'hidden' 让最终 bundle 不带 //# sourceMappingURL 注释（隐私）
    // Sentry 仍然可以通过 .map 文件上传到 sentry.io 用
    sourcemap: process.env.NODE_ENV === 'production' ? 'hidden' : true,
  },
})
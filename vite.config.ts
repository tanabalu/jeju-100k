import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base 用相对路径，方便部署到任意子路径（如 Dokploy 的 /trail/ ）
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5180,
    host: '127.0.0.1',
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // 大体积第三方库各自独立成 chunk：不参与业务代码的变更缓存，
        // 库版本不变时浏览器可长期命中缓存。
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          leaflet: ['leaflet'],
          echarts: ['echarts/core', 'echarts/charts', 'echarts/components', 'echarts/renderers'],
        },
      },
    },
  },
})

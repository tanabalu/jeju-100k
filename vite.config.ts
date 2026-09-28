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
  },
})

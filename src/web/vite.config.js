import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  server: {
    port: 5000,
    proxy: {
      '/api': {
        target: 'http://localhost:19999',
        changeOrigin: true
      },
      '/ws': {
        target: 'ws://localhost:19999',
        ws: true,
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true
  }
})

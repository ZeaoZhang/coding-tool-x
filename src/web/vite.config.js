import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:10099',
        changeOrigin: true
      },
      '/ws': {
        target: 'ws://localhost:10099',
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

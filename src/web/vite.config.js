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
    emptyOutDir: true,
    // 代码分割优化
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return
          }

          if (id.includes('/naive-ui/')) {
            return 'naive-ui'
          }

          if (id.includes('/@xterm/')) {
            return 'xterm'
          }

          if (id.includes('/markdown-it/') || id.includes('/marked/') || id.includes('/highlight.js/')) {
            return 'markdown'
          }

          if (id.includes('/@vicons/')) {
            return 'icons'
          }

          if (id.includes('/vue-router/') || id.includes('/pinia/') || id.includes('/vue/')) {
            return 'vue-vendor'
          }

          if (id.includes('/axios/') || id.includes('/vuedraggable/')) {
            return 'vendors'
          }
        }
      }
    },
    // 压缩优化
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true
      }
    },
    // 代码分割阈值
    chunkSizeWarningLimit: 500
  },
  // CSS 优化
  css: {
    devSourcemap: false
  }
})

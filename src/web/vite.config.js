import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      vuedraggable: path.resolve(import.meta.dirname, 'node_modules/vuedraggable/src/vuedraggable.js')
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
    // Vite 8 uses Rolldown; keep third-party cache boundaries explicit while
    // leaving route and async-component boundaries to automatic splitting.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'markdown',
              test: /[\\/]node_modules[\\/](?:markdown-it|marked|highlight\\.js)[\\/]/,
              priority: 30
            },
            {
              name: 'icons',
              test: /[\\/]node_modules[\\/]@vicons[\\/]ionicons5[\\/]/,
              priority: 30
            },
            {
              name: 'vue-vendor',
              test: /[\\/]node_modules[\\/](?:vue|vue-demi|vue-router|pinia|@vue[\\/](?:shared|reactivity|runtime-core|runtime-dom))[\\/]/,
              priority: 40
            },
            {
              name: 'vendors',
              test: /[\\/]node_modules[\\/](?:axios|vuedraggable|sortablejs)[\\/]/,
              priority: 10
            }
          ]
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

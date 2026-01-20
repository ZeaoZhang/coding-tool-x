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
        manualChunks: {
          'naive-ui': ['naive-ui'],
          'vue-vendor': ['vue', 'vue-router', 'pinia'],
          'icons': ['@vicons/ionicons5'],
          'vendors': ['axios', 'vuedraggable']
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


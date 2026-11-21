import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    include: ['src/**/__tests__/**/*.test.js'],
    // Component tests mount Naive UI + ResizeObserver; under full-suite
    // parallelism the default 5s budget is occasionally exceeded by startup
    // contention rather than by the test body.
    testTimeout: 15000,
    hookTimeout: 15000
  }
})

const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.js'],
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      exclude: ['src/web/**', 'src/plugins/**'],
    },
  },
});

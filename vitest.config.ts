import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    // Only pick up co-located unit tests; tests/e2e/ contains Playwright specs.
    include: ['src/**/*.test.ts'],
  },
})

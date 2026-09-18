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
    // The forestry regression suite is plain ESM (.mjs) against the real modules.
    include: ['src/**/*.test.ts', 'src/**/*.test.mjs'],
  },
})

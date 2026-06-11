import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Only pick up co-located unit tests; tests/e2e/ contains Playwright specs.
    include: ['src/**/*.test.ts'],
  },
})

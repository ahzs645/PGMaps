import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      'brandkit/consumer': path.resolve(__dirname, 'vendor/brandkit/src/engine/consumer.js'),
      'brandkit/fonts': path.resolve(__dirname, 'vendor/brandkit/src/fonts/provider.js'),
      'brandkit/pack/host': path.resolve(__dirname, 'vendor/brandkit/src/pack/host.js'),
      '@': path.resolve(__dirname, 'src'),
      '@pgmaps/geo-toolkit': path.resolve(__dirname, 'packages/geo-toolkit/src'),
    },
  },
  test: {
    environment: 'node',
    // The VIA report's JSON parts render through document-kit's engine, which the page loads with Save & export.
    setupFiles: ['src/pages/dev-forestry/viaReport/reportEngine.setup.ts'],
    // Only pick up co-located unit tests; tests/e2e/ contains Playwright specs.
    // The forestry regression suite is plain ESM (.mjs) against the real modules.
    include: [
      'src/**/*.test.ts',
      'packages/legal-rules/tests/**/*.test.ts',
      'src/**/*.test.tsx',
      'src/**/*.test.mjs',
      'packages/geo-toolkit/src/**/*.test.ts',
      'packages/geo-toolkit/src/**/*.test.mjs',
    ],
  },
})

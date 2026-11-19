/**
 * Runs the VIA recipe scripts (`*.run.ts`) under Vitest, which reads the app's TypeScript, its `@/` paths, its JSON
 * and `import.meta.glob` as the app's own tests do.
 */
import { defineConfig } from 'vitest/config'

import base from '../../../vitest.config'

export default defineConfig({
  ...base,
  test: { ...base.test, include: ['scripts/forestry/via-recipes/*.run.ts'], testTimeout: 600_000 },
})

import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['**/dist/**', 'public', '**/node_modules/**', '**/test-results/**', '**/playwright-report/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ['scripts/toolkit/**/*.mjs'],
    languageOptions: {
      globals: { fetch: 'readonly', AbortSignal: 'readonly' },
    },
  },
  {
    files: ['packages/geo-toolkit/tests/**/*.mjs'],
    languageOptions: {
      globals: { window: 'readonly', document: 'readonly', getComputedStyle: 'readonly', console: 'readonly' },
    },
  },
  {
    // Plain-ESM test files run under vitest on Node 20+, where these are globals.
    files: ['src/**/*.mjs', 'packages/geo-toolkit/src/**/*.mjs'],
    languageOptions: {
      globals: { structuredClone: 'readonly', URL: 'readonly', TextDecoder: 'readonly', TextEncoder: 'readonly' },
    },
  },
  {
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  }
)

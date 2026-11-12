import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import prettier from 'eslint-config-prettier'

function designTokenSelectors() {
  const checks = [
    [
      String.raw`(^|\s)([a-z0-9-]+:)*rounded(\s|$)`,
      'Name a corner role instead of plain `rounded`: rounded-sm for marks, rounded-md for controls and boxes (insetBox), rounded-lg for cards.',
    ],
    [String.raw`rounded(-[a-z]+)?-\[`, 'Use the radius scale (rounded-sm … rounded-2xl), which follows --radius.'],
    [String.raw`text-\[[0-9.]+px\]`, 'Use the type scale (text-3xs, text-2xs, text-xs …) rather than a pixel size.'],
    [
      String.raw`(^|\s)([a-z0-9-]+:)*text-(amber|red|emerald|green)-[0-9]`,
      'Use a status colour (text-warning, text-danger, text-success) rather than a palette shade.',
    ],
  ]
  const sources = [
    ["JSXAttribute[name.name='className'] Literal", 'value'],
    ["JSXAttribute[name.name='className'] TemplateElement", 'value.raw'],
    ["CallExpression[callee.name='cn'] Literal", 'value'],
  ]
  return checks.flatMap(([pattern, message]) =>
    sources.map(([node, field]) => ({ selector: `${node}[${field}=/${pattern}/]`, message })),
  )
}

export default tseslint.config(
  { ignores: ['**/dist/**', 'public', '**/node_modules/**', '**/test-results/**', '**/playwright-report/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    // Plain-ESM test files run under vitest on Node 20+, where these are globals.
    files: ['src/**/*.mjs', 'packages/geo-toolkit/src/**/*.mjs'],
    languageOptions: {
      globals: { structuredClone: 'readonly', URL: 'readonly', TextDecoder: 'readonly', TextEncoder: 'readonly' },
    },
  },
  {
    // The Flatten routing engine is browser JavaScript; its graph methods alias `this` as `g`.
    files: ['src/pages/dev-flatten/**/*.js'],
    languageOptions: {
      globals: {
        atob: 'readonly',
        Blob: 'readonly',
        DecompressionStream: 'readonly',
        Response: 'readonly',
        fetch: 'readonly',
        TextDecoder: 'readonly',
        performance: 'readonly',
      },
    },
    rules: { '@typescript-eslint/no-this-alias': ['error', { allowedNames: ['g'] }] },
  },
  {
    // Forestry tools read radius, type size and status colour from the design tokens
    // (docs/shared-ui.md, Design tokens). Checked where class names are written: a
    // className string or template, or an argument to `cn`.
    files: [
      'src/pages/dev-forestry/**/*.tsx',
      'src/pages/dev-forestry-roads/**/*.tsx',
      'src/components/interfaces/**/*.tsx',
      'src/pages/DevForestry.tsx',
      'src/pages/DevForestryRoads.tsx',
      'src/pages/DevForestryVisuals.tsx',
      'src/pages/ForestryRoadWorkspace.tsx',
    ],
    ignores: ['**/*.test.tsx'],
    rules: { 'no-restricted-syntax': ['error', ...designTokenSelectors()] },
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

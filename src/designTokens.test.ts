import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// src/index.css is where PG Maps sets its token values (docs/shared-ui.md, Design tokens).
// Its rules also name `.geo-toolkit`, so they replace the toolkit's defaults inside map
// workspaces. These checks keep that true when either stylesheet changes.
const app = readFileSync(new URL('./index.css', import.meta.url), 'utf8')
const toolkit = readFileSync(new URL('../packages/geo-toolkit/src/styles.css', import.meta.url), 'utf8')
const main = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8')

function blockAfter(css: string, selector: string) {
  const start = css.indexOf(selector)
  expect(start, selector).toBeGreaterThanOrEqual(0)
  const open = css.indexOf('{', start)
  return css.slice(open + 1, css.indexOf('}', open))
}

const declared = (body: string) => new Set([...body.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]))
const tokenNames = (body: string) => [...declared(body)].filter((name) => !name.startsWith('--geo-motion'))

const appLight = declared(blockAfter(app, ':root,\n  .geo-toolkit {'))
const appDark = declared(
  blockAfter(
    app,
    ".dark,\n  .geo-toolkit.dark,\n  .geo-toolkit[data-theme='dark'],\n  .dark .geo-toolkit:not([data-theme='light']) {",
  ),
)
const toolkitLight = tokenNames(blockAfter(toolkit, '.geo-toolkit {'))
const toolkitDark = tokenNames(blockAfter(toolkit, ".geo-toolkit.dark,\n.geo-toolkit[data-theme='dark']"))

describe('design tokens', () => {
  it('sets every toolkit token in the light theme', () => {
    expect(toolkitLight).toContain('--radius')
    expect(toolkitLight).toContain('--warning-surface')
    for (const name of toolkitLight) expect(appLight.has(name), name).toBe(true)
  })

  it('sets every themed toolkit token in the dark theme', () => {
    for (const name of toolkitDark) expect(appDark.has(name), name).toBe(true)
  })

  it('loads after the toolkit stylesheet so equal selectors resolve to the app', () => {
    const toolkitImport = main.indexOf("import '@pgmaps/geo-toolkit/styles.css'")
    const appImport = main.indexOf("import './index.css'")
    expect(toolkitImport).toBeGreaterThanOrEqual(0)
    expect(appImport).toBeGreaterThan(toolkitImport)
  })
})

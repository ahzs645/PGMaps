import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// GitHub Pages serves a path without its own index.html through 404.html with HTTP 404: the app still
// renders, but crawlers, link checkers and previews treat the page as broken. scripts/write-spa-fallback.mjs
// writes an entry page for every listed route; this keeps that list in step with the router.
const root = new URL('../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), 'utf8')

function listedRoutes(): Set<string> {
  const source = read('scripts/write-spa-fallback.mjs')
  const block = /const spaRoutes = \[([\s\S]*?)\n\]/.exec(source)?.[1]
  if (!block) throw new Error('spaRoutes list not found in write-spa-fallback.mjs')
  const routes = new Set<string>()
  for (const [, value] of block.matchAll(/^\s*'([^']+)',?$/gm)) routes.add(value)
  // Spread groups: ...['a', 'b'].map((tool) => `prefix/${tool}`)
  for (const [, items, prefix] of block.matchAll(/\.\.\.\[([^\]]*)\]\.map\(\s*\(\w+\) => `([^`$]*)\$\{\w+\}`/g))
    for (const [, item] of items.matchAll(/'([^']+)'/g)) routes.add(`${prefix}${item}`)
  return routes
}

describe('static entry pages for GitHub Pages', () => {
  const listed = listedRoutes()

  it('lists every concrete route in App.tsx', () => {
    const routes = [...read('src/App.tsx').matchAll(/<Route[\s\S]*?path="\/([^"]*)"/g)]
      .map((match) => match[1])
      .filter((route) => route && !route.includes(':') && !route.includes('*'))
    expect(routes.length).toBeGreaterThan(40)
    expect(routes.filter((route) => !listed.has(route))).toEqual([])
  })

  it('lists every LiDAR workspace tool served by /dev/lidar/*', () => {
    const union = /export type LidarToolId =([\s\S]*?)\n(?:export|\S)/.exec(
      read('src/pages/dev-lidar/workspaceTools.ts'),
    )
    const tools = [...(union?.[1] ?? '').matchAll(/'([^']+)'/g)].map((match) => match[1])
    expect(tools.length).toBeGreaterThan(5)
    expect(tools.filter((tool) => !listed.has(`dev/lidar/${tool}`))).toEqual([])
  })
})

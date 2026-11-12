import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import postcss from 'postcss'
import { helpRadiusTokens, rebuildPortableGuards, tokenizedPlayerCss } from '../../scripts/lib/help-tour-build.mjs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const help = new URL('../../public/help/', import.meta.url)
const radius = helpRadiusTokens(read('../index.css'))

describe('standalone lesson exports', () => {
  it('copies the shared token without maintaining another radius value', () => {
    expect(read('../../public/help/designTokens.css')).toBe(radius)
    expect(helpRadiusTokens(':root { --radius: 1rem }')).toContain('--radius: 1rem')
    expect(() => helpRadiusTokens('body {}')).toThrow('one shared --radius')
    expect(read('../../public/help/help.css')).toContain("@import url('./designTokens.css')")
  })

  it('keeps every lesson self-contained and gives every player corner the shared token', () => {
    for (const entry of readdirSync(help, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'open-hillside') continue
      const html = read(`../../public/help/${entry.name}/tour.html`)
      expect(html).toContain(radius)
      for (const [, css] of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
        postcss.parse(css).walkDecls(/^border.*radius$/, ({ value }) => {
          expect(value.includes('var(--radius)') || /^(0|50%)$/.test(value), value).toBe(true)
        })
      }
    }
  })

  it('rebuilds guards and corner expressions idempotently and refuses unknown runtimes', () => {
    const html = read('../../public/help/sketch-road/tour.html')
    const runtime = html.match(/<script>([\s\S]*?)<\/script>/)[1]
    const guards = 'var PGMapsCapture = {parseCapture: () => {}};'
    const rebuilt = rebuildPortableGuards(runtime, guards)
    expect(rebuildPortableGuards(rebuilt, guards)).toBe(rebuilt)
    expect(() => rebuildPortableGuards('unknown player', guards)).toThrow('Unrecognized TourKit')
    const css = tokenizedPlayerCss('a{border-radius:5px}b{border-radius:50%}')
    expect(tokenizedPlayerCss(css)).toBe(css)
  })
})

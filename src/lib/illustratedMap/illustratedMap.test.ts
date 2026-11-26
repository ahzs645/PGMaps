import { DOMParser } from '@xmldom/xmldom'
import { describe, expect, it } from 'vitest'
import { buildElementSvg, buildIllustratedMapSvg, ELEMENT_CATALOG } from './index'
import { CONNECTORS, HIGHWAYS, JUNCTIONS, smoothPath } from './layout'
import { lettering } from './lettering'

describe('editable illustrated-map exports', () => {
  it('exports every catalog entry as independently openable, image-free SVG', () => {
    expect(new Set(ELEMENT_CATALOG.map((entry) => entry.id)).size).toBe(ELEMENT_CATALOG.length)
    for (const element of ELEMENT_CATALOG) {
      const svg = buildElementSvg(element.id)
      const document = new DOMParser().parseFromString(svg, 'image/svg+xml')
      expect(document.documentElement?.tagName).toBe('svg')
      expect(document.getElementsByTagName('parsererror').length).toBe(0)
      expect(document.getElementsByTagName('image').length).toBe(0)
      expect(document.getElementsByTagName('foreignObject').length).toBe(0)
      expect(svg).not.toMatch(/NaN|Infinity|data:image|<script/)
    }
    expect(() => buildElementSvg('unrecognised')).toThrow('Unknown illustrated-map element')
  })

  it('keeps layer choices in the actual exported file and resolves its clipping resources', () => {
    const svg = buildIllustratedMapSvg({ layers: { hatching: false, roads: false, symbols: false } })
    expect(svg).not.toContain('id="highways"')
    expect(svg).not.toContain('id="forest-hatching"')
    expect(svg).not.toContain('id="illustration"')
    expect(svg).toContain('id="lettering"')
    const full = buildIllustratedMapSvg()
    const document = new DOMParser().parseFromString(full, 'image/svg+xml')
    const ids = new Set(Array.from(document.getElementsByTagName('*')).map((node) => node.getAttribute('id')))
    for (const match of full.matchAll(/url\(#([^)]*)\)/g)) expect(ids.has(match[1])).toBe(true)
    expect(full).not.toContain('<image')
  })

  it('makes an ink-only comparison without changing road geometry', () => {
    const ink = buildIllustratedMapSvg({ transparentBackground: true })
    expect(ink).not.toContain('id="surroundings"')
    expect(ink).not.toContain('id="land"')
    for (const highway of HIGHWAYS) expect(ink).toContain(`d="${smoothPath(highway.points)}"`)
    expect(ink).toContain('id="forest-hatching"')
  })

  it('joins highways on shared semantic junctions instead of nearby independent endpoints', () => {
    const ends = HIGHWAYS.flatMap((route) => [route.points[0], route.points[route.points.length - 1]])
    for (const name of ['vancouver', 'hope', 'kamloops'] as const) {
      expect(ends.filter((point) => point === JUNCTIONS[name]).length).toBeGreaterThanOrEqual(2)
    }
    expect(HIGHWAYS.every((route) => route.points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)))).toBe(
      true,
    )
  })

  it('attaches intentional scenic-connector endpoints to their receiving route', () => {
    const routes = [...HIGHWAYS, ...CONNECTORS]
    const joins = [
      ['to-seattle', 'start', 'highway-1-west'],
      ['golden-fernie', 'start', 'highway-1-east'],
      ['east-mountain-loop', 'end', 'golden-fernie'],
      ['south-loop-short', 'end', 'south-loop'],
    ] as const
    for (const [fromId, end, toId] of joins) {
      const from = routes.find((route) => route.id === fromId)!
      const to = routes.find((route) => route.id === toId)!
      const endpoint = from.points[end === 'start' ? 0 : from.points.length - 1]
      // Both centrelines must pass through one shared landmark, not two nearby
      // coordinates whose stroke widths happen to hide a gap at this scale.
      expect(to.points).toContain(endpoint)
    }
  })

  it('composes lettering from glyphs and retains its editable source wording', () => {
    const svg = lettering('JASPER &', [10, 20, 100, 12])
    const document = new DOMParser().parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg">${svg}</svg>`,
      'image/svg+xml',
    )
    expect(document.getElementsByTagName('path').length).toBe(7)
    expect(svg).toContain('data-text="JASPER &amp;"')
    expect(svg).not.toContain('<text')
    expect(() => lettering('é', [0, 0, 100, 20])).toThrow('no glyph')
  })
})

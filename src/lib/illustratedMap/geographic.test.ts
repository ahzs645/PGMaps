import { DOMParser } from '@xmldom/xmldom'
import { describe, expect, it } from 'vitest'
import data from './geography.generated.json'
import { buildGeographicLandMaskSvg, buildGeographicMapSvg } from './geographic'
import { lettering, letteringSize } from './lettering'

const parse = (svg: string) => new DOMParser().parseFromString(svg, 'image/svg+xml')
const byId = (document: ReturnType<typeof parse>, id: string) =>
  Array.from(document.getElementsByTagName('*')).find((node) => node.getAttribute('id') === id)

describe('geographic illustration', () => {
  it('uses one compound dry-land object for both province fill and hatch clipping', () => {
    const svg = buildGeographicMapSvg()
    const document = parse(svg)
    expect(document.getElementsByTagName('parsererror').length).toBe(0)
    expect(document.getElementsByTagName('image').length).toBe(0)
    expect(svg).not.toMatch(/NaN|Infinity|data:image|<script/)
    const boundary = byId(document, 'geo-bc-land-geometry')!
    expect(boundary.getAttribute('d')).toBe(data.bcLand.d)
    expect(boundary.getAttribute('fill-rule')).toBe('evenodd')
    expect(boundary.hasAttribute('stroke')).toBe(false)
    const clip = byId(document, 'geo-land-clip')!
    expect(clip.getElementsByTagName('use')[0].getAttribute('href')).toBe('#geo-bc-land-geometry')
    expect(clip.getElementsByTagName('use')[0].getAttribute('clip-rule')).toBe('evenodd')
    const fills = byId(document, 'geo-land')!.getElementsByTagName('use')
    expect(Array.from(fills).some((use) => use.getAttribute('href') === '#geo-bc-land-geometry')).toBe(true)
    const ids = new Set(Array.from(document.getElementsByTagName('*')).map((node) => node.getAttribute('id')))
    for (const match of svg.matchAll(/url\(#([^)]*)\)/g)) expect(ids.has(match[1])).toBe(true)
  })

  it('keeps lake holes and real islands in the independent mask export', () => {
    const document = parse(buildGeographicLandMaskSvg())
    const mask = document.getElementsByTagName('path')[0]
    expect(mask.getAttribute('d')).toBe(data.land.d)
    expect(mask.getAttribute('fill-rule')).toBe('evenodd')
    expect(data.land.holes).toBeGreaterThan(0)
    expect(data.land.polygons).toBeGreaterThan(100)
    expect(data.projection.sourceCoverageMissingSquareMetres).toBeLessThanOrEqual(1)
    expect(data.checkpoints.find((point) => point.id === 'strait-of-georgia-water')?.land).toBe(false)
    expect(data.checkpoints.find((point) => point.id === 'okanagan-lake-water')?.land).toBe(false)
    expect(data.checkpoints.find((point) => point.id === 'kamloops-lake-water')?.land).toBe(false)
    expect(data.checkpoints.find((point) => point.id === 'victoria-land')?.land).toBe(true)
  })

  it('changes inland style coverage without replacing the coastline or source road geometry', () => {
    const coastal = buildGeographicMapSvg({ layers: { symbols: false, labels: false } })
    const province = buildGeographicMapSvg({ coverage: 'province', layers: { symbols: false, labels: false } })
    expect(coastal).toContain('clip-path="url(#geo-style-clip)"')
    expect(province).not.toContain('geo-style-clip')
    expect(province).toContain('clip-path="url(#geo-land-clip)"')
    for (const road of data.roads) {
      expect(coastal).toContain(`d="${road.d}"`)
      expect(province).toContain(`d="${road.d}"`)
      expect(road.d).not.toMatch(/[CQ]/)
    }
    const noRoads = buildGeographicMapSvg({ layers: { roads: false, hatching: false, labels: false } })
    expect(noRoads).not.toContain('id="geo-primary-highways"')
    expect(noRoads).not.toContain('id="geo-forest-hatching"')
    expect(noRoads).not.toContain('id="geo-lettering"')
    expect(noRoads).toContain('id="geo-destinations"')
  })

  it('keeps the true place coordinates and route identity in the exported markers', () => {
    const document = parse(buildGeographicMapSvg({ layers: { hatching: false } }))
    const vancouver = data.places.find((point) => point.id === 'vancouver')!
    const marker = byId(document, 'geo-place-vancouver')!
    expect(Number(marker.getAttribute('data-longitude'))).toBe(vancouver.coordinate[0])
    expect(Number(marker.getAttribute('data-latitude'))).toBe(vancouver.coordinate[1])
    for (const shield of data.shields) {
      const roadMarker = byId(document, `geo-${shield.id}`)!
      expect(roadMarker.getAttribute('data-route')).toBe(shield.route)
      expect(data.roads.some((road) => road.jurisdiction === 'BC' && road.route === shield.route)).toBe(true)
    }
  })

  it('sets geographic labels with uniform glyph scale and preserves the white outline', () => {
    const size = letteringSize('VANCOUVER')
    const document = parse(
      `<svg xmlns="http://www.w3.org/2000/svg">${lettering('VANCOUVER', [20, 30, size.width, size.height], 'smallcaps', 0, 1.8)}</svg>`,
    )
    const group = document.getElementsByTagName('g')[0]
    const scales = group.getAttribute('data-font-scale')!.split(' ').map(Number)
    expect(scales[0]).toBeCloseTo(scales[1], 6)
    expect(group.getAttribute('stroke-width')).toBe('3.6')
    expect(group.getAttribute('data-tracking-units')).toBe('0')
    expect(() => letteringSize('ROCKIES', 36.728, 'regular', 'FORESTS')).toThrow('preserve the lettering text')
  })
})

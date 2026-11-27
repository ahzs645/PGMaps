import { DOMParser } from '@xmldom/xmldom'
import { describe, expect, it } from 'vitest'
import data from './geography.generated.json'
import {
  boxTouchesLand,
  buildGeographicLandMaskSvg,
  buildGeographicMapSvg,
  drawnMotifs,
  drawnRoads,
  landPath,
  journeyInsetAccent,
  PAGE8_EDITION,
  PAGE8_JOURNEY_REGION,
  PLACE_LABELS,
  VANCOUVER_ISLAND_HIGHWAY_1,
} from './geographic'
import { lettering, letteringSize } from './lettering'
import { ELEMENT_CATALOG } from './symbols'

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

  it('unions the northern and coastal style regions over one stable hatch field and the same land clip', () => {
    const options = { layers: { symbols: false, labels: false } }
    const coastal = buildGeographicMapSvg(options)
    const northern = buildGeographicMapSvg({ ...options, coverage: 'northern' })
    const document = parse(northern)
    const stylePaths = byId(document, 'geo-style-clip')!.getElementsByTagName('path')
    expect(stylePaths.length).toBe(2)
    expect(stylePaths[0].getAttribute('d')).toBe(data.coastalCoverage.d)
    expect(stylePaths[1].getAttribute('id')).toBe('geo-northern-style-extent')
    expect(byId(document, 'geo-bc-land-geometry')!.getAttribute('d')).toBe(data.bcLand.d)
    expect(byId(document, 'geo-forest-hatching')!.getElementsByTagName('g')[0].getAttribute('clip-path')).toBe(
      'url(#geo-land-clip)',
    )
    const field = Array.from(document.getElementsByTagName('g')).filter(
      (node) => node.getAttribute('data-generator') === 'contour-hatch-v3',
    )
    expect(field.length).toBe(1)
    expect(field[0].getAttribute('data-effective-spacing')).toBe('3')
    expect(field[0].getAttribute('data-budget-limited')).toBe('false')
    const marks = (svg: string) => new Set(svg.match(/<path d="M[^"]+" stroke-width="[^"]+"\/>/g))
    const originalMarks = marks(coastal)
    const northernMarks = marks(northern)
    expect(originalMarks.size).toBeGreaterThan(10_000)
    expect(northernMarks.size).toBeGreaterThan(originalMarks.size)
    for (const mark of originalMarks) expect(northernMarks.has(mark)).toBe(true)
    for (const road of data.roads) expect(northern).toContain(`d="${road.d}"`)
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

describe('page 8 hatch style', () => {
  it('draws the patch field under the same land and coverage clips, and records its settings', () => {
    const svg = buildGeographicMapSvg({ coverage: 'northern', hatchStyle: 'patch' })
    expect(svg).toContain('data-generator="patch-hatch-v1"')
    expect(svg).not.toContain('data-generator="contour-hatch-v3"')
    expect(svg).toContain('<g clip-path="url(#geo-land-clip)"><g clip-path="url(#geo-style-clip)"')
    expect(svg).toContain('&quot;hatchStyle&quot;:&quot;patch&quot;')
    expect(Number(svg.match(/data-stroke-count="(\d+)"/)![1])).toBeGreaterThan(20_000)
    // The default stays the continuous field every earlier export drew.
    expect(buildGeographicMapSvg({ coverage: 'northern' })).toContain('data-generator="contour-hatch-v3"')
  })
})

describe('channel gap', () => {
  it('masks the land and its hatch along every shore, only when asked', () => {
    const svg = buildGeographicMapSvg({ coverage: 'northern', channelGap: 1.2 })
    const document = parse(svg)
    expect(document.getElementsByTagName('parsererror').length).toBe(0)
    expect(svg).toContain('<mask id="geo-channel-gap"')
    expect(svg).toContain('stroke="black" stroke-width="1.2"')
    expect(svg).toContain('<g clip-path="url(#geo-land-clip)" mask="url(#geo-channel-gap)">')
    // The land path itself is unchanged; the gap is a mask over it.
    expect(byId(document, 'geo-bc-land-geometry')!.getAttribute('d')).toBe(data.bcLand.d)
    expect(buildGeographicMapSvg({ coverage: 'northern' })).not.toContain('geo-channel-gap')
  })
})

describe('page 8 edition', () => {
  const svg = buildGeographicMapSvg(PAGE8_EDITION)
  const document = parse(svg)

  it('hatches BC outside the journey region and leaves the region white', () => {
    expect(document.getElementsByTagName('parsererror').length).toBe(0)
    expect(svg).toContain('data-generator="patch-hatch-v1"')
    // The style clip is the frame less the journey region, even-odd.
    const clip = byId(document, 'geo-style-clip')!
    const clipPath = clip.getElementsByTagName('path')[0]
    expect(clipPath.getAttribute('clip-rule')).toBe('evenodd')
    expect(clipPath.getAttribute('d')).toContain(PAGE8_JOURNEY_REGION.d)
    expect(svg).toContain('&quot;coverage&quot;:&quot;page8&quot;')
  })

  it('draws only page 8 place names', () => {
    expect(byId(document, 'geo-label-vancouver')).toBeTruthy()
    expect(byId(document, 'geo-label-mount-robson')).toBeTruthy()
    const secondary = PLACE_LABELS.filter((definition) => 'secondary' in definition)
    expect(secondary.length).toBeGreaterThan(0)
    for (const definition of secondary) expect(byId(document, `geo-label-${definition.id}`)).toBeUndefined()
  })

  it('colours the journey region in the compass inset', () => {
    expect(svg).toContain('data-inset-accent="page8-journey-region"')
    expect(svg).toContain(journeyInsetAccent())
  })

  it('prints as vectors: clips and a water stroke, no masks', () => {
    expect(svg).not.toContain('<mask')
    expect(byId(document, 'geo-channel-gap')).toBeTruthy()
    expect(svg).toContain('<clipPath id="geo-compass-clearance"')
    expect(svg).toContain('<g clip-path="url(#geo-compass-clearance)">')
    // Illustration clearances, when the hatch keeps clear of the motifs, are nested clips.
    const cleared = buildGeographicMapSvg({ ...PAGE8_EDITION, composition: { allowIllustrationOverlap: false } })
    expect(cleared).not.toContain('<mask')
    expect(cleared).toContain('<clipPath id="geo-illustration-clearance-0"')
    // The same edition with masks keeps the mask form.
    const masked = buildGeographicMapSvg({ ...PAGE8_EDITION, vectorMasks: false })
    expect(masked).toContain('<mask id="geo-channel-gap"')
    expect(masked).toContain('<mask id="geo-compass-clearance"')
  }, 20_000)
})

describe('lakes and waves', () => {
  it('fills every lake as land when lakes are off, keeping the coast and islands', () => {
    const count = (d: string) => (d.match(/M/g) ?? []).length
    expect(count(landPath('bcLand'))).toBe(data.bcLand.polygons + data.bcLand.holes)
    // Every lake goes, and the islands in lakes with them; the coast and its islands stay.
    // (BC's lakes and reservoirs hold thousands of islets; the coast keeps over two thousand islands.)
    const lakeless = landPath('bcLand', false)
    expect(count(lakeless)).toBeLessThan(data.bcLand.polygons)
    expect(count(lakeless)).toBeGreaterThan(2000)
    // The two longest shores, the mainland and Vancouver Island, are kept as built.
    for (const shore of data.bcLand.d
      .split(/(?=M)/)
      .sort((a, b) => b.length - a.length)
      .slice(0, 2))
      expect(lakeless).toContain(shore)
    expect(count(landPath('land', false))).toBeLessThan(data.land.polygons)
    const svg = buildGeographicMapSvg({ coverage: 'northern', lakes: false })
    const document = parse(svg)
    expect(byId(document, 'geo-bc-land-geometry')!.getAttribute('d')).toBe(landPath('bcLand', false))
    expect(byId(document, 'geo-land-geometry')!.getAttribute('d')).toBe(landPath('land', false))
    expect(svg).toContain('&quot;lakes&quot;:false')
    // Lakes are on by default, and the default drawing records nothing new.
    expect(buildGeographicMapSvg({ coverage: 'northern' })).not.toContain('&quot;lakes&quot;')
  })

  it('puts every wave on open water, clear of the shore', () => {
    const waves = drawnMotifs().filter((motif) => motif.id.startsWith('wave-'))
    expect(waves.length).toBe(3)
    for (const wave of waves) {
      const element = ELEMENT_CATALOG.find((candidate) => candidate.id === wave.id)!
      const [w, h] = [element.width * wave.scale, element.height * wave.scale]
      const [x, y] = [wave.point[0] + wave.offset[0], wave.point[1] + wave.offset[1]]
      expect(boxTouchesLand({ x: x - w / 2 - 2, y: y - h / 2 - 2, w: w + 4, h: h + 4 })).toBe(false)
      expect(Math.hypot(wave.offset[0], wave.offset[1])).toBeLessThanOrEqual(150)
    }
    // The north wave's built coordinate sits on the Central Coast's islands: it is moved.
    const north = data.motifs.find((motif) => motif.id === 'wave-coast-north')!
    const element = ELEMENT_CATALOG.find((candidate) => candidate.id === north.id)!
    const [w, h] = [element.width * north.scale, element.height * north.scale]
    expect(boxTouchesLand({ x: north.point[0] - w / 2, y: north.point[1] - h / 2, w, h })).toBe(true)
    // Motifs on land stay as built.
    expect(drawnMotifs().find((motif) => motif.id === 'bear')).toBe(data.motifs.find((motif) => motif.id === 'bear'))
  })
})

describe('cleaning up small shapes', () => {
  const count = (d: string) => (d.match(/M/g) ?? []).length
  it('leaves out islands and fills lakes below the given sizes', () => {
    const all = count(landPath('land'))
    const islands = count(landPath('land', { minIslandKm2: 1 }))
    // Most of the frame's rings are islets under a square kilometre.
    expect(islands).toBeLessThan(all * 0.25)
    const lakes = count(landPath('land', { minLakeKm2: 2 }))
    expect(all - lakes).toBeGreaterThan(400)
    // A lake filled by size takes its islets with it, as lakes off does: every lake by size is lakes off.
    expect(landPath('land', { minLakeKm2: 1e6 })).toBe(landPath('land', false))
    // The two longest shores stay whatever the thresholds.
    const filtered = landPath('bcLand', { minIslandKm2: 25, minLakeKm2: 25 })
    for (const shore of data.bcLand.d
      .split(/(?=M)/)
      .sort((a, b) => b.length - a.length)
      .slice(0, 2))
      expect(filtered).toContain(shore)
    // `true` and an empty filter are the land as built.
    expect(landPath('land', {})).toBe(data.land.d)
    expect(landPath('land', true)).toBe(data.land.d)
  })

  it('draws the land, hatch and channel gap from the filtered path and records the thresholds', () => {
    const svg = buildGeographicMapSvg({ coverage: 'northern', minIslandKm2: 1, minLakeKm2: 2 })
    const document = parse(svg)
    const filter = { minIslandKm2: 1, minLakeKm2: 2 }
    expect(byId(document, 'geo-bc-land-geometry')!.getAttribute('d')).toBe(landPath('bcLand', filter))
    expect(byId(document, 'geo-land-geometry')!.getAttribute('d')).toBe(landPath('land', filter))
    expect(svg).toContain('&quot;minIslandKm2&quot;:1')
    expect(svg).toContain('&quot;minLakeKm2&quot;:2')
  })
})

describe('hidden road stretches', () => {
  it('leaves out Highway 1 on Vancouver Island and keeps it on the mainland', () => {
    const built = data.roads.find((road) => road.id === 'bc-1')!
    const drawn = drawnRoads([VANCOUVER_ISLAND_HIGHWAY_1]).find((road) => road.id === 'bc-1')!
    const parts = (d: string) => d.split(/(?=M)/)
    expect(parts(drawn.d).length).toBeLessThan(parts(built.d).length)
    expect(parts(drawn.d).length).toBeGreaterThan(0)
    // Nothing left west of the Strait of Georgia below Nanaimo, the island stretch.
    const xs = (d: string) => (d.match(/M?(-?[\d.]+),/g) ?? []).map((value) => Number(value.replace(/[M,]/g, '')))
    const victoria = data.places.find((place) => place.id === 'victoria')!.point
    expect(Math.min(...xs(drawn.d))).toBeGreaterThan(victoria[0])
    expect(Math.min(...xs(built.d))).toBeLessThan(victoria[0])
    // Other roads are as built, and no stretch is the map as built.
    expect(drawnRoads([VANCOUVER_ISLAND_HIGHWAY_1]).find((road) => road.id === 'bc-99')).toBe(
      data.roads.find((road) => road.id === 'bc-99'),
    )
    expect(drawnRoads()).toBe(data.roads)
    expect(() => drawnRoads([{ road: 'bc-1', landmassOf: 'nowhere' }])).toThrow(/No place/)
    const svg = buildGeographicMapSvg({ ...PAGE8_EDITION })
    expect(svg).toContain(`id="geo-road-bc-1"`)
    expect(svg).toContain(drawn.d)
  })
})

describe('compass lettering', () => {
  it('sets BC in Small Caps outlines when asked, on either compass', () => {
    const page8 = buildGeographicMapSvg({ ...PAGE8_EDITION })
    const compass = (svg: string) => svg.match(/<g id="geo-compass".*?<\/g><\/g><\/g>/)![0]
    expect(compass(page8)).toContain('data-text="BC"')
    expect(compass(page8)).toContain('data-font="Great Forest"')
    const coastal = buildGeographicMapSvg({ coverage: 'coastal', compassLettering: 'smallcaps' })
    expect(compass(coastal)).toContain('data-text="BC"')
    expect(compass(buildGeographicMapSvg({ coverage: 'coastal' }))).not.toContain('data-text="BC"')
  })
})

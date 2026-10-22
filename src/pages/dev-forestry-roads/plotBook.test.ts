import { describe, expect, it } from 'vitest'
import { analyzeRoad, offsetCoordinate } from './engine'
import { plotBookHtml } from './plotBook'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE, exportGrid } from './terrain'
import type { Alignment, Coordinate, TerrainMetadata } from './types'

const origin: Coordinate = [-122.8, 53.9]
const alignment: Alignment = {
  id: 'r',
  name: 'Spur <1>',
  color: '#16817a',
  points: [
    { id: 'a', coordinate: origin, radiusM: 0 },
    { id: 'b', coordinate: offsetCoordinate(origin, 60, 600), radiusM: 0 },
  ],
  vertical: [
    { id: 's', chainage: 0, elevation: 799, curveLength: 0 },
    { id: 'e', chainage: 600, elevation: 805, curveLength: 0 },
  ],
  template: { ...DEFAULT_TEMPLATE },
  overrides: [],
}
const terrain: TerrainMetadata = { kind: 'demo', name: 'Slope', resolutionM: 1, verticalReference: 'CGVD2013' }
const analysis = analyzeRoad(alignment, { elevationAt: (lng) => 800 + (lng - origin[0]) * 1000 }, DEFAULT_ROAD_SETTINGS)

describe('plot book', () => {
  it('lays out plan-and-profile sheets per window and section sheets of twelve', () => {
    const book = plotBookHtml({
      projectName: 'Demo & book',
      alignment,
      analysis,
      terrain,
      ...exportGrid(terrain, origin),
      sheetLengthM: 250,
      sectionIntervalM: 20,
    })
    // 600 m at 250 m per sheet → 3 plan-and-profile sheets; 31 sections → 3 section sheets.
    expect(book.match(/<section class="sheet">/g)).toHaveLength(6)
    expect(book).toContain('Sheet 1 of 6')
    expect(book).toContain('Plan &amp; profile 0+000.0–0+250.0')
    expect(book).toContain('Mass haul (m³)')
    expect(book).toContain('Cross-sections 0+000.0–0+220.0')
    expect(book).toContain('@page{size:A3 landscape')
    expect(book).toContain('Spur &lt;1&gt;')
    expect(book).not.toContain('NaN')
  })

  it('says on every plan when contours are unavailable', () => {
    for (const contours of [undefined, { type: 'FeatureCollection' as const, features: [] }]) {
      const book = plotBookHtml({
        projectName: 'P',
        alignment,
        analysis,
        terrain,
        contours,
        ...exportGrid(terrain, origin),
      })
      expect(book.match(/>Contours unavailable</g)).toHaveLength(3)
    }
  })

  it('prints the contour interval on every plan', () => {
    const contours: GeoJSON.FeatureCollection<GeoJSON.MultiLineString> = {
      type: 'FeatureCollection',
      features: [800, 802].map((elevation) => ({
        type: 'Feature',
        properties: { elevation_m: elevation, index: false, interval_m: 2, preview_resolution_m: 4.25 },
        geometry: {
          type: 'MultiLineString',
          coordinates: [[origin, offsetCoordinate(origin, 0, 100 + elevation - 800)]],
        },
      })),
    }
    const book = plotBookHtml({
      projectName: 'P',
      alignment,
      analysis,
      terrain,
      contours,
      ...exportGrid(terrain, origin),
    })
    expect(book.match(/>Contours 2 m \(index 10 m\) · from a 4\.3 m sample grid</g)).toHaveLength(3)
    expect(book).not.toContain('Contours unavailable')
  })
})

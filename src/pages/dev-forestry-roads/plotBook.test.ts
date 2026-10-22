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
})

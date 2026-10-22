import { describe, expect, it } from 'vitest'
import { analyzeRoad, offsetCoordinate } from './engine'
import { landXml, sectionStations, stakeoutCsv } from './designExports'
import { DEFAULT_ROAD_SETTINGS, exportGrid } from './terrain'
import type { Alignment, Coordinate, TerrainMetadata } from './types'

const origin: Coordinate = [-122.8, 53.9]
const corner = offsetCoordinate(origin, 0, 200)
const road: Alignment = {
  id: 'r',
  name: 'Spur <A&B>',
  color: '#16817a',
  points: [
    { id: 'a', coordinate: origin, radiusM: 0 },
    { id: 'b', coordinate: corner, radiusM: 60 },
    { id: 'c', coordinate: offsetCoordinate(corner, 90, 200), radiusM: 0 },
  ],
  vertical: [
    { id: 'v0', chainage: 0, elevation: 799, curveLength: 0 },
    { id: 'v1', chainage: 200, elevation: 801, curveLength: 40 },
    { id: 'v2', chainage: 380, elevation: 799, curveLength: 0 },
  ],
  template: {
    leftWidth: 3,
    rightWidth: 3,
    crossfallPercent: 0,
    cutSlope: 1,
    fillSlope: 1.5,
    ditchWidth: 1,
    ditchDepth: 0.5,
    surfaceDepth: 0,
  },
  overrides: [],
}
const terrain: TerrainMetadata = { kind: 'demo', name: 'Flat', resolutionM: 1, verticalReference: 'CGVD2013' }
const flat = { elevationAt: () => 800 }
const analysis = analyzeRoad(road, flat, DEFAULT_ROAD_SETTINGS)
const grid = exportGrid(terrain, origin)

describe('engineering exports', () => {
  it('projects a geographic source to its WGS84 UTM zone', () => {
    expect(grid.epsg).toBe(32610)
    const [e, n] = grid.toGrid(origin)
    expect(e).toBeGreaterThan(400000)
    expect(e).toBeLessThan(700000)
    expect(n).toBeGreaterThan(5900000)
  })

  it('writes LandXML lines, arcs, profile, ground and sections', () => {
    const text = landXml({
      name: 'Demo & test',
      alignment: road,
      analysis,
      terrain,
      ...grid,
      date: new Date(2026, 9, 22),
    })
    expect(text).toContain('<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2" date="2026-10-22"')
    expect(text).toContain('<CoordinateSystem epsgCode="32610"')
    expect(text.match(/<Line /g)).toHaveLength(2)
    expect(text.match(/<Curve rot="cw" crvType="arc" radius="60.000"/g)).toHaveLength(1)
    expect(text).toContain('<ParaCurve length="40.000">200.000 801.000</ParaCurve>')
    expect(text.match(/<PVI>/g)).toHaveLength(2)
    expect(text.match(/<CrossSect /g)!.length).toBe(sectionStations(analysis, 20).length)
    // Names are escaped; every opened element closes.
    expect(text).toContain('name="Spur &lt;A&amp;B&gt;"')
    for (const tag of ['LandXML', 'Alignments', 'Alignment', 'CoordGeom', 'Profile', 'CrossSects'])
      expect(text.match(new RegExp(`<${tag}[ >]`, 'g'))?.length).toBe(text.split(`</${tag}>`).length - 1)
  })

  it('lists slope stakes with offsets, levels and cut or fill', () => {
    const csv = stakeoutCsv({ alignment: road, analysis, ...grid, intervalM: 100 })
    const rows = csv.trim().split('\n')
    expect(rows[0]).toBe('point,station_m,code,offset_m,easting,northing,elevation_m,ground_m,cut_fill_m,epsg')
    const first = rows.slice(1).filter((r) => r.split(',')[1] === '0.00')
    expect(first.map((r) => r.split(',')[2])).toEqual(
      expect.arrayContaining([
        'centreline',
        'left-formation-edge',
        'right-formation-edge',
        'left-catch',
        'right-catch',
      ]),
    )
    const centre = first.find((r) => r.split(',')[2] === 'centreline')!.split(',')
    // Formation 799 under flat 800 ground: 1 m of cut at the centreline.
    expect(Number(centre[6])).toBeCloseTo(799, 3)
    expect(Number(centre[8])).toBeCloseTo(1, 3)
    // A catch point sits on the ground; left catches have negative offsets.
    const leftCatch = first.find((r) => r.split(',')[2] === 'left-catch')!.split(',')
    expect(Number(leftCatch[3])).toBeLessThan(0)
    expect(Number(leftCatch[6])).toBeCloseTo(800, 3)
    expect(csv).not.toMatch(/[=+@]/)
  })
})

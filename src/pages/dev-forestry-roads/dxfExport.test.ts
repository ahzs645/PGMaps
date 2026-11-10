import { describe, expect, it } from 'vitest'
import { analyzeRoad, offsetCoordinate } from './engine'
import { DEFAULT_DXF_OPTIONS, DXF_LAYERS, roadDxf } from './dxfExport'
import { exportUnavailable, INVALID_INPUT_RULES } from './exportCatalog'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE, localMetricGrid } from './terrain'
import type { Alignment, Coordinate, RoadAnalysis, TerrainSource } from './types'

const origin: Coordinate = [-122.75, 53.917]
const at = (east: number, north: number) =>
  offsetCoordinate(origin, (Math.atan2(east, north) * 180) / Math.PI, Math.hypot(east, north))
const road: Alignment = {
  id: 'r',
  name: 'Spur 7',
  color: '#000000',
  points: [
    { id: 'a', coordinate: at(0, 0), radiusM: 0 },
    { id: 'b', coordinate: at(0, 150), radiusM: 60 },
    { id: 'c', coordinate: at(120, 220), radiusM: 50, spiralM: 20 },
    { id: 'd', coordinate: at(120, 380), radiusM: 0 },
  ],
  vertical: [
    { id: 'v0', chainage: 0, elevation: 800, curveLength: 0 },
    { id: 'v1', chainage: 380, elevation: 812, curveLength: 0 },
  ],
  template: { ...DEFAULT_TEMPLATE },
  overrides: [],
}
const hill: TerrainSource = { elevationAt: (lon, lat) => 800 + (lat - origin[1]) * 3000 + (lon - origin[0]) * 800 }
const grid = localMetricGrid(origin)

/** Group-code pairs of a DXF file. */
function pairs(dxf: string) {
  const lines = dxf.split('\r\n')
  expect(lines.pop()).toBe('')
  expect(lines.length % 2).toBe(0)
  const out: [number, string][] = []
  for (let i = 0; i < lines.length; i += 2) {
    expect(lines[i]).toMatch(/^-?\d+$/)
    out.push([Number(lines[i]), lines[i + 1]])
  }
  return out
}
const entities = (list: [number, string][]) => {
  const start = list.findIndex(([code, value], i) => code === 2 && value === 'ENTITIES' && list[i - 1][1] === 'SECTION')
  return list
    .slice(start + 1)
    .filter(([code]) => code === 0)
    .map(([, value]) => value)
}

describe('DXF export', () => {
  const analysis = analyzeRoad(road, hill, DEFAULT_ROAD_SETTINGS)
  const dxf = roadDxf({
    name: 'Job',
    alignment: road,
    analysis,
    terrain: { name: 'DEM', verticalReference: 'CGVD2013' },
    ...grid,
  })
  const list = pairs(dxf)
  it('is a well-formed R12 file with its layer table', () => {
    expect(list.find(([code]) => code === 1)?.[1]).toBe('AC1009')
    expect(list[list.length - 1]).toEqual([0, 'EOF'])
    const layers = list.filter(([code], i) => code === 2 && list[i - 1][1] === 'LAYER').map(([, value]) => value)
    expect(layers).toEqual(Object.keys(DXF_LAYERS))
    expect(dxf).not.toMatch(/NaN|Infinity/)
    // Every POLYLINE closes with a SEQEND.
    const kinds = entities(list)
    expect(kinds.filter((k) => k === 'POLYLINE').length).toBe(kinds.filter((k) => k === 'SEQEND').length)
  })
  it('draws the centreline with true arcs at the design radius, and a spiral as a polyline', () => {
    const arcs: number[] = []
    list.forEach(([code, value], i) => {
      if (code === 0 && value === 'ARC') {
        const radius = list.slice(i).find(([c]) => c === 40)!
        arcs.push(Number(radius[1]))
      }
    })
    expect(arcs).toHaveLength(2)
    // Grid radii differ from the model's by the UTM scale near the central meridian (k ≈ 0.9996).
    expect(arcs[0]).toBeCloseTo(60, 0)
    expect(arcs[1]).toBeCloseTo(50, 0)
    const clPolylines = list.filter(([code, value], i) => code === 8 && value === 'CL' && list[i - 1][1] === 'POLYLINE')
    expect(clPolylines).toHaveLength(2)
  })
  it('writes 3D feature lines, the profile and the sections on their layers', () => {
    const layersUsed = new Set(list.filter(([code]) => code === 8).map(([, value]) => value))
    for (const layer of [
      'CL_3D',
      'EDGE_L',
      'EDGE_R',
      'CATCH_L',
      'CATCH_R',
      'STATIONS',
      'LABELS',
      'PROF_GROUND',
      'PROF_DESIGN',
      'SECT_GROUND',
      'SECT_DESIGN',
    ])
      expect(layersUsed.has(layer)).toBe(true)
    // 3D polylines carry flag 8 and their vertices flag 32.
    expect(list.some(([code, value]) => code === 70 && value === '8')).toBe(true)
    expect(list.filter(([code, value]) => code === 1 && /^\d+\+\d{3}/.test(value)).length).toBeGreaterThan(5)
  })
  it('breaks a line at missing ground instead of bridging it', () => {
    const holed: TerrainSource = {
      elevationAt: (lon, lat) => (lat > at(0, 60)[1] && lat < at(0, 80)[1] ? NaN : hill.elevationAt(lon, lat)),
    }
    const result = analyzeRoad(road, holed, DEFAULT_ROAD_SETTINGS)
    const out = pairs(
      roadDxf({
        name: 'Job',
        alignment: road,
        analysis: result,
        terrain: { name: 'DEM', verticalReference: 'CGVD2013' },
        ...grid,
        options: { ...DEFAULT_DXF_OPTIONS, plan: false, sections: false },
      }),
    )
    const groundRuns = out.filter(
      ([code, value], i) => code === 8 && value === 'PROF_GROUND' && out[i - 1][1] === 'POLYLINE',
    )
    expect(groundRuns).toHaveLength(2)
  })
  it('is refused while an input is invalid', () => {
    expect(INVALID_INPUT_RULES.dxf).toBe('refuse')
    const invalid: RoadAnalysis = { ...analysis, invalidInput: { message: 'Fill slope must be positive.' } }
    expect(() =>
      roadDxf({
        name: 'Job',
        alignment: road,
        analysis: invalid,
        terrain: { name: 'DEM', verticalReference: '' },
        ...grid,
      }),
    ).toThrow(/DXF drawing was not exported/)
    expect(
      exportUnavailable('dxf', {
        designPreview: false,
        hasResults: true,
        terrainProfile: true,
        hasTerrainGrid: false,
        hasProvincialEvidence: false,
        hasNotes: false,
      }),
    ).toMatch(/Return to the road/)
  })
})

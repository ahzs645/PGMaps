import { describe, expect, it } from 'vitest'
import {
  catchmentPolygon,
  delineateCatchment,
  delineateWatersheds,
  snapPourPoint,
  upstreamMask,
  type DrainageGrid,
} from './drainageCatchments'
import { flowAccumulation, MISSING } from './hydrology'

const identity = (p: [number, number]): [number, number] => [...p]
const grid: DrainageGrid = { origin: [0, 2], cellM: 1, width: 3, height: 3 }
const allToCentre = new Int8Array([1, 2, 3, 0, -1, 4, 7, 6, 5])
const ringArea = (ring: number[][]) =>
  ring.slice(1).reduce((sum, p, i) => sum + ring[i][0] * p[1] - p[0] * ring[i][1], 0) / 2
const geometryArea = (geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon) => {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  return polygons.reduce((sum, p) => sum + p.reduce((sum, ring) => sum + ringArea(ring), 0), 0)
}

describe('cell-exact D8 catchments', () => {
  it('finds an arbitrary snapped pour point and conserves its nine contributing cells in the polygon', () => {
    const acc = flowAccumulation(allToCentre, grid)
    const result = delineateCatchment(
      grid,
      allToCentre,
      acc,
      { coordinate: [1.3, 1.5], snapRadiusM: 1, surface: 'existing' },
      identity,
      identity,
    )
    expect(result.outletCell).toBe(4)
    expect(result.snappedCoordinate).toEqual([1, 1])
    expect(result.snappedDistanceM).toBeCloseTo(Math.hypot(0.3, 0.5))
    expect(result.feature.properties.cells).toBe(9)
    expect(result.feature.properties.areaHa).toBe(0.0009)
    expect(geometryArea(result.feature.geometry)).toBe(9)
    expect(result.feature.properties.truncated).toBe(true)
    expect(result.feature.properties.touchesGridEdge).toBe(true)
  })

  it('does not include cells whose paths bypass the selected point', () => {
    const mask = upstreamMask(grid, allToCentre, 0)
    expect([...mask]).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0])
  })

  it('keeps holes at missing cells and warns of no-data truncation', () => {
    const dirs = new Int8Array(9).fill(-1)
    dirs[4] = MISSING
    const mask = new Uint8Array(9).fill(1)
    mask[4] = 0
    const feature = catchmentPolygon(grid, dirs, mask, 0, identity)
    expect(feature.geometry.type).toBe('Polygon')
    if (feature.geometry.type === 'Polygon') expect(feature.geometry.coordinates).toHaveLength(2)
    expect(geometryArea(feature.geometry)).toBe(8)
    expect(feature.properties.touchesNoData).toBe(true)
    expect(feature.properties.cells).toBe(8)
  })

  it('does not join diagonally touching cell components into a self-crossing ring', () => {
    const g = { origin: [0, 1] as [number, number], cellM: 2, width: 2, height: 2 }
    const feature = catchmentPolygon(g, new Int8Array(4).fill(-1), new Uint8Array([1, 0, 0, 1]), 0, identity)
    expect(feature.geometry.type).toBe('MultiPolygon')
    if (feature.geometry.type === 'MultiPolygon') expect(feature.geometry.coordinates).toHaveLength(2)
    expect(geometryArea(feature.geometry)).toBe(8)
  })

  it('partitions supported terrain into nonoverlapping outlet basins and filters only by explicit minimum area', () => {
    const g = { origin: [0, 2] as [number, number], cellM: 1, width: 4, height: 3 }
    const dirs = new Int8Array([2, 2, 2, 2, 2, 2, 2, 2, 0, -1, 0, -1])
    const result = delineateWatersheds(g, dirs, identity, { minAreaHa: 0 })
    expect(result.features).toHaveLength(2)
    expect(result.features.map((f) => f.properties.cells)).toEqual([6, 6])
    expect(result.features.reduce((s, f) => s + geometryArea(f.geometry), 0)).toBe(12)
    expect(result.features.reduce((s, f) => s + f.properties.areaHa, 0)).toBeCloseTo(0.0012)
    expect(delineateWatersheds(g, dirs, identity, { minAreaHa: 0.0007 }).features).toHaveLength(0)
  })

  it('rejects cycles, missing pour points and unsupported snap requests', () => {
    expect(() =>
      delineateWatersheds({ origin: [0, 0], cellM: 1, width: 2, height: 1 }, new Int8Array([0, 4]), identity, {
        minAreaHa: 0,
      }),
    ).toThrow(/cycle/)
    const dirs = new Int8Array(allToCentre)
    dirs[4] = MISSING
    expect(() => snapPourPoint(grid, dirs, new Float64Array(9), [1, 1], 0)).toThrow(/no sampled terrain/)
    expect(() => snapPourPoint(grid, allToCentre, new Float64Array(9), [99, 99], 1)).toThrow(/No supported/)
    expect(() => snapPourPoint(grid, allToCentre, new Float64Array(9), [1, 1], 2001)).toThrow(/2,000/)
    expect(() => upstreamMask({ ...grid, width: 4_194_305 }, allToCentre, 1)).toThrow(/4,194,304/)
  })
})

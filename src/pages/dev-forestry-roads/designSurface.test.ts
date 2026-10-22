import { describe, expect, it } from 'vitest'
import { burnRoad, roadFrame } from './designSurface'
import { analyzeRoad, offsetCoordinate } from './engine'
import { cellIndexAt, corridorBounds, sampleBilinear, sampleSurfaceGrid, type SurfaceGrid } from './surfaceGrid'
import type { Alignment, Coordinate, Culvert, RoadSettings, RoadTemplate, TerrainSource } from './types'

const origin: Coordinate = [-122.8, 53.9]
const R = 6371008.8,
  RAD = Math.PI / 180
// A local equirectangular grid: x east, y north, metres from the origin.
const toGrid = (c: Coordinate): [number, number] => [
  (c[0] - origin[0]) * RAD * R * Math.cos(origin[1] * RAD),
  (c[1] - origin[1]) * RAD * R,
]
const toLonLat = ([x, y]: [number, number]): Coordinate => [
  origin[0] + x / (R * Math.cos(origin[1] * RAD) * RAD),
  origin[1] + y / (R * RAD),
]
const at = (x: number, y: number) => toLonLat([x, y])
const terrainOf = (f: (x: number, y: number) => number): TerrainSource => ({
  elevationAt: (lon, lat) => {
    const [x, y] = toGrid([lon, lat])
    return f(x, y)
  },
})
const settings: RoadSettings = {
  stationInterval: 10,
  crossSectionHalfWidth: 30,
  maxGradePercent: 12,
  minRadius: 25,
  cutRate: 2,
  fillRate: 3,
  surfacingRate: 4,
  clearingRate: 0.5,
  shrinkFactor: 0.8,
}
const template: RoadTemplate = {
  leftWidth: 2,
  rightWidth: 4,
  crossfallPercent: 3,
  cutSlope: 0.75,
  fillSlope: 1.5,
  ditchWidth: 1,
  ditchDepth: 0.5,
  surfaceDepth: 0.25,
}
function northRoad(elevation: number, length = 100): Alignment {
  return {
    id: 'main',
    name: 'Main',
    color: '#000',
    points: [
      { id: 'a', coordinate: at(0, 0), radiusM: 0 },
      { id: 'b', coordinate: at(0, length), radiusM: 0 },
    ],
    vertical: [
      { id: 'v0', chainage: 0, elevation, curveLength: 0 },
      { id: 'v1', chainage: length, elevation, curveLength: 0 },
    ],
    template: { ...template },
    overrides: [],
  }
}
const valueAt = (grid: SurfaceGrid, x: number, y: number) => grid.values[cellIndexAt(grid, x, y)]

describe('surface grid sampling', () => {
  it('samples cell centres, keeps missing cells missing and grows the cell to fit', () => {
    const terrain = terrainOf((x, y) => (x > 5 ? NaN : 100 + x + 2 * y))
    const grid = sampleSurfaceGrid(terrain, [0, 0, 10, 4], toLonLat, { cellM: 1 })
    expect([grid.width, grid.height]).toEqual([11, 5])
    expect(grid.origin).toEqual([0.5, 3.5])
    expect(grid.values[0]).toBeCloseTo(100 + 0.5 + 7, 6)
    expect(Number.isNaN(grid.values[10])).toBe(true)
    expect(sampleBilinear(grid, 1, 2)).toBeCloseTo(105, 6)
    expect(Number.isNaN(sampleBilinear(grid, 5.2, 2))).toBe(true)
    const coarse = sampleSurfaceGrid(terrain, [0, 0, 100, 100], toLonLat, { cellM: 1, maxCells: 1000 })
    expect(coarse.width * coarse.height).toBeLessThanOrEqual(1000)
    expect(coarse.cellM).toBeGreaterThan(1)
  })
})

describe('burning the road prism', () => {
  it('lays the designed section on the correct side and leaves ground past the catch points', () => {
    // Flat ground, formation 1 m above it: fill on both sides, 2 m left and 4 m right of a road heading north.
    const analysis = analyzeRoad(
      northRoad(801),
      terrainOf(() => 800),
      settings,
    )
    // Whole-metre bounds put 0.5 m cell centres on the quarter metre.
    const raw = corridorBounds(analysis, toGrid, 10)
    const bounds: [number, number, number, number] = [
      Math.floor(raw[0]),
      Math.floor(raw[1]),
      Math.ceil(raw[2]),
      Math.ceil(raw[3]),
    ]
    expect(bounds[0]).toBeLessThan(-12)
    expect(bounds[2]).toBeGreaterThan(14)
    const grid = sampleSurfaceGrid(
      terrainOf(() => 800),
      bounds,
      toLonLat,
      { cellM: 0.5 },
    )
    const { surface, footprint, changedCells } = burnRoad(grid, analysis, toGrid)
    const station = analysis.stations.find((s) => Math.abs(s.chainage - 50) < 1e-6)!
    // Cell centres sit on the quarter metre; sample there along the station's section.
    for (const offset of [0.25, -0.25, 1.75, -1.75, 3.75, -3.25, 5.25]) {
      const p = offsetCoordinate(station.coordinate, station.bearing + 90, offset)
      const [x, y] = toGrid(p)
      const value = valueAt(surface, x, y)
      const design = (() => {
        for (let i = 1; i < station.section.length; i++) {
          const a = station.section[i - 1],
            b = station.section[i]
          if (offset >= a.offset && offset <= b.offset && a.design !== null && b.design !== null)
            return a.design + ((b.design - a.design) * (offset - a.offset)) / (b.offset - a.offset)
        }
        return null
      })()
      if (design === null) expect(value).toBe(800)
      else expect(value).toBeCloseTo(design, 4)
    }
    // Right formation (east) is 4 m wide, left only 2 m: at ±3.25 m the right is road, the left is batter.
    expect(valueAt(surface, 3.25, 50)).toBeCloseTo(801 - 3.25 * 0.03, 4)
    expect(valueAt(surface, -3.25, 50)).toBeLessThan(801 - 2 * 0.03 - 0.5)
    // Centreline equals the station design elevation.
    expect(valueAt(surface, 0.25, 50)).toBeCloseTo(801 - 0.25 * 0.03, 4)
    // Past the right daylight (4 + 0.88 × 1.5 = 5.32 m) and the left one the ground is untouched.
    expect(station.rightDaylightM).toBeCloseTo(4 + (1 - 0.12) * 1.5, 3)
    for (const x of [5.75, 8.25, -4.25, -9.75]) {
      expect(valueAt(surface, x, 50)).toBe(800)
      expect(footprint[cellIndexAt(surface, x, 50)]).toBe(0)
    }
    expect(footprint[cellIndexAt(surface, 0.25, 50)]).toBe(1)
    // Nothing before the first or after the last station.
    expect(valueAt(surface, 0.25, -2.25)).toBe(800)
    expect(valueAt(surface, 0.25, 102.25)).toBe(800)
    // About 100 m × (left 2+1.4 m + right 5.32 m) of prism at 0.25 m² per cell.
    expect(changedCells).toBeGreaterThan(0.9 * ((100 * 8.7) / 0.25))
    expect(changedCells).toBeLessThan(1.1 * ((100 * 8.7) / 0.25))
    expect(grid.values.every((v) => v === 800)).toBe(true)
  })

  it('covers a horizontal curve without gaps, inside and outside', () => {
    const road = northRoad(801)
    road.points = [
      { id: 'a', coordinate: at(0, 0), radiusM: 0 },
      { id: 'pi', coordinate: at(0, 100), radiusM: 30 },
      { id: 'b', coordinate: at(100, 100), radiusM: 0 },
    ]
    road.vertical = road.vertical.map((p, i) => ({ ...p, chainage: i ? 160 : 0 }))
    const analysis = analyzeRoad(
      road,
      terrainOf(() => 800),
      settings,
    )
    const grid = sampleSurfaceGrid(
      terrainOf(() => 800),
      corridorBounds(analysis, toGrid, 5),
      toLonLat,
      { cellM: 0.5 },
    )
    const { surface, footprint } = burnRoad(grid, analysis, toGrid)
    // Every point across the formation, at every station and halfway between, is road.
    const stations = analysis.stations
    for (let k = 1; k < stations.length; k++)
      for (const f of [0, 0.5])
        for (const offset of [-1.5, 0, 1.5, 3]) {
          const a = toGrid(offsetCoordinate(stations[k - 1].coordinate, stations[k - 1].bearing + 90, offset)),
            b = toGrid(offsetCoordinate(stations[k].coordinate, stations[k].bearing + 90, offset))
          const i = cellIndexAt(surface, a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)
          expect(footprint[i]).toBe(1)
          expect(Math.abs(surface.values[i] - 801)).toBeLessThan(0.2)
        }
  })

  it('locates cells by chainage and signed offset, negative to the left', () => {
    const analysis = analyzeRoad(
      northRoad(801),
      terrainOf(() => 800),
      settings,
    )
    const frame = roadFrame(analysis, toGrid)
    const left = frame.locate(-3, 40),
      right = frame.locate(2, 70)
    expect(left.chainage).toBeCloseTo(40, 3)
    expect(left.offset).toBeCloseTo(-3, 3)
    expect(right.offset).toBeCloseTo(2, 3)
    expect(frame.at(25).y).toBeCloseTo(25, 3)
  })

  it('carves a culvert at its inverts across the whole footprint, inlet on the left', () => {
    const analysis = analyzeRoad(
      northRoad(802),
      terrainOf(() => 800),
      settings,
    )
    const grid = sampleSurfaceGrid(
      terrainOf(() => 800),
      corridorBounds(analysis, toGrid, 20),
      toLonLat,
      {
        cellM: 0.5,
      },
    )
    const culvert: Culvert = {
      id: 'c1',
      name: 'CMP 1',
      chainage: 50,
      skewDegrees: 0,
      lengthM: 4,
      diameterM: 0.6,
      inletInvertM: 799.9,
      outletInvertM: 799.7,
      minCoverM: 0.3,
      unitCost: 0,
      fixedCost: 0,
    }
    const { surface, footprint, channels } = burnRoad(grid, analysis, toGrid, { culverts: [culvert] })
    expect(channels).toHaveLength(1)
    const channel = channels[0]
    const xs = Array.from(channel.barrel, (i) => (i % surface.width) * surface.cellM + surface.origin[0])
    // The 4 m barrel is extended to the catch points, 4.9 m left and 6.8 m right.
    expect(Math.min(...xs)).toBeLessThan(-4.4)
    expect(Math.max(...xs)).toBeGreaterThan(6.3)
    // Inlet (west/left) end at the inlet invert, falling to the outlet invert, held past the ends.
    expect(surface.values[channel.barrel[0]]).toBeCloseTo(799.9, 6)
    expect(surface.values[channel.barrel[channel.barrel.length - 1]]).toBeCloseTo(799.7, 6)
    for (const i of channel.barrel) expect(surface.values[i]).toBeLessThanOrEqual(799.9 + 1e-9)
    // A square culvert on a road heading north is one row of cells.
    const ys = new Set(Array.from(channel.cells, (i) => Math.floor(i / surface.width)))
    expect(ys.size).toBe(1)
    expect(footprint[channel.barrel[0]]).toBe(1)
    // Past the barrel an apron is cut at the end invert while the ground stands above it.
    expect(channel.cells.length).toBeGreaterThan(channel.barrel.length + 30)
    // Without inverts, the channel lies 0.3 m below the lower ground at its ends.
    const assumed = burnRoad(grid, analysis, toGrid, {
      culverts: [{ ...culvert, inletInvertM: null, outletInvertM: null }],
    }).channels[0]
    expect(assumed.assumedInverts).toBe(true)
    expect(assumed.inletZ).toBeCloseTo(799.7, 6)
  })
})

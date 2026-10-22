import { describe, expect, it } from 'vitest'
import { burnRoad } from './designSurface'
import { analyzeRoad, offsetCoordinate } from './engine'
import {
  analyzeDrainage,
  downstream,
  extractStreams,
  fillDepressions,
  flowAccumulation,
  flowDirections,
  fullPipeCapacity,
  minimumDiameter,
  OUTLET,
  rationalPeakFlow,
} from './hydrology'
import { corridorBounds, sampleBilinear, sampleSurfaceGrid, type SurfaceGrid } from './surfaceGrid'
import { DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, Coordinate, Culvert, RoadSettings, TerrainSource } from './types'

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
const terrainOf = (f: (x: number, y: number) => number): TerrainSource => ({
  elevationAt: (lon, lat) => {
    const [x, y] = toGrid([lon, lat])
    return f(x, y)
  },
})
/** A grid with x east from 0 and y north from 0, cell centres on whole metres. */
function gridOf(width: number, height: number, f: (x: number, y: number) => number, cellM = 1): SurfaceGrid {
  const values = new Float64Array(width * height)
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++) values[row * width + col] = f(col * cellM, (height - 1 - row) * cellM)
  return { origin: [0, (height - 1) * cellM], cellM, width, height, values }
}
const outletArea = (dirs: Int8Array, acc: Float64Array) =>
  acc.reduce((sum, a, i) => (dirs[i] === OUTLET ? sum + a : sum), 0)

describe('depression filling and D8 flow', () => {
  it('drains a tilted plane to its low edge with the whole area at the outlets', () => {
    const grid = gridOf(50, 40, (_, y) => 100 + 0.05 * y, 2)
    const { filled, depth } = fillDepressions(grid)
    expect(Math.max(...depth)).toBeLessThan(1e-9)
    const dirs = flowDirections(filled)
    const acc = flowAccumulation(dirs, grid)
    // Everything flows south (D8 code 2); only the bottom row leaves the grid.
    for (let row = 0; row < 39; row++) for (let col = 0; col < 50; col++) expect(dirs[row * 50 + col]).toBe(2)
    for (let col = 0; col < 50; col++) {
      expect(dirs[39 * 50 + col]).toBe(OUTLET)
      expect(acc[39 * 50 + col]).toBe(40 * 4)
    }
    expect(outletArea(dirs, acc)).toBe(50 * 40 * 4)
  })

  it('fills a pit to its spill level so every cell drains off the grid', () => {
    const grid = gridOf(21, 21, (x, y) => (Math.abs(x - 10) <= 1 && Math.abs(y - 10) <= 1 ? 99 : 100))
    grid.values[3 * 21 + 3] = NaN
    const { filled, depth } = fillDepressions(grid, { epsilon: 1e-5 })
    expect(depth[10 * 21 + 10]).toBeGreaterThan(1)
    expect(depth[10 * 21 + 10]).toBeLessThan(1.001)
    expect(Number.isNaN(depth[3 * 21 + 3])).toBe(true)
    const dirs = flowDirections(filled)
    const acc = flowAccumulation(dirs, grid)
    // Every cell reaches an outlet, so outlets collect the whole valid area exactly once.
    expect(outletArea(dirs, acc)).toBe(21 * 21 - 1)
    // A missing cell is an outlet for its neighbours.
    expect(dirs.some((d, i) => d === OUTLET && Math.abs(i - (3 * 21 + 3)) <= 22)).toBe(true)
    // Strictly downhill, so no path cycles.
    for (let i = 0; i < dirs.length; i++) {
      const j = downstream(dirs, 21, i)
      if (j >= 0) expect(filled.values[j]).toBeLessThan(filled.values[i])
    }
  })

  it('traces one stream down the thalweg of a V-valley', () => {
    const grid = gridOf(41, 60, (x, y) => 0.1 * Math.abs(x - 20) + 0.05 * y)
    const { filled } = fillDepressions(grid)
    const dirs = flowDirections(filled)
    const acc = flowAccumulation(dirs, grid)
    // Cells near the bottom edge run along it to the thalweg (≤ 200 m² a side); stay above that.
    const streams = extractStreams(acc, dirs, grid, (xy) => xy, { thresholdM2: 400 })
    expect(streams.features).toHaveLength(1)
    const line = streams.features[0]
    for (const [x] of line.geometry.coordinates) expect(x).toBe(20)
    // The valley's whole area leaves at the thalweg outlet.
    expect(line.properties.areaHa).toBeCloseTo((41 * 60) / 10_000, 9)
    expect(line.geometry.coordinates.at(-1)![1]).toBe(0)
  })
})

describe('culvert sizing', () => {
  it('matches hand calculations of the Rational method and full-pipe Manning', () => {
    // 10 ha, C 0.5, 50 mm/h: 0.5 × 50 × 10 / 360.
    expect(rationalPeakFlow(0.5, 50, 10)).toBeCloseTo(0.694444, 6)
    // 0.6 m CMP, n 0.024, 2%: (1/n)(πD²/4)(D/4)^(2/3)√S.
    expect(fullPipeCapacity(0.6, 0.02, 0.024)).toBeCloseTo(0.470353, 6)
    expect(fullPipeCapacity(0.8, 0.02, 0.024)).toBeCloseTo(1.012963, 6)
    expect(minimumDiameter(0.694444, 0.02, 0.024)).toBe(0.8)
    expect(minimumDiameter(100, 0.02, 0.024)).toBeNull()
  })
})

describe('drainage on the design surface', () => {
  // A hillside rising north and falling east, with a V gully running down it at x = 0.
  const ground = (x: number, y: number) => 500 + 0.15 * y - 0.06 * x + 0.12 * (Math.min(Math.abs(x), 10) - 10)
  const terrain = terrainOf(ground)
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
  // Heading east across the slope at −4%, 2 m into the hill at the gully: the uphill (left) ditch
  // runs downgrade to about x = 127, where the left side comes out of cut.
  const road: Alignment = {
    id: 'main',
    name: 'Main',
    color: '#000',
    points: [
      { id: 'a', coordinate: toLonLat([-150, 0]), radiusM: 0 },
      { id: 'b', coordinate: toLonLat([150, 0]), radiusM: 0 },
    ],
    vertical: [
      { id: 'v0', chainage: 0, elevation: 504, curveLength: 0 },
      { id: 'v1', chainage: 300, elevation: 492, curveLength: 0 },
    ],
    template: {
      leftWidth: 3,
      rightWidth: 3,
      crossfallPercent: 3,
      cutSlope: 0.75,
      fillSlope: 1.5,
      ditchWidth: 1,
      ditchDepth: 0.5,
      surfaceDepth: 0.25,
    },
    overrides: [],
  }
  const analysis = analyzeRoad(road, terrain, settings)
  const existing = sampleSurfaceGrid(terrain, [-175, -60, 175, 150], toLonLat, { cellM: 1 })
  const culvert: Culvert = {
    id: 'gully',
    name: 'Gully CMP',
    kind: 'stream',
    chainage: 150,
    skewDegrees: 0,
    lengthM: 16,
    diameterM: 0.6,
    inletInvertM: 497.3,
    outletInvertM: 497.0,
    minCoverM: 0.3,
    unitCost: 0,
    fixedCost: 0,
  }
  const run = (culverts: Culvert[]) => {
    const burned = burnRoad(existing, analysis, toGrid, { culverts })
    return analyzeDrainage({
      existing,
      design: burned.surface,
      footprint: burned.footprint,
      channels: burned.channels,
      analysis,
      culverts,
      toGrid,
      toLonLat,
      rainfallMmPerHr: 50,
      runoffCoefficient: 0.5,
      manningN: 0.024,
      streamThresholdM2: 1000,
    })
  }

  it('reports the road redirecting the gully along the ditch when it has no culvert', () => {
    const result = run([])
    const gully = result.crossings.find((c) => Math.abs(c.chainage - 150) < 10)
    expect(gully).toBeDefined()
    // About 150 m of gully above the road, ~10 m wide.
    expect(gully!.areaHa).toBeGreaterThan(0.12)
    expect(gully!.culvertId).toBeNull()
    expect(gully!.divertedM).toBeGreaterThan(20)
    expect(gully!.redirected).toBe(true)
    // It leaves where the left ditch runs out of cut, collecting the hillside the ditch intercepts.
    expect(gully!.exitChainage).toBeGreaterThan(250)
    expect(gully!.exitAreaHa).toBeGreaterThan(2)
    const outlet = result.lowPoints.find((p) => p.kind === 'outlet' && p.side === 'left' && p.chainage > 250)
    expect(outlet?.culvertId).toBeNull()
    expect(outlet!.areaHa).toBeGreaterThan(2)
    // From the last ditch bottom (0+270, 492.61) to the uphill fill toe (0+280, 492.66) the ditch
    // rises only ~5 cm, so it spills on along the toe rather than ponding deeply.
    expect(result.newPonding.maxDepthM).toBeLessThan(0.1)
    expect(result.existing.ponding.cells).toBe(0)
    expect(result.existing.streams.features.length).toBeGreaterThan(0)
  })

  it('burns the ditch on the uphill (left) side and fill on the downhill side', () => {
    const { surface, footprint } = burnRoad(existing, analysis, toGrid)
    // At x = 99.5 (chainage 249.5) the formation is at 504 − 0.04 × 249.5; edges 3% lower.
    // (Millimetres differ because the great-circle centreline bows off the grid's y = 0.)
    const edge = 504 - 0.04 * 249.5 - 0.09
    expect(sampleBilinear(surface, 99.5, 3.5)).toBeCloseTo(edge - 0.5, 2)
    expect(sampleBilinear(surface, 99.5, -3.5)).toBeCloseTo(edge - 0.5 / 1.5, 2)
    for (const s of analysis.stations.filter((s) => s.chainage > 5 && s.chainage < 295)) {
      const [x, y] = toGrid(s.coordinate)
      expect(sampleBilinear(surface, x, y)).toBeCloseTo(s.designElevation!, 1)
    }
    // Ground well beyond the catch points is untouched.
    expect(sampleBilinear(surface, 99.5, 40.5)).toBe(sampleBilinear(existing, 99.5, 40.5))
    expect(footprint.some((f, i) => f && existing.values[i] === surface.values[i])).toBe(false)
  })

  it('passes the gully under the road through a culvert at the thalweg and sizes it', () => {
    const result = run([culvert])
    const gully = result.crossings.find((c) => Math.abs(c.chainage - 150) < 10)
    expect(gully).toBeDefined()
    expect(gully!.culvertId).toBe('gully')
    expect(gully!.throughCulvertId).toBe('gully')
    expect(gully!.divertedM).toBeLessThan(5)
    expect(gully!.redirected).toBe(false)
    const outlet = result.lowPoints.find((p) => p.throughCulvert)
    expect(outlet?.culvertId).toBe('gully')
    expect(outlet!.side).toBe('right')
    // The ditch brings the intercepted hillside west of the gully to the pipe as well.
    const check = result.culverts[0]
    expect(check.existingAreaHa).toBeLessThan(0.25)
    expect(check.designAreaHa).toBeGreaterThan(2)
    expect(check.slope).toBeCloseTo(0.3 / 16, 9)
    expect(check.slopeAssumed).toBe(false)
    expect(check.designFlowM3s).toBeCloseTo(rationalPeakFlow(0.5, 50, check.designAreaHa), 9)
    expect(check.capacityM3s).toBeCloseTo(fullPipeCapacity(0.6, 0.3 / 16, 0.024), 9)
    expect(check.adequate).toBe(check.capacityM3s >= check.designFlowM3s)
    expect(check.minimumDiameterM).toBe(minimumDiameter(check.designFlowM3s, 0.3 / 16, 0.024))
  })
})

describe('ditches skewed to the grid', () => {
  it('drains a V ditch and an uphill fill toe as channels, not a staircase of pits', () => {
    // A planar sidehill rising 30% to the left of a road heading 17° off the grid's x axis, the
    // road on a steady −4% grade against a −6% fall of the ground: the left side starts in cut
    // with the default 1 m × 0.5 m V ditch and comes out onto fill near 0+090.
    const bearing = 90 - 17,
      b = bearing * RAD
    const ground = (x: number, y: number) =>
      500 + 0.3 * (y * Math.sin(b) - x * Math.cos(b)) - 0.06 * (x * Math.sin(b) + y * Math.cos(b))
    const terrain = terrainOf(ground)
    const road: Alignment = {
      id: 'skew',
      name: 'Skewed',
      color: '#000',
      points: [
        { id: 'a', coordinate: origin, radiusM: 0 },
        { id: 'b', coordinate: offsetCoordinate(origin, bearing, 300), radiusM: 0 },
      ],
      vertical: [
        { id: 'v0', chainage: 0, elevation: 499, curveLength: 0 },
        { id: 'v1', chainage: 300, elevation: 487, curveLength: 0 },
      ],
      template: { ...DEFAULT_TEMPLATE },
      overrides: [],
    }
    const settings: RoadSettings = {
      stationInterval: 10,
      crossSectionHalfWidth: 35,
      maxGradePercent: 12,
      minRadius: 25,
      cutRate: 2,
      fillRate: 3,
      surfacingRate: 4,
      clearingRate: 0.5,
      shrinkFactor: 0.8,
    }
    const analysis = analyzeRoad(road, terrain, settings)
    const existing = sampleSurfaceGrid(terrain, corridorBounds(analysis, toGrid, 40), toLonLat, { cellM: 1 })
    const burned = burnRoad(existing, analysis, toGrid)
    const result = analyzeDrainage({
      existing,
      design: burned.surface,
      footprint: burned.footprint,
      channels: burned.channels,
      analysis,
      culverts: [],
      toGrid,
      toLonLat,
      rainfallMmPerHr: 50,
      runoffCoefficient: 0.5,
      manningN: 0.024,
      streamThresholdM2: 5000,
    })
    // The left ditch's dead end: the last station still in cut at the left formation edge.
    const inCut = analysis.stations.filter((s) => {
      const edge = s.section.find((p) => Math.abs(p.offset + s.leftWidth) < 1e-6)!
      return edge.ground! > edge.design!
    })
    const deadEnd = inCut[inCut.length - 1].chainage
    expect(deadEnd).toBeGreaterThan(60)
    expect(deadEnd).toBeLessThan(120)
    // Before the break lines were burned: 64 ponds 0.28 m deep every ~12 m and 34 low points.
    for (const pond of result.newPonding.ponds.features)
      expect(Math.abs(pond.properties.chainage - deadEnd)).toBeLessThan(15)
    expect(result.newPonding.maxDepthM).toBeLessThan(0.15)
    expect(result.lowPoints.length).toBeLessThanOrEqual(3)
    for (const p of result.lowPoints) expect(p.areaHa).toBeGreaterThanOrEqual(0.05)
    // Ground wholly outside the prism is still untouched.
    for (let i = 0; i < existing.values.length; i++)
      if (!burned.footprint[i]) expect(burned.surface.values[i]).toBe(existing.values[i])
  })
})

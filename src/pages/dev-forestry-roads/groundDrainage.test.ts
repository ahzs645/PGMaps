import { describe, expect, it } from 'vitest'
import { runToCompletion } from './cooperative'
import {
  areaOutlet,
  areaSquareMetres,
  capsuleSpan,
  DEFAULT_GROUND_DRAINAGE_SETTINGS,
  groundDrainageKey,
  groundDrainagePlan,
  mapGeometry,
  parseGroundDrainage,
  routeAreaGrid,
  sampleAreaGridSteps,
  ZONE_AREA,
  ZONE_MARGIN,
  type GroundDrainageArea,
} from './groundDrainage'
import { createDemoProject, localMetricGrid } from './terrain'
import { parseProject, serializeProject } from './project'
import type { Coordinate, TerrainSource } from './types'

const grid = localMetricGrid([-122.75, 53.9])
const [x0, y0] = grid.toGrid([-122.75, 53.9])
const at = (dx: number, dy: number) => grid.toLonLat([x0 + dx, y0 + dy])
const square = (half: number, hole?: number): GroundDrainageArea['geometry'] => ({
  type: 'Polygon',
  coordinates: [
    [at(-half, -half), at(half, -half), at(half, half), at(-half, half), at(-half, -half)],
    ...(hole
      ? [[at(-hole, -hole), at(-hole, hole), at(hole, hole), at(hole, -hole), at(-hole, -hole)] as Coordinate[]]
      : []),
  ],
})
/** Ground falling 5% to the south. */
const slope: TerrainSource = {
  elevationAt: (lon, lat) => 100 + 0.05 * (grid.toGrid([lon, lat])[1] - y0),
}
/** A cone: highest at the centre. */
const cone: TerrainSource = {
  elevationAt: (lon, lat) => {
    const [x, y] = grid.toGrid([lon, lat])
    return 200 - 0.2 * Math.hypot(x - x0, y - y0)
  },
}
const sample = (
  terrain: TerrainSource,
  area: GroundDrainageArea['geometry'],
  options: { marginM?: number; sourceM?: number; maxCells?: number; workingResolutionM?: number } = {},
) =>
  runToCompletion(sampleAreaGridSteps(terrain, area, grid.toGrid, { sourceM: 2, toLonLat: grid.toLonLat, ...options }))

describe('sampling an analysis area', () => {
  it('holds only the area at the source spacing, with no margin', () => {
    const area = sample(slope, square(50))
    expect(area.summary.cellM).toBe(2)
    expect(area.summary.coarsenedForBudget).toBe(false)
    expect(area.summary.areaCells).toBeGreaterThan(2400)
    expect(area.summary.areaCells).toBeLessThan(2600)
    expect(area.summary.marginCells).toBe(0)
    expect(area.summary.missingAreaCells).toBe(0)
    expect(area.zone.filter((z) => z === ZONE_AREA).length).toBe(area.summary.areaCells)
    // Outside the area every stored cell is missing, never sampled.
    area.zone.forEach((z, i) => expect(Number.isNaN(area.grid.values[i])).toBe(z === 0))
  })

  it('adds a margin as wide as asked, round the corners', () => {
    const area = sample(slope, square(50), { marginM: 20 })
    // A square buffered by r: side² + 4·side·r + πr², less the square itself.
    const expected = (4 * 100 * 20 + Math.PI * 400) / 4
    expect(area.summary.marginCells / expected).toBeGreaterThan(0.95)
    expect(area.summary.marginCells / expected).toBeLessThan(1.05)
    expect(area.zone.filter((z) => z === ZONE_MARGIN).length).toBe(area.summary.marginCells)
  })

  it('keeps a hole in the area out of it', () => {
    const area = sample(slope, square(50, 20))
    const expected = (100 * 100 - 40 * 40) / 4
    expect(area.summary.areaCells / expected).toBeGreaterThan(0.95)
    expect(area.summary.areaCells / expected).toBeLessThan(1.05)
    expect(areaSquareMetres(square(50, 20), grid.toGrid)).toBeCloseTo(8400, -1)
  })

  it('keeps missing ground missing and counts it', () => {
    const gappy: TerrainSource = {
      elevationAt: (lon, lat) => (grid.toGrid([lon, lat])[0] > x0 + 30 ? NaN : slope.elevationAt(lon, lat)),
    }
    const area = sample(gappy, square(50))
    expect(area.summary.missingAreaCells).toBeGreaterThan(400)
    expect(area.summary.groundCells + area.summary.missingAreaCells).toBe(area.summary.areaCells)
  })

  it('coarsens the cell until the touched tiles fit the routed-cell budget', () => {
    const area = sample(slope, square(500), { maxCells: 40_000 })
    expect(area.summary.coarsenedForBudget).toBe(true)
    expect(area.summary.cellM).toBeGreaterThan(2)
    expect(area.grid.values.length).toBeLessThanOrEqual(40_000)
  })

  it('never routes finer than the source or the request', () => {
    expect(sample(slope, square(50), { sourceM: 0.5 }).summary.cellM).toBe(1)
    expect(sample(slope, square(50), { workingResolutionM: 5 }).summary.cellM).toBe(5)
  })

  it('refuses an area with no ground', () => {
    expect(() => sample({ elevationAt: () => NaN }, square(50))).toThrow(/no ground/)
  })
})

describe('routing and outlets', () => {
  it('finds the catchment above an outlet and says it reaches the boundary', () => {
    const area = sample(slope, square(50))
    const routing = routeAreaGrid(area, { streamThresholdHa: 0.01 }, (xy) => xy as Coordinate)
    const outlet = areaOutlet(routing, [x0, y0 - 49], { snapRadiusM: 0 }, (xy) => xy as Coordinate)
    // A plane drains straight downhill: the catchment is the column of cells above the outlet.
    expect(outlet.cells).toBeGreaterThan(40)
    expect(outlet.cells).toBeLessThan(60)
    expect(outlet.touchesBoundary).toBe(true)
    expect(outlet.touchesMissingGround).toBe(false)
    expect(outlet.inMarginHa).toBe(0)
    expect(outlet.areaHa).toBeCloseTo(outlet.inAreaHa)
  })

  it('finds a catchment that stays inside the area', () => {
    const area = sample(cone, square(100))
    const routing = routeAreaGrid(area, { streamThresholdHa: 1 }, (xy) => xy as Coordinate)
    const outlet = areaOutlet(routing, [x0, y0 - 20], { snapRadiusM: 0 }, (xy) => xy as Coordinate)
    expect(outlet.touchesBoundary).toBe(false)
    expect(outlet.touchesMissingGround).toBe(false)
    expect(outlet.cells).toBeGreaterThan(0)
  })

  it('reports a catchment that runs into a terrain gap', () => {
    const gappy: TerrainSource = {
      elevationAt: (lon, lat) => (grid.toGrid([lon, lat])[1] > y0 + 30 ? NaN : slope.elevationAt(lon, lat)),
    }
    const area = sample(gappy, square(50))
    const routing = routeAreaGrid(area, { streamThresholdHa: 1 }, (xy) => xy as Coordinate)
    const outlet = areaOutlet(routing, [x0, y0 - 49], { snapRadiusM: 0 }, (xy) => xy as Coordinate)
    expect(outlet.touchesMissingGround).toBe(true)
  })

  it('counts the catchment in the margin apart from the area', () => {
    const area = sample(slope, square(50), { marginM: 30 })
    const routing = routeAreaGrid(area, { streamThresholdHa: 1 }, (xy) => xy as Coordinate)
    const outlet = areaOutlet(routing, [x0, y0 - 49], { snapRadiusM: 0 }, (xy) => xy as Coordinate)
    expect(outlet.inMarginHa).toBeGreaterThan(0)
    expect(outlet.inAreaHa).toBeGreaterThan(0)
  })

  it('snaps a requested outlet to the largest flow within the radius', () => {
    const valley: TerrainSource = {
      elevationAt: (lon, lat) => {
        const [x, y] = grid.toGrid([lon, lat])
        return 100 + 0.05 * (y - y0) + 0.1 * Math.abs(x - x0)
      },
    }
    const area = sample(valley, square(100))
    const routing = routeAreaGrid(area, { streamThresholdHa: 0.2 }, (xy) => xy as Coordinate)
    expect(routing.streams.features.length).toBeGreaterThan(0)
    const outlet = areaOutlet(routing, [x0 + 9, y0 - 60], { snapRadiusM: 15 }, (xy) => xy as Coordinate)
    expect(Math.abs(outlet.snapped[0] - x0)).toBeLessThanOrEqual(2)
    expect(outlet.snappedDistanceM).toBeGreaterThan(5)
  })

  it('partitions watersheds only when asked', () => {
    const area = sample(cone, square(60))
    expect(routeAreaGrid(area, { streamThresholdHa: 1 }, (xy) => xy as Coordinate).watersheds).toBeUndefined()
    const routed = routeAreaGrid(area, { streamThresholdHa: 1, watershedMinAreaHa: 0.05 }, (xy) => xy as Coordinate)
    expect(routed.watersheds!.features.length).toBeGreaterThan(1)
  })
})

describe('saving and keying', () => {
  const area: GroundDrainageArea = { source: 'drawn', name: 'Area 1', geometry: square(50) }
  it('reads back what it saves and closes open rings', () => {
    const open = { ...area, geometry: { type: 'Polygon', coordinates: [square(50).coordinates[0].slice(0, 4)] } }
    const parsed = parseGroundDrainage({ area: open, settings: DEFAULT_GROUND_DRAINAGE_SETTINGS, outlet: at(0, 0) })
    expect((parsed.area!.geometry as GeoJSON.Polygon).coordinates[0]).toHaveLength(5)
    expect(parseGroundDrainage(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed)
  })
  it('refuses a margin past the limit and an area that is not a polygon', () => {
    expect(() => parseGroundDrainage({ settings: { ...DEFAULT_GROUND_DRAINAGE_SETTINGS, marginM: 5000 } })).toThrow(
      /margin/,
    )
    expect(() =>
      parseGroundDrainage({
        area: { ...area, geometry: { type: 'LineString', coordinates: [at(0, 0), at(1, 1)] } },
        settings: DEFAULT_GROUND_DRAINAGE_SETTINGS,
      }),
    ).toThrow(/polygon/)
  })
  it('changes with the terrain, area and routing, never with the outlet snap', () => {
    const base = groundDrainageKey({ terrainFingerprint: 't1', area, settings: DEFAULT_GROUND_DRAINAGE_SETTINGS })
    const same = (settings: object, terrainFingerprint = 't1', a = area) =>
      groundDrainageKey({ terrainFingerprint, area: a, settings: { ...DEFAULT_GROUND_DRAINAGE_SETTINGS, ...settings } })
    expect(same({ snapRadiusM: 100, snapPolicy: 'lowest-elevation' })).toBe(base)
    expect(same({}, 't2')).not.toBe(base)
    expect(same({ marginM: 50 })).not.toBe(base)
    expect(same({ streamThresholdHa: 2 })).not.toBe(base)
    expect(same({}, 't1', { ...area, geometry: square(60) })).not.toBe(base)
  })
})

describe('the project file', () => {
  it('reads an older project without the area unchanged, and keeps a saved one', () => {
    const older = parseProject(createDemoProject())
    expect(older.groundDrainage).toBeUndefined()
    expect(parseProject(JSON.parse(serializeProject(older)))).toEqual(older)
    const area: GroundDrainageArea = { source: 'block', name: 'Block 7', contextId: 'b7', geometry: square(50) }
    const saved = parseProject({
      ...older,
      groundDrainage: { area, settings: { ...DEFAULT_GROUND_DRAINAGE_SETTINGS, marginM: 100 }, outlet: at(0, -40) },
    })
    const reread = parseProject(JSON.parse(serializeProject(saved)))
    expect(reread.groundDrainage).toEqual(saved.groundDrainage)
    expect(reread.groundDrainage!.area!.contextId).toBe('b7')
  })
})

describe('geometry helpers', () => {
  it('cuts a capsule along a line', () => {
    expect(capsuleSpan([0, 0], [10, 0], 2, 0)).toEqual([-2, 12])
    expect(capsuleSpan([0, 0], [10, 0], 2, 3)).toBeNull()
    const [lo, hi] = capsuleSpan([0, 0], [0, 10], 2, 5)!
    expect(lo).toBeCloseTo(-2)
    expect(hi).toBeCloseTo(2)
  })
  it('maps geometry coordinates and draws the plan by role', () => {
    const mapped = mapGeometry(
      {
        type: 'LineString',
        coordinates: [
          [1, 2],
          [3, 4],
        ],
      },
      ([x, y]) => [x * 10, y * 10],
    )
    expect(mapped.coordinates).toEqual([
      [10, 20],
      [30, 40],
    ])
    const area: GroundDrainageArea = { source: 'drawn', name: 'A', geometry: square(10) }
    expect(groundDrainagePlan(area).features.map((f) => f.properties!.role)).toEqual(['ground-area'])
  })
})

describe('the routing worker', () => {
  it('keeps the routed grid and answers outlets from it', async () => {
    const { createAreaRouterCore } = await import('./groundDrainage.worker')
    const handle = createAreaRouterCore()
    expect(handle({ type: 'outlet', id: 1, requested: [x0, y0], settings: { snapRadiusM: 0 } }).type).toBe('error')
    const area = sample(slope, square(50))
    const routed = handle({
      type: 'route',
      id: 2,
      grid: area.grid,
      zone: area.zone,
      settings: { streamThresholdHa: 0.1 },
    })
    expect(routed.type).toBe('routed')
    const outlet = handle({ type: 'outlet', id: 3, requested: [x0, y0 - 49], settings: { snapRadiusM: 0 } })
    expect(outlet.type === 'outlet' && outlet.result.cells).toBeGreaterThan(40)
  })
})

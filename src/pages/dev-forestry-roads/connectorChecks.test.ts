import { describe, expect, it } from 'vitest'
import { checkConnector, parseConnectorCheckOptions, type ConnectorCheckOptions } from './connectorChecks'
import { alignmentLength } from './engine'
import { createEngineeringDesign } from './engineeringTypes'
import type { Alignment, ContextFeature, Coordinate, RoadSettings, TerrainSource } from './types'

const origin: Coordinate = [-122, 54],
  R = 6371008.8,
  RAD = Math.PI / 180
const point = (x: number, y: number): Coordinate => [
  origin[0] + x / (R * RAD * Math.cos(origin[1] * RAD)),
  origin[1] + y / (R * RAD),
]
const northing = (latitude: number) => (latitude - origin[1]) * R * RAD
const flat: TerrainSource = { elevationAt: () => 800 }
const settings: RoadSettings = {
  stationInterval: 10,
  crossSectionHalfWidth: 30,
  maxGradePercent: 12,
  minRadius: 25,
  cutRate: 1,
  fillRate: 1,
  surfacingRate: 1,
  clearingRate: 1,
  shrinkFactor: 1,
}
const criteria: ConnectorCheckOptions = {
  loadedDirection: 'start-to-end',
  maxAdverseGradePercent: 10,
  maxFavourableGradePercent: 12,
  clearingExtraM: 0,
  exclusionClearanceM: 0,
  streamSetbackM: 0,
  allowStreamCrossings: false,
  requireFormationDesign: true,
  maxCutDepthM: null,
  maxFillHeightM: null,
  approvedCrossings: [],
}
function road(height = 800): Alignment {
  return {
    id: 'road',
    name: 'Connector',
    color: '#123456',
    points: [
      { id: 'a', coordinate: point(0, 0), radiusM: 0 },
      { id: 'b', coordinate: point(0, 100), radiusM: 0 },
    ],
    vertical: [
      { id: 'start', chainage: 0, elevation: height, curveLength: 0 },
      { id: 'end', chainage: 100, elevation: height, curveLength: 0 },
    ],
    template: {
      leftWidth: 3,
      rightWidth: 3,
      crossfallPercent: 0,
      cutSlope: 1,
      fillSlope: 1,
      ditchWidth: 0,
      ditchDepth: 0,
      surfaceDepth: 0.2,
    },
    overrides: [],
  }
}
const rectangle = (x0: number, y0: number, x1: number, y1: number): Coordinate[] => [
  point(x0, y0),
  point(x1, y0),
  point(x1, y1),
  point(x0, y1),
  point(x0, y0),
]
const exclusion = (rings: Coordinate[][]): ContextFeature => ({
  id: 'reserve',
  name: 'Reserved ground',
  kind: 'avoid',
  geometry: { type: 'Polygon', coordinates: rings },
})
const run = (
  alignment = road(),
  context: ContextFeature[] = [],
  options: Partial<ConnectorCheckOptions> = {},
  terrain = flat,
) =>
  checkConnector({ alignment, terrain, settings, context, options: { ...criteria, ...options }, terrainResolutionM: 1 })
const codes = (result: ReturnType<typeof run>) => result.failures.map((issue) => issue.code)

describe('final fitted connector gates', () => {
  it('passes an independently formed, covered straight road without changing the input', () => {
    const alignment = road(),
      before = JSON.stringify(alignment),
      result = run(alignment)
    expect(result.status).toBe('pass')
    expect(result.adoptable).toBe(true)
    expect(result.metrics.maxSectionSpacingM).toBeLessThanOrEqual(1 + 1e-6)
    expect(result.metrics.checkedStations).toBeGreaterThanOrEqual(101)
    expect(JSON.stringify(alignment)).toBe(before)
  })
  it('blocks a sharp search-grid corner and a fitted curve below the actual minimum radius', () => {
    const alignment = road()
    alignment.points = [
      { id: 'a', coordinate: point(0, 0), radiusM: 0 },
      { id: 'corner', coordinate: point(0, 60), radiusM: 0 },
      { id: 'b', coordinate: point(60, 60), radiusM: 0 },
    ]
    alignment.vertical.at(-1)!.chainage = alignmentLength(alignment)
    expect(codes(run(alignment))).toContain('invalid-final-geometry')
    alignment.points[1].radiusM = 10
    alignment.vertical.at(-1)!.chainage = alignmentLength(alignment)
    const result = run(alignment)
    expect(result.adoptable).toBe(false)
    expect(codes(result)).toContain('minimum-radius')
  })
  it('checks loaded uphill/downhill formation grades rather than absolute ground grade', () => {
    const alignment = road()
    alignment.vertical.at(-1)!.elevation = 808
    const uphill = run(alignment, [], { maxAdverseGradePercent: 6 })
    expect(codes(uphill)).toContain('adverse-loaded-grade')
    expect(uphill.metrics.maxAdverseGradePercent).toBeCloseTo(8, 5)
    expect(uphill.metrics.maxFormationUphillGradePercent).toBeCloseTo(8, 5)
    expect(uphill.metrics.maxFormationDownhillGradePercent).toBe(0)
    const downhill = run(alignment, [], { loadedDirection: 'end-to-start', maxAdverseGradePercent: 6 })
    expect(downhill.status).toBe('pass')
    expect(downhill.metrics.maxFavourableGradePercent).toBeCloseTo(8, 5)
    expect(codes(run(alignment, [], { loadedDirection: 'end-to-start', maxFavourableGradePercent: 7 }))).toContain(
      'favourable-loaded-grade',
    )
  })
  it('rejects a daylight footprint intersecting a narrow polygon between stations even when the centreline is clear', () => {
    const alignment = road(803),
      reserved = exclusion([rectangle(5, 50.35, 7, 50.45)])
    const result = run(alignment, [reserved])
    expect(result.analysis!.crossings.filter((crossing) => crossing.kind === 'avoid')).toHaveLength(0)
    expect(result.metrics.maxFootprintWidthM).toBeCloseTo(12, 2)
    expect(codes(run(alignment, [], { maxFillHeightM: 2 }))).toContain('maximum-fill')
    expect(codes(result)).toContain('exclusion-footprint')
    expect(result.adoptable).toBe(false)
    expect(codes(run(road(), [exclusion([rectangle(5, 50.35, 7, 50.45)])], { clearingExtraM: 3 }))).toContain(
      'exclusion-footprint',
    )
  })
  it('respects polygon holes and only passes when the complete prism clears the hole boundary', () => {
    const reserve = exclusion([rectangle(-20, -20, 20, 120), rectangle(-10, -10, 10, 110)])
    expect(run(road(), [reserve]).status).toBe('pass')
    expect(codes(run(road(), [reserve], { clearingExtraM: 8 }))).toContain('exclusion-footprint')
  })
  it('rechecks the fitted arc footprint after the original straight grid legs avoided an area', () => {
    const alignment = road()
    alignment.points = [
      { id: 'a', coordinate: point(0, 0), radiusM: 0 },
      { id: 'curve', coordinate: point(0, 60), radiusM: 25 },
      { id: 'b', coordinate: point(60, 60), radiusM: 0 },
    ]
    alignment.vertical.at(-1)!.chainage = alignmentLength(alignment)
    const result = run(alignment, [exclusion([rectangle(7, 51, 9, 53)])])
    expect(codes(result)).toContain('exclusion-footprint')
    expect(codes(result)).not.toContain('minimum-radius')
  })
  it('blocks adoption with separately reported unknown terrain, formation, source resolution and loaded criteria', () => {
    const missing: TerrainSource = {
      elevationAt: (_longitude, latitude) => (northing(latitude) > 49 && northing(latitude) < 52 ? NaN : 800),
    }
    const result = run(road(), [], {}, missing)
    expect(result.adoptable).toBe(false)
    expect(result.status).toBe('unknown')
    expect(result.unknowns.some((issue) => issue.code === 'incomplete-section')).toBe(true)
    const alignment = road()
    alignment.vertical = []
    expect(run(alignment).unknowns.some((issue) => issue.code === 'independent-formation')).toBe(true)
    const unspecified = checkConnector({ alignment: road(), terrain: flat, settings })
    expect(unspecified.status).toBe('unknown')
    expect(unspecified.unknowns.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['loaded-haul-criteria', 'terrain-resolution']),
    )
    expect(
      checkConnector({
        alignment: road(),
        terrain: flat,
        settings,
        options: criteria,
        terrainResolutionM: 30,
      }).unknowns.some((issue) => issue.code === 'coarse-terrain'),
    ).toBe(true)
  })
  it('requires a bounded reviewed stream window and complete matching structure; a review is not global setback permission', () => {
    const stream: ContextFeature = {
      id: 'creek',
      name: 'Creek',
      kind: 'stream',
      geometry: { type: 'LineString', coordinates: [point(-100, 50), point(100, 50)] },
    }
    expect(codes(run(road(), [stream], { streamSetbackM: 5 }))).toContain('stream-footprint-setback')
    const unreviewed = run(road(), [stream], { allowStreamCrossings: true, streamSetbackM: 5 })
    expect(unreviewed.status).toBe('unknown')
    expect(unreviewed.unknowns.some((issue) => issue.code === 'unreviewed-stream-crossing')).toBe(true)
    const alignment = road()
    alignment.engineering = createEngineeringDesign()
    alignment.engineering.culverts = [
      {
        id: 'pipe',
        name: 'Crossing pipe',
        kind: 'stream',
        sourceFeatureId: 'creek',
        chainage: 50,
        skewDegrees: 0,
        lengthM: 10,
        diameterM: 0.8,
        inletInvertM: 798.6,
        outletInvertM: 798.4,
        minCoverM: 0.5,
        unitCost: 100,
        fixedCost: 1000,
      },
    ]
    const approved = {
      allowStreamCrossings: true,
      streamSetbackM: 5,
      approvedCrossings: [{ featureId: 'creek', structureId: 'pipe', startM: 35, endM: 65 }],
    }
    expect(run(alignment, [stream], approved).status).toBe('pass')
    expect(
      codes(
        run(alignment, [stream], {
          ...approved,
          approvedCrossings: [{ ...approved.approvedCrossings[0], startM: 49, endM: 51 }],
        }),
      ),
    ).toContain('stream-footprint-setback')
    alignment.engineering.culverts[0].outletInvertM = 798.6
    expect(codes(run(alignment, [stream], approved))).toContain('culvert-flow-grade')
    alignment.engineering.culverts[0].outletInvertM = 798.4
    alignment.engineering.culverts[0].inletInvertM = null
    expect(run(alignment, [stream], approved).unknowns.some((issue) => issue.code === 'crossing-geometry')).toBe(true)
  })
  it('validates portable criteria and blocks a changed endpoint registration', () => {
    for (const invalid of [
      null,
      { loadedDirection: 'up' },
      { maxAdverseGradePercent: Infinity },
      { clearingExtraM: -1 },
      { approvedCrossings: [{ featureId: 'stream', structureId: 'pipe', startM: 50, endM: 40 }] },
    ])
      expect(() => parseConnectorCheckOptions(invalid)).toThrow()
    const result = checkConnector({
      alignment: road(),
      terrain: flat,
      settings,
      options: criteria,
      terrainResolutionM: 1,
      expectedEnd: point(5, 100),
    })
    expect(codes(result)).toContain('endpoint-registration')
  })
  it('returns unknown instead of a truncated success when the dense-section budget is exceeded', () => {
    const alignment = road()
    alignment.points[1].coordinate = point(0, 20000)
    alignment.vertical[1].chainage = alignmentLength(alignment)
    const result = run(alignment)
    expect(result.status).toBe('unknown')
    expect(result.adoptable).toBe(false)
    expect(result.unknowns.some((issue) => issue.code === 'station-budget')).toBe(true)
  })
  it('accepts valid circular and clothoid tangent continuity rather than rejecting every curved design', () => {
    const alignment = road()
    alignment.points = [
      { id: 'a', coordinate: point(0, 0), radiusM: 0 },
      { id: 'curve', coordinate: point(0, 100), radiusM: 30, spiralM: 10 },
      { id: 'b', coordinate: point(100, 100), radiusM: 0 },
    ]
    alignment.vertical.at(-1)!.chainage = alignmentLength(alignment)
    expect(run(alignment).status).toBe('pass')
    alignment.points[1].spiralM = 0
    alignment.vertical.at(-1)!.chainage = alignmentLength(alignment)
    expect(run(alignment).status).toBe('pass')
  })
})

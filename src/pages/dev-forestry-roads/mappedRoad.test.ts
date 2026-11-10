import { describe, expect, it } from 'vitest'
import { analyzeRoad, distance, offsetCoordinate } from './engine'
import {
  derivedRoadName,
  designFromMappedRoad,
  joinMappedRoad,
  loadableMappedRoads,
  loadMappedRoads,
  MAPPED_ROAD_PALETTE,
  mappedRoadInBounds,
  MAX_JOIN_GAP_M,
  mappedRoadAlignment,
  mappedRoadKey,
  nextMappedRoadColor,
  reviewMappedRoad,
  thinMappedRoad,
} from './mappedRoad'
import { parseProject } from './project'
import { createDemoProject, DEFAULT_TEMPLATE } from './terrain'
import type { ContextFeature, Coordinate, RoadSettings, TerrainSource } from './types'

const origin: Coordinate = [-122.8, 53.9]
const at = (east: number, north: number): Coordinate =>
  offsetCoordinate(origin, (Math.atan2(east, north) * 180) / Math.PI, Math.hypot(east, north))
const eastOf = (p: Coordinate) =>
  (((p[0] - origin[0]) * Math.PI) / 180) * 6371008.8 * Math.cos((origin[1] * Math.PI) / 180)
const northOf = (p: Coordinate) => (((p[1] - origin[1]) * Math.PI) / 180) * 6371008.8

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

function road(
  id: string,
  coordinates: Coordinate[],
  evidence: Partial<NonNullable<ContextFeature['roadEvidence']>> = {},
) {
  return {
    id,
    name: 'R03890 · A',
    kind: 'existing-road',
    geometry: { type: 'LineString', coordinates },
    roadEvidence: {
      source: 'bc-ften',
      forestFileId: 'R03890',
      roadSectionId: 'A',
      condition: 'unknown',
      conditionBasis: 'unreviewed',
      reuseAllowed: false,
      ...evidence,
    },
  } as ContextFeature
}

describe('joining a mapped road', () => {
  it('joins the parts of one permit section end to end, in station order, whatever their drawn direction', () => {
    const first = road('a', [at(0, 0), at(0, 100)], { sourceId: '1', segmentStartStation: 0 })
    // Drawn backwards, and touching the first part's end.
    const second = road('b', [at(0, 200), at(0, 100)], { sourceId: '2', segmentStartStation: 0.1 })
    // A 10 m gap: within the join limit, so it is bridged and reported.
    const third = road('c', [at(0, 210), at(0, 300)], { sourceId: '3', segmentStartStation: 0.2 })
    const other = road('x', [at(0, 300), at(0, 400)], { forestFileId: 'R99999', sourceId: '9' })
    const joined = joinMappedRoad(second, [third, other, first, second])
    expect(joined.parts.map((p) => p.id)).toEqual(['a', 'b', 'c'])
    expect(distance(joined.coordinates[0], at(0, 0))).toBeLessThan(0.01)
    expect(distance(joined.coordinates.at(-1)!, at(0, 300))).toBeLessThan(0.01)
    // The touching joint is kept once.
    expect(joined.coordinates).toHaveLength(5)
    expect(joined.joinGapsM).toHaveLength(1)
    expect(joined.joinGapsM[0]).toBeCloseTo(10, 1)
    expect(joined.partsLeftOut).toBe(0)
  })

  it(`leaves out a part more than ${MAX_JOIN_GAP_M} m from the line rather than inventing the gap`, () => {
    const near = road('a', [at(0, 0), at(0, 100)])
    const far = road('b', [at(0, 100 + MAX_JOIN_GAP_M + 5), at(0, 300)])
    const joined = joinMappedRoad(near, [near, far])
    expect(joined.parts.map((p) => p.id)).toEqual(['a'])
    expect(joined.partsLeftOut).toBe(1)
  })

  it('groups by permit section, then by source row, then by feature', () => {
    expect(mappedRoadKey(road('a', [at(0, 0), at(0, 1)]))).toBe('bc-ften:section:R03890:A')
    expect(mappedRoadKey(road('a', [at(0, 0), at(0, 1)], { forestFileId: undefined, sourceId: '7' }))).toBe(
      'bc-ften:row:7',
    )
    expect(mappedRoadKey({ ...road('z', [at(0, 0), at(0, 1)]), roadEvidence: undefined })).toBe('feature:z')
  })

  it('refuses anything but a mapped road line', () => {
    const block = { ...road('h', [at(0, 0), at(0, 1)]), kind: 'harvest' } as ContextFeature
    expect(() => joinMappedRoad(block, [block])).toThrow('mapped road line')
  })
})

describe('thinning a mapped road', () => {
  const wiggle = Array.from({ length: 401 }, (_, i) => at(Math.sin(i / 3) * 0.2, i))

  it('drops vertices that move the line by less than half a terrain cell, between 0.5 and 5 m', () => {
    expect(thinMappedRoad(wiggle, 1, 2000).toleranceM).toBe(0.5)
    expect(thinMappedRoad(wiggle, 22, 2000).toleranceM).toBe(5)
    // 0.2 m of wobble is below every tolerance, so the straight line keeps its two ends.
    expect(thinMappedRoad(wiggle, 1, 2000).coordinates).toHaveLength(2)
  })

  it('raises the tolerance only when the line would not fit the point budget', () => {
    const zigzag = Array.from({ length: 200 }, (_, i) => at(i % 2 ? 20 : 0, i * 10))
    const roomy = thinMappedRoad(zigzag, 1, 2000)
    expect(roomy.coordinates).toHaveLength(200)
    const tight = thinMappedRoad(zigzag, 1, 50)
    expect(tight.coordinates.length).toBeLessThanOrEqual(50)
    expect(tight.toleranceM).toBeGreaterThan(roomy.toleranceM)
  })
})

describe('the as-mapped road', () => {
  const parts = [
    road('a', [at(0, 0), at(0, 150)], { sourceId: '101', segmentStartStation: 0 }),
    road('b', [at(0, 150), at(80, 300)], { sourceId: '102', segmentStartStation: 0.15 }),
  ]

  it('is a road held as recorded: no vertical controls, no curves, its provenance attached', () => {
    const alignment = mappedRoadAlignment({
      seed: parts[0],
      context: parts,
      id: 'mapped-1',
      template: DEFAULT_TEMPLATE,
      terrainResolutionM: 1,
      pointBudget: 2000,
    })
    expect(alignment.name).toBe('R03890 · A · as mapped')
    expect(alignment.vertical).toEqual([])
    expect(alignment.points.every((p) => p.radiusM === 0)).toBe(true)
    expect(alignment.mappedRoad).toEqual({
      source: 'bc-ften',
      roadName: 'R03890 · A',
      contextIds: ['a', 'b'],
      sourceIds: ['101', '102'],
      forestFileId: 'R03890',
      roadSectionId: 'A',
      sourceVertexCount: 3,
      thinningToleranceM: 0.5,
      joinGapsM: [],
      partsLeftOut: 0,
    })
  })

  it('survives a project save and reload, and an invalid origin is refused', () => {
    const project = createDemoProject()
    const alignment = mappedRoadAlignment({
      seed: parts[0],
      context: parts,
      id: 'mapped-1',
      template: DEFAULT_TEMPLATE,
      terrainResolutionM: 1,
      pointBudget: 2000,
    })
    const saved = parseProject(JSON.stringify({ ...project, alignments: [alignment], activeAlignmentId: 'mapped-1' }))
    expect(saved.alignments[0].mappedRoad).toEqual(alignment.mappedRoad)
    const broken = { ...alignment, mappedRoad: { ...alignment.mappedRoad, source: 'guess' } }
    expect(() => parseProject({ ...project, alignments: [broken], activeAlignmentId: 'mapped-1' })).toThrow(
      'mapped road source',
    )
  })

  it('copies as an editable design with no record, and derived roads are not called mapped', () => {
    const alignment = mappedRoadAlignment({
      seed: parts[0],
      context: parts,
      id: 'mapped-1',
      template: DEFAULT_TEMPLATE,
      terrainResolutionM: 1,
      pointBudget: 2000,
    })
    const copy = designFromMappedRoad(alignment, 'copy-1', '#2563eb')
    expect(copy.mappedRoad).toBeUndefined()
    expect(copy.name).toBe('Design on R03890 · A')
    expect(copy.points.map((p) => p.coordinate)).toEqual(alignment.points.map((p) => p.coordinate))
    expect(new Set([...copy.points, ...alignment.points].map((p) => p.id)).size).toBe(alignment.points.length * 2)
    expect(derivedRoadName(alignment)).toBe('R03890 · A alternative')
    expect(derivedRoadName(copy)).toBe(copy.name)
  })
})

describe('reviewing a mapped road against the project limits', () => {
  // A road due north for 400 m: flat for 200 m, then climbing at 20% for 200 m.
  const climb: TerrainSource = {
    elevationAt: (lng, lat) => {
      const n = northOf([lng, lat])
      return 800 + Math.max(0, n - 200) * 0.2
    },
  }
  const straight = mappedRoadAlignment({
    seed: road('s', [at(0, 0), at(0, 400)]),
    context: [],
    id: 'straight',
    template: DEFAULT_TEMPLATE,
    terrainResolutionM: 1,
    pointBudget: 2000,
  })

  it('reads sustained grades over the window, and the length over the grade limit', () => {
    const review = reviewMappedRoad(analyzeRoad(straight, climb, settings), settings, 1)
    expect(review.lengthM).toBeCloseTo(400, 0)
    expect(review.terrainCoveragePercent).toBe(100)
    expect(review.coarseTerrain).toBe(false)
    expect(review.steepest!.gradePercent).toBeCloseTo(20, 0)
    // The window straddles the break near 200 m, so the over-limit run starts a little before it.
    expect(review.overLimitM).toBeGreaterThan(180)
    expect(review.overLimitM).toBeLessThan(215)
    expect(review.overLimitRanges).toHaveLength(1)
    expect(review.overLimitRanges[0].end).toBeCloseTo(400, 0)
    expect(review.tightestBend).toBeNull()
    expect(review.belowMinRadiusM).toBe(0)
  })

  it('reads a straight line at an angle to the meridian as straight, not as a great-circle bend', () => {
    const diagonal = mappedRoadAlignment({
      seed: road('d', [at(0, 0), at(300, 400)]),
      context: [],
      id: 'diagonal',
      template: DEFAULT_TEMPLATE,
      terrainResolutionM: 1,
      pointBudget: 2000,
    })
    expect(reviewMappedRoad(analyzeRoad(diagonal, climb, settings), settings, 1).tightestBend).toBeNull()
  })

  it('reads a sharp mapped corner as the tight bend it implies, and flags coarse terrain', () => {
    const corner = mappedRoadAlignment({
      seed: road('c', [at(0, 0), at(0, 200), at(200, 200)]),
      context: [],
      id: 'corner',
      template: DEFAULT_TEMPLATE,
      terrainResolutionM: 22,
      pointBudget: 2000,
    })
    const review = reviewMappedRoad(analyzeRoad(corner, { elevationAt: () => 800 }, settings), settings, 22)
    expect(review.coarseTerrain).toBe(true)
    expect(review.steepest!.gradePercent).toBeCloseTo(0, 5)
    expect(review.overLimitM).toBe(0)
    // A right angle read across 20 m chords: a circle of roughly 14 m.
    expect(review.tightestBend!.radiusM).toBeGreaterThan(10)
    expect(review.tightestBend!.radiusM).toBeLessThan(settings.minRadius)
    expect(review.tightestBend!.chainage).toBeCloseTo(200, -1)
    expect(review.belowMinRadiusM).toBeGreaterThan(0)
    expect(eastOf(corner.points.at(-1)!.coordinate)).toBeCloseTo(200, 0)
  })

  it('reports missing terrain as missing coverage, never as a grade', () => {
    const half: TerrainSource = { elevationAt: (lng, lat) => (northOf([lng, lat]) < 200 ? 800 : Number.NaN) }
    const review = reviewMappedRoad(analyzeRoad(straight, half, settings), settings, 1)
    expect(review.terrainCoveragePercent).toBeLessThan(60)
    expect(review.terrainCoveragePercent).toBeGreaterThan(40)
    expect(review.steepest!.gradePercent).toBeCloseTo(0, 5)
  })
})

describe('loading the mapped roads in view together', () => {
  const section = (id: string, name: string, coordinates: Coordinate[], sectionId = id) =>
    ({ ...road(id, coordinates, { roadSectionId: sectionId, sourceId: id }), name }) as ContextFeature
  // A 1 km road of 100 vertices, two short roads, and a second part of the first road's section.
  const long = section(
    'long',
    'R1 · A',
    Array.from({ length: 100 }, (_, i) => at((i % 2) * 15, i * 10)),
    'A',
  )
  const longTail = section('long-2', 'R1 · A', [at(0, 990), at(0, 1100)], 'A')
  const short = section('short', 'R1 · B', [at(500, 0), at(500, 200)], 'B')
  const other = section('other', 'R1 · C', [at(5000, 0), at(5000, 200)], 'C')
  const context = [long, longTail, short, other]
  let n = 0
  const newId = () => `load-${++n}`

  it('lists one road per section, and finds those with a part in view', () => {
    const roads = loadableMappedRoads(context)
    expect(roads.map((r) => r.feature.name)).toEqual(['R1 · A', 'R1 · B', 'R1 · C'])
    expect(roads[0].parts).toBe(2)
    const [w, s] = at(-100, -100)
    const [e, nn] = at(800, 300)
    const bounds: [number, number, number, number] = [w, s, e, nn]
    expect(roads.filter((r) => mappedRoadInBounds(r.feature, context, bounds)).map((r) => r.feature.name)).toEqual([
      'R1 · A',
      'R1 · B',
    ])
    // A road in view by its other part only still counts.
    const [w2, s2] = at(-50, 1050)
    const [e2, n2] = at(50, 1150)
    expect(mappedRoadInBounds(long, context, [w2, s2, e2, n2])).toBe(true)
  })

  it('loads each road in its own colour, in the order given', () => {
    const result = loadMappedRoads({
      seeds: [long, short, other],
      context,
      template: DEFAULT_TEMPLATE,
      terrainResolutionM: 1,
      pointBudget: 2000,
      roadBudget: 20,
      newId,
      usedColors: [],
    })
    expect(result.skipped).toEqual([])
    expect(result.alignments.map((a) => a.mappedRoad!.roadName)).toEqual(['R1 · A', 'R1 · B', 'R1 · C'])
    expect(new Set(result.alignments.map((a) => a.color)).size).toBe(3)
    expect(result.alignments[0].mappedRoad!.contextIds).toEqual(['long', 'long-2'])
  })

  it('shares a tight point budget so short roads keep their detail and the long one is thinned to fit', () => {
    const result = loadMappedRoads({
      seeds: [long, short, other],
      context,
      template: DEFAULT_TEMPLATE,
      terrainResolutionM: 1,
      pointBudget: 30,
      roadBudget: 20,
      newId,
      usedColors: [],
    })
    expect(result.alignments).toHaveLength(3)
    const [a, b, c] = result.alignments
    expect(b.points).toHaveLength(2)
    expect(c.points).toHaveLength(2)
    expect(a.points.length).toBeLessThanOrEqual(26)
    expect(a.mappedRoad!.thinningToleranceM).toBeGreaterThan(0.5)
    expect(result.alignments.reduce((sum, x) => sum + x.points.length, 0)).toBeLessThanOrEqual(30)
  })

  it('reports the roads it leaves out when the road limit is reached', () => {
    const result = loadMappedRoads({
      seeds: [long, short, other],
      context,
      template: DEFAULT_TEMPLATE,
      terrainResolutionM: 1,
      pointBudget: 2000,
      roadBudget: 2,
      newId,
      usedColors: [],
    })
    expect(result.alignments).toHaveLength(2)
    expect(result.skipped).toEqual([{ name: 'R1 · A', reason: 'the project holds its maximum of roads' }])
  })

  it('picks colours the project does not already use', () => {
    expect(nextMappedRoadColor([])).toBe(MAPPED_ROAD_PALETTE[0])
    expect(nextMappedRoadColor([MAPPED_ROAD_PALETTE[0].toUpperCase(), MAPPED_ROAD_PALETTE[1]])).toBe(
      MAPPED_ROAD_PALETTE[2],
    )
    expect(MAPPED_ROAD_PALETTE).not.toContain('#d97706')
    expect(MAPPED_ROAD_PALETTE).not.toContain('#dc2626')
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { RouteComparison, RouteComparisonInput, RouteRow } from './routeComparison'
import type { ContextFeature, Coordinate, RoadSettings, TerrainSource } from './types'

// The goal comparison is tested on its own; here it returns one road per goal along its base.
vi.mock('./routeComparison', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./routeComparison')>()
  return {
    ...actual,
    compareRoutes: vi.fn(async (input: RouteComparisonInput): Promise<RouteComparison> => {
      const coordinates = input.base.points.map((p) => p.coordinate)
      const row = (goal: RouteRow['goal'], lengthM: number, maxGradePercent: number, totalCost: number): RouteRow => ({
        id: `${input.base.id}-${goal}`,
        goal,
        label: String(goal),
        color: '#000000',
        alignment: goal === 'current' ? input.base : { ...input.base, id: `${input.base.id}-${goal}` },
        coordinates,
        lengthM,
        maxGradePercent,
        earthworksM3: 0,
        constructionCost: totalCost,
        drainage: null,
        totalCost,
        blockers: [],
        notes: [],
        best: [],
      })
      // The western start gives the cheaper road, the eastern one the gentler road.
      const west = input.base.name.startsWith('FSR west')
      return {
        rows: [
          row('current', 0, 0, 0),
          row('cost', 300, 9, west ? 10_000 : 14_000),
          row('gentle', 320, west ? 7 : 4, west ? 12_000 : 15_000),
        ],
        drainageChecked: false,
        currentLeads: [],
      }
    }),
  }
})

const { accessConnector, accessStarts, compareAccessRoutes, isActiveRoad, pickActiveRoad, reverseAlignment } =
  await import('./accessReview')
const { compareRoutes } = await import('./routeComparison')
const { alignmentLength } = await import('./engine')

const RAD = Math.PI / 180,
  R = 6371008.8
const origin: Coordinate = [-122, 54]
const point = (x: number, y: number): Coordinate => [
  origin[0] + x / (R * RAD * Math.cos(origin[1] * RAD)),
  origin[1] + y / (R * RAD),
]
const xy = (c: Coordinate) => [(c[0] - origin[0]) * R * RAD * Math.cos(origin[1] * RAD), (c[1] - origin[1]) * R * RAD]
const settings: RoadSettings = {
  stationInterval: 10,
  crossSectionHalfWidth: 30,
  maxGradePercent: 15,
  minRadius: 20,
  cutRate: 1,
  fillRate: 1,
  surfacingRate: 1,
  clearingRate: 1,
  shrinkFactor: 1,
}
const flat: TerrainSource = { elevationAt: () => 800 }
const road = (
  id: string,
  x: number,
  patch: Partial<NonNullable<ContextFeature['roadEvidence']>> = {},
): ContextFeature => ({
  id,
  name: `FSR ${id}`,
  kind: 'existing-road',
  geometry: { type: 'LineString', coordinates: [point(x, -50), point(x, 250)] },
  roadEvidence: {
    source: 'user',
    roadClass: 'fsr',
    condition: 'unknown',
    conditionBasis: 'unreviewed',
    reuseAllowed: false,
    ...patch,
  },
})
const block: ContextFeature = {
  id: 'block',
  name: 'Block 7',
  kind: 'harvest',
  geometry: {
    type: 'Polygon',
    coordinates: [[point(0, 0), point(100, 0), point(100, 100), point(0, 100), point(0, 0)]],
  },
}
const context = [road('east', 500), road('west', -300), road('closed', 200, { condition: 'closed' })]
const input = (starts: ReturnType<typeof accessStarts>) => ({
  starts,
  endName: 'Picked end',
  template: { width: 6 } as never,
  terrain: flat,
  resolutionM: 1,
  settings,
  context,
  routeOptions: { alternatives: 1 } as never,
  gridAt: () => ({ toGrid: (c: Coordinate) => c as never, toLonLat: (c: never) => c }) as never,
  options: {
    goals: ['cost', 'gentle'] as const,
    corridorHalfWidthM: 100,
    groundWindowM: 0,
    crossingCost: 0,
    crossDrainCost: 0,
    drainage: {} as never,
  } as never,
})

describe('access starts', () => {
  it('treats closed and retired roads as unusable starts', () => {
    expect(isActiveRoad(road('a', 0))).toBe(true)
    expect(isActiveRoad(road('a', 0, { condition: 'closed' }))).toBe(false)
    expect(isActiveRoad(road('a', 0, { lifecycleStatus: 'RETIRED' }))).toBe(false)
  })

  it('tries the nearest active FSRs from a point, joining each at its footpoint', () => {
    const end = point(50, 50)
    const starts = accessStarts({ kind: 'point', coordinate: end }, context, { kind: 'nearest', count: 3 })
    expect(starts.map((s) => s.target.featureId)).toEqual(['west', 'east'])
    for (const start of starts) expect(start.landing).toEqual(end)
    expect(xy(starts[0].target.coordinate)[0]).toBeCloseTo(-300, 3)
    expect(xy(starts[0].target.coordinate)[1]).toBeCloseTo(50, 3)
  })

  it('lands a block on its edge nearest each FSR', () => {
    const starts = accessStarts({ kind: 'block', block }, context, { kind: 'nearest', count: 2 })
    expect(starts.map((s) => s.target.featureId)).toEqual(['west', 'east'])
    expect(xy(starts[0].landing)[0]).toBeCloseTo(0, 3)
    expect(xy(starts[1].landing)[0]).toBeCloseTo(100, 3)
  })

  it('starts from a picked road where it comes closest to the end, and refuses a closed one', () => {
    const starts = accessStarts({ kind: 'block', block }, context, { kind: 'road', roadId: 'east' })
    expect(starts).toHaveLength(1)
    expect(xy(starts[0].landing)[0]).toBeCloseTo(100, 3)
    expect(xy(starts[0].target.coordinate)[0]).toBeCloseTo(500, 3)
    expect(() => accessStarts({ kind: 'block', block }, context, { kind: 'road', roadId: 'closed' })).toThrow(
      /closed or not active/,
    )
  })

  it('picks the active road nearest a click, within reach', () => {
    expect(pickActiveRoad(point(490, 0), context)?.id).toBe('east')
    expect(pickActiveRoad(point(205, 0), context)?.id).not.toBe('closed')
    expect(pickActiveRoad(point(1500, 0), context)).toBeNull()
  })
})

describe('compareAccessRoutes', () => {
  it('runs each start from its junction to the end and marks the overall leader of each goal', async () => {
    const end = point(50, 50)
    const starts = accessStarts({ kind: 'point', coordinate: end }, context, { kind: 'nearest', count: 2 })
    const review = await compareAccessRoutes(input(starts))
    expect(review.attempts.every((attempt) => !attempt.error)).toBe(true)
    expect(review.rows).toHaveLength(4)
    for (const row of review.rows) {
      expect(row.coordinates[0]).toEqual(row.start.target.coordinate)
      expect(row.coordinates.at(-1)).toEqual(end)
      expect(row.alignment?.name).toMatch(/^FSR (west|east) → Picked end · /)
      // Flat ground: no adverse grade either way.
      expect(row.loadedUphillPercent).toBe(0)
    }
    const leaders = Object.fromEntries(review.rows.flatMap((row) => row.overallBest.map((g) => [g, row.id])))
    expect(leaders.cost).toBe(review.rows.find((r) => r.start.target.featureId === 'west' && r.goal === 'cost')!.id)
    expect(leaders.gentle).toBe(review.rows.find((r) => r.start.target.featureId === 'east' && r.goal === 'gentle')!.id)
  })

  it('reports a start that already meets the end instead of failing the review', async () => {
    const onRoad = point(500, 50)
    const starts = accessStarts({ kind: 'point', coordinate: onRoad }, context, { kind: 'nearest', count: 2 })
    const review = await compareAccessRoutes(input(starts))
    expect(review.attempts.find((a) => a.start.target.featureId === 'east')?.error).toMatch(/already meets/)
    expect(review.rows.every((row) => row.start.target.featureId === 'west')).toBe(true)
  })

  it("keeps a start's own route when it already leads, and says why a start found nothing", async () => {
    const end = point(50, 50)
    const starts = accessStarts({ kind: 'point', coordinate: end }, context, { kind: 'nearest', count: 2 })
    const base = (input: RouteComparisonInput, goal: RouteRow['goal'], alignment: boolean, blockers: string[] = []) =>
      ({
        id: goal,
        goal,
        label: String(goal),
        color: '#000000',
        alignment: alignment ? input.base : null,
        coordinates: input.base.points.map((p) => p.coordinate),
        lengthM: 300,
        maxGradePercent: 6,
        earthworksM3: 0,
        constructionCost: 9000,
        drainage: null,
        totalCost: 9000,
        blockers,
        notes: [],
        best: [],
      }) satisfies RouteRow
    vi.mocked(compareRoutes)
      .mockImplementationOnce(async (input) => ({
        rows: [base(input, 'current', true)],
        drainageChecked: false,
        currentLeads: ['cost', 'gentle'],
      }))
      .mockImplementationOnce(async (input) => ({
        rows: [base(input, 'current', true), base(input, 'cost', false, ['Grade 21% exceeds the 15% limit.'])],
        drainageChecked: false,
        currentLeads: [],
      }))
    const review = await compareAccessRoutes(input(starts))
    expect(review.rows).toHaveLength(1)
    expect(review.rows[0]).toMatchObject({ label: 'Lowest cost · Gentlest', overallBest: ['cost', 'gentle'] })
    expect(review.attempts[1].error).toBe('Grade 21% exceeds the 15% limit.')
  })

  it('orients the junction toward the haul destination and reports the loaded turn', async () => {
    const starts = accessStarts({ kind: 'point', coordinate: point(50, 50) }, [road('west', -300)], {
      kind: 'nearest',
      count: 1,
    })
    // The destination lies north along the FSR, wherever the truck joins it.
    const orientation = {
      departureAt: (c: Coordinate) => (Math.abs(xy(c)[0] + 300) < 5 ? 0 : null),
      rule: { maxTurnDeg: 90, preferredTurnDeg: 45, windowM: 300 },
    }
    const review = await compareAccessRoutes({ ...input(starts), context: [road('west', -300)], orientation })
    expect(review.rows.length).toBeGreaterThan(0)
    for (const row of review.rows) {
      expect(row.junction?.oriented).toBe(true)
      expect(row.junction!.turnDeg!).toBeLessThanOrEqual(90)
      // Moved north, toward the destination, and the road still starts there.
      expect(xy(row.start.target.coordinate)[1]).toBeGreaterThan(50)
      expect(row.coordinates[0]).toEqual(row.start.target.coordinate)
    }
    const plain = await compareAccessRoutes({ ...input(starts), context: [road('west', -300)] })
    expect(plain.rows[0].junction).toBeUndefined()
  })

  it('limits grades by haul direction from the end back to the junction', async () => {
    const starts = accessStarts({ kind: 'point', coordinate: point(50, 50) }, context, { kind: 'nearest', count: 1 })
    const haulGrades = {
      loadedDirection: 'start-to-end' as const,
      maxLoadedUphillPercent: 8,
      maxLoadedDownhillPercent: null,
      maxEmptyUphillPercent: 16,
    }
    await compareAccessRoutes({ ...input(starts), routeOptions: { alternatives: 1, haulGrades } as never })
    const sent = vi.mocked(compareRoutes).mock.calls.at(-1)![0].routeOptions
    expect(sent.haulGrades).toEqual({ ...haulGrades, loadedDirection: 'end-to-start' })
  })

  it('stops when cancelled and refuses an empty start list', async () => {
    const controller = new AbortController()
    controller.abort()
    const starts = accessStarts({ kind: 'point', coordinate: point(50, 50) }, context, { kind: 'nearest', count: 1 })
    await expect(compareAccessRoutes(input(starts), { signal: controller.signal })).rejects.toThrow(/cancelled/)
    await expect(compareAccessRoutes(input([]))).rejects.toThrow(/No active FSR/)
  })
})

describe('road-end connectors', () => {
  const alignment = {
    id: 'road',
    name: 'Spur',
    color: '#000000',
    points: [
      { id: 'a', coordinate: point(0, 0), radiusM: 0 },
      { id: 'b', coordinate: point(100, 0), radiusM: 30 },
      { id: 'c', coordinate: point(100, 100), radiusM: 0 },
    ],
    vertical: [
      { id: 'v0', chainage: 0, elevation: 800, curveLength: 0 },
      { id: 'v1', chainage: 50, elevation: 805, curveLength: 20 },
    ],
    template: { leftWidth: 3, rightWidth: 4, leftCutSlope: 1.5 } as never,
    overrides: [
      { id: 'w', name: 'Turnout', kind: 'turnout', side: 'left', start: 10, end: 40, taper: 5, extraWidth: 3 },
    ],
  } as unknown as import('./types').Alignment

  it('reverses a road: points, profile and widenings from the other end, sides swapped', () => {
    const reversed = reverseAlignment(alignment)
    expect(reversed.points.map((p) => p.id)).toEqual(['c', 'b', 'a'])
    const length = alignmentLength(alignment)
    expect(reversed.vertical.map((v) => v.chainage)).toEqual([length - 50, length])
    expect(reversed.overrides[0]).toMatchObject({ side: 'right' })
    expect(reversed.overrides[0]).toMatchObject({ start: length - 40, end: length - 10 })
    expect(reversed.template).toMatchObject({ leftWidth: 4, rightWidth: 3, rightCutSlope: 1.5 })
    expect(reversed.template).not.toHaveProperty('leftCutSlope')
    expect(reverseAlignment(reversed).points).toEqual(alignment.points)
  })

  it('runs a connector from the road end to the exact junction and records it', () => {
    const origin = { alignmentId: 'road', alignmentName: 'Spur', endpoint: 'end' as const, coordinate: point(100, 100) }
    const target = {
      featureId: 'fsr',
      name: 'FSR west',
      coordinate: point(-300, 100),
      distanceM: 400,
      segmentIndex: 0,
      fraction: 0.5,
    }
    const row = {
      alignment: {
        ...alignment,
        points: [{ id: 'j', coordinate: target.coordinate, radiusM: 0 }, ...alignment.points.slice(1)],
      },
      start: { target, landing: origin.coordinate },
      lengthM: 420,
      totalCost: 12_000,
    } as never
    const road = accessConnector(row, origin, 'Loaded network.', 'chosen')
    expect(road.points[0].coordinate).toEqual(origin.coordinate)
    expect(road.points.at(-1)!.coordinate).toEqual(target.coordinate)
    expect(road.name).toBe('Spur → FSR west · FSR connection')
    expect(road.fsrConnection).toMatchObject({
      targetFeatureId: 'fsr',
      endpoint: 'end',
      preference: 'chosen',
      originAlignmentId: 'road',
      straightLineDistanceM: 400,
      routeLengthM: 420,
    })
  })
})

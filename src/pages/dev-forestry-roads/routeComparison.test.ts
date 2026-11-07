import { describe, expect, it } from 'vitest'
import { safeAnalyzeRoad } from './analysisResult'
import { DEFAULT_DRAINAGE_SETTINGS } from './drainageRun'
import {
  assignGoals,
  compareRoutes,
  crossDrainSites,
  DEFAULT_CROSS_DRAIN_COST,
  flowPenalty,
  simplifyGuide,
  type RouteRow,
} from './routeComparison'
import { DEFAULT_ROUTE_OPTIONS } from './routing'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE, localMetricGrid } from './terrain'
import type { Alignment, Coordinate, TerrainSource } from './types'

const M = 111_194.93
const origin: Coordinate = [-122.8, 53.9]
const cos = Math.cos((origin[1] * Math.PI) / 180)
const at = (x: number, y: number): Coordinate => [origin[0] + x / (M * cos), origin[1] + y / M]
/** A planar 4 % slope falling south with a gully down x = 300. */
const hillside: TerrainSource = {
  elevationAt(lng, lat) {
    const x = (lng - origin[0]) * M * cos,
      y = (lat - origin[1]) * M
    return 700 + 0.04 * y - 3 * Math.exp(-(((x - 300) / 12) ** 2))
  },
}
const road = (points: Coordinate[], name = 'Test road'): Alignment => ({
  id: name,
  name,
  color: '#000000',
  points: points.map((coordinate, i) => ({ id: `p${i}`, coordinate, radiusM: 0 })),
  vertical: [],
  template: { ...DEFAULT_TEMPLATE },
  overrides: [],
})
let n = 0
const input = (base: Alignment, goals: ('cost' | 'shortest' | 'gentle' | 'drainage')[], grade = 12) => {
  const settings = { ...DEFAULT_ROAD_SETTINGS, maxGradePercent: grade }
  return {
    base,
    baseAnalysis: safeAnalyzeRoad(base, hillside, settings),
    terrain: hillside,
    resolutionM: 5,
    settings,
    context: [],
    routeOptions: { ...DEFAULT_ROUTE_OPTIONS },
    gridAt: localMetricGrid,
    id: () => `id-${++n}`,
    options: {
      goals,
      corridorHalfWidthM: 80,
      groundWindowM: 0,
      crossingCost: 8000,
      crossDrainCost: DEFAULT_CROSS_DRAIN_COST,
      drainage: { ...DEFAULT_DRAINAGE_SETTINGS, bufferM: 80 },
    },
  }
}

describe('simplifyGuide', () => {
  it('keeps both ends and the sharpest bends', () => {
    const line = Array.from({ length: 40 }, (_, i) => at(i * 10, i === 20 ? 60 : 0))
    const guide = simplifyGuide(line, 4)
    expect(guide).toHaveLength(4)
    expect(guide[0]).toEqual(line[0])
    expect(guide.at(-1)).toEqual(line.at(-1))
    expect(guide).toContainEqual(line[20])
  })
  it('leaves a short line alone', () => {
    const line = [at(0, 0), at(10, 0)]
    expect(simplifyGuide(line)).toBe(line)
  })
})

describe('crossDrainSites', () => {
  it('counts one site per cluster and skips points a culvert serves', () => {
    expect(
      crossDrainSites([
        { chainage: 300, culvertId: null },
        { chainage: 10, culvertId: null },
        { chainage: 30, culvertId: null },
        { chainage: 100, culvertId: 'c1' },
        { chainage: 310, culvertId: null },
      ]),
    ).toBe(2)
  })
})

describe('flowPenalty', () => {
  it('prices the gully and leaves the open slope free', () => {
    const penalty = flowPenalty(hillside, [at(0, 0), at(600, 0)], localMetricGrid(at(0, 0)), 5, 250, 1)
    expect(penalty(at(300, 0))).toBeGreaterThan(0)
    expect(penalty(at(100, 0))).toBe(0)
  })
})

describe('assignGoals', () => {
  const row = (id: string, goal: RouteRow['goal'], values: Partial<RouteRow>): RouteRow => ({
    id,
    goal,
    label: id,
    color: '#000000',
    alignment: road([at(0, 0), at(100, 0)]),
    coordinates: [],
    lengthM: 1000,
    maxGradePercent: 8,
    earthworksM3: 1000,
    constructionCost: 100,
    drainage: { crossings: 1, crossDrains: 4, redirected: 0, newPondingM2: 0, allowance: 0 },
    totalCost: 100,
    blockers: [],
    notes: [],
    best: [],
    ...values,
  })
  const goals = ['cost', 'shortest', 'gentle', 'drainage'] as const

  it('gives a goal to the road that leads it, not the search that shares its name', () => {
    // The run reported from the training road: the Lowest cost row cost more than Gentlest.
    const rows = [
      row('current', 'current', { totalCost: 156_323, lengthM: 1429, maxGradePercent: 10.2 }),
      row('cost', 'cost', {
        totalCost: 157_933,
        lengthM: 1576,
        maxGradePercent: 8.4,
        drainage: { crossings: 2, crossDrains: 6, redirected: 0, newPondingM2: 0, allowance: 25_000 },
      }),
      row('shortest', 'shortest', {
        totalCost: 151_618,
        lengthM: 1413,
        maxGradePercent: 10.6,
        drainage: { crossings: 3, crossDrains: 7, redirected: 0, newPondingM2: 0, allowance: 34_500 },
      }),
      row('gentle', 'gentle', { totalCost: 147_258, lengthM: 1575, maxGradePercent: 8.4 }),
    ]
    const shown = assignGoals(rows, goals)
    expect(shown.map((item) => item.id)).toEqual(['current', 'shortest', 'gentle'])
    const winner = shown.find((item) => item.id === 'gentle')!
    expect(winner.best).toEqual(['cost', 'gentle', 'drainage'])
    expect(winner.label).toBe('Lowest cost · Gentlest · Fewest drainage issues')
    expect(winner.goal).toBe('cost')
    expect(shown.find((item) => item.id === 'shortest')!.label).toBe('Shortest')
  })

  it('tells you when your road already leads, rather than offering a dearer one as cheapest', () => {
    const shown = assignGoals(
      [row('current', 'current', { totalCost: 90 }), row('cost', 'cost', { totalCost: 120, lengthM: 900 })],
      ['cost', 'shortest'],
    )
    expect(shown[0].best).toEqual(['cost'])
    expect(shown[1].label).toBe('Shortest')
  })

  it('keeps a road that breaks a limit out of every goal, and shows it only if nothing else holds its goal', () => {
    const shown = assignGoals(
      [
        row('current', 'current', { totalCost: 200 }),
        row('short', 'shortest', { totalCost: 50, lengthM: 400, blockers: ['Grade 14% over limit'] }),
        row('gentle', 'gentle', { totalCost: 150, maxGradePercent: 6 }),
      ],
      ['shortest', 'gentle'],
    )
    expect(shown.find((item) => item.id === 'short')).toBeUndefined()
    expect(shown.find((item) => item.id === 'gentle')!.best).toContain('shortest')
    const alone = assignGoals(
      [
        row('current', 'current', { blockers: ['over'] }),
        row('short', 'shortest', { blockers: ['Grade 14% over limit'] }),
      ],
      ['shortest'],
    )
    expect(alone.find((item) => item.id === 'short')!.best).toEqual([])
  })
})

describe('compareRoutes', () => {
  it('reports progress that only moves forward and ends full', async () => {
    const seen: { step: number; total: number }[] = []
    await compareRoutes(input(road([at(0, 0), at(600, 40)]), ['shortest', 'gentle']), {
      onStep: ({ step, total }) => seen.push({ step, total }),
    })
    expect(seen.map((item) => item.step)).toEqual([...seen.map((item) => item.step)].sort((a, b) => a - b))
    expect(seen.at(-1)!.step).toBe(seen.at(-1)!.total)
  }, 30_000)

  // Four designed roads with drainage screens: about 18 s here and three to four times that on CI runners.
  it('prices every goal, measures the cheapest and leaves the road untouched', async () => {
    const base = road([at(0, 0), at(600, 40)])
    const before = structuredClone(base)
    const steps: string[] = []
    const { rows } = await compareRoutes(input(base, ['cost', 'shortest', 'gentle', 'drainage']), {
      onStep: ({ message }) => steps.push(message),
    })
    expect(base).toEqual(before)
    expect(rows[0].goal).toBe('current')
    expect(rows[0].notes.join(' ')).toContain('follows the ground')
    expect(steps.some((step) => /checking drainage/.test(step))).toBe(true)
    const designed = rows.filter((row) => row.goal !== 'current')
    expect(designed.length).toBeGreaterThan(0)
    for (const row of designed) {
      expect(row.alignment!.vertical.length).toBeGreaterThan(1)
      expect(row.maxGradePercent!).toBeLessThanOrEqual(12.0001)
      expect(row.drainage).not.toBeNull()
      expect(row.totalCost).toBe(row.constructionCost! + row.drainage!.allowance)
      expect(row.coordinates.length).toBeGreaterThan(1)
    }
    const cheapest = designed.filter((row) => !row.blockers.length).sort((a, b) => a.totalCost! - b.totalCost!)[0]
    expect(rows.flatMap((row) => row.best)).toContain('cost')
    expect(cheapest.totalCost).toBeLessThanOrEqual(rows.find((row) => row.best.includes('cost'))!.totalCost!)
    expect(new Set(rows.map((row) => JSON.stringify(row.coordinates))).size).toBe(rows.length)
  }, 180_000)

  it('never recommends a road over the grade limit', async () => {
    const base = road([at(0, 0), at(0, 300)], 'Straight up')
    const { rows } = await compareRoutes(input(base, ['shortest'], 2))
    expect(rows[0].blockers.join(' ')).toMatch(/over limit/)
    expect(rows[0].best).toEqual([])
  }, 30_000)

  it('reports a goal it cannot meet without failing the others', async () => {
    const steep: TerrainSource = { elevationAt: (_lng, lat) => 700 + 0.6 * (lat - origin[1]) * M }
    const base = road([at(0, 0), at(0, 200)], 'Cliff')
    const { rows } = await compareRoutes({
      ...input(base, ['shortest']),
      terrain: steep,
      baseAnalysis: safeAnalyzeRoad(base, steep, DEFAULT_ROAD_SETTINGS),
    })
    const failed = rows.find((row) => row.goal === 'shortest')!
    expect(failed.alignment).toBeNull()
    expect(failed.blockers).toHaveLength(1)
    expect(rows[0].alignment).not.toBeNull()
  }, 30_000)

  it('stops when cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      compareRoutes(input(road([at(0, 0), at(600, 40)]), ['shortest']), { signal: controller.signal }),
    ).rejects.toThrow(/cancelled/)
  })
})

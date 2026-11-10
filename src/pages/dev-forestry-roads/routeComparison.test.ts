import { describe, expect, it } from 'vitest'
import { safeAnalyzeRoad } from './analysisResult'
import { DEFAULT_DRAINAGE_SETTINGS } from './drainageRun'
import { createEngineeringDesign } from './engineeringTypes'
import {
  assignGoals,
  compareRoutes,
  comparisonSummary,
  crossDrainSites,
  DEFAULT_CROSS_DRAIN_COST,
  describeCorridorFailure,
  flowPenalty,
  simplifyGuide,
  type RouteRow,
} from './routeComparison'
import { DEFAULT_ROUTE_OPTIONS } from './routing'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE, localMetricGrid } from './terrain'
import type { Alignment, ContextFeature, Coordinate, TerrainSource } from './types'

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
  it('rechecks a blocked conditional area on the fitted current road before assigning goals', async () => {
    const base = road([at(0, 0), at(100, 0)])
    const area: ContextFeature = {
      id: 'condition',
      name: 'Pending site review',
      kind: 'avoid',
      routeCostPerM: 1,
      constraint: { treatment: 'conditional', condition: 'Review the site.' },
      geometry: { type: 'Polygon', coordinates: [[at(40, -10), at(60, -10), at(60, 10), at(40, 10), at(40, -10)]] },
    }
    const { rows } = await compareRoutes({ ...input(base, []), context: [area] })
    expect(rows[0].blockers.join(' ')).toContain('Pending site review: conditional review pending')
    expect(rows[0].best).toEqual([])
  })

  it('counts curves tighter than the minimum radius against a road, once per curve', async () => {
    const base = road([at(0, 0), at(150, 0), at(150, 150), at(300, 150)])
    base.points[1].radiusM = 12
    base.points[2].radiusM = 40
    const { rows } = await compareRoutes(input(base, []))
    expect(rows[0].blockers).toContain('1 curve tighter than the 25 m minimum radius')
    expect(rows[0].best).toEqual([])
  })

  it('keeps an unpriced crossing explicit in the final road comparison', async () => {
    const base = road([at(0, 0), at(100, 0)])
    const stream: ContextFeature = {
      id: 'crossing',
      name: 'Unpriced creek',
      kind: 'stream',
      geometry: { type: 'LineString', coordinates: [at(50, -30), at(50, 30)] },
      riparianPolicy: { treatment: 'additional-cost', costPerM: 0 },
    }
    const original = input(base, [])
    const { rows } = await compareRoutes({
      ...original,
      context: [stream],
      baseAnalysis: safeAnalyzeRoad(base, hillside, original.settings, [stream]),
    })
    expect(rows[0].blockers.join(' ')).toContain('Crossing estimates are incomplete')
    expect(rows[0].best).toEqual([])
  })

  it('keeps a road whose material plan is not solved from leading on a cost that leaves haul out', async () => {
    const plane: TerrainSource = { elevationAt: (_lng, lat) => 700 + 0.04 * (lat - origin[1]) * M }
    // Thirteen priced sites are one more than the economic allocation takes, so the plan stays unsolved.
    const withSites = (priced: number): Alignment => {
      const engineering = createEngineeringDesign()
      Object.assign(engineering.haul, {
        enabled: true,
        allocation: 'economic',
        freeHaulDistanceM: 0,
        overhaulDistanceM: 150,
        freeHaulRate: 5,
        overhaulRate: 5,
        endHaulRate: 5,
      })
      engineering.sites = Array.from({ length: 14 }, (_, i) => ({
        id: `s${i}`,
        name: `Site ${i}`,
        kind: i % 2 ? ('borrow' as const) : ('waste' as const),
        chainage: 10 + i * 20,
        accessDistanceM: 50,
        capacityM3: null,
        unitRate: 6,
        fixedCost: i < priced ? 100 : 0,
      }))
      return {
        ...road([at(0, 0), at(300, 60)]),
        // 1 m into the hill at the start and 1 m above it at the end: cut, then fill.
        vertical: [
          { id: 'v0', chainage: 0, elevation: 699, curveLength: 0 },
          { id: 'v1', chainage: 305.94, elevation: 703.4, curveLength: 0 },
        ],
        engineering,
      }
    }
    const compared = async (priced: number) => {
      const base = withSites(priced)
      const original = input(base, [])
      const baseAnalysis = safeAnalyzeRoad(base, plane, original.settings)
      const { rows } = await compareRoutes({ ...original, terrain: plane, baseAnalysis })
      return { row: rows[0], status: baseAnalysis.engineering!.haul.optimizationStatus }
    }
    const solved = await compared(12),
      unsolved = await compared(13)
    expect([solved.status, unsolved.status]).toEqual(['optimal', 'unsolved'])
    expect(solved.row.blockers).toEqual([])
    // The same road reads cheaper with its plan unsolved: haul, borrow and waste are all missing.
    expect(unsolved.row.totalCost!).toBeLessThan(solved.row.totalCost! - 1000)
    expect(unsolved.row.blockers).toEqual([
      'Material plan not solved: this cost leaves out haul, borrow and waste. Fix the plan under Engineering before comparing costs.',
    ])
    const rival: RouteRow = { ...solved.row, id: 'rival', goal: 'cost', best: [] }
    assignGoals([unsolved.row, rival], ['cost'])
    expect(unsolved.row.best).toEqual([])
    expect(rival.best).toEqual(['cost'])
  }, 60_000)

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

  it('gives the reason the goal itself failed, not that of the search that got nearest the end', async () => {
    // A hill between the ends, and a 12 m spike 1 m across under the road's end: too narrow for the
    // 12 m ground trend the searches read, but the profile's tied end stands on it.
    const spiked: TerrainSource = {
      elevationAt(lng, lat) {
        const x = (lng - origin[0]) * M * cos,
          y = (lat - origin[1]) * M
        return (
          700 +
          0.01 * x +
          0.02 * y +
          40 * Math.exp(-((x - 300) ** 2 + (y - 10) ** 2) / 80 ** 2) +
          12 * Math.exp(-((x - 600) ** 2 + y ** 2) / 0.5 ** 2)
        )
      },
    }
    const base = road([at(0, 0), at(600, 0)])
    const original = input(base, ['shortest'], 8)
    // The even search runs out of this budget; the leaning search then finds a line, and no profile fits it.
    const comparison = await compareRoutes({
      ...original,
      terrain: spiked,
      resolutionM: 1,
      baseAnalysis: safeAnalyzeRoad(base, spiked, original.settings),
      options: {
        ...original.options,
        corridorHalfWidthM: 180,
        groundWindowM: 12,
        searchBudget: { maxStates: 1500 },
      },
    })
    const failed = comparison.rows.find((row) => row.goal === 'shortest')!
    expect(failed.alignment).toBeNull()
    expect(failed.blockers[0]).toMatch(/^A line was found, but no profile fits it\. No profile meets the limits/)
    expect(failed.blockers[0]).not.toMatch(/ran out of its search budget/)
  }, 120_000)

  it('says no route was found, and why, when no search could run', async () => {
    const plane: TerrainSource = { elevationAt: (_lng, lat) => 700 + 0.04 * (lat - origin[1]) * M }
    const base = road([at(0, 0), at(400, 0)])
    const run = async (grade: number, minRadius: number) => {
      const original = input(base, ['cost', 'shortest', 'gentle'], grade)
      const settings = { ...original.settings, minRadius }
      return compareRoutes({
        ...original,
        settings,
        terrain: plane,
        baseAnalysis: safeAnalyzeRoad(base, plane, settings),
      })
    }
    // A 35 % grade limit is outside what the corridor search takes: every search stops before it starts.
    const refused = await run(35, 35)
    const reason = 'The corridor search takes a grade limit of 1–30%. Set the grade limit in that range to search.'
    expect(refused.rows.filter((row) => !row.alignment).map((row) => row.blockers)).toEqual([
      [reason],
      [reason],
      [reason],
    ])
    // The current road holds the goals only because nothing was set against it, and the notice says so.
    expect(comparisonSummary(refused)).toEqual({ found: false, message: `No route found. ${reason}` })
    // No minimum radius is not a reason to refuse: the searches run at the tightest curve they draw.
    const unchecked = await run(12, 0)
    expect(unchecked.rows.some((row) => row.goal !== 'current' && row.alignment)).toBe(true)
    expect(comparisonSummary(unchecked).found).toBe(true)
  }, 120_000)

  it('says which limit stopped a goal, where the search got to and that nothing was found', async () => {
    // 60 % straight up the fall line: every line has to traverse, and none can turn back toward the end.
    const steep: TerrainSource = { elevationAt: (_lng, lat) => 700 + 0.6 * (lat - origin[1]) * M }
    const base = road([at(0, 0), at(0, 200)], 'Cliff')
    const comparison = await compareRoutes({
      ...input(base, ['shortest', 'gentle']),
      terrain: steep,
      baseAnalysis: safeAnalyzeRoad(base, steep, DEFAULT_ROAD_SETTINGS),
    })
    const failed = comparison.rows.filter((row) => row.goal !== 'current')
    expect(failed.map((row) => row.alignment)).toEqual([null, null])
    for (const row of failed)
      expect(row.blockers[0]).toMatch(
        /^No line within 12% and a 25 m radius reaches the end: the search made no headway toward the end.* \d+% of the lines it tried were stopped by ground steeper than the 12% grade limit\. Raise the grade limit, move the road's start onto gentler ground, or widen the corridor under Search settings\. A coarser search of a wider area on a grid found no line either\.$/,
      )
    // Never "ready" when nothing usable came back.
    const summary = comparisonSummary(comparison)
    expect(summary.found).toBe(false)
    expect(summary.message).toMatch(/^No route found\. No line within 12%/)
  }, 60_000)

  it('searches again leaning toward the end when the even search runs out of budget', async () => {
    // A knoll on the direct line, too steep to cross: the road has to go round it.
    const knoll: TerrainSource = {
      elevationAt(lng, lat) {
        const x = (lng - origin[0]) * M * cos,
          y = (lat - origin[1]) * M
        return 700 + 40 * Math.exp(-((x - 150) ** 2 + y ** 2) / 60 ** 2)
      },
    }
    const base = road([at(0, 0), at(300, 0)], 'Over the knoll')
    const settings = { ...DEFAULT_ROAD_SETTINGS, maxGradePercent: 8, minRadius: 35 }
    const details: string[] = []
    const original = input(base, ['shortest'])
    const comparison = await compareRoutes(
      {
        ...original,
        terrain: knoll,
        settings,
        baseAnalysis: safeAnalyzeRoad(base, knoll, settings),
        options: { ...original.options, corridorHalfWidthM: 180, searchBudget: { maxStates: 3000 } },
      },
      { onStep: ({ detail }) => detail && details.push(detail) },
    )
    const found = comparison.rows.find((row) => row.goal !== 'current')!
    expect(found.alignment).not.toBeNull()
    expect(found.lengthM!).toBeGreaterThan(330)
    expect(found.notes.join(' ')).toMatch(/quicker search that leans toward the end/)
    // The progress line said what it was doing, and how far through each search's own budget it was.
    expect(details.some((text) => /^searching within 180 m of your road( · \d+% of its budget)?$/.test(text))).toBe(
      true,
    )
    expect(details.some((text) => /^searching within 180 m of your road, leaning toward the end/.test(text))).toBe(true)
    expect(details.some((text) => /^fitting a profile · \d+%$/.test(text))).toBe(true)
    expect(comparisonSummary(comparison).found).toBe(true)
  }, 60_000)

  it('stops when cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      compareRoutes(input(road([at(0, 0), at(600, 40)]), ['shortest']), { signal: controller.signal }),
    ).rejects.toThrow(/cancelled/)
  })

  it('stops inside a search or a profile fit, not only between steps', async () => {
    for (const stage of [/^searching within/, /^fitting a profile/]) {
      const controller = new AbortController()
      let after = 0,
        cancelledAt = 0
      const run = compareRoutes(input(road([at(0, 0), at(600, 40)]), ['shortest', 'gentle']), {
        signal: controller.signal,
        onStep: ({ detail }) => {
          if (controller.signal.aborted) after++
          else if (detail && stage.test(detail)) {
            cancelledAt = performance.now()
            controller.abort()
          }
        },
      })
      await expect(run).rejects.toMatchObject({ name: 'AbortError' })
      expect(cancelledAt).toBeGreaterThan(0)
      expect(after).toBe(0)
      expect(performance.now() - cancelledAt).toBeLessThan(1000)
    }
  }, 60_000)
})

describe('describeCorridorFailure', () => {
  const limits = { maxGradePercent: 18, minRadiusM: 35, halfWidthM: 180 }
  const failure = (patch: Partial<Parameters<typeof describeCorridorFailure>[0]>) => ({
    reason: 'budget' as const,
    directM: 1100,
    closestRemainingM: 109,
    closest: at(990, 0),
    stopped: { grade: 790, terrain: 60, exclusion: 0, corridor: 150 },
    ...patch,
  })
  it('names the limit that stopped most lines and the end the trouble is near', () => {
    expect(describeCorridorFailure(failure({}), limits)).toBe(
      "No line within 18% and a 35 m radius reaches the end: the search got to within 109 m of the end, then ran out of its search budget. 79% of the lines it tried were stopped by ground steeper than the 18% grade limit. Raise the grade limit, move the road's end onto gentler ground, or widen the corridor under Search settings.",
    )
  })
  it('says when terrain gaps or blocked areas, not grade, are in the way', () => {
    expect(
      describeCorridorFailure(
        failure({
          reason: 'no-candidate',
          closestRemainingM: 560,
          stopped: { grade: 1, terrain: 9, exclusion: 0, corridor: 0 },
        }),
        limits,
      ),
    ).toMatch(
      /got to within 560 m of the end and had no line left to try\. 90% of the lines it tried were stopped by gaps in the terrain\. Move the ends onto mapped ground, or add terrain between them\.$/,
    )
    expect(
      describeCorridorFailure(failure({ stopped: { grade: 0, terrain: 0, exclusion: 5, corridor: 0 } }), limits),
    ).toMatch(
      /100% of the lines it tried were stopped by blocked areas\. Change the treatment of the areas between the ends/,
    )
    expect(
      describeCorridorFailure(failure({ stopped: { grade: 0, terrain: 0, exclusion: 0, corridor: 5 } }), limits),
    ).toMatch(/stopped by the edge of the ±180 m corridor\. Widen the corridor under Search settings\.$/)
  })
})

describe('comparisonSummary', () => {
  const row = (goal: RouteRow['goal'], values: Partial<RouteRow> = {}): RouteRow => ({
    id: goal,
    goal,
    label: goal === 'current' ? 'Your road' : goal === 'cost' ? 'Lowest cost' : 'Shortest',
    color: '#000000',
    alignment: road([at(0, 0), at(100, 0)]),
    coordinates: [],
    lengthM: 1000,
    maxGradePercent: 8,
    earthworksM3: 1000,
    constructionCost: 100,
    drainage: null,
    totalCost: 100,
    blockers: [],
    notes: [],
    best: [],
    ...values,
  })
  const summary = (rows: RouteRow[]) => comparisonSummary({ rows, drainageChecked: true, currentLeads: [] })
  it('counts the roads that came back and the ones with a flag', () => {
    expect(summary([row('current'), row('cost'), row('shortest')])).toEqual({
      found: true,
      message: '2 routes ready. Click one to open its profile and sections.',
    })
    expect(
      summary([row('current'), row('cost'), row('shortest', { blockers: ['98% of sections complete'] })]).message,
    ).toBe('2 routes found; 1 has a limit broken or a check to make, shown on its row. Click one to open it.')
    expect(summary([row('current'), row('cost', { blockers: ['3 sharp corners'] })]).message).toBe(
      '1 route found, with a limit broken or a check to make: its row says which. Click one to open it.',
    )
  })
  it('names the goals left without a road, and fails outright when there is none at all', () => {
    const none = { alignment: null, blockers: ['No line within 12% reaches the end.'] }
    expect(summary([row('current'), row('cost'), row('shortest', none)]).message).toBe(
      '1 route ready. Click one to open its profile and sections. No route for shortest.',
    )
    expect(summary([row('current'), row('cost', none), row('shortest', none)])).toEqual({
      found: false,
      message: 'No route found. No line within 12% reaches the end.',
    })
    expect(summary([row('current', { best: ['cost'] })])).toEqual({
      found: true,
      message: 'No new road beat yours on these goals.',
    })
  })
})

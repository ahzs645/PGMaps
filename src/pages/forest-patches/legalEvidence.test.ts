import { describe, expect, it } from 'vitest'
import { assess } from '../../../packages/legal-rules/engine/evaluate'
import { spatialFacts } from '../../../packages/legal-rules/engine/spatialFacts'
import { parsePack, type FactSet, type Scalar } from '../../../packages/legal-rules/src/contract'
import board from '../../../packages/legal-rules/observations/fpb-irc-235.json'
import pack120 from '../../../packages/legal-rules/packs/bc-pgtsa-planning-1.2.0.json'
import pack130 from '../../../packages/legal-rules/packs/bc-pgtsa-planning-1.3.0.json'
import { samplePlan, periodYears } from '../block-planning/plan'
import { analyzePlan, scheduleProject } from '../block-planning/planAnalysis'
import { measuredTrend, trendMeasurements } from '../block-planning/review/pathways'
import { analyze, type Period } from './analysis'
import {
  classMovements,
  distributionDistance,
  distributionTrend,
  patchFacts,
  trendEvidence,
  trendsAway,
} from './legalEvidence'
import { bins } from './project'

const current = parsePack(pack130)
const previous = parsePack(pack120)

/** A period of the given class shares (percent of young forest) against the given targets. */
function period(percent: (number | null)[], target = [20, 10, 30, 40], extra: Partial<Period> = {}): Period {
  return {
    scenario: 'proposed',
    year: 2031,
    totalHa: 100,
    unclassifiedHa: 0,
    patches: 4,
    classes: bins.map((bin, i) => ({
      bin,
      ha: percent[i] ?? 0,
      percent: percent[i],
      target: target[i],
      gapPoints: percent[i] === null ? null : percent[i]! - target[i],
    })),
    ...extra,
  }
}

/** The 1.3.0 trend rule's status for a measured growth, with the order recorded as applying. */
function trendStatus(growth: Scalar | null) {
  const facts: FactSet = {
    format: 'pgmaps-legal-facts/v1',
    pack: current.id,
    version: current.version,
    source: 'test',
    facts: [
      { id: 'applicable', value: true },
      { id: 'patch-distance-growth', value: growth },
    ],
  }
  return assess('2026-11-17', [current], [facts]).releases[0].findings.find((f) => f.rule === 'distribution-trend')!
    .status
}

describe('the distribution’s distance from Table 7', () => {
  it('adds the four classes’ distances, in points of young forest', () => {
    expect(
      distributionDistance([
        { percent: 10, target: 5 },
        { percent: 5, target: 5 },
        { percent: 45, target: 20 },
        { percent: 40, target: 70 },
      ]),
    ).toBe(60)
  })

  it('raises when the distance grows', () => {
    const trend = distributionTrend(period([20, 10, 30, 40]), period([30, 10, 30, 30]))!
    expect(trend).toMatchObject({ before: 0, after: 20, growth: 20 })
    expect(trendStatus(trend.growth)).toBe('review_required')
  })

  it('does not raise when the distribution moves toward the targets', () => {
    const trend = distributionTrend(period([40, 10, 30, 20]), period([30, 10, 30, 30]))!
    expect(trend.growth).toBe(-20)
    expect(trendStatus(trend.growth)).toBe('condition_not_triggered')
  })

  it('does not raise when the distance is unchanged, within the tolerance of unrounded shares', () => {
    const trend = distributionTrend(period([30, 10, 30, 30]), period([10, 10, 30, 50]))!
    expect(trend.growth).toBe(0)
    expect(trendStatus(trend.growth)).toBe('condition_not_triggered')
    const tiny = distributionTrend(period([30, 10, 30, 30]), period([30 + 1e-10, 10, 30, 30 - 1e-10]))!
    expect(tiny.growth).toBe(0)
  })

  it('counts a class with a target of 0 at its whole share', () => {
    const targets = [0, 10, 40, 50]
    const toward = distributionTrend(period([10, 10, 30, 50], targets), period([5, 10, 35, 50], targets))!
    expect(toward).toMatchObject({ before: 20, after: 10, growth: -10 })
    const away = distributionTrend(period([5, 10, 35, 50], targets), period([15, 10, 25, 50], targets))!
    expect(away.growth).toBe(20)
    expect(trendStatus(away.growth)).toBe('review_required')
  })

  it('is unknown, never a pass, when a distribution is missing or incomplete', () => {
    const full = period([20, 10, 30, 40])
    const cases = [
      distributionTrend(undefined, full),
      distributionTrend(full, undefined),
      distributionTrend(period([null, null, null, null], undefined, { totalHa: 0 }), full),
      distributionTrend(full, period([20, 10, 30, 40], undefined, { unclassifiedHa: 3 })),
      distributionTrend(full, period([20, 10, null, 40])),
      distributionTrend(full, period([20, 10, 30, 30])),
      distributionTrend(full, period([20, 10, 30, 40], [25, 10, 25, 40])),
    ]
    for (const trend of cases) {
      expect(trend).toBeNull()
      expect(trendStatus(trend?.growth ?? null)).toBe('missing_evidence')
    }
    expect(trendEvidence(null, 2026, 2031)).toMatch(/unavailable for 2026–2031/)
  })

  it('reads the distribution as a whole where one class moving away raised the earlier releases', () => {
    // The two large classes close 15 points on their targets while the smallest moves 5 away.
    const earlier = period([20, 10, 20, 50]),
      later = period([25, 10, 25, 40])
    const movements = classMovements(earlier, later)!
    expect(movements).toEqual([-5, 0, 5, 10])
    expect(trendsAway(movements)).toBe(true)
    const trend = distributionTrend(earlier, later)!
    expect(trend.growth).toBe(-10)
    expect(trendStatus(trend.growth)).toBe('condition_not_triggered')
    // The class that moved away stays in the evidence.
    expect(trend.movements).toEqual(movements)
    expect(trendEvidence(trend, 2026, 2031)).toBe(
      'Summed distance from Table 7: 20 points in 2026, 10 in 2031 (−10, closer to the targets). ' +
        'Classes that moved farther from their targets (points): <50 ha 5.',
    )
  })
})

describe('the Board’s published 2015 and 2018 distributions (FPB/IRC/235, Appendix 4)', () => {
  const rows = board.youngForest.distributions.filter((r) => r.target && r.observed2015 && r.observed2018)
  const distance = (observed: number[], target: number[]) =>
    distributionDistance(observed.map((percent, i) => ({ percent, target: target[i] })))

  it('raise the units whose summed distance grew, not every unit where a class moved away', () => {
    const raised: string[] = []
    const classOnly: string[] = []
    for (const row of rows) {
      const growth = distance(row.observed2018!, row.target!) - distance(row.observed2015!, row.target!)
      const name = `${row.district} · ${row.ndu}`
      if (trendStatus(growth) === 'review_required') raised.push(name)
      else if (row.target!.some((t, i) => Math.abs(row.observed2018![i] - t) > Math.abs(row.observed2015![i] - t)))
        classOnly.push(name)
    }
    expect(raised).toEqual([
      'Fort St. James · Moist Interior - Mountain',
      'Fort St. James · Moist Interior - Plateau',
      'Fort St. James · Omineca - Mountain',
      'Prince George · Moist Interior - Mountain',
      'Prince George · Moist Interior - Plateau',
      'Prince George · Wet Trench - Valley',
      'Vanderhoof · Moist Interior - Mountain',
      'Vanderhoof · Moist Interior - Plateau',
    ])
    // Closer as a whole (11.5 and 47.5 points) though a class moved away: release 1.2.0 raised both.
    expect(classOnly).toEqual(['Prince George · McGregor Plateau', 'Prince George · Wet Trench - Mountain'])
  })
})

describe('the forest patches page and the planner’s landscape review', () => {
  const plan = samplePlan()
  const years = periodYears(plan.area.startYear)

  it('measure the same growth for every schedule and period, and raise the same finding', () => {
    const growths: (Scalar | null)[] = []
    for (const schedule of plan.schedules) {
      const project = scheduleProject(plan, schedule.id)
      for (const year of years.slice(1)) {
        const reviewPlan = { ...plan, reviewSchedule: schedule.id, landscape: { ...plan.landscape, trendYear: year } }
        const planner = analyzePlan(reviewPlan, { schedule: schedule.id, year })
        const run = planner.runs.find((r) => r.schedule === schedule.id)!
        const page = patchFacts(project, analyze(project, year, 'proposed'), year, 'proposed')
        expect(page).toMatchObject({ pack: current.id, version: current.version })
        const growth = page.facts.find((f) => f.id === 'patch-distance-growth')!.value
        expect(run.distanceGrowth[years.indexOf(year)]).toBe(growth)

        // The review's measurement, bound through the release, is the page's figure.
        const trend = measuredTrend(reviewPlan, planner)!
        const bound = spatialFacts(current, trendMeasurements(reviewPlan, trend, schedule.name))
        expect(bound).toHaveLength(1)
        expect(bound[0]).toMatchObject({ id: 'patch-distance-growth', value: growth })
        expect(bound[0].evidence).toContain(page.facts[0].evidence!.split(' Model comparison')[0])
        expect(trendStatus(bound[0].value)).toBe(trendStatus(growth))
        growths.push(growth)
      }
    }
    expect(growths).toHaveLength(plan.schedules.length * (years.length - 1))
    // The sample raises, holds and leaves intervals unknown, so the agreement is not vacuous.
    expect(growths.some((g) => typeof g === 'number' && g > 0)).toBe(true)
    expect(growths).toContain(0)
    expect(growths).toContain(null)
  }, 60_000)

  it('keep handing a review saved on 1.2.0 its own class test', () => {
    const reviewPlan = { ...plan, landscape: { ...plan.landscape, trendYear: 2031 } }
    const result = analyzePlan(reviewPlan, { schedule: plan.reviewSchedule, year: 2031 })
    const trend = measuredTrend(reviewPlan, result)!
    const bound = spatialFacts(previous, trendMeasurements(reviewPlan, trend, 'Proposed'))
    expect(bound).toEqual([expect.objectContaining({ id: 'patch-class-away', value: trend.movedAway })])
    expect(typeof trend.movedAway).toBe('boolean')
  })
})

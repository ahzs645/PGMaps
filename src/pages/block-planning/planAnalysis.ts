/**
 * Runs the Prince George patch calculation (`forest-patches/analysis.ts`,
 * method `pg-2005-buffer-v1`) for every schedule of a plan.
 *
 * The engine compares a shared `reference` set of footprints with one schedule's own. A plan's
 * baseline is that reference set and each schedule's harvests are its own, so a schedule compiles
 * to one engine project (`scheduleProject`) and the engine runs unchanged, however many schedules
 * the plan has. Footprint ids are namespaced (`d:` baseline, `b:` block) so a patch's contributors
 * read back as the names the planner gave (`footprintName`).
 *
 * DOM- and network-free.
 */
import type { Feature, MultiPolygon } from 'geojson'
import { periodCalculator, type Period } from '../forest-patches/analysis'
import { classMovements, trendsAway } from '../forest-patches/legalEvidence'
import type { Footprint, Project } from '../forest-patches/project'
import { baselineFootprintId, blockFootprintId, periodYears, scheduleHarvests, type Plan } from './plan'

/** Whether the area is set well enough for the Objective C calculation to run. */
export function landscapeReady(plan: Plan): string | null {
  if (!plan.area.district) return 'Choose the historic forest district.'
  if (!plan.area.ndu) return 'Choose the natural disturbance sub-unit.'
  return null
}

export function scheduleProject(plan: Plan, scheduleId: string): Project {
  const baseline: Footprint[] = plan.baseline.map((d) => ({
    type: 'Feature',
    geometry: d.geometry,
    properties: {
      id: baselineFootprintId(d.id),
      scenario: 'reference',
      year: d.year,
      yearBasis: d.yearBasis,
      source: d.source,
    },
  }))
  const harvests: Footprint[] = scheduleHarvests(plan, scheduleId).map(({ block, shape, year }) => ({
    type: 'Feature',
    geometry: shape.geometry,
    properties: {
      id: blockFootprintId(block.id),
      scenario: 'proposed',
      year,
      yearBasis: 'plan-entry',
      source: block.source,
    },
  }))
  return {
    format: 'pgmaps-patches-v1',
    type: 'FeatureCollection',
    district: plan.area.district,
    ndu: plan.area.ndu,
    source: plan.area.source.trim() || 'Inventory source not stated.',
    startYear: plan.area.startYear,
    features: [...baseline, ...harvests],
  }
}

export interface ScheduleRun {
  schedule: string
  periods: Period[]
  /** Per period after the first: whether any class moved away from its target. Null when unknown. */
  movedAway: (boolean | null)[]
}

export interface PlanAnalysis {
  runs: ScheduleRun[]
  /** The patches of the schedule and year on the map. */
  shown: { schedule: string; year: number; patches: Feature<MultiPolygon>[] }
}

/** Every schedule's periods, and the patch geometry of the one shown. Throws a readable error. */
export function analyzePlan(plan: Plan, shown: { schedule: string; year: number }): PlanAnalysis {
  const missing = landscapeReady(plan)
  if (missing) throw Error(missing)
  const years = periodYears(plan.area.startYear)
  if (!years.includes(shown.year)) throw Error('The year shown is not one of the projection periods.')
  const patches: Feature<MultiPolygon>[] = []
  const runs = plan.schedules.map((schedule) => {
    const period = periodCalculator(scheduleProject(plan, schedule.id), shown.year, 'proposed')
    const periods = years.map((year) =>
      period(year, 'proposed', undefined, schedule.id === shown.schedule && year === shown.year ? patches : undefined),
    )
    return {
      schedule: schedule.id,
      periods,
      movedAway: periods.map((p, i) => (i === 0 ? null : trendsAway(classMovements(periods[i - 1], p)))),
    }
  })
  return { runs, shown: { ...shown, patches } }
}

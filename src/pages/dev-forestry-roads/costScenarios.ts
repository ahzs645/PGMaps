/**
 * Low, base and high cost scenarios. Each driver is a stated pair of multipliers on the inputs it
 * names (rates, rock depth, the reusable share of cut, haul distance), and a case is a copy of the
 * road and the settings with every driver set to its low or its high multiplier, analysed in full
 * by the same engine (as `terrainCases.ts` does for terrain). Neither case is ever applied to the
 * project, and nothing here is a probability: low and high are the estimator's stated bounds, not a
 * confidence interval. Surfacing thickness is not a driver: it is a template change, compared with
 * the template tools. Free of DOM and network access.
 */
import { object, optional, text } from '@/lib/jsonGuards'
import type { Alignment, RoadSettings } from './types'
import type { AlignmentEngineering } from './engineeringTypes'

export type ScenarioDriverId =
  | 'excavation-rate'
  | 'rock-rate'
  | 'rock-depth'
  | 'reusable-cut'
  | 'haul-rate'
  | 'haul-distance'
  | 'surfacing-rate'
  | 'structures'
  | 'clearing-rate'

export interface ScenarioRange {
  low: number
  high: number
}

export interface CostScenarioSettings {
  drivers: Partial<Record<ScenarioDriverId, ScenarioRange>>
  /** What the bounds rest on: "Rock depth ±30 % from two test pits". */
  note?: string
}

export const SCENARIO_DRIVERS: Record<ScenarioDriverId, { label: string; scales: string; suggested: ScenarioRange }> = {
  'excavation-rate': {
    label: 'Excavation productivity',
    scales: 'The cut rate and every non-rock material’s excavation rate.',
    suggested: { low: 0.9, high: 1.25 },
  },
  'rock-rate': {
    label: 'Rock excavation cost',
    scales: 'Rock materials’ excavation, shallow rock and overbreak rates.',
    suggested: { low: 0.85, high: 1.5 },
  },
  'rock-depth': {
    label: 'Depth to rock',
    scales: 'The top depth of every rock horizon. Below 1 brings rock nearer the surface, so more of the cut is rock.',
    suggested: { low: 1.3, high: 0.7 },
  },
  'reusable-cut': {
    label: 'Suitable share of cut',
    scales:
      'Each material’s reusable fraction (capped at 1) and the default reusable-cut factor; less reuse means more borrow and waste.',
    suggested: { low: 1.1, high: 0.8 },
  },
  'haul-rate': {
    label: 'Truck cycle cost',
    scales: 'Every haul and loading rate, and the surfacing source’s haul and loading.',
    suggested: { low: 0.9, high: 1.3 },
  },
  'haul-distance': {
    label: 'Haul distance',
    scales: 'Each material site’s access distance and the surfacing source’s one-way haul.',
    suggested: { low: 0.8, high: 1.5 },
  },
  'surfacing-rate': {
    label: 'Aggregate supply',
    scales: 'The surfacing rate and the surfacing source’s acquisition, processing and placement.',
    suggested: { low: 0.9, high: 1.3 },
  },
  structures: {
    label: 'Crossing structures',
    scales: 'Each culvert’s installed cost per metre and fixed cost.',
    suggested: { low: 0.9, high: 1.5 },
  },
  'clearing-rate': { label: 'Clearing', scales: 'The clearing rate.', suggested: { low: 0.9, high: 1.2 } },
}

export const SCENARIO_MULTIPLIER = { min: 0.1, max: 5 } as const

export type ScenarioCaseId = 'low' | 'high'

export interface ScenarioCaseInput {
  settings: RoadSettings
  alignment: Alignment
  /** The drivers that changed something, in words: "Excavation productivity × 0.9". */
  applied: string[]
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** A copy of the road and settings with every driver at its low or high multiplier. */
export function scenarioCase(
  settings: RoadSettings,
  alignment: Alignment,
  scenario: CostScenarioSettings,
  which: ScenarioCaseId,
): ScenarioCaseInput {
  let s = { ...settings }
  let e: AlignmentEngineering | undefined = alignment.engineering
  const applied: string[] = []
  const rock = new Set((e?.materials ?? []).filter((m) => m.rock).map((m) => m.id))
  for (const [id, range] of Object.entries(scenario.drivers) as [ScenarioDriverId, ScenarioRange][]) {
    const m = range[which]
    if (m === 1) continue
    applied.push(`${SCENARIO_DRIVERS[id].label} × ${m}`)
    switch (id) {
      case 'excavation-rate':
        s = { ...s, cutRate: s.cutRate * m }
        if (e) e = { ...e, materials: e.materials.map((x) => (x.rock ? x : { ...x, cutRate: x.cutRate * m })) }
        break
      case 'rock-rate':
        if (e)
          e = {
            ...e,
            materials: e.materials.map((x) =>
              x.rock
                ? {
                    ...x,
                    cutRate: x.cutRate * m,
                    ...(x.shallowCutRate === undefined ? {} : { shallowCutRate: x.shallowCutRate * m }),
                    ...(x.overbreakRate === undefined ? {} : { overbreakRate: x.overbreakRate * m }),
                  }
                : x,
            ),
          }
        break
      case 'rock-depth':
        if (e)
          e = {
            ...e,
            strata: e.strata.map((stratum) => {
              if (!rock.has(stratum.materialId)) return stratum
              const top = stratum.topDepthM * m
              return {
                ...stratum,
                topDepthM: stratum.bottomDepthM === null ? top : Math.min(top, stratum.bottomDepthM * 0.999),
              }
            }),
          }
        break
      case 'reusable-cut':
        s = { ...s, shrinkFactor: clamp(s.shrinkFactor * m, 0.1, 2) }
        if (e)
          e = {
            ...e,
            materials: e.materials.map((x) =>
              x.purpose === 'stripping' ? x : { ...x, reusableFraction: clamp(x.reusableFraction * m, 0, 1) },
            ),
          }
        break
      case 'haul-rate':
        if (e)
          e = {
            ...e,
            haul: {
              ...e.haul,
              freeHaulRate: e.haul.freeHaulRate * m,
              overhaulRate: e.haul.overhaulRate * m,
              endHaulRate: e.haul.endHaulRate * m,
              freeHaulLoadingRate: e.haul.freeHaulLoadingRate * m,
              overhaulLoadingRate: e.haul.overhaulLoadingRate * m,
              endHaulLoadingRate: e.haul.endHaulLoadingRate * m,
            },
            ...(e.surfacingSupply
              ? {
                  surfacingSupply: {
                    ...e.surfacingSupply,
                    haulRate: e.surfacingSupply.haulRate * m,
                    loadingRate: e.surfacingSupply.loadingRate * m,
                  },
                }
              : {}),
          }
        break
      case 'haul-distance':
        if (e)
          e = {
            ...e,
            sites: e.sites.map((site) => ({ ...site, accessDistanceM: clamp(site.accessDistanceM * m, 0, 100000) })),
            ...(e.surfacingSupply
              ? {
                  surfacingSupply: {
                    ...e.surfacingSupply,
                    haulDistanceKm: clamp(e.surfacingSupply.haulDistanceKm * m, 0, 1000),
                  },
                }
              : {}),
          }
        break
      case 'surfacing-rate':
        s = { ...s, surfacingRate: s.surfacingRate * m }
        if (e?.surfacingSupply)
          e = {
            ...e,
            surfacingSupply: {
              ...e.surfacingSupply,
              acquisitionRate: e.surfacingSupply.acquisitionRate * m,
              processingRate: e.surfacingSupply.processingRate * m,
              placementRate: e.surfacingSupply.placementRate * m,
            },
          }
        break
      case 'structures':
        if (e)
          e = {
            ...e,
            culverts: e.culverts.map((c) => ({ ...c, unitCost: c.unitCost * m, fixedCost: c.fixedCost * m })),
          }
        break
      case 'clearing-rate':
        s = { ...s, clearingRate: s.clearingRate * m }
        break
    }
  }
  return { settings: s, alignment: e === alignment.engineering ? alignment : { ...alignment, engineering: e }, applied }
}

/** Drivers that need inputs the road does not have, so their multipliers change nothing. */
export function idleDrivers(alignment: Alignment, scenario: CostScenarioSettings): ScenarioDriverId[] {
  const e = alignment.engineering
  const has: Record<ScenarioDriverId, boolean> = {
    'excavation-rate': true,
    'rock-rate': !!e?.materials.some((m) => m.rock),
    'rock-depth': !!e?.strata.some((s) => e.materials.find((m) => m.id === s.materialId)?.rock),
    'reusable-cut': true,
    'haul-rate': !!e?.haul.enabled || !!e?.surfacingSupply?.enabled,
    'haul-distance': !!e?.sites.length || !!e?.surfacingSupply?.enabled,
    'surfacing-rate': true,
    structures: !!e?.culverts.length,
    'clearing-rate': true,
  }
  return (Object.keys(scenario.drivers) as ScenarioDriverId[]).filter((id) => !has[id])
}

export function scenarioProblem(range: ScenarioRange): string | null {
  for (const value of [range.low, range.high])
    if (!Number.isFinite(value) || value < SCENARIO_MULTIPLIER.min || value > SCENARIO_MULTIPLIER.max)
      return `Multipliers run from ${SCENARIO_MULTIPLIER.min} to ${SCENARIO_MULTIPLIER.max}.`
  return null
}

export function parseCostScenarios(raw: unknown): CostScenarioSettings | undefined {
  if (raw === undefined) return undefined
  const r = object(raw, 'Cost scenarios')
  const d = object(r.drivers, 'Cost scenario drivers')
  const drivers: CostScenarioSettings['drivers'] = {}
  for (const key of Object.keys(d)) {
    if (!(key in SCENARIO_DRIVERS)) throw Error(`Cost scenario driver ${key} is not one PGMaps runs.`)
    const range = object(d[key], `Cost scenario ${key}`)
    const parsed = { low: range.low as number, high: range.high as number }
    const problem = scenarioProblem(parsed)
    if (problem) throw Error(`Cost scenario ${key}: ${problem}`)
    drivers[key as ScenarioDriverId] = parsed
  }
  const note = optional(r, 'note', (value) => text(value, 'Cost scenario note', 500))
  return { drivers, ...(note ? { note } : {}) }
}

import type { Analysis } from './analysis'
import { classMovements, trendsAway } from './legalEvidence'
import { bins, table, type Scenario } from './project'

export function explainPatches(result: Analysis, year: number, scenario: Scenario) {
  const selected = result.timeline.find((r) => r.year === year && r.scenario === scenario)!
  const previous = result.timeline.find((r) => r.year === year - 5 && r.scenario === scenario)
  const movements = classMovements(previous, selected)
  const classes = selected.classes.map((c) => {
    const i = bins.indexOf(c.bin)
    const patches = result.patchMap.features
      .filter((f) => f.properties?.bin === c.bin)
      .map((f) => ({
        id: Number(f.properties!.id),
        footprintIds: f.properties!.footprintIds as string[],
        youngHa: Number(f.properties!.youngHa),
        sharePoints: (100 * Number(f.properties!.youngHa)) / selected.totalHa,
      }))
      .sort((a, b) => b.youngHa - a.youngHa || a.id - b.id)
    return {
      ...c,
      label: table.labels[i],
      priorGapPoints: previous?.classes.find((prior) => prior.bin === c.bin)?.gapPoints ?? null,
      movement: movements?.[i] ?? null,
      patches,
    }
  })
  return { classes, totalHa: selected.totalHa, unclassifiedHa: selected.unclassifiedHa, screen: trendsAway(movements) }
}

export type FieldComparison = {
  id: string
  source: string
  earliest: number
  latest: number
  baselineYear: number
  baselineScreen: boolean | null
  cases: {
    from: number
    through: number
    screen: boolean | null
    maxTrendShift: number | null
    maxClassShift: number | null
    mostAffected: string | null
  }[]
  minFlipYears: number | null
  canFlip: boolean
  canLoseEvidence: boolean
}

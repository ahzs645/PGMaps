import type { FactSet } from '../../../packages/legal-rules/src/contract'
import pgPack from '../../../packages/legal-rules/packs/bc-pgtsa-biodiversity.json'
import type { Analysis } from './analysis'
import { bins, movementTowardTarget, type Project, type Scenario } from './project'

type Period = Analysis['timeline'][number]

// A worker period contains unrounded shares. Missing or mismatched classes make the interval unknown.
function completePeriod(period: Period | undefined): period is Period {
  return (
    !!period &&
    Number.isFinite(period.totalHa) &&
    period.totalHa > 0 &&
    period.unclassifiedHa === 0 &&
    period.classes.length === bins.length &&
    period.classes.every(
      ({ percent }) => percent !== null && Number.isFinite(percent) && percent >= 0 && percent <= 100 + 1e-8,
    ) &&
    Math.abs(period.classes.reduce((sum, c) => sum + (c.percent ?? 0), 0) - 100) <= 1e-8
  )
}

export function classMovements(earlier?: Period, later?: Period): number[] | null {
  if (completePeriod(earlier) && completePeriod(later)) {
    const changes = bins.map((bin) => {
      const before = earlier.classes.find((c) => c.bin === bin)
      const after = later.classes.find((c) => c.bin === bin)
      if (
        !before ||
        !after ||
        before.target !== after.target ||
        !Number.isFinite(after.target) ||
        after.target < 0 ||
        after.target > 100
      )
        return null
      return movementTowardTarget(before.percent, after.percent, after.target)
    })
    if (changes.every((v) => v !== null)) return changes
  }
  return null
}
export function trendsAway(changes: number[] | null) {
  return changes === null ? null : changes.some((v) => v < -1e-8)
}

// Adapter for calculated facts only. The reviewer supplies applicability and D.5 findings.
export function patchFacts(project: Project, result: Analysis, year: number, scenario: Scenario): FactSet {
  const get = (y: number) => result.timeline.find((r) => r.year === y && r.scenario === scenario)
  const earlier = get(year - 5),
    later = get(year)
  const movedAway = trendsAway(classMovements(earlier, later))
  const defaults = project.features.filter(
    (f) =>
      f.properties.yearBasis === 'editor-default' &&
      (f.properties.scenario === 'reference' || f.properties.scenario === scenario),
  ).length
  const evidence =
    movedAway === null
      ? 'Comparable complete distributions are unavailable for this interval.'
      : 'Model comparison of the four class percentages. Inventory and reporting coverage are user-supplied.'
  return {
    format: 'pgmaps-legal-facts/v1',
    pack: pgPack.id,
    version: pgPack.version,
    source: [project.source, project.district, project.ndu, scenario, year - 5 + '–' + year, 'pg-2005-buffer-v1'].join(
      ' · ',
    ),
    facts: [
      {
        id: 'patch-class-away',
        value: movedAway,
        evidence: defaults
          ? evidence + ' Footprints using an assumed date because the source year was missing: ' + defaults + '.'
          : evidence,
      },
    ],
  }
}

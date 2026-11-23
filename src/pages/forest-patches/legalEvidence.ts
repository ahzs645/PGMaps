import type { FactSet } from '../../../packages/legal-rules/src/contract'
import pgPack from '../../../packages/legal-rules/packs/bc-pgtsa-biodiversity.json'
import type { Analysis } from './analysis'
import { movementTowardTarget, type Project, type Scenario } from './project'

// Adapter for calculated facts only. The reviewer supplies applicability and D.5 findings.
export function patchFacts(project: Project, result: Analysis, year: number, scenario: Scenario): FactSet {
  const get = (y: number) => result.timeline.find((r) => r.year === y && r.scenario === scenario)
  const earlier = get(year - 5),
    later = get(year)
  const set: FactSet = {
    format: 'pgmaps-legal-facts/v1',
    pack: pgPack.id,
    version: pgPack.version,
    source: [project.source, project.district, project.ndu, scenario, year - 5 + '–' + year, 'pg-2005-buffer-v1'].join(
      ' · ',
    ),
    facts: [],
  }
  if (!earlier || !later || earlier.unclassifiedHa || later.unclassifiedHa || !earlier.totalHa || !later.totalHa) {
    set.facts.push({
      id: 'patch-class-away',
      value: null,
      evidence: 'Comparable complete distributions are unavailable for this interval.',
    })
    return set
  }
  const movedAway = later.classes.some(
    (c, i) => (movementTowardTarget(earlier.classes[i].percent, c.percent, c.target) ?? 0) < -1e-8,
  )
  set.facts.push({
    id: 'patch-class-away',
    value: movedAway,
    evidence: 'Model comparison of the four class percentages. Inventory and reporting coverage are user-supplied.',
  })
  return set
}

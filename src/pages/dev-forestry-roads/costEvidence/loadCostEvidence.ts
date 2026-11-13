import type {
  CostEvidenceCatalogue,
  EvidenceLead,
  EvidenceRecord,
  EvidenceSource,
  FuelAdjustment,
  WorkedEstimate,
} from './costEvidence'

/**
 * A quote route from the October 2026 review that the November research did not revisit. Kept so
 * the Kootenay-Boundary gap still names it.
 */
const CARRIED_LEADS: EvidenceLead[] = [
  {
    regionId: 'kootenay-boundary',
    party: 'MacKay Contracting',
    place: 'Cranbrook / East Kootenay',
    products: ['crushed aggregates', 'rip rap', 'custom crushing', 'material supply and delivery'],
    status: 'Quote required; no public numeric rate identified.',
    url: 'https://mackaybuilds.com/divisions/aggregates-materials/',
    checked: '2026-10-26',
  },
]

let pending: Promise<CostEvidenceCatalogue> | null = null

/**
 * The catalogue, loaded once and only when the references dialog asks for it, so its records stay
 * out of the designer's first load. The files are generated and checked by `costEvidence.test.ts`.
 */
export function loadCostEvidence(): Promise<CostEvidenceCatalogue> {
  pending ??= Promise.all([
    import('./bcLocal.generated.json'),
    import('./bcProjects.generated.json'),
    import('./external.generated.json'),
  ]).then(([local, projects, external]) => assembleCostEvidence(local.default, projects.default, external.default))
  pending.catch(() => {
    pending = null
  })
  return pending
}

export function assembleCostEvidence(
  local: { checked: string; records: unknown[]; leads: unknown[]; fuel: FuelAdjustment },
  projects: { checked: string; limits: string[]; records: unknown[] },
  external: { checked: string; records: unknown[]; sources: unknown[]; estimates: unknown[] },
): CostEvidenceCatalogue {
  return {
    checked: [local.checked, projects.checked, external.checked].sort().at(-1)!,
    records: [...local.records, ...projects.records, ...external.records] as EvidenceRecord[],
    leads: [...(local.leads as EvidenceLead[]), ...CARRIED_LEADS],
    sources: external.sources as EvidenceSource[],
    estimates: external.estimates as WorkedEstimate[],
    fuel: local.fuel,
    projectLimits: projects.limits,
  }
}

export type CcissLayerKind = 'suitability' | 'bgc'
export type CcissPeriod =
  | '1961_1990'
  | '1961_1990_ref'
  | '2001_2020_obs'
  | '2021_2040'
  | '2041_2060'
  | '2061_2080'
  | '2081_2100'
export type CcissEdatope = 'B2' | 'C4' | 'D6'
export type CcissStatistic = 'NewFeas' | 'MeanChange'

export const CCISS_PERIODS: { id: CcissPeriod; label: string }[] = [
  { id: '1961_1990', label: 'Reference, modelled (1961–1990)' },
  { id: '1961_1990_ref', label: 'Reference, mapped (1961–1990)' },
  { id: '2001_2020_obs', label: 'Observed (2001–2020)' },
  { id: '2021_2040', label: 'Future (2021–2040)' },
  { id: '2041_2060', label: 'Future (2041–2060)' },
  { id: '2061_2080', label: 'Future (2061–2080)' },
  { id: '2081_2100', label: 'Future (2081–2100)' },
]

export const CCISS_SPECIES = [
  'Pl',
  'Sx',
  'Fd',
  'Cw',
  'Hw',
  'Py',
  'Bl',
  'At',
  'Ac',
  'Ep',
  'Yc',
  'Pw',
  'Ss',
  'Bg',
  'Lw',
  'Mb',
] as const

export const CCISS_GCMS = ['Ensemble', 'ACCESS-ESM1-5', 'EC-Earth3', 'GISS-E2-1-G', 'MIROC6', 'MPI-ESM1-2-HR'] as const

export type CcissLayerSelection = {
  kind: CcissLayerKind
  period: CcissPeriod
  edatope: CcissEdatope
  species: (typeof CCISS_SPECIES)[number]
  statistic: CcissStatistic
  gcm: (typeof CCISS_GCMS)[number]
  byZone: boolean
}

export interface CcissMapOption<T extends string = string> {
  id: T
  label: string
}
export type CcissPeriodPhase = 'reference' | 'observed' | 'projection'
export interface CcissMapCatalogue {
  kinds: readonly CcissMapOption<CcissLayerKind>[]
  periods: readonly (CcissMapOption<CcissPeriod> & { phase: CcissPeriodPhase })[]
  species: readonly CcissMapOption<CcissLayerSelection['species']>[]
  edatopes: readonly CcissMapOption<CcissEdatope>[]
  gcms: readonly CcissMapOption<CcissLayerSelection['gcm']>[]
  statistics: readonly (CcissMapOption<CcissStatistic> & { phases: readonly CcissPeriodPhase[] })[]
}

/** The published map catalogue is separate from the legacy analysis manifest.
 * Adding a published product changes its catalogue, not source-selection logic.
 * A listed image choice is not a promise that a numeric download exists.
 */
export const CCISS_MAP_CATALOG: CcissMapCatalogue = {
  kinds: [
    { id: 'suitability', label: 'Tree species suitability' },
    { id: 'bgc', label: 'BGC classification' },
  ],
  periods: CCISS_PERIODS.map((period) => ({
    ...period,
    phase: period.id.startsWith('1961') ? 'reference' : period.id === '2001_2020_obs' ? 'observed' : 'projection',
  })),
  species: CCISS_SPECIES.map((id) => ({ id, label: id })),
  edatopes: [
    { id: 'B2', label: 'B2 · Poor / subxeric' },
    { id: 'C4', label: 'C4 · Medium / mesic' },
    { id: 'D6', label: 'D6 · Rich / hygric' },
  ],
  gcms: CCISS_GCMS.map((id) => ({ id, label: id })),
  statistics: [
    { id: 'NewFeas', label: 'Projected suitability', phases: ['reference', 'observed', 'projection'] },
    { id: 'MeanChange', label: 'Suitability change', phases: ['observed', 'projection'] },
  ],
}

export const DEFAULT_CCISS_SELECTION: CcissLayerSelection = {
  kind: 'suitability',
  period: '1961_1990_ref',
  edatope: 'C4',
  species: 'Pl',
  statistic: 'NewFeas',
  gcm: 'Ensemble',
  byZone: false,
}

/** Only expose controls that affect the selected published map product. */
export function ccissMapOptions(selection: CcissLayerSelection, catalogue = CCISS_MAP_CATALOG) {
  const phase = catalogue.periods.find((period) => period.id === selection.period)?.phase
  const suitability = selection.kind === 'suitability'
  return {
    kinds: catalogue.kinds,
    periods: catalogue.periods,
    species: suitability ? catalogue.species : [],
    edatopes: suitability ? catalogue.edatopes : [],
    statistics: suitability ? catalogue.statistics.filter((stat) => phase && stat.phases.includes(phase)) : [],
    gcms: !suitability && phase === 'projection' ? catalogue.gcms : [],
    // Upstream Spatial only publishes zone grouping for historical products
    // and the future ensemble, not individual future model maps.
    showZoneGrouping:
      !suitability &&
      (phase === 'reference' || phase === 'observed' || (phase === 'projection' && selection.gcm === 'Ensemble')),
  }
}

/** Validate URL/saved choices against their catalogue while preserving unrelated
 * choices for a later switch back to that map kind.
 */
export function normalizeCcissSelection(
  selection: Partial<CcissLayerSelection>,
  catalogue = CCISS_MAP_CATALOG,
): CcissLayerSelection {
  function choose<T extends string>(value: T | undefined, options: readonly CcissMapOption<T>[], fallback: T): T {
    if (!options.length) throw new Error('A CCISS map catalogue option list is empty.')
    return (
      options.find((option) => option.id === value)?.id ??
      options.find((option) => option.id === fallback)?.id ??
      options[0].id
    )
  }
  const normalized: CcissLayerSelection = {
    kind: choose(selection.kind, catalogue.kinds, DEFAULT_CCISS_SELECTION.kind),
    period: choose(selection.period, catalogue.periods, DEFAULT_CCISS_SELECTION.period),
    species: choose(selection.species, catalogue.species, DEFAULT_CCISS_SELECTION.species),
    edatope: choose(selection.edatope, catalogue.edatopes, DEFAULT_CCISS_SELECTION.edatope),
    statistic: choose(selection.statistic, catalogue.statistics, DEFAULT_CCISS_SELECTION.statistic),
    gcm: choose(selection.gcm, catalogue.gcms, DEFAULT_CCISS_SELECTION.gcm),
    byZone: selection.byZone === true,
  }
  const options = ccissMapOptions(normalized, catalogue)
  const availableStatistics = options.statistics
  if (availableStatistics.length && !availableStatistics.some((stat) => stat.id === normalized.statistic))
    normalized.statistic = availableStatistics[0].id
  if (!options.showZoneGrouping) normalized.byZone = false
  return normalized
}

export function ccissTileId(selection: CcissLayerSelection): string {
  if (selection.kind === 'bgc') {
    const gcm = selection.period.startsWith('20') && selection.period !== '2001_2020_obs' ? selection.gcm : 'Ensemble'
    const byZone = selection.byZone && ccissMapOptions(selection).showZoneGrouping
    return `bgc_${gcm}_${selection.period}_${byZone ? 'Zone' : 'Subzone'}`
  }
  const statistic = selection.period.startsWith('1961_1990') ? 'NewFeas' : selection.statistic
  return `${statistic}_${selection.period}_${selection.edatope}_${selection.species}`
}

export function ccissTileUrl(tileId: string): string {
  return `https://tileserver.thebeczone.ca/data/${tileId}/{z}/{x}/{y}.webp`
}

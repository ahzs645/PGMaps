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

export function ccissTileId(selection: CcissLayerSelection): string {
  if (selection.kind === 'bgc') {
    const gcm = selection.period.startsWith('20') && selection.period !== '2001_2020_obs' ? selection.gcm : 'Ensemble'
    return `bgc_${gcm}_${selection.period}_${selection.byZone ? 'Zone' : 'Subzone'}`
  }
  const statistic = selection.period.startsWith('1961_1990') ? 'NewFeas' : selection.statistic
  return `${statistic}_${selection.period}_${selection.edatope}_${selection.species}`
}

export function ccissTileUrl(tileId: string): string {
  return `https://tileserver.thebeczone.ca/data/${tileId}/{z}/{x}/{y}.webp`
}

export function hasComparableNumericSuitability(selection: CcissLayerSelection): boolean {
  return (
    selection.kind === 'suitability' &&
    selection.period === '1961_1990_ref' &&
    selection.edatope === 'C4' &&
    selection.species === 'Pl'
  )
}

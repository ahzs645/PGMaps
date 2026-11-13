/**
 * What each published appraisal allowance covers, read from the 2026 manuals on 12 November 2026.
 * An allowance that covers an activity must not be added to a rate that prices it again, and an
 * activity an allowance leaves out is not free: it needs its own rate or estimate.
 * Free of DOM and network access.
 */

export interface AllowanceScope {
  id: string
  title: string
  unit: string
  locator: string
  covers: readonly string[]
  /** Left out of the allowance. Not zero cost. */
  excludes: readonly string[]
  /** Priced by another allowance or an engineered estimate. */
  separate: readonly string[]
  note?: string
}

export const INTERIOR_ALLOWANCE_SCOPES: readonly AllowanceScope[] = [
  {
    id: 'interior-subgrade',
    title: 'Interior subgrade',
    unit: 'CAD/km',
    locator: 'IAM 4.3.2.1, p. 4-11',
    covers: [
      'Clearing, grubbing and stripping',
      'Debris disposal and stump removal',
      'Ditches and turnouts',
      'Pipe culverts under 950 mm and log culverts up to 3.4 m span',
      'Low-bedding of subgrade equipment',
    ],
    excludes: ['Right-of-way felling and logging', 'Rock drilling, explosives, loading and blasting', 'Landings'],
    separate: ['Stabilizing material', 'Culverts of 950 mm and larger', 'Bridges'],
    note: 'Road group 1 follows the Coast bank-height procedure instead.',
  },
  {
    id: 'interior-stabilization',
    title: 'Interior stabilizing material',
    unit: 'CAD/km',
    locator: 'IAM 4.3.4 and 4.3.4.1, pp. 4-20 to 4-22',
    covers: [
      'Borrow pit preparation',
      'Loosening or pushing material',
      'Loading trucks and hauling',
      'Spreading and compacting',
    ],
    excludes: ['Rock drilling, explosives, loading and blasting in borrow pits', 'Any snow and ice road'],
    separate: ['An access road to the borrow pit'],
    note: 'For imported gravel or broken rock where the subgrade and ditch material is not enough. The published haul-distance coefficient is zero, which does not make a real haul free.',
  },
  {
    id: 'interior-culverts',
    title: 'Interior culverts, 950 mm to 1.8 m',
    unit: 'CAD per culvert (Part A) or CAD/m (Part B)',
    locator: 'IAM 4.3.3.1 and Table 4-3, pp. 4-17 to 4-18',
    covers: ['Part A: supply, transport and installation, as one installed total by length and diameter'],
    excludes: ['Part B covers supply and delivery only'],
    separate: ['Over 1.8 m diameter or 20 m length: engineered estimate'],
    note: 'Use Part A or Part B, never both, and do not multiply Part A by length. The table is not interpolated.',
  },
]

export const COAST_ALLOWANCE_SCOPES: readonly AllowanceScope[] = [
  {
    id: 'coast-road',
    title: 'Coast tabular road',
    unit: 'CAD/km',
    locator: 'CAM 5.3.3.1 and Table 5-1, pp. 5-14 to 5-16',
    covers: [
      'Clearing, grubbing and stripping',
      'Stump removal and incidental log decking',
      'Ditch, landing and turnout construction',
      'The selected category’s rock work and ballast, as Table 5-1 names it',
    ],
    excludes: ['Bridge length, which is left out of the section length'],
    separate: [
      'Culverts and bridges, added to the tabular road cost',
      'Trucking additional stabilizing material more than 3.2 km: engineered estimate',
    ],
    note: 'A bundled allowance. Its scope is wider than Interior subgrade, so the two figures are not comparable.',
  },
  {
    id: 'coast-culverts',
    title: 'Coast culverts, 0.3 m to 1.8 m',
    unit: 'CAD per lineal metre',
    locator: 'CAM 5.3.3.2.3 and Table 5-4, p. 5-21',
    covers: ['Column A: culvert materials and installation'],
    excludes: ['Column B covers culvert materials only'],
    separate: ['Wood culverts up to 3.4 m span: $2,700 each'],
    note: 'Use Column A or Column B, never both.',
  },
]

/** IAM Table 4-3, selected diameters. Part A is the installed total for a 12 m culvert. */
export const INTERIOR_CULVERT_ROWS = [
  { diameterM: 0.3, installed12mCad: 963, supplyPerMCad: 57, inSubgrade: true },
  { diameterM: 0.6, installed12mCad: 2027, supplyPerMCad: 114, inSubgrade: true },
  { diameterM: 0.95, installed12mCad: 4405, supplyPerMCad: 232, inSubgrade: false },
  { diameterM: 1.2, installed12mCad: 6728, supplyPerMCad: 347, inSubgrade: false },
  { diameterM: 1.6, installed12mCad: 11594, supplyPerMCad: 588, inSubgrade: false },
  { diameterM: 1.8, installed12mCad: 14525, supplyPerMCad: 734, inSubgrade: false },
] as const

/** CAM Table 5-4, selected diameters, CAD per lineal metre. */
export const COAST_CULVERT_ROWS = [
  { diameterM: 0.3, installedPerMCad: 148, materialsPerMCad: 104 },
  { diameterM: 0.6, installedPerMCad: 173, materialsPerMCad: 130 },
  { diameterM: 0.9, installedPerMCad: 270, materialsPerMCad: 203 },
  { diameterM: 1.2, installedPerMCad: 440, materialsPerMCad: 322 },
  { diameterM: 1.6, installedPerMCad: 779, materialsPerMCad: 554 },
  { diameterM: 1.8, installedPerMCad: 996, materialsPerMCad: 701 },
] as const

/**
 * IAM Appendix I, selected rows, CAD/hour on the 2024–2025 Blue Book basis. Equipment rates are
 * all-found: the operator is in the rate, so adding a wage again counts it twice.
 */
export const INTERIOR_EQUIPMENT_RATES = [
  { item: 'Forestry excavator, class 2', ratePerHour: 238.95, fuel: 'off-road' },
  { item: 'Crawler tractor, class 4', ratePerHour: 270.75, fuel: 'off-road' },
  { item: 'Front-end loader for gravel, class 10', ratePerHour: 268.75, fuel: 'off-road' },
  { item: 'Grader, class 6', ratePerHour: 214.85, fuel: 'on-road' },
  { item: 'Gravel dump truck, 14 yd³, standard haul', ratePerHour: 170.45, fuel: 'on-road' },
] as const

/** IAM Appendix I wage rates effective 15 June 2024, with the 50% payroll loading included. */
export const INTERIOR_LABOUR_RATES = [
  { role: 'Labourer, group I', ratePerHour: 52.7 },
  { role: 'Roadman, group II', ratePerHour: 53.11 },
  { role: 'Crib or culvert maker, powderman, group VII', ratePerHour: 55.77 },
  { role: 'Bridgeman, tradesman', ratePerHour: 71.2 },
] as const

/**
 * Two fuel references that answer different questions. The appraisal allowance belongs to the
 * Interior manual's engineered estimates; the monthly adjustment (`CostEvidenceCatalogue.fuel`)
 * belongs to the transportation Hired Equipment Program. Neither goes on top of a rate that
 * already includes fuel.
 */
export const INTERIOR_APPRAISAL_FUEL = {
  onRoadPerHour: 10.23,
  offRoadPerHour: 23.86,
  locator: 'IAM Appendix I, p. A-8',
} as const

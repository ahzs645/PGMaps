/**
 * Independent appraisal cross-check, in CAD/km at the published cost base.
 * These equations never replace quantity-based rates or enter the project total.
 * Source: 2026 Interior Appraisal Manual, 4.3.2.2–4.3.2.4 and 4.3.6(8).
 */
export const BC_INTERIOR_COST_SOURCE = {
  title: '2026 BC Interior Appraisal Manual',
  url: 'https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/forestry/timber-pricing/interior-timber-pricing/interior-appraisal-manual/iam_2026_master_b.pdf',
  effectiveDate: '2026-07-01',
  costBaseYear: 2024,
  reviewedDate: '2026-10-26',
  sections: '4.3.2.2–4.3.2.4, Table 4-2; 4.3.6(8)',
} as const

export interface InteriorRoadGroup {
  id: number
  label: string
  boundaries: string
  method: 'coast-bank-height' | 'interior-equation'
}

/** Table 4-2. These are appraisal areas, not natural-resource region tariffs. */
export const INTERIOR_ROAD_GROUPS: readonly InteriorRoadGroup[] = [
  {
    id: 1,
    label: '1 · Kalum / Nass / specified coastal blocks',
    boundaries: 'Cascadia TSA blocks 9–11; Kalum TSA and TFLs 1, 41; Nass TSA; Pacific TSA blocks 28A, 28B.',
    method: 'coast-bank-height',
  },
  {
    id: 2,
    label: '2 · Skeena Stikine',
    boundaries: 'Skeena Stikine district.',
    method: 'interior-equation',
  },
  {
    id: 3,
    label: '3 · Nadina',
    boundaries: 'Nadina district.',
    method: 'interior-equation',
  },
  {
    id: 4,
    label: '4 · Cariboo supply blocks / Prince George G–H',
    boundaries:
      'Williams Lake TSA supply blocks J–L; Prince George TSA G–H and TFLs 30, 53; Quesnel TSA E–I and TFL 52 (except block B); 100 Mile House TSA G–H; Cascadia TSA blocks 5–7.',
    method: 'interior-equation',
  },
  {
    id: 5,
    label: '5 · Prince George C–F and I / TFL 52 block B',
    boundaries: 'Prince George TSA supply blocks C–F and I; TFL 52 block B (former TFL 5); Cascadia TSA block 8.',
    method: 'interior-equation',
  },
  {
    id: 6,
    label: '6 · Mackenzie G–P / Prince George A–B',
    boundaries: 'Mackenzie TSA supply blocks G–P; Prince George TSA A–B.',
    method: 'interior-equation',
  },
  {
    id: 7,
    label: '7 · Peace / Fort Nelson / Mackenzie A–F',
    boundaries: 'Peace and Fort Nelson districts; Mackenzie TSA supply blocks A–F.',
    method: 'interior-equation',
  },
  {
    id: 8,
    label: '8 · Williams Lake A–I / Quesnel A–D / 100 Mile A–F',
    boundaries: 'Williams Lake TSA supply blocks A–I; Quesnel TSA A–D; 100 Mile House TSA A–F.',
    method: 'interior-equation',
  },
  {
    id: 9,
    label: '9 · Cascades / Okanagan 1–5 / Kamloops 2–4',
    boundaries: 'Cascades district; TFLs 15, 49, 59; Okanagan TSA supply blocks 1–5; Kamloops TSA 2–4 and TFL 35.',
    method: 'interior-equation',
  },
  {
    id: 10,
    label: '10 · Rocky Mountain / Boundary',
    boundaries: 'Rocky Mountain district; Boundary TSA and TFL 8.',
    method: 'interior-equation',
  },
  {
    id: 11,
    label: '11 · Arrow / Golden / Kootenay Lake / Revelstoke',
    boundaries:
      'Arrow TSA and TFLs 23, 3, 33; Golden TSA; Kootenay Lake TSA; Revelstoke TSA and TFLs 55, 56; Okanagan TSA supply blocks 8–9; Cascadia TSA blocks 1–4.',
    method: 'interior-equation',
  },
  {
    id: 12,
    label: '12 · Robson Valley / specified mountain supply blocks',
    boundaries: 'Kamloops TSA supply block 1 and TFL 18; Williams Lake TSA M–N; Okanagan TSA 6–7; Robson Valley TSA.',
    method: 'interior-equation',
  },
]

export type InteriorBecZone = 'ESSF' | 'ICH' | 'CWH' | 'SBS' | 'MS' | 'other'
export type InteriorRoadType = 'long-term' | 'short-term' | 'snow-ice'
export type InteriorSoilMoisture = 'wet' | 'moist' | 'dry'

export interface InteriorBenchmarkInput {
  roadGroup: number | null
  /** Representative uphill cross slope, perpendicular to the road; not road grade. */
  sideSlopePercent: number | null
  /** The manual's section rock percentage, not a remotely inferred rock fraction. */
  rockPercent: number | null
  roadType: InteriorRoadType | null
  /** `other` means a known BEC zone with no indicator in these equations. */
  becZone: InteriorBecZone | null
  soilMoisture: InteriorSoilMoisture | null
  /** Optional homogeneous-section length; scales the comparison without appraisal rounding. */
  lengthM?: number | null
  conditions?: {
    runningSurfaceWidthM?: number | null
    terrainClass?: 1 | 2 | 3 | 4 | 5 | null
    requiresEndHaul?: boolean
    requiresOverlandConstruction?: boolean
    existingRoad?: boolean
    /** False permits a non-primary long-term road; undefined stays conservative. */
    primaryAccessRoad?: boolean
  }
}

export interface InteriorBenchmarkResult {
  status: 'available' | 'needs-input' | 'not-applicable'
  subgradePerKm: number | null
  subgradeTotal: number | null
  /** IAM 4.3.2.2 records representative side slope to the nearest integer. */
  slopeUsedPercent: number | null
  errors: string[]
  cautions: readonly string[]
}

export const INTERIOR_BENCHMARK_CAUTIONS = [
  'Appraisal allowance in 2024-base CAD, effective July 2026; this is not a current contractor quote or a complete road budget.',
  'Use a verified Table 4-2 road group and representative conditions for a new, homogeneous road section. A natural resource region does not determine the road group.',
  'Subgrade includes clearing, grubbing, stripping, debris and stump removal, ditching, turnouts, small drainage structures and eligible equipment moves. Adding these again would double count them.',
  'Right-of-way felling/logging, drilling/blasting, stabilizing material and larger structures require separate consideration. The benchmark is not added to the itemized estimate.',
  'Confirm terrain stability, road standard, end haul and overland construction before use. The equation does not certify ECE eligibility, survey quality or engineering approval.',
  'Any comparison total scales the entered length. Formal appraisal section lengths are recorded to the nearest 100 m, normally in sections of at least 1 km; shorter qualifying sections require source review.',
] as const

type Equation = { base: number; essf: number; ichCwh?: number; sbs?: number; ich?: number; ms?: number }

// IAM 4.3.2.3, printed p4-14. All groups share 263*SLOPE + 7153*LT + 945*WET.
const SUBGRADE_EQUATIONS: Readonly<Record<number, Equation>> = {
  2: { base: 8559, essf: 2078, ichCwh: 5696 },
  3: { base: 8427, essf: 2078 },
  4: { base: 7281, essf: 2078 },
  5: { base: 6888, essf: 2078 },
  6: { base: 5497, essf: 2078, sbs: 4961 },
  7: { base: 4452, essf: 2078 },
  8: { base: 6596, essf: 7108 },
  9: { base: 13105, essf: 2078, ich: 4614, ms: 5267 },
  10: { base: 9017, essf: 6129 },
  11: { base: 31715, essf: 2078 },
  12: { base: 18975, essf: 6353 },
}

/**
 * Evaluate the sourced $/km equation, with known exclusions and missing inputs explicit.
 * No defaults are assigned for geology, moisture, BEC, road group or road type.
 * A length is optional because this comparison is often only a unit-cost reference.
 */
export function interiorRoadBenchmark(input: InteriorBenchmarkInput): InteriorBenchmarkResult {
  const missing: string[] = []
  const excluded: string[] = []
  const { roadGroup, sideSlopePercent, rockPercent, roadType, becZone, soilMoisture } = input
  const conditions = input.conditions
  const equation = roadGroup === null ? undefined : SUBGRADE_EQUATIONS[roadGroup]

  if (roadGroup === null) missing.push('Select a road group after checking the source boundaries.')
  else if (roadGroup === 1) excluded.push('Road Group 1 uses Coast bank-height procedures through Interior ECE Item Q.')
  else if (!Number.isInteger(roadGroup) || !equation)
    excluded.push('The supported Interior equation road groups are 2 through 12.')

  if (sideSlopePercent === null) missing.push('Enter the representative uphill side slope.')
  else if (!Number.isFinite(sideSlopePercent) || sideSlopePercent < 0)
    missing.push('Uphill side slope must be a finite, non-negative percent.')
  else if (sideSlopePercent > 50) excluded.push('Uphill side slope above 50% requires an engineering cost estimate.')

  if (rockPercent === null) missing.push('Enter the section rock percentage.')
  else if (!Number.isFinite(rockPercent) || rockPercent < 0 || rockPercent > 100)
    missing.push('Rock percentage must be a finite number from 0 to 100.')
  else if (rockPercent > 50) excluded.push('Rock above 50% requires an engineering cost estimate.')

  if (roadType === 'snow-ice') excluded.push('Snow/ice roads have a separate $/km method and eligibility criteria.')
  else if (roadType !== 'long-term' && roadType !== 'short-term')
    missing.push('Select a long-term or short-term road type using the manual definitions.')

  if (!becZone || !['ESSF', 'ICH', 'CWH', 'SBS', 'MS', 'other'].includes(becZone))
    missing.push('Select the verified BEC zone; unknown does not mean other.')
  if (!soilMoisture || !['wet', 'moist', 'dry'].includes(soilMoisture))
    missing.push('Select absolute soil moisture using the manual classification.')

  if (input.lengthM != null && (!Number.isFinite(input.lengthM) || input.lengthM <= 0))
    missing.push('Section length must be finite and greater than zero when supplied.')
  if (input.lengthM != null && input.lengthM > 0 && input.lengthM < 100)
    excluded.push('Sections shorter than 100 m must be combined with an appropriate adjacent section.')

  const width = conditions?.runningSurfaceWidthM
  if (width != null && (!Number.isFinite(width) || width <= 0))
    missing.push('Running-surface width must be finite and greater than zero.')
  else if (width != null && width > 6 && roadType === 'long-term' && conditions?.primaryAccessRoad !== false)
    excluded.push('Long-term primary access with a running surface wider than 6 m requires an ECE.')
  const terrainClass = conditions?.terrainClass
  if (terrainClass != null && (!Number.isInteger(terrainClass) || terrainClass < 1 || terrainClass > 5))
    missing.push('Terrain class must be an integer from I to V when supplied.')
  else if (terrainClass != null && terrainClass >= 4)
    excluded.push('Terrain class IV or V requires an engineering cost estimate.')
  if (conditions?.requiresEndHaul) excluded.push('Required end-haul construction needs an engineering cost estimate.')
  if (conditions?.requiresOverlandConstruction)
    excluded.push('Overland construction with trucked fill needs an engineering cost estimate.')
  if (conditions?.existingRoad)
    excluded.push('This new-subgrade equation does not price existing-road reactivation or upgrade.')

  if (missing.length || excluded.length)
    return {
      status: excluded.length ? 'not-applicable' : 'needs-input',
      subgradePerKm: null,
      subgradeTotal: null,
      slopeUsedPercent: null,
      errors: [...excluded, ...missing],
      cautions: INTERIOR_BENCHMARK_CAUTIONS,
    }

  // Validation above establishes the required numerical inputs without inventing a fallback rate.
  const slope = Math.round(sideSlopePercent!)
  const eq = equation!
  const subgradePerKm =
    eq.base +
    263 * slope +
    (roadType === 'long-term' ? 7153 : 0) +
    (soilMoisture === 'wet' ? 945 : 0) +
    (becZone === 'ESSF' ? eq.essf : 0) +
    (becZone === 'ICH' || becZone === 'CWH' ? (eq.ichCwh ?? 0) : 0) +
    (becZone === 'SBS' ? (eq.sbs ?? 0) : 0) +
    (becZone === 'ICH' ? (eq.ich ?? 0) : 0) +
    (becZone === 'MS' ? (eq.ms ?? 0) : 0)
  const subgradeTotal = input.lengthM == null ? null : (subgradePerKm * input.lengthM) / 1000
  if (subgradeTotal !== null && !Number.isFinite(subgradeTotal))
    return {
      status: 'needs-input',
      subgradePerKm: null,
      subgradeTotal: null,
      slopeUsedPercent: null,
      errors: ['Section length produces a non-finite amount.'],
      cautions: INTERIOR_BENCHMARK_CAUTIONS,
    }
  return {
    status: 'available',
    subgradePerKm,
    subgradeTotal,
    slopeUsedPercent: slope,
    errors: [],
    cautions: INTERIOR_BENCHMARK_CAUTIONS,
  }
}

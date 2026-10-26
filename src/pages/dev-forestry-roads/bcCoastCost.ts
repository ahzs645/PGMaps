/**
 * A separate appraisal benchmark, not a replacement for the road's quantity × rate estimate.
 * Source: BC Coast Appraisal Manual, effective 2026-01-01, Table 5-1 (p. 5-16),
 * sections 4.2 and 5.3.3.1, and Appendix VI. Published cost base: 2024.
 * No geology, eligibility or point-of-origin boundary is inferred from a map location.
 */
export const COAST_COST_SOURCE = {
  id: 'bc-cam-2026-table-5-1',
  title: 'BC Coast Appraisal Manual 2026 — road construction benchmark',
  url: 'https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/forestry/timber-pricing/coast-timber-pricing/coast-appraisal-manual/cam_2026_master.pdf',
  effectiveDate: '2026-01-01',
  costBaseYear: 2024,
  table: '5-1',
  page: '5-16',
  currency: 'CAD',
  unit: '$/km',
  kind: 'appraisal-benchmark',
} as const

export const COAST_ROAD_CATEGORIES = [
  {
    code: 'OMLB',
    label: 'Other material — local ballast',
    description: 'No drilling or blasting required; local ballast/surfacing without truck haul.',
    rockFaceHeightRangeM: null,
    softMediumCadPerKm: 72601,
    hardCadPerKm: 72601,
  },
  {
    code: 'OMPR',
    label: 'Other material — pit-run ballast',
    description: 'No drilling or blasting of the road prism; trucked pit-run or stored end-haul surfacing.',
    rockFaceHeightRangeM: null,
    softMediumCadPerKm: 85856,
    hardCadPerKm: 85856,
  },
  {
    code: 'OMRB',
    label: 'Other material — rock ballast',
    description: 'No drilling or blasting of the road prism; quarried rock surfacing.',
    rockFaceHeightRangeM: null,
    softMediumCadPerKm: 114855,
    hardCadPerKm: 116090,
  },
  {
    code: 'TOE',
    label: 'Blasted rock face up to 1.50 m',
    description: 'Drilling and blasting, including qualifying ditchlines or boulders.',
    rockFaceHeightRangeM: [0, 1.5],
    softMediumCadPerKm: 114855,
    hardCadPerKm: 116090,
  },
  {
    code: 'MRK',
    label: 'Blasted rock face 1.51–3.00 m',
    description: 'Drilling and blasting; inside rock-face or qualifying boulder height.',
    rockFaceHeightRangeM: [1.51, 3],
    softMediumCadPerKm: 141239,
    hardCadPerKm: 144177,
  },
  {
    code: 'HRK',
    label: 'Blasted rock face 3.01–4.50 m',
    description: 'Drilling and blasting; inside rock-face or qualifying boulder height.',
    rockFaceHeightRangeM: [3.01, 4.5],
    softMediumCadPerKm: 177964,
    hardCadPerKm: 191315,
  },
  {
    code: 'XRK',
    label: 'Blasted rock face 4.51–6.00 m',
    description: 'Drilling and blasting; inside rock-face or qualifying boulder height.',
    rockFaceHeightRangeM: [4.51, 6],
    softMediumCadPerKm: 207524,
    hardCadPerKm: 223856,
  },
  {
    code: 'XXRK',
    label: 'Blasted rock face 6.01–7.50 m',
    description: 'Drilling and blasting; greater rock-face heights require an engineering estimate.',
    rockFaceHeightRangeM: [6.01, 7.5],
    softMediumCadPerKm: 225412,
    hardCadPerKm: 250466,
  },
] as const

export type CoastRoadCategory = (typeof COAST_ROAD_CATEGORIES)[number]['code']
export type CoastRockHardness = 'soft-medium' | 'hard'

/** Table 4-3 geography; only five named areas receive the Table 5-1 addition. */
export const COAST_POINTS_OF_ORIGIN = [
  { code: 'BKCL', label: 'Barkley–Clayoquot', addOnCadPerKm: 0 },
  { code: 'BUTE', label: 'Bute Inlet', addOnCadPerKm: 0 },
  { code: 'COCO', label: 'Courtenay–Comox', addOnCadPerKm: 0 },
  { code: 'DEWD', label: 'Dewdney', addOnCadPerKm: 0 },
  { code: 'DRSE', label: 'Drury–Seymour', addOnCadPerKm: 7548 },
  { code: 'ESPE', label: 'Esperanza', addOnCadPerKm: 0 },
  { code: 'GKIN', label: 'Gilford–Knight', addOnCadPerKm: 7548 },
  { code: 'GRIS', label: 'Graham Island', addOnCadPerKm: 7548 },
  { code: 'HARR', label: 'Harrison', addOnCadPerKm: 0 },
  { code: 'JEIS', label: 'Jervis–Sechelt', addOnCadPerKm: 0 },
  { code: 'JUDF', label: 'Juan de Fuca', addOnCadPerKm: 0 },
  { code: 'KEAD', label: 'Kelsey–Adam', addOnCadPerKm: 0 },
  { code: 'KOKI', label: 'Kokish', addOnCadPerKm: 0 },
  { code: 'MESF', label: 'Menzies–Sayward Forest', addOnCadPerKm: 0 },
  { code: 'MIDC', label: 'Mid-Coast', addOnCadPerKm: 7548 },
  { code: 'NOSO', label: 'Nootka Sound', addOnCadPerKm: 0 },
  { code: 'NTHC', label: 'North Coast', addOnCadPerKm: 7548 },
  { code: 'POMH', label: 'Port McNeill–Hardy', addOnCadPerKm: 0 },
  { code: 'QUSO', label: 'Quatsino Sound', addOnCadPerKm: 0 },
  { code: 'SLOQ', label: 'Sloquet', addOnCadPerKm: 0 },
  { code: 'SEVI', label: 'Southeast Vancouver Island', addOnCadPerKm: 0 },
  { code: 'SQPM', label: 'Squamish–Pemberton', addOnCadPerKm: 0 },
  { code: 'SUCO', label: 'Sunshine Coast', addOnCadPerKm: 0 },
  { code: 'THUR', label: 'Thurlow', addOnCadPerKm: 0 },
] as const

export type CoastPointOfOrigin = (typeof COAST_POINTS_OF_ORIGIN)[number]['code']
export const COAST_ISOLATION_ADD_ON_CAD_PER_KM = 7615

export const COAST_BENCHMARK_NOTES: readonly string[] = [
  'Published appraisal allowance with a 2024 cost base; not a current contractor quotation or a construction-ready total.',
  'Select the category from field-supported construction conditions. Soft/medium means RMC 1–4; hard means RMC 5. A terrain model cannot establish rock hardness.',
  'The bundled road allowance includes clearing, grubbing, stripping, stump removal, incidental log decking, ditches, landings, turnouts and the category’s ballast/surfacing. Do not add it to the itemized road estimate.',
  'Bridges and culverts are separate. Exclude bridge deck/span lengths from road length when applying this $/km benchmark.',
  'Additional stabilizing-material haul beyond 3.2 km and work outside tabular conditions need separate engineering cost estimates.',
  'Confirm new single-lane logging-road eligibility. Main access upgrades, end haul, extensive imported fills, uphill side slopes over 150%, repeated deep gullies, large switchbacks and rock faces above 7.50 m require engineering review.',
  'Isolation uses the CAM’s eligible cutblock net-cruise-volume fraction, not a road-length fraction. A public-ferry-served community is included when checking connection to the nearest qualifying community.',
  'Point-of-origin areas are appraisal boundaries, not natural-resource-region multipliers. Select a published area or explicitly confirm that no eligible addition applies; unknown geography cannot be priced as zero.',
]

export interface CoastRoadBenchmarkInput {
  category: CoastRoadCategory
  hardness: CoastRockHardness
  /** CAM ISOLATED fraction, from net cruise volume of eligible cutblocks / total net cruise volume. */
  isolationFraction: number
  /** Must be explicitly true before a positive isolation fraction can be priced. */
  isolationEligibilityConfirmed: boolean
  /** User-selected CAM Table 4-3 area; null requires an explicit review before a zero addition is valid. */
  pointOfOrigin: CoastPointOfOrigin | null
  /** For a null area, must be true to confirm that no eligible point-of-origin addition applies. */
  pointOfOriginReviewed?: boolean
  /** Explicit review of new single-lane tabular-road conditions, not a map-derived flag. */
  tabularEligibilityConfirmed: boolean
}

export interface CoastRoadBenchmark {
  valid: boolean
  unitCostCadPerKm: number | null
  baseCadPerKm: number | null
  isolationAddOnCadPerKm: number | null
  pointOfOriginAddOnCadPerKm: number | null
  errors: string[]
  notes: readonly string[]
  source: typeof COAST_COST_SOURCE
}

/** Reject malformed or unconfirmed inputs rather than silently applying a regional surcharge. */
export function calculateCoastRoadBenchmark(input: CoastRoadBenchmarkInput): CoastRoadBenchmark {
  const errors: string[] = []
  const category = COAST_ROAD_CATEGORIES.find((row) => row.code === input.category)
  const origin = COAST_POINTS_OF_ORIGIN.find((row) => row.code === input.pointOfOrigin)
  if (!category) errors.push('Select a published Coast construction category.')
  if (input.hardness !== 'soft-medium' && input.hardness !== 'hard') {
    errors.push('Select soft/medium (RMC 1–4) or hard (RMC 5) rock.')
  }
  if (input.tabularEligibilityConfirmed !== true) {
    errors.push('Confirm that the segment meets the CAM new single-lane tabular-road conditions.')
  }
  if (!Number.isFinite(input.isolationFraction) || input.isolationFraction < 0 || input.isolationFraction > 1) {
    errors.push('The CAM isolation fraction must be finite and between 0 and 1.')
  } else if (input.isolationFraction > 0 && input.isolationEligibilityConfirmed !== true) {
    errors.push('Confirm CAM isolation eligibility before applying the isolation addition.')
  }
  if (input.pointOfOrigin === null && input.pointOfOriginReviewed !== true) {
    errors.push('Choose a point-of-origin area or confirm that no eligible addition applies.')
  } else if (input.pointOfOrigin !== null && !origin) {
    errors.push('Select a published CAM point-of-origin area, or explicitly confirm that no eligible addition applies.')
  }
  if (errors.length || !category) {
    return {
      valid: false,
      unitCostCadPerKm: null,
      baseCadPerKm: null,
      isolationAddOnCadPerKm: null,
      pointOfOriginAddOnCadPerKm: null,
      errors,
      notes: COAST_BENCHMARK_NOTES,
      source: COAST_COST_SOURCE,
    }
  }
  const baseCadPerKm = input.hardness === 'hard' ? category.hardCadPerKm : category.softMediumCadPerKm
  const isolationAddOnCadPerKm = input.isolationFraction * COAST_ISOLATION_ADD_ON_CAD_PER_KM
  const pointOfOriginAddOnCadPerKm = origin?.addOnCadPerKm ?? 0
  return {
    valid: true,
    unitCostCadPerKm: baseCadPerKm + isolationAddOnCadPerKm + pointOfOriginAddOnCadPerKm,
    baseCadPerKm,
    isolationAddOnCadPerKm,
    pointOfOriginAddOnCadPerKm,
    errors,
    notes: COAST_BENCHMARK_NOTES,
    source: COAST_COST_SOURCE,
  }
}

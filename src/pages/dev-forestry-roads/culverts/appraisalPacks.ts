/**
 * How each BC appraisal manual treats a pipe culvert, as data. A manual edition is one pack; a new
 * edition or another jurisdiction is another pack, never a branch in `culvertAppraisal.ts`.
 *
 * Read from the manuals effective 2026 (2024 cost base) on 16 November 2026. The twelve-metre row of
 * the Interior table and six Coast rows repeat `appraisalScope.ts`, read on 12 November, and
 * `appraisalPacks.test.ts` holds the two readings to each other.
 *
 * An appraisal allowance feeds the stumpage appraisal. It is not the price of building the culvert
 * and never enters the estimate.
 *
 * Free of DOM and network access.
 */
import type { CulvertShape } from './culvertShape'

export type AppraisalPackId = 'bc-interior-2026' | 'bc-coast-2026'

/** A table of installed totals by pipe length and diameter (Interior Table 4-3, Part A). */
export interface InstalledByLengthTable {
  kind: 'installed-by-length'
  diametersM: readonly number[]
  lengthsM: readonly number[]
  /** `installedCad[lengthIndex][diameterIndex]`: supply, delivery and installation of one culvert. */
  installedCad: readonly (readonly number[])[]
  /** Supply and delivery only, CAD per metre, by diameter (Part B). Never added to Part A. */
  supplyPerMCad: readonly number[]
}

/** A table of rates per lineal metre by diameter (Coast Table 5-4). */
export interface PerMetreTable {
  kind: 'per-metre'
  diametersM: readonly number[]
  /** Materials and installation, CAD per lineal metre (Column A). */
  installedPerMCad: readonly number[]
  /** Materials only, CAD per lineal metre (Column B). Never added to Column A. */
  supplyPerMCad: readonly number[]
}

export interface CulvertAppraisalPack {
  id: AppraisalPackId
  /** "Interior Appraisal Manual". */
  manual: string
  short: string
  edition: string
  costBaseYear: number
  sourceUrl: string
  /**
   * A round pipe below this diameter is inside the road's subgrade allowance and has no allowance of
   * its own. Null: the manual's road allowance holds no pipe culverts, so every pipe is costed.
   */
  inSubgradeBelowDiameterM: number | null
  inSubgradeLocator: string
  table: InstalledByLengthTable | PerMetreTable
  tableName: string
  tableLocator: string
  /** What the manual says about a size between two table entries. */
  betweenEntries: string
  /** A pipe larger than this needs an engineered estimate; a pipe of exactly this size does not. */
  engineeredAboveDiameterM: number
  /** A pipe longer than this needs one whatever its diameter; null where the manual has no length rule. */
  engineeredAboveLengthM: number | null
  engineeredLocator: string
  /**
   * Installations that are engineered estimates at any size. Null where the manual's treatment of
   * them was not read, which `culvertAppraisal.ts` reports as not determined, never as tabular.
   */
  special: {
    locator: string
    shapes: readonly CulvertShape[]
    multipleBarrels: boolean
    embedded: boolean
  } | null
  /** What an engineered estimate for a culvert may hold, for the reader who has to prepare one. */
  engineeredScope: readonly string[]
  engineeredScopeLocator: string
}

const INTERIOR_URL =
  'https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/forestry/timber-pricing/interior-timber-pricing/interior-appraisal-manual/iam_2026_master_b.pdf'
const COAST_URL =
  'https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/forestry/timber-pricing/coast-timber-pricing/coast-appraisal-manual/cam_2026_master.pdf'

const TABLE_4_3_DIAMETERS = [0.3, 0.4, 0.45, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1.0, 1.2, 1.4, 1.6, 1.8] as const
// One row per pipe length, 9 m to 20 m; one column per diameter above.
const TABLE_4_3_PART_A = [
  [963, 1018, 1142, 1308, 1640, 2055, 2552, 3133, 3423, 3755, 5165, 6866, 8815, 11013],
  [963, 1078, 1216, 1400, 1769, 2230, 2783, 3428, 3750, 4119, 5686, 7575, 9741, 12184],
  [963, 1137, 1290, 1492, 1898, 2405, 3013, 3723, 4078, 4483, 6207, 8285, 10668, 13355],
  [963, 1197, 1363, 1584, 2027, 2580, 3244, 4018, 4405, 4847, 6728, 8995, 11594, 14525],
  [963, 1257, 1437, 1677, 2156, 2755, 3474, 4313, 4732, 5211, 7248, 9705, 12520, 15696],
  [963, 1317, 1511, 1769, 2285, 2930, 3704, 4608, 5059, 5575, 7769, 10414, 13447, 16866],
  [963, 1377, 1584, 1861, 2414, 3105, 3935, 4903, 5386, 5939, 8290, 11124, 14373, 18037],
  [963, 1437, 1658, 1953, 2543, 3280, 4165, 5198, 5714, 6304, 8811, 11834, 15299, 19207],
  [1027, 1497, 1732, 2045, 2672, 3456, 4396, 5492, 6041, 6668, 9331, 12543, 16226, 20378],
  [1059, 1557, 1806, 2137, 2801, 3631, 4626, 5787, 6368, 7032, 9852, 13253, 17152, 21548],
  [1091, 1617, 1879, 2230, 2930, 3806, 4856, 6082, 6695, 7396, 10373, 13963, 18078, 22719],
  [1124, 1677, 1953, 2322, 3059, 3981, 5087, 6377, 7022, 7760, 10894, 14673, 19005, 23890],
] as const

export const BC_INTERIOR_2026: CulvertAppraisalPack = {
  id: 'bc-interior-2026',
  manual: 'Interior Appraisal Manual',
  short: 'Interior',
  edition: 'effective 1 July 2026',
  costBaseYear: 2024,
  sourceUrl: INTERIOR_URL,
  inSubgradeBelowDiameterM: 0.95,
  inSubgradeLocator: 'IAM 4.3.2.1(1)(i) and 4.3.3(1), pp. 4-11 and 4-17',
  table: {
    kind: 'installed-by-length',
    diametersM: TABLE_4_3_DIAMETERS,
    lengthsM: [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
    installedCad: TABLE_4_3_PART_A,
    supplyPerMCad: [57, 73, 82, 92, 114, 142, 175, 213, 232, 254, 347, 460, 588, 734],
  },
  tableName: 'Table 4-3, Part A',
  tableLocator: 'IAM 4.3.3.1 and Table 4-3, pp. 4-17 to 4-18',
  betweenEntries: 'The manual permits no interpolation and states no rounding rule for culverts.',
  engineeredAboveDiameterM: 1.8,
  engineeredAboveLengthM: 20,
  engineeredLocator: 'IAM 4.3.3.1(4) and 4.3.6(8)(m), pp. 4-17 and 4-25; ECE Procedures Item M',
  special: {
    locator: 'IAM 4.3.6(8)(p), p. 4-25; ECE Procedures Item P',
    shapes: ['box', 'pipe-arch', 'open-bottom-arch'],
    multipleBarrels: true,
    embedded: true,
  },
  engineeredScope: [
    'Site plan and general arrangement',
    'Culvert components and freight',
    'Mobilization of specialized equipment',
    'Site preparation and temporary stream diversion',
    'Foundation, structural fill envelope and compaction',
    'Riprap or other scour protection',
    'Approach fills to 15 m from each end where the design requires them, deducted from the road subgrade cost',
  ],
  engineeredScopeLocator: 'Interior ECE Procedures (1 July 2026), Item M, pp. 45-46',
}

export const BC_COAST_2026: CulvertAppraisalPack = {
  id: 'bc-coast-2026',
  manual: 'Coast Appraisal Manual',
  short: 'Coast',
  edition: 'effective 1 January 2026',
  costBaseYear: 2024,
  sourceUrl: COAST_URL,
  inSubgradeBelowDiameterM: null,
  inSubgradeLocator: 'CAM 5.3.3.1, pp. 5-14 to 5-16',
  table: {
    kind: 'per-metre',
    diametersM: [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.2, 1.4, 1.6, 1.8],
    installedPerMCad: [148, 149, 157, 173, 198, 230, 270, 319, 440, 593, 779, 996],
    supplyPerMCad: [104, 107, 116, 130, 149, 173, 203, 237, 322, 428, 554, 701],
  },
  tableName: 'Table 5-4, Column A',
  tableLocator: 'CAM 5.3.3.2.3 and Table 5-4, p. 5-21',
  betweenEntries: 'The manual rounds input data to fit its tables and permits no interpolation (CAM 5.3.3.2(3)).',
  engineeredAboveDiameterM: 1.8,
  engineeredAboveLengthM: null,
  engineeredLocator: 'CAM 5.3.3.2.2(4)(d) and 5.3.4(1)(d)',
  special: null,
  engineeredScope: [],
  engineeredScopeLocator: 'Coast ECE procedures',
}

export const CULVERT_APPRAISAL_PACKS: readonly CulvertAppraisalPack[] = [BC_INTERIOR_2026, BC_COAST_2026]

export const culvertAppraisalPack = (id: AppraisalPackId): CulvertAppraisalPack =>
  CULVERT_APPRAISAL_PACKS.find((pack) => pack.id === id)!

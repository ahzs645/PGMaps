import type { Coordinate, RoadTemplate } from './types'

/** User-entered assumptions and measured horizons, never inferred from a DTM. */
export interface TemplateDefinition {
  id: string
  name: string
  template: RoadTemplate
}
export interface TemplateAssignment {
  id: string
  start: number
  end: number
  templateId: string
  side: 'left' | 'right' | 'both'
  /** Linear transition from/to the base section inside the assigned range. */
  transitionM: number
}
export interface GroundMaterial {
  id: string
  name: string
  color: string
  /** CAD per bank cubic metre excavated. */
  cutRate: number
  reusableFraction: number
  /** Compacted fill volume per reusable bank volume. */
  compactionFactor: number
  /** Stripping here means excavated shallow material only, not undercut below fill. */
  purpose?: 'earthwork' | 'stripping'
}
export interface StratumAssignment {
  id: string
  start: number
  end: number
  materialId: string
  /** Vertical depth below each original-ground section sample. */
  topDepthM: number
  /** Null extends the material below all entered finite horizons. */
  bottomDepthM: number | null
}
export interface Culvert {
  id: string
  name: string
  kind?: 'stream' | 'cross-drain'
  sourceFeatureId?: string
  chainage: number
  /** Degrees clockwise from the right-facing perpendicular; -80…80. */
  skewDegrees: number
  /** Horizontal barrel span; the actual inclined length is computed from known inverts. */
  lengthM: number
  diameterM: number
  /** Endpoint inverts retain the project's vertical datum. Inlet is the left endpoint. */
  inletInvertM: number | null
  outletInvertM: number | null
  minCoverM: number
  /**
   * Ditch dip toward the inlet: the inlet-side (left) ditch is deepened so its bottom falls at this
   * grade (%) to the inlet invert, like RoadEng's culvert dip. Omitted means no dip.
   */
  ditchDipPercent?: number
  /** CAD per installed barrel metre, plus the explicit fixed amount. */
  unitCost: number
  fixedCost: number
}
export interface HaulSettings {
  enabled: boolean
  freeHaulDistanceM: number
  overhaulDistanceM: number
  /** CAD/(transported m³·km) over the whole distance of a free-haul movement. Zero is free haul. */
  freeHaulRate: number
  /** CAD/(transported m³·km), applied only beyond the free-haul distance. */
  overhaulRate: number
  endHaulRate: number
  /** CAD per transported m³ for loading, by haul class: a fixed step in the haul-cost curve. */
  freeHaulLoadingRate: number
  overhaulLoadingRate: number
  endHaulLoadingRate: number
  /** CAD per compacted m³ supplied / bank m³ disposed. */
  borrowRate: number
  wasteRate: number
  mobilizationCost: number
  contingencyPercent: number
}
export interface HaulSite {
  id: string
  name: string
  kind: 'borrow' | 'waste'
  chainage: number
  accessDistanceM: number
  /** Borrow capacity is compacted m³; waste capacity is bank m³. Null is unbounded. */
  capacityM3: number | null
  /** CAD per compacted borrow m³ or bank waste m³. Replaces the matching default rate. */
  unitRate: number
  fixedCost: number
}
export interface AlignmentEngineering {
  templates: TemplateDefinition[]
  assignments: TemplateAssignment[]
  materials: GroundMaterial[]
  strata: StratumAssignment[]
  culverts: Culvert[]
  haul: HaulSettings
  sites: HaulSite[]
}

export interface ResolvedTemplate {
  template: RoadTemplate
  leftName: string
  rightName: string
  assignmentIds: string[]
}
export interface ResolvedGroundLayer {
  id: string
  materialId: string
  name: string
  color: string
  topDepthM: number
  bottomDepthM: number | null
}
export interface MaterialSectionArea {
  materialId: string
  cutAreaM2: number | null
}
export interface EngineeringStation {
  chainage: number
  template: ResolvedTemplate
  layers: ResolvedGroundLayer[]
  materialAreas: MaterialSectionArea[]
  usableCutVolumeM3: number | null
  unusableCutVolumeM3: number | null
  massM3: number | null
}
export interface MaterialQuantity {
  materialId: string
  name: string
  color: string
  purpose: 'earthwork' | 'stripping'
  bankCutM3: number
  usableCompactedM3: number
  unusableBankM3: number
  excavationCost: number
}
export interface CulvertProfilePoint {
  distanceM: number
  coordinate: Coordinate
  groundElevation: number | null
  formationElevation: number | null
  invertElevation: number | null
  crownElevation: number | null
}
export interface CulvertAnalysis {
  id: string
  name: string
  chainage: number
  coordinate: Coordinate
  bearing: number
  start: Coordinate
  end: Coordinate
  requiredLengthM: number | null
  /** Minimum sampled formation-to-pipe-crown cover where the barrel crosses the formation. */
  coverM: number | null
  gradePercent: number | null
  /** Actual inclined barrel length; null until both endpoint inverts are known. */
  barrelLengthM: number | null
  barrelAreaM2: number
  /** Internal void, not pipe-wall material. Provisional horizontal-span quantity when inverts are unknown. */
  barrelInternalVolumeM3: number
  installedCost: number
  profile: CulvertProfilePoint[]
  complete: boolean
  warnings: string[]
}
export interface HaulMovement {
  id: string
  kind: 'cut-to-fill' | 'borrow' | 'waste'
  sourceId: string
  targetId: string
  materialId: string | null
  fromChainage: number
  toChainage: number
  distanceM: number
  bankVolumeM3: number | null
  compactedVolumeM3: number | null
  /** Waste uses bank m³; cut-to-fill and borrow use compacted m³. */
  transportedVolumeM3: number
  volumeBasis: 'bank' | 'compacted'
  category: 'freehaul' | 'overhaul' | 'endhaul'
  haulCost: number
}
export interface HaulSummary {
  enabled: boolean
  /** Cut-to-fill and borrow quantities use compacted m³ throughout. */
  freeHaulM3: number
  overhaulM3: number
  endHaulM3: number
  haulM3Km: number
  /** Waste movements retain bank m³ and are never summed with compacted volumes. */
  wasteFreeHaulBankM3: number
  wasteOverhaulBankM3: number
  wasteEndHaulBankM3: number
  wasteHaulM3Km: number
  borrowCompactedM3: number
  wasteBankM3: number
  unallocatedBorrowM3: number
  unallocatedWasteM3: number
  /** All quantities refer only to supported earthwork intervals. */
  complete: boolean
}
export interface EngineeringCosts {
  cut: number
  stripping: number
  fill: number
  surfacing: number
  clearing: number
  structures: number
  haul: number
  borrow: number
  waste: number
  sitePreparation: number
  mobilization: number
  subtotal: number
  contingency: number
  total: number
}
export interface EngineeringAnalysis {
  stations: EngineeringStation[]
  materials: MaterialQuantity[]
  culverts: CulvertAnalysis[]
  movements: HaulMovement[]
  haul: HaulSummary
  costs: EngineeringCosts
  usableCutM3: number
  unusableCutM3: number
  strippingCutM3: number
  balanceM3: number
  complete: boolean
  warnings: string[]
}

export const DEFAULT_HAUL_SETTINGS: HaulSettings = {
  enabled: false,
  freeHaulDistanceM: 25,
  overhaulDistanceM: 150,
  freeHaulRate: 0,
  overhaulRate: 0,
  endHaulRate: 0,
  freeHaulLoadingRate: 0,
  overhaulLoadingRate: 0,
  endHaulLoadingRate: 0,
  borrowRate: 0,
  wasteRate: 0,
  mobilizationCost: 0,
  contingencyPercent: 0,
}
export function createEngineeringDesign(): AlignmentEngineering {
  return {
    templates: [],
    assignments: [],
    materials: [],
    strata: [],
    culverts: [],
    sites: [],
    haul: { ...DEFAULT_HAUL_SETTINGS },
  }
}

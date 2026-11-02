/** Browser adaptation of forestryCastor (Apache-2.0); see the upstream NOTICE. */
export const CASTOR_MODEL_VERSION = 'pgmaps-castor-1' as const

export interface CastorYieldPoint {
  age: number
  volume: number // merchantable m³/ha
  height: number // metres
  eca?: number // fraction [0, 1]
  basalArea?: number
  crownClosure?: number
  deciduousPercent?: number
  qmd?: number
}

export interface CastorYieldCurve {
  id: string
  points: CastorYieldPoint[]
}

export interface CastorPixel {
  id: number
  blockId: string
  compartment: string
  areaHa: number // full represented ground area
  thlbHa: number // timber harvesting land base hectares, <= areaHa
  owned: boolean
  age: number
  volume: number // live merchantable m³/ha of THLB
  height: number
  eca: number
  distance: number // metres from existing disturbance
  salvageVolume: number // dead merchantable m³/ha of THLB
  curveId?: string
  managedCurveId?: string
  treatmentId?: string
  basalArea?: number
  crownClosure?: number
  deciduousPercent?: number
  qmd?: number
  elevation?: number
  culminationVolume?: number // derived volume at maximum mean annual increment
  x?: number // projected metres; required when updating distance
  y?: number
  gridIndex?: number // zero-based row-major cell; not inferred from id
  geometry?: import('geojson').Polygon | import('geojson').MultiPolygon | import('geojson').Point // WGS84
  zones: Record<string, string>
  attributes?: Record<string, number | string | boolean | null>
}

export interface CastorGrid {
  width: number
  height: number
  originX: number // upper-left outer edge
  originY: number
  cellSize: number // square pixel size in metres
  crs: string // projected CRS, e.g. EPSG:3005
}

export type CastorPredicate =
  | { field: string; op: 'eq' | 'ne' | 'gt' | 'ge' | 'lt' | 'le'; value: number | string | boolean }
  | { all: CastorPredicate[] }
  | { any: CastorPredicate[] }
  | { not: CastorPredicate }

export interface CastorConstraint {
  id: string
  zone: string
  zoneId: string
  type: 'nh' | 'ge' | 'le'
  variable?: string
  threshold?: number
  percentage?: number
  condition?: CastorPredicate
  denominator?: CastorPredicate
  startYear?: number
  stopYear?: number
}

export interface CastorHarvestFlow {
  id: string
  compartment: string
  period: number // 1-based period index, not calendar year
  targetM3: number // period total, not annual rate
  type: 'live' | 'salvage'
  condition?: CastorPredicate
}

export interface CastorTreatment {
  id: string
  condition: CastorPredicate
  method?: 'curve-transition' | 'fraction'
  removeFraction?: number
  resetAge?: number
  nextCurveId?: string
  nextManagedCurveId?: string
  nextTreatmentId?: string
  nextSilviculturalSystem?: number
  startYear?: number
  stopYear?: number
}

export interface CastorScheduledHarvest {
  period: number
  pixelIds?: number[]
  blockIds?: string[]
  type?: 'live' | 'salvage'
  removeFraction?: number
}

export interface CastorProject {
  schema: 'pgmaps-castor-project-v1'
  name: string
  description: string
  provenance: { source: string; url?: string; revision?: string; notes: string[]; synthetic?: boolean }
  pixels: CastorPixel[]
  yieldCurves: CastorYieldCurve[]
  constraints: CastorConstraint[]
  harvestFlows: CastorHarvestFlow[]
  adjacency: Array<[string, string]>
  landings: Array<{ blockId: string; pixelId: number }>
  treatments?: CastorTreatment[]
  schedule?: CastorScheduledHarvest[]
  grid?: CastorGrid
  crs?: string // projected metre CRS for x/y when no grid is supplied
  config?: Partial<CastorConfig>
}

export interface CastorPriority {
  field: string
  direction: 'asc' | 'desc'
}

export interface CastorConfig {
  scenario: string
  periods: number
  stepYears: number
  startYear: number
  mode: 'queue' | 'schedule'
  harvestUnit: 'pixel' | 'block'
  minimumHarvestAge: number
  blockPriority: CastorPriority[]
  zonePriority?: { zone: string; order: CastorPriority[]; refreshPeriods: number }
  adjacencyHeight: number | null
  growingStockRetention: number // fraction of initial merchantable THLB stock
  initializeFromYield: boolean
  growthTiming: 'period-end' | 'upstream-midpoint'
  updateDistance: boolean
  maxYieldAge: number
  targetMultiplier: number
  uncertainty: { enabled: boolean; replicates: number; coefficientOfVariation: number; seed: number }
}

export const DEFAULT_CASTOR_CONFIG: CastorConfig = {
  scenario: 'Forest management scenario',
  periods: 10,
  stepYears: 5,
  startYear: 2025,
  mode: 'queue',
  harvestUnit: 'pixel',
  minimumHarvestAge: 0,
  blockPriority: [{ field: 'age', direction: 'desc' }],
  adjacencyHeight: null,
  growingStockRetention: 0,
  initializeFromYield: true,
  growthTiming: 'upstream-midpoint',
  updateDistance: false,
  maxYieldAge: 350,
  targetMultiplier: 1,
  uncertainty: { enabled: false, replicates: 100, coefficientOfVariation: 0.15, seed: 12345 },
}

export interface CastorHarvestRow {
  scenario: string
  period: number
  year: number
  elapsedYears: number
  compartment: string
  flowId: string
  type: 'live' | 'salvage' | 'partial'
  targetM3: number | null
  effectiveTargetM3: number | null
  volumeM3: number
  areaHa: number
  annualVolumeM3: number
  annualAreaHa: number
  meanAge: number | null
  blockCount: number
  meanBlockAreaHa: number | null
  availableThlbHa: number
  transitionAreaHa: number
  transitionVolumeM3: number
  shortfallM3: number | null
}

export interface CastorStockRow {
  scenario: string
  period: number
  year: number
  elapsedYears: number
  compartment: string
  phase: 'initial' | 'before-harvest' | 'after-harvest'
  stockM3: number
  salvageM3: number
  thlbHa: number
  availableThlbHa: number
  meanAge: number | null
}

export interface CastorConstraintRow {
  scenario: string
  period: number
  year: number
  elapsedYears: number
  phase: 'before-harvest' | 'after-harvest'
  constraintId: string
  zone: string
  zoneId: string
  type: 'nh' | 'ge' | 'le'
  variable: string
  threshold: number | null
  targetPercent: number
  actualPercent: number
  denominatorHa: number
  protectedHa: number
  met: boolean
}

export interface CastorHarvestPixelRow {
  period: number
  year: number
  elapsedYears: number
  pixelId: number
  blockId: string
  compartment: string
  flowId: string
  type: 'live' | 'salvage' | 'partial'
  areaHa: number
  volumeM3: number
  age: number
  height: number
  removeFraction: number
  x?: number
  y?: number
}

export interface CastorHarvestBlockRow {
  period: number
  year: number
  elapsedYears: number
  blockId: string
  compartment: string
  type: 'live' | 'salvage' | 'partial'
  volumeM3: number
  areaHa: number
  meanHeight: number
  pixelCount: number
}

export interface CastorLandingRow {
  period: number
  year: number
  elapsedYears: number
  blockId: string
  pixelId: number
  x?: number
  y?: number
  source: 'provided' | 'harvest-pixel'
}

export interface CastorSalvageRow {
  period: number
  year: number
  elapsedYears: number
  compartment: string
  availableM3: number
  harvestedM3: number
  remainingM3: number
  areaHa: number
}

export interface CastorSnapshot {
  period: number
  year: number
  elapsedYears: number
  /** Arrays follow project.pixels order. No-data cells are handled by exporters. */
  age: number[]
  volume: number[]
  height: number[]
  eca: number[]
  harvestedYear: Array<number | null>
  harvestedVolumeM3: number[]
  constrained: number[]
  constrainedPeriods: number[]
  constrainedYears: number[]
}

export interface CastorUncertaintyRow {
  period: number
  year: number
  compartment: string
  flowId: string
  targetM3: number
  p05M3: number
  medianM3: number
  p95M3: number
  probabilityTarget: number
}

export interface CastorResult {
  modelVersion: typeof CASTOR_MODEL_VERSION
  scenario: string
  config: CastorConfig
  warnings: string[]
  assumptions: string[]
  harvestReport: CastorHarvestRow[]
  growingStockReport: CastorStockRow[]
  zoneManagement: CastorConstraintRow[]
  harvestPixelList: CastorHarvestPixelRow[]
  harvestBlockList: CastorHarvestBlockRow[]
  landings: CastorLandingRow[]
  salvageReport: CastorSalvageRow[]
  snapshots: CastorSnapshot[]
  finalPixels: CastorPixel[]
  uncertainty: CastorUncertaintyRow[]
  summary: {
    initialStockM3: number
    finalStockM3: number
    harvestedM3: number
    harvestedAreaHa: number
    targetM3: number
    shortfallM3: number
  }
}

export interface CastorProgress {
  phase: 'simulation' | 'uncertainty'
  completed: number
  total: number
  message: string
}

export interface CastorRunOptions {
  onProgress?: (progress: CastorProgress) => void
  shouldCancel?: () => boolean
}

export interface CastorValidationIssue {
  path: string
  message: string
}
export interface CastorValidation {
  errors: CastorValidationIssue[]
  warnings: string[]
}

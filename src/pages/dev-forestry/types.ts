/** Shared, serializable scenario and worker shapes. Optional additions migrate v1 scenes. */
import { DEFAULT_DEM_ZOOM } from './terrain'
import type { ReverseViewshedResult } from './reverseViewshed'
import type { VacRating, VisualQualityClassId } from './vqo'
export type ViewpointMode = 'spot' | 'corridor'
export type Viewpoint = { id: string; name: string; mode: ViewpointMode; coordinates: Array<[number, number]> }
export type TargetRole = 'block' | 'landscape' | 'harvested'
/**
 * How a proposed block is cut. Dispersed retention keeps its geometry and earns
 * a Table 5 adjustment; a partial cut adds its Table 6 visual equivalent to
 * clearcut rather than counting as cleared ground (handbook 3.4.3.3, 3.4.4).
 */
export type HarvestSystem = 'clearcut' | 'retention' | 'partial'
export type TargetPolygon = {
  id: string; name: string; role: TargetRole; objectiveId: VisualQualityClassId; vac: VacRating | null
  harvestYear: number | null; clearcutPercent: number | null; siteDisturbance?: boolean
  /** Optional observed/modelled recovery estimate. Null retains the explicitly labelled age assumption. */
  recoveryPercent?: number | null
  /** Proposed blocks only; absent means clearcut. */
  harvestSystem?: HarvestSystem
  /** Dispersed retention: share of the stand left standing, percent. */
  retentionPercent?: number | null
  /** Partial cut: share of volume removed, percent, and the mean height of the trees left. */
  volumeRemovedPercent?: number | null
  residualHeightMeters?: number | null
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon; source: string; inventoryUnitId?: string | null
}
export type Availability = 'complete' | 'partial' | 'unavailable' | 'not-requested' | 'scenario-only'
export type InventoryEvidence = {
  status: Availability; bounds?: [number, number, number, number]; retrievedAt?: string; source?: string
}
export type AnalysisSettings = {
  demZoom: number; observerHeightMeters: number; targetOffsetMeters: number; stationSpacingMeters: number
  maxViewDistanceMeters: number; sampleBudget: number; greenUpAgeYears: number
  screeningEnabled: boolean; minCrownClosurePercent: number
  /** Explicit scenario assumptions, NEVER silently enabled by migration or by a failed query. */
  greenAreaConfirmed?: boolean
  existingDisturbanceConfirmed?: boolean
}
export const DEFAULT_ANALYSIS_SETTINGS: AnalysisSettings = {
  demZoom: DEFAULT_DEM_ZOOM, observerHeightMeters: 1.6, targetOffsetMeters: 0, stationSpacingMeters: 150,
  maxViewDistanceMeters: 12000, sampleBudget: 900, greenUpAgeYears: 20,
  screeningEnabled: false, minCrownClosurePercent: 30,
  greenAreaConfirmed: false, existingDisturbanceConfirmed: false,
}
export type AnalysisInput = {
  viewpoint: Pick<Viewpoint, 'mode' | 'coordinates'>
  targets: Array<Pick<TargetPolygon, 'id' | 'name' | 'role' | 'geometry' | 'harvestYear' | 'clearcutPercent' | 'siteDisturbance' | 'recoveryPercent' | 'harvestSystem'>>
  settings: AnalysisSettings; assessmentYear: number; activeLandformId?: string | null
  harvestInventory?: InventoryEvidence
}
export type StationResult = { lng: number; lat: number; groundElevationMeters: number; distanceAlongMeters: number; visiblePercent: number; unknownPercent?: number }
export type TargetVisibility = {
  targetId: string; role: TargetRole; positions: Float64Array; elevations: Float64Array
  /** 0 = occluded/out-of-range, 1 = visible, 2 = unknown. A known visible station wins in the union. */
  anyVisible: Uint8Array; visibleByStation: Uint8Array; visibleDistances: Float64Array
  sampleCount: number; sampleAreaMeters: number; areaMeters: number; visibleAreaMeters: number; visiblePercent: number
  unknownPercent?: number
  apparentSolidAngle: number; visibleApparentSolidAngle: number; apparentVisiblePercent: number
  visibleAreaByZone: Record<string, number>; nearestVisibleDistanceMeters: number | null; farthestVisibleDistanceMeters: number | null
  meanSlopePercent: number | null; vegHeightMeters: number | null; forestedAreaMeters: number | null
  areaInsideLandformMeters: number | null; newAreaInsideLandformMeters: number | null
  visibleApparentSolidAngleNew: number; visibleApparentSolidAngleByStation: Float64Array; visibleApparentSolidAngleNewByStation: Float64Array
  alterationWeight: number; recovered: boolean; siteDisturbance: boolean; outOfRange: boolean; stations: StationResult[]
}
export type AlterationBreakdown = { existingPercent: number; disturbancePercent: number; proposedPercent: number; cumulativePercent: number }
export type AnalysisQuality = {
  terrain: Availability; vegetation: Availability; existingInventory: Availability
  greenBasis: 'inventory-and-openings' | 'confirmed-landform' | 'unverified-whole-landform'
  unknownSightlines: number; unknownStationCount: number; underResolvedTargetIds: string[]
  largestGroundCellPercent: number | null; numericalReady: boolean; warnings: string[]
}
export type AnalysisResult = {
  landformDesign?: import('./landformDesign').LandformDesignReview | null
  settings: AnalysisSettings
  stations: Array<{ lng: number; lat: number; groundElevationMeters: number; distanceAlongMeters: number }>
  corridorLengthMeters: number; assessmentStationIndex: number; targets: TargetVisibility[]
  perspectiveAlteration: AlterationBreakdown | null; perspectiveByStation: Array<AlterationBreakdown | null>
  planimetricAlteration: AlterationBreakdown | null; landformAreaMeters: number | null; landformForestedAreaMeters: number | null
  recoveredOpeningCount: number; canopyCoverageFraction: number | null; canopyStandCount: number
  demTileCount: number; demResolutionMeters: number; missingTileCount: number; elapsedMs: number
  /** Generated by the calculation, not by the view component. Old results without it cannot be exported as current. */
  inputSignature?: string; inputSnapshot?: AnalysisInput; activeLandformId?: string | null
  largestVisibleAreaStationIndex?: number; quality?: AnalysisQuality; actualSightlineCount?: number
  renderStands?: Array<{ geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon; heightMeters: number; crownClosurePercent: number | null; speciesCode?: string | null; stemsPerHa?: number | null }>
}
export type AnalysisProgress = { phase: 'terrain' | 'sightlines'; completed: number; total: number }
export type ReverseInput = {
  blocks: Array<{ id: string; name: string; geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon }>
  roads: Array<{ id: string; name: string; roadClass: string | null; coordinates: Array<[number, number]> }>
  settings: AnalysisSettings
}
export type AnalysisWorkerRequest = { type: 'analyze'; requestId: number; input: AnalysisInput } | { type: 'reverse'; requestId: number; input: ReverseInput }
export type AnalysisWorkerResponse =
  | { type: 'progress'; requestId: number; progress: AnalysisProgress }
  | { type: 'result'; requestId: number; result: AnalysisResult }
  | { type: 'reverse-result'; requestId: number; result: ReverseViewshedResult }
  | { type: 'error'; requestId: number; message: string }

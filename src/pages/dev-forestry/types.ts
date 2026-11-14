/** Shared, serializable scenario and worker shapes. Optional additions migrate v1 scenes. */
import { DEFAULT_DEM_ZOOM } from './terrain'
import type { ReverseViewshedResult } from './reverseViewshed'
import type { VacRating, VisualQualityClassId } from './vqo'
export type ViewpointMode = 'spot' | 'corridor'
/**
 * A reviewer's surveyed eye elevation for a stood-at viewpoint (a spot, or a pullout of at most
 * twice `PULLOUT_METERS`): absolute metres above sea level, kept with the point it was entered for
 * so it lapses when the viewpoint moves (`viewpointStand.ts`).
 */
export type SurveyedEye = { elevationMeters: number; lng: number; lat: number }
export type Viewpoint = {
  id: string
  name: string
  mode: ViewpointMode
  coordinates: Array<[number, number]>
  surveyedEye?: SurveyedEye
}
export type TargetRole = 'block' | 'landscape' | 'harvested'
/**
 * How a proposed block is cut. Dispersed retention keeps its geometry and earns
 * a Table 5 adjustment; a partial cut adds its Table 6 visual equivalent to
 * clearcut rather than counting as cleared ground (handbook 3.4.3.3, 3.4.4).
 */
export type HarvestSystem = 'clearcut' | 'retention' | 'partial'
export type TargetPolygon = {
  id: string
  name: string
  role: TargetRole
  objectiveId: VisualQualityClassId
  vac: VacRating | null
  harvestYear: number | null
  clearcutPercent: number | null
  siteDisturbance?: boolean
  /** Optional observed/modelled recovery estimate. Null retains the explicitly labelled age assumption. */
  recoveryPercent?: number | null
  /**
   * Existing openings only: a dated, signed field check of green-up. When complete it overrides
   * the modelled share (`greenUp.ts`); the modelled share is kept and shown beside it.
   */
  fieldGreenUp?: import('./greenUp').FieldGreenUp | null
  /** Proposed blocks only; absent means clearcut. */
  harvestSystem?: HarvestSystem
  /** Dispersed retention: share of the stand left standing, percent. */
  retentionPercent?: number | null
  /** Partial cut: share of volume removed, percent, and the mean height of the trees left. */
  volumeRemovedPercent?: number | null
  residualHeightMeters?: number | null
  /** Optional planned date; used by the explicit scheduling runner, not ordinary VIA runs. */
  plannedHarvestYear?: number | null
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
  source: string
  inventoryUnitId?: string | null
  /** Block, licence, permit and opening from the imported attributes; display only. */
  planning?: import('./shapeImport').BlockPlanningIds
  /**
   * The colour the block is drawn in on the map and in the road view (`#rrggbb`).
   * Display only: kept out of the run's fingerprint, so recolouring never stales a run.
   */
  displayColor?: string | null
}
export type AssessmentMaskKind = 'natural' | 'private' | 'permanent' | 'retained'
export type AssessmentMask = {
  id: string
  name: string
  kind: AssessmentMaskKind
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
  source: string
}
/** A cropped, native-resolution, north-up raster. Null cells remain unknown. Heights are metres. */
export type LocalRaster = {
  id: string
  name: string
  kind: 'terrain' | 'canopy'
  epsg: number
  origin: [number, number]
  pixelSize: [number, number]
  width: number
  height: number
  values: Array<number | null>
  acquired: string
  verticalReference: string
  sha256: string
}
export type Availability = 'complete' | 'partial' | 'unavailable' | 'not-requested' | 'scenario-only'
export type InventoryEvidence = {
  status: Availability
  bounds?: [number, number, number, number]
  retrievedAt?: string
  source?: string
}
export type AnalysisSettings = {
  demZoom: number
  observerHeightMeters: number
  targetOffsetMeters: number
  stationSpacingMeters: number
  maxViewDistanceMeters: number
  sampleBudget: number
  greenUpAgeYears: number
  screeningEnabled: boolean
  minCrownClosurePercent: number
  /** Explicit scenario assumptions, NEVER silently enabled by migration or by a failed query. */
  greenAreaConfirmed?: boolean
  existingDisturbanceConfirmed?: boolean
  /**
   * What the perspective figure's denominator leaves out of the landform. `non-vegetated-out`
   * (absent reads as this): VRI non-vegetated ground (BCLCS level 1 `N`: rock, water, ice), as a
   * VIA's "net of rock" does. `non-treed-out`: every non-treed polygon, the 1998 procedure's "green
   * (forested)" portion, which the planimetric figure always uses. See the doc's evidence.
   */
  perspectiveDenominator?: 'non-vegetated-out' | 'non-treed-out'
  /**
   * Private-land masks leave both denominators (a VIA's landform − private land) while keeping
   * their timber for screening. Off by default: until on, private land stays in the denominator
   * and only carries no alteration.
   */
  privateLandOutOfDenominator?: boolean
  /** With screening on, timber this close to each station is cleared, metres (VRI stands cover roads and shores). */
  screeningEyeClearingMeters?: number
}
export const DEFAULT_ANALYSIS_SETTINGS: AnalysisSettings = {
  demZoom: DEFAULT_DEM_ZOOM,
  observerHeightMeters: 1.6,
  targetOffsetMeters: 0,
  stationSpacingMeters: 150,
  maxViewDistanceMeters: 12000,
  sampleBudget: 900,
  greenUpAgeYears: 20,
  screeningEnabled: false,
  minCrownClosurePercent: 30,
  greenAreaConfirmed: false,
  existingDisturbanceConfirmed: false,
  perspectiveDenominator: 'non-vegetated-out',
  privateLandOutOfDenominator: false,
  screeningEyeClearingMeters: 50,
}
export type AnalysisInput = {
  /**
   * `eyeElevationMeters`: a surveyed eye elevation that applies (`surveyedEyeElevation`), absolute
   * metres. Every station's eye stands there in place of the terrain model's ground + eye height.
   */
  viewpoint: Pick<Viewpoint, 'mode' | 'coordinates'> & { eyeElevationMeters?: number }
  targets: Array<
    Pick<
      TargetPolygon,
      | 'id'
      | 'name'
      | 'role'
      | 'geometry'
      | 'harvestYear'
      | 'clearcutPercent'
      | 'siteDisturbance'
      | 'recoveryPercent'
      | 'harvestSystem'
    > & { fieldGreenUp?: import('./greenUp').FieldGreenUpInput }
  >
  settings: AnalysisSettings
  assessmentYear: number
  activeLandformId?: string | null
  harvestInventory?: InventoryEvidence
  masks?: AssessmentMask[]
  localRasters?: LocalRaster[]
}
export type StationResult = {
  lng: number
  lat: number
  groundElevationMeters: number
  distanceAlongMeters: number
  visiblePercent: number
  unknownPercent?: number
}
export type TargetVisibility = {
  targetId: string
  role: TargetRole
  positions: Float64Array
  elevations: Float64Array
  /** 0 = occluded/out-of-range, 1 = visible, 2 = unknown. A known visible station wins in the union. */
  anyVisible: Uint8Array
  /**
   * 1 where the bare ground is clear from at least one station: visible, or
   * hidden only by the timber screening the sightline. A sample hidden with
   * this set is screened, not behind a ridge. Absent on runs saved before it.
   */
  anyBareEarthVisible?: Uint8Array
  visibleByStation: Uint8Array
  visibleDistances: Float64Array
  sampleCount: number
  sampleAreaMeters: number
  areaMeters: number
  visibleAreaMeters: number
  visiblePercent: number
  unknownPercent?: number
  apparentSolidAngle: number
  visibleApparentSolidAngle: number
  apparentVisiblePercent: number
  visibleAreaByZone: Record<string, number>
  nearestVisibleDistanceMeters: number | null
  farthestVisibleDistanceMeters: number | null
  meanSlopePercent: number | null
  vegHeightMeters: number | null
  forestedAreaMeters: number | null
  areaInsideLandformMeters: number | null
  newAreaInsideLandformMeters: number | null
  visibleApparentSolidAngleNew: number
  visibleApparentSolidAngleByStation: Float64Array
  visibleApparentSolidAngleNewByStation: Float64Array
  alterationWeight: number
  recovered: boolean
  siteDisturbance: boolean
  outOfRange: boolean
  stations: StationResult[]
}
export type AlterationBreakdown = {
  existingPercent: number
  disturbancePercent: number
  proposedPercent: number
  cumulativePercent: number
}
export type AnalysisQuality = {
  terrain: Availability
  vegetation: Availability
  existingInventory: Availability
  greenBasis: 'inventory-and-openings' | 'confirmed-landform' | 'unverified-whole-landform'
  unknownSightlines: number
  unknownStationCount: number
  underResolvedTargetIds: string[]
  largestGroundCellPercent: number | null
  numericalReady: boolean
  warnings: string[]
}
export type AnalysisResult = {
  sightlineProfile?: import('./sightlineProfile').SightlineProfile
  sourceNotes?: string[]
  landformDesign?: import('./landformDesign').LandformDesignReview | null
  settings: AnalysisSettings
  /**
   * `groundElevationMeters` is the ground the eye stands on. With a surveyed eye elevation it is that
   * elevation less the eye height, and `terrainGroundElevationMeters` keeps the terrain model's reading.
   */
  stations: Array<{
    lng: number
    lat: number
    groundElevationMeters: number
    distanceAlongMeters: number
    terrainGroundElevationMeters?: number
  }>
  corridorLengthMeters: number
  assessmentStationIndex: number
  targets: TargetVisibility[]
  perspectiveAlteration: AlterationBreakdown | null
  perspectiveByStation: Array<AlterationBreakdown | null>
  planimetricAlteration: AlterationBreakdown | null
  landformAreaMeters: number | null
  landformForestedAreaMeters: number | null
  recoveredOpeningCount: number
  canopyCoverageFraction: number | null
  canopyStandCount: number
  demTileCount: number
  demResolutionMeters: number
  missingTileCount: number
  elapsedMs: number
  /** Generated by the calculation, not by the view component. Old results without it cannot be exported as current. */
  inputSignature?: string
  inputSnapshot?: AnalysisInput
  activeLandformId?: string | null
  largestVisibleAreaStationIndex?: number
  quality?: AnalysisQuality
  actualSightlineCount?: number
  /**
   * VRI non-vegetated land (rock, rubble, exposed soil) around the landform, from the run's own
   * vegetation read: the rock a VIA figure draws. Display only; no figure reads it.
   */
  nonVegetatedGround?: Array<GeoJSON.Polygon | GeoJSON.MultiPolygon>
  renderStands?: Array<{
    geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
    heightMeters: number
    crownClosurePercent: number | null
    speciesCode?: string | null
    stemsPerHa?: number | null
    speciesComposition?: Array<{ code: string; percent: number; heightMeters: number | null }>
  }>
  /**
   * Non-treed inventory ground in the view (water, rock, shrub, herb), for
   * drawing only: the road view grows no timber on it. Not used by any figure.
   */
  renderCover?: Array<{
    geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
    cover: import('./forest').GroundCover
  }>
  /**
   * The run's VRI read as a scene package's ground cover source (`terrain.cover`, `coverOnGrid`): its open-ground
   * polygons, and its box when the read was whole. Display only; no figure reads it.
   */
  sceneCover?: import('./sceneCover').SceneCoverSource
}
export type AnalysisProgress = { phase: 'terrain' | 'sightlines'; completed: number; total: number }
export type ReverseInput = {
  blocks: Array<{ id: string; name: string; geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon }>
  roads: Array<{ id: string; name: string; roadClass: string | null; coordinates: Array<[number, number]> }>
  settings: AnalysisSettings
}
export type AnalysisWorkerRequest =
  | {
      type: 'analyze'
      requestId: number
      input: AnalysisInput
      inspection?: { targetId: string; sampleIndex: number; stationIndex: number }
    }
  | { type: 'reverse'; requestId: number; input: ReverseInput }
export type AnalysisWorkerResponse =
  | { type: 'progress'; requestId: number; progress: AnalysisProgress }
  | { type: 'result'; requestId: number; result: AnalysisResult }
  | { type: 'reverse-result'; requestId: number; result: ReverseViewshedResult }
  | { type: 'error'; requestId: number; message: string }

import type { LocalRaster } from '../dev-forestry/types'
import type { ElevationSource } from '../dev-forestry/terrain'
import type { AlignmentEngineering, EngineeringAnalysis } from './engineeringTypes'
import type { VerticalCheck, VerticalControl, VerticalStandards } from './verticalStandards'
import type { RouteSearchOptions } from './routing'
import type { RoadNetworkEvidence } from './roadNetworkTypes'
import type { RoadConditionObservation, RoadConditionPolicy } from './roadCondition'
import type { TotalCostPlanning } from './fullCostPlanning'
import type { FullCostReviewRecord } from './fullCostRecord'
import type { DrainageProjectState } from './drainageEvidence'
import type { RoadReportSettings } from './reportSettings'
export type { GradeRange, VerticalCheck, VerticalControl, VerticalStandards } from './verticalStandards'
export type * from './engineeringTypes'

export type Coordinate = [number, number]
export interface RoadPoint {
  id: string
  coordinate: Coordinate
  radiusM: number
  /** Clothoid transition length on each side of the circular curve; omitted or 0 is a simple curve. */
  spiralM?: number
}
export interface VerticalPoint {
  id: string
  chainage: number
  elevation: number
  curveLength: number
}
export interface SectionComponent {
  id: string
  name: string
  side: 'left' | 'right'
  kind: 'bench' | 'slope' | 'wall' | 'key'
  condition: 'always' | 'cut' | 'fill'
  widthM: number
  /** Metres rising away from the road; key uses depthM instead. */
  riseM: number
  depthM?: number
  /** Key starts this far outside the formation edge. */
  offsetM?: number
  materialId?: string
  code?: string
  /** A named context line/polygon intersects the section to anchor the component endpoint. */
  referenceFeatureId?: string
  /** original-ground, prepared-ground, or a named retained analytical surface. */
  referenceSurfaceId?: string
  referenceOffsetM?: number
  referenceElevationM?: number
}
export interface SectionLayer {
  id: string
  name: string
  side: 'left' | 'right' | 'both'
  depthM: number
  materialId?: string
}
export interface RoadTemplate {
  leftWidth: number
  rightWidth: number
  crossfallPercent: number
  cutSlope: number
  fillSlope: number
  ditchWidth: number
  ditchDepth: number
  surfaceDepth: number
  /** Flat ditch bottom inside the ditch width: 0 (or omitted) is a V ditch, up to the width is a U / box ditch. */
  ditchBottomWidth?: number
  /** Optional side-specific values; omitted values inherit the symmetric base setting. */
  leftCrossfallPercent?: number
  rightCrossfallPercent?: number
  leftCutSlope?: number
  rightCutSlope?: number
  leftFillSlope?: number
  rightFillSlope?: number
  leftDitchWidth?: number
  rightDitchWidth?: number
  leftDitchDepth?: number
  rightDitchDepth?: number
  leftDitchBottomWidth?: number
  rightDitchBottomWidth?: number
  leftSurfaceDepth?: number
  rightSurfaceDepth?: number
  /** Ordered additions between ditch/formation and the daylight batter. */
  components?: SectionComponent[]
  /** Explicit surface course stack replaces legacy surfaceDepth when present. */
  layers?: SectionLayer[]
}
export interface WidthOverride {
  id: string
  name: string
  kind: 'landing' | 'turnout'
  start: number
  end: number
  taper: number
  side: 'left' | 'right' | 'both'
  extraWidth: number
  entryTaperM?: number
  exitTaperM?: number
}
/**
 * Design-speed curve rules: superelevation e = V²/(127 R) − f, held between the normal crown and
 * the maximum, rotated about the centreline, plus inside widening L²/(2R) for a vehicle of length L.
 * Both run in linearly over the runoff length before each curve and out after it.
 */
export interface CurveDesign {
  /** User-entered criteria identity and source; never implies a certified road standard. */
  criteriaName?: string
  criteriaSource?: string
  designSpeedKmh: number
  maxSuperelevationPercent: number
  sideFrictionFactor: number
  runoffLengthM: number
  /** Null for no curve widening. */
  wideningVehicleLengthM: number | null
  /** Optional rectangular radius/deflection table, interpolated independently on the two sides. */
  wideningTable?: { radiusM: number; deflectionDegrees: number; insideM: number; outsideM: number }[]
  /** Added to the table/formula width on its named side. */
  insideWideningM?: number
  outsideWideningM?: number
}
export interface Alignment {
  id: string
  name: string
  color: string
  points: RoadPoint[]
  vertical: VerticalPoint[]
  /** Named profiles share this road's horizontal geometry. `vertical` is the active editable profile. */
  verticalAlternatives?: VerticalAlternative[]
  activeVerticalAlternativeId?: string
  /** Shared engineering inputs, or a separately saved engineering design for each profile. */
  verticalAlternativeCostMode?: 'shared' | 'independent'
  template: RoadTemplate
  overrides: WidthOverride[]
  engineering?: AlignmentEngineering
  /** Optional vertical standards and control points; unset values are not checked. */
  verticalStandards?: VerticalStandards
  verticalControls?: VerticalControl[]
  curveDesign?: CurveDesign
  fullCostRecord?: FullCostReviewRecord
  /** Reviewed road section at the connector's end, including permit/user roads and ambiguous levels. */
  networkEntryRoadId?: string
  /** Recorded origin and destination of a generated FSR connector; later edits may change the junction. */
  fsrConnection?: {
    targetFeatureId: string
    targetName: string
    targetCoordinate: Coordinate
    originCoordinate: Coordinate
    originAlignmentId: string
    endpoint: 'start' | 'end'
    preference: 'nearest' | 'lowest-cost' | 'chosen'
    networkScope: string
    straightLineDistanceM: number
    routeLengthM: number
    searchCost: number
  }
}
export interface VerticalAlternative {
  id: string
  name: string
  vertical: VerticalPoint[]
  verticalStandards?: VerticalStandards
  verticalControls?: VerticalControl[]
  /** Used only with independent engineering inputs. Horizontal template/width ranges remain shared. */
  engineering?: AlignmentEngineering
  /** Historical/current comparison evidence belongs to its vertical design and is retained on switches. */
  fullCostRecord?: FullCostReviewRecord
}
export interface ContextFeature {
  id: string
  name: string
  kind: 'stream' | 'avoid' | 'existing-road' | 'harvest'
  geometry: GeoJSON.LineString | GeoJSON.Polygon
  /** Required before source Z can anchor an engineering section; must match project terrain. */
  referenceVerticalDatum?: string
  /** On an avoid polygon: route search may cross it at this extra CAD per metre instead of being blocked. */
  routeCostPerM?: number
  /** A feature price overrides its group's price, which overrides the route-search default. */
  crossingCost?: number
  crossingGroup?: string
  /** Catalogue facts and separately entered planning assumptions; tenure dates are not road age. */
  roadEvidence?: ExistingRoadEvidence
}
export interface ExistingRoadEvidence {
  source: 'bc-ften' | 'user' | 'scenario'
  /** FSR identity comes from the source file-type code, never the name or file ID. */
  roadClass?: 'fsr' | 'permit' | 'user'
  fileTypeCode?: string
  lifecycleStatus?: string
  sourceId?: string
  sourceUrl?: string
  retrievedAt?: string
  status?: string
  awardDate?: string
  retirementDate?: string
  constructionYear?: number
  condition: 'unknown' | 'serviceable' | 'rehabilitation' | 'closed'
  conditionBasis: 'unreviewed' | 'assumed' | 'field-verified'
  /** Explicit planning opt-in, never inferred from a permit status or a record date. */
  reuseAllowed: boolean
  /** A refreshed line changed geometry; retained evidence/restrictions require explicit scope review. */
  geometryReviewRequired?: boolean
  network?: RoadNetworkEvidence
  observations?: RoadConditionObservation[]
  conditionPolicy?: RoadConditionPolicy
}
export interface CableLine {
  id: string
  name: string
  start: Coordinate
  end: Coordinate
  startHeight: number
  endHeight: number
  deflectionPercent: number
  /** Positive offsets inset each original endpoint; negative offsets extend it. */
  startOffsetM?: number
  endOffsetM?: number
  /** startHeight is the yarder height; endHeight is the tailhold height. */
  yarderAt?: 'start' | 'end'
}
export interface RoadSettings {
  stationInterval: number
  crossSectionHalfWidth: number
  maxGradePercent: number
  minRadius: number
  cutRate: number
  fillRate: number
  surfacingRate: number
  clearingRate: number
  shrinkFactor: number
}
export interface TerrainMetadata {
  kind: 'demo' | 'geotiff' | 'regional'
  name: string
  resolutionM: number
  verticalReference: string
  epsg?: number
  sourceUrl?: string
  sha256?: string
  raster?: LocalRaster
  /** Explicit reproducible source preparation; retained TIN is optional and bounded. */
  preparation?: import('./terrainPreparation').TerrainPreparationRecord
  /** Independent imagery/canopy display stack; never analytical ground. */
  backgrounds?: import('./terrainPreparation').TerrainBackgroundLayer[]
  /** Reviewed analytical grid snapshots, kept separate from display-only canopy/imagery. */
  referenceSurfaces?: Array<{ id: string; name: string; raster: LocalRaster }>
  /** Regional DEMs only: the extent loaded, [west, south, east, north], so reopening loads it again. */
  bounds?: [number, number, number, number]
}
export interface RoadProject {
  schema: 'pgmaps-road-project-v1'
  name: string
  /** Persistent library loading/coverage evidence, retained when a scenario is saved. */
  scenario?: { id: string; contextWarnings: string[]; terrainCoveragePercent: number }
  activeAlignmentId: string
  alignments: Alignment[]
  terrain: TerrainMetadata
  settings: RoadSettings
  /** Portable drawing settings; report intervals never alter analytical station spacing. */
  reportSettings?: RoadReportSettings
  /** Optional saved route-search assumptions; older projects retain the current defaults. */
  routeSearch?: RouteSearchOptions
  /** Explicit vehicle, network, evidence, supply and final-check inputs for complete route comparisons. */
  totalCostPlanning?: TotalCostPlanning
  /** Portable inputs and compact, fingerprinted drainage evidence; full grids are recomputed. */
  drainage?: DrainageProjectState
  context: ContextFeature[]
  cables: CableLine[]
  profiles?: { id: string; name: string; points: Coordinate[] }[]
  surveyBooks?: import('./surveyInterchange').SurveyBookRecord[]
}
export interface SectionSample {
  offset: number
  ground: number | null
  design: number | null
  /** Ground after site preparation; ground above retains the source measurement. */
  preparedGround?: number | null
}
export interface RoadStation {
  index: number
  chainage: number
  coordinate: Coordinate
  bearing: number
  groundElevation: number | null
  designElevation: number | null
  gradePercent: number | null
  groundGradePercent: number | null
  curveRadiusM: number | null
  leftWidth: number
  rightWidth: number
  section: SectionSample[]
  preparationAreas?: { materialId?: string; purpose: 'stripping' | 'earthwork'; areaM2: number }[]
  layerAreas?: { id: string; name: string; materialId?: string; areaM2: number }[]
  componentAreas?: { id: string; name: string; materialId?: string; areaM2: number }[]
  componentPoints?: { code: string; offset: number; design: number }[]
  /** Includes preparation margins beyond the constructed catches. */
  clearingWidthM?: number
  leftClearingM?: number
  rightClearingM?: number
  cutAreaM2: number | null
  fillAreaM2: number | null
  cutVolumeM3: number | null
  fillVolumeM3: number | null
  massM3: number | null
  leftDaylightM: number | null
  rightDaylightM: number | null
  complete: boolean
  flags: string[]
}
export interface Crossing {
  id: string
  featureId: string
  name: string
  kind: ContextFeature['kind']
  chainage: number
  coordinate: Coordinate
}
export interface RoadAnalysis {
  stations: RoadStation[]
  centerline: Coordinate[]
  crossings: Crossing[]
  length: number
  cutVolumeM3: number
  fillVolumeM3: number
  balanceM3: number
  surfaceVolumeM3: number
  clearingAreaM2: number
  estimatedCost: number
  maxGradePercent: number
  completeLength: number
  coveragePercent: number
  warnings: string[]
  engineering?: EngineeringAnalysis
  /** Failed vertical standard / control checks, each also flagged on its nearest station. */
  verticalChecks?: VerticalCheck[]
}
export interface CableSample {
  distance: number
  ground: number | null
  cable: number | null
  clearance: number | null
}
export interface CableAnalysis {
  samples: CableSample[]
  length: number
  minClearance: number | null
  complete: boolean
}
export type TerrainSource = ElevationSource

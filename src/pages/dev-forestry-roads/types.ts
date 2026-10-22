import type { LocalRaster } from '../dev-forestry/types'
import type { ElevationSource } from '../dev-forestry/terrain'
import type { AlignmentEngineering, EngineeringAnalysis } from './engineeringTypes'
import type { VerticalCheck, VerticalControl, VerticalStandards } from './verticalStandards'
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
}
/**
 * Design-speed curve rules: superelevation e = V²/(127 R) − f, held between the normal crown and
 * the maximum, rotated about the centreline, plus inside widening L²/(2R) for a vehicle of length L.
 * Both run in linearly over the runoff length before each curve and out after it.
 */
export interface CurveDesign {
  designSpeedKmh: number
  maxSuperelevationPercent: number
  sideFrictionFactor: number
  runoffLengthM: number
  /** Null for no curve widening. */
  wideningVehicleLengthM: number | null
}
export interface Alignment {
  id: string
  name: string
  color: string
  points: RoadPoint[]
  vertical: VerticalPoint[]
  template: RoadTemplate
  overrides: WidthOverride[]
  engineering?: AlignmentEngineering
  /** Optional vertical standards and control points; unset values are not checked. */
  verticalStandards?: VerticalStandards
  verticalControls?: VerticalControl[]
  curveDesign?: CurveDesign
}
export interface ContextFeature {
  id: string
  name: string
  kind: 'stream' | 'avoid' | 'existing-road' | 'harvest'
  geometry: GeoJSON.LineString | GeoJSON.Polygon
  /** On an avoid polygon: route search may cross it at this extra CAD per metre instead of being blocked. */
  routeCostPerM?: number
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
}
export interface RoadProject {
  schema: 'pgmaps-road-project-v1'
  name: string
  activeAlignmentId: string
  alignments: Alignment[]
  terrain: TerrainMetadata
  settings: RoadSettings
  context: ContextFeature[]
  cables: CableLine[]
  profiles?: { id: string; name: string; points: Coordinate[] }[]
}
export interface SectionSample {
  offset: number
  ground: number | null
  design: number | null
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

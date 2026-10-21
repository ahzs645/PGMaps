import type { LocalRaster } from '../dev-forestry/types'
import type { ElevationSource } from '../dev-forestry/terrain'

export type Coordinate = [number, number]
export interface RoadPoint {
  id: string
  coordinate: Coordinate
  radiusM: number
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
export interface Alignment {
  id: string
  name: string
  color: string
  points: RoadPoint[]
  vertical: VerticalPoint[]
  template: RoadTemplate
  overrides: WidthOverride[]
}
export interface ContextFeature {
  id: string
  name: string
  kind: 'stream' | 'avoid' | 'existing-road' | 'harvest'
  geometry: GeoJSON.LineString | GeoJSON.Polygon
}
export interface CableLine {
  id: string
  name: string
  start: Coordinate
  end: Coordinate
  startHeight: number
  endHeight: number
  deflectionPercent: number
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

/** Shared shapes for the forestry visual-quality utility. */

import { DEFAULT_DEM_ZOOM } from './terrain'
import type { VacRating, VisualQualityClassId } from './vqo'

/** A spot beside the road, or a length of road driven end to end. */
export type ViewpointMode = 'spot' | 'corridor'

export type Viewpoint = {
  id: string
  name: string
  mode: ViewpointMode
  /** One position for a spot; the road centreline for a corridor. */
  coordinates: Array<[number, number]>
}

/**
 * Blocks are what gets assessed; a landform is what they are assessed against.
 * Percent alteration is written against a readily identifiable landform — a hill
 * or mountain bounded by ridges, valleys, shorelines, and skylines — rather than
 * against an entire visible landscape.
 */
export type TargetRole = 'block' | 'landscape'

export type TargetPolygon = {
  id: string
  name: string
  role: TargetRole
  objectiveId: VisualQualityClassId
  /**
   * Visual absorption capability, on a landform. Narrows the planimetric
   * allowance from the class range to a single figure; null where the
   * inventory has no rating, which is much of the province.
   */
  vac: VacRating | null
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
  /** Where it came from, shown in the sidebar so imports stay traceable. */
  source: string
}

export type AnalysisSettings = {
  /** DEM tile zoom — higher is finer terrain and more tiles to fetch. */
  demZoom: number
  /** Eye height above the road, in metres. */
  observerHeightMeters: number
  /** Height added to each target sample; 0 assesses the cut surface itself. */
  targetOffsetMeters: number
  /** Distance between viewing stations along a corridor, in metres. */
  stationSpacingMeters: number
  /** Targets further than this are treated as out of view. */
  maxViewDistanceMeters: number
  /** Target number of grid samples per polygon. */
  sampleBudget: number
}

export const DEFAULT_ANALYSIS_SETTINGS: AnalysisSettings = {
  demZoom: DEFAULT_DEM_ZOOM,
  observerHeightMeters: 1.6,
  targetOffsetMeters: 0,
  stationSpacingMeters: 150,
  maxViewDistanceMeters: 12000,
  sampleBudget: 900,
}

export type AnalysisInput = {
  viewpoint: Pick<Viewpoint, 'mode' | 'coordinates'>
  targets: Array<Pick<TargetPolygon, 'id' | 'name' | 'role' | 'geometry'>>
  settings: AnalysisSettings
}

export type StationResult = {
  lng: number
  lat: number
  groundElevationMeters: number
  distanceAlongMeters: number
  /** Share of the polygon's ground area visible from this station alone. */
  visiblePercent: number
}

export type TargetVisibility = {
  targetId: string
  role: TargetRole
  /** `[lng, lat]` pairs, two entries per sample. */
  positions: Float64Array
  /** Ground elevation per sample, in metres. */
  elevations: Float64Array
  /** 1 where the sample is visible from at least one station. */
  anyVisible: Uint8Array
  /** `stationCount × sampleCount`, row-major by station. */
  visibleByStation: Uint8Array
  /** Distance to the nearest station that can see each sample, or -1 when none can. */
  visibleDistances: Float64Array
  sampleCount: number
  /** Ground area each sample stands for, in square metres. */
  sampleAreaMeters: number
  areaMeters: number
  visibleAreaMeters: number
  visiblePercent: number
  /** Solid angle the whole polygon subtends from the assessment station. */
  apparentSolidAngle: number
  /** Solid angle of only the parts visible from the assessment station. */
  visibleApparentSolidAngle: number
  /** Share of the polygon's apparent area that is visible, in percent. */
  apparentVisiblePercent: number
  /** Visible ground area split across foreground / middleground / background. */
  visibleAreaByZone: Record<string, number>
  nearestVisibleDistanceMeters: number | null
  farthestVisibleDistanceMeters: number | null
  /** Mean ground slope over the polygon, in percent — drives green-up height. */
  meanSlopePercent: number | null
  /** Polygon area falling inside the landform, or null when there is no landform. */
  areaInsideLandformMeters: number | null
  /** True when every station sits beyond the maximum view distance. */
  outOfRange: boolean
  stations: StationResult[]
}

export type AnalysisResult = {
  /** Echoes the settings the numbers were produced with. */
  settings: AnalysisSettings
  stations: Array<{ lng: number; lat: number; groundElevationMeters: number; distanceAlongMeters: number }>
  corridorLengthMeters: number
  /** Station the perspective metrics were measured from — the worst case for the blocks. */
  assessmentStationIndex: number
  targets: TargetVisibility[]
  /**
   * Altered share of the landform's visible face at the assessment station —
   * the scale a visual quality objective is defined on. Null until a landform
   * is supplied to divide by.
   */
  perspectiveAlterationPercent: number | null
  /**
   * Altered share of the landform's map area, visible or not — the looser
   * scale timber supply analyses model against.
   */
  planimetricAlterationPercent: number | null
  landformAreaMeters: number | null
  demTileCount: number
  demResolutionMeters: number
  /** Tiles the DEM source did not return; their ground is treated as unknown. */
  missingTileCount: number
  elapsedMs: number
}

export type AnalysisProgress = {
  phase: 'terrain' | 'sightlines'
  completed: number
  total: number
}

export type AnalysisWorkerRequest = {
  type: 'analyze'
  requestId: number
  input: AnalysisInput
}

export type AnalysisWorkerResponse =
  | { type: 'progress'; requestId: number; progress: AnalysisProgress }
  | { type: 'result'; requestId: number; result: AnalysisResult }
  | { type: 'error'; requestId: number; message: string }

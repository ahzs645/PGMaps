/** Shared shapes for the forestry visual-quality utility. */

import { DEFAULT_DEM_ZOOM } from './terrain'
import type { ReverseViewshedResult } from './reverseViewshed'
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
 * Blocks are what gets assessed; a landform is what they are assessed against;
 * harvested ground is what has already been taken off it.
 *
 * Percent alteration is written against a readily identifiable landform — a hill
 * or mountain bounded by ridges, valleys, shorelines, and skylines — rather than
 * against an entire visible landscape.
 */
export type TargetRole = 'block' | 'landscape' | 'harvested'

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
  /** Year the opening was harvested, on existing disturbance. */
  harvestYear: number | null
  /**
   * Share of an existing opening that was clearcut rather than partial cut.
   * Only the clearcut part reads as denudation.
   */
  clearcutPercent: number | null
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
  /** Where it came from, shown in the sidebar so imports stay traceable. */
  source: string
  /**
   * The visual landscape inventory polygon this was adopted from, when it was.
   * Keeps the link to the inventory record so the worksheet can fill FS1252's
   * VLI section — polygon number, VSC, scenic area — from the source rather
   * than from the name it was labelled with.
   */
  inventoryUnitId?: string | null
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
  /**
   * Years after harvest at which an opening is treated as recovered and stops
   * counting as alteration. The references give the green-up *height* a slope
   * needs (Table 6), not how long a site takes to reach it, so this is a
   * planning assumption rather than a published figure.
   */
  greenUpAgeYears: number
  /**
   * Whether standing timber is added to the sightline as screening. Off by
   * default: the inventory now covers the whole landscape, so this is a real
   * answer rather than a partial one, but it is a multi-megabyte query and the
   * run is honest without it.
   */
  screeningEnabled: boolean
  /** Stands more open than this do not screen. */
  minCrownClosurePercent: number
}

export const DEFAULT_ANALYSIS_SETTINGS: AnalysisSettings = {
  demZoom: DEFAULT_DEM_ZOOM,
  observerHeightMeters: 1.6,
  targetOffsetMeters: 0,
  stationSpacingMeters: 150,
  maxViewDistanceMeters: 12000,
  sampleBudget: 900,
  greenUpAgeYears: 20,
  // Off by default: the live source covers managed openings only, so leaving it
  // on would imply more screening than the data can support.
  screeningEnabled: false,
  minCrownClosurePercent: 30,
}

export type AnalysisInput = {
  viewpoint: Pick<Viewpoint, 'mode' | 'coordinates'>
  targets: Array<Pick<TargetPolygon, 'id' | 'name' | 'role' | 'geometry' | 'harvestYear' | 'clearcutPercent'>>
  settings: AnalysisSettings
  /** Year the run is assessed in, so green-up is reproducible. */
  assessmentYear: number
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
  /** Mean ground slope over the polygon, in percent. */
  meanSlopePercent: number | null
  /**
   * Visually effective green-up height, in metres: Table 6's height for each
   * sample's own slope class, weighted by the ground each sample stands for,
   * which is the procedure the 1998 document sets out. Reading one height off
   * the mean slope gives a different — and, on mixed ground, wrong — answer.
   */
  vegHeightMeters: number | null
  /**
   * Treed area inside this landform, from the vegetation inventory — the
   * procedure's "green (forested) portion". Null on a block, and on a landform
   * when no inventory was supplied.
   */
  forestedAreaMeters: number | null
  /** Polygon area falling inside the landform, or null when there is no landform. */
  areaInsideLandformMeters: number | null
  /** The same, minus ground an existing opening already holds. */
  newAreaInsideLandformMeters: number | null
  /** Solid angle of visible ground not already held by an existing opening. */
  visibleApparentSolidAngleNew: number
  /**
   * The two solid-angle sums above, per station rather than only for the
   * assessment one, so any viewpoint on the corridor can be worked as its own
   * assessment. FS1252 asks for the calculation to be repeated per viewpoint.
   */
  visibleApparentSolidAngleByStation: Float64Array
  visibleApparentSolidAngleNewByStation: Float64Array
  /** How much of this polygon reads as denudation, 0–1. */
  alterationWeight: number
  /** True for an existing opening that has passed green-up. */
  recovered: boolean
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
   * Alteration on the scale a visual quality objective is defined on: the
   * landform's visible face, from the assessment station. Null until a landform
   * is supplied to divide by.
   */
  perspectiveAlteration: AlterationBreakdown | null
  /**
   * The perspective figure worked from every station, not just the assessment
   * one. FS1252 says to repeat the calculation for each viewpoint selected for
   * evaluation; a corridor run has one per station already paid for, so this
   * carries them all. Null at a station that sees none of the landform.
   */
  perspectiveByStation: Array<AlterationBreakdown | null>
  /**
   * Alteration on the looser scale timber supply analyses model against: the
   * landform's map area, visible or not.
   */
  planimetricAlteration: AlterationBreakdown | null
  landformAreaMeters: number | null
  /**
   * The landform's treed area, which is what the planimetric figure divides by
   * when the inventory supplied one. Null means the whole area was used, and
   * the figure reads low by however much of the landform was never forest.
   */
  landformForestedAreaMeters: number | null
  /** Existing openings excluded because they have passed green-up. */
  recoveredOpeningCount: number
  /** Share of the analysis area carrying screening timber, or null when off. */
  canopyCoverageFraction: number | null
  /** Inventory stands the screening grid was built from. */
  canopyStandCount: number
  demTileCount: number
  demResolutionMeters: number
  /** Tiles the DEM source did not return; their ground is treated as unknown. */
  missingTileCount: number
  elapsedMs: number
}

/**
 * Alteration split into what is already on the ground and what is proposed.
 * Proposed excludes ground that already counts as existing, so a block laid
 * over an old opening is not charged twice.
 */
export type AlterationBreakdown = {
  existingPercent: number
  proposedPercent: number
  cumulativePercent: number
}

export type AnalysisProgress = {
  phase: 'terrain' | 'sightlines'
  completed: number
  total: number
}

/** Working backwards: which roads can see these blocks. */
export type ReverseInput = {
  blocks: Array<{ id: string; name: string; geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon }>
  roads: Array<{ id: string; name: string; roadClass: string | null; coordinates: Array<[number, number]> }>
  settings: AnalysisSettings
}

export type AnalysisWorkerRequest =
  | { type: 'analyze'; requestId: number; input: AnalysisInput }
  | { type: 'reverse'; requestId: number; input: ReverseInput }

export type AnalysisWorkerResponse =
  | { type: 'progress'; requestId: number; progress: AnalysisProgress }
  | { type: 'result'; requestId: number; result: AnalysisResult }
  | { type: 'reverse-result'; requestId: number; result: ReverseViewshedResult }
  | { type: 'error'; requestId: number; message: string }

/**
 * The page's document: a viewpoint, the polygons to assess, and the settings
 * and thresholds they are assessed under. Kept separate from the React tree so
 * it can be saved, restored, exported, and turned into map layers.
 */

import { geometryBounds, type BBox } from '@/lib/geo'
import type { InventoryEvidence } from './types'
import type { FormMetadata } from './pdf/fs1252'
import { parseViaReview, type ViaReview } from './via'

import { polygonAreaMeters, polygonBounds } from './visibility'
import {
  DEFAULT_ANALYSIS_SETTINGS,
  type AnalysisResult,
  type AnalysisSettings,
  type TargetPolygon,
  type TargetRole,
  type Viewpoint,
} from './types'
import {
  DEFAULT_VISUAL_QUALITY_CLASS_ID,
  DEFAULT_VISUAL_QUALITY_THRESHOLDS,
  VAC_RATINGS,
  VISUAL_QUALITY_CLASSES,
  type AlterationBasis,
  type VacRating,
  type VisualQualityClassId,
  type VisualQualityThresholds,
} from './vqo'

export const SCENE_STORAGE_KEY = 'pgmaps.forestry-visual-quality.v1'

export type ForestryScene = {
  activeLandformId?: string | null
  assessmentYear?: number
  harvestInventory?: InventoryEvidence
  reportMetadata?: FormMetadata
  /** The reviewer's handbook step 2–5 judgements. A record of review, not an input to the run. */
  viaReview?: ViaReview
  viewpoint: Viewpoint
  targets: TargetPolygon[]
  settings: AnalysisSettings
  thresholds: VisualQualityThresholds
}

let idCounter = 0

export function createId(prefix: string): string {
  idCounter += 1
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`
}

export function createEmptyScene(): ForestryScene {
  return {
    activeLandformId: null,
    assessmentYear: new Date().getFullYear(),
    // A road, not a spot: the road view and most assessments are written from one.
    viewpoint: { id: createId('viewpoint'), name: 'Viewpoint', mode: 'corridor', coordinates: [] },
    targets: [],
    settings: { ...DEFAULT_ANALYSIS_SETTINGS },
    thresholds: { ...DEFAULT_VISUAL_QUALITY_THRESHOLDS },
  }
}

function box(lng: number, lat: number, halfLng: number, halfLat: number): GeoJSON.Polygon {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [lng - halfLng, lat - halfLat],
        [lng + halfLng, lat - halfLat],
        [lng + halfLng, lat + halfLat],
        [lng - halfLng, lat + halfLat],
        [lng - halfLng, lat - halfLat],
      ],
    ],
  }
}

/**
 * A worked example east of Prince George: a valley road looking across at
 * Tabor Mountain, one block on the face that the road sees and one just over
 * the height of land that it never does.
 */
export function createSampleScene(): ForestryScene {
  const scene = createEmptyScene()
  return {
    ...scene,
    viewpoint: {
      id: createId('viewpoint'),
      name: 'Valley road corridor',
      mode: 'corridor',
      coordinates: [
        [-122.7, 53.915],
        [-122.66, 53.9115],
        [-122.62, 53.9085],
        [-122.58, 53.906],
        [-122.556, 53.9045],
      ],
    },
    targets: [
      {
        id: createId('block'),
        name: 'Block A — west face',
        role: 'block',
        objectiveId: 'partial-retention',
        vac: null,
        harvestYear: null,
        clearcutPercent: null,
        geometry: box(-122.5085, 53.883, 0.009, 0.005),
        source: 'Sample scenario',
      },
      {
        id: createId('block'),
        name: 'Block B — over the height of land',
        role: 'block',
        objectiveId: 'partial-retention',
        vac: null,
        harvestYear: null,
        clearcutPercent: null,
        geometry: box(-122.434, 53.873, 0.009, 0.005),
        source: 'Sample scenario',
      },
      {
        id: createId('landscape'),
        name: 'Tabor Mountain landform',
        role: 'landscape',
        objectiveId: DEFAULT_VISUAL_QUALITY_CLASS_ID,
        vac: 'medium',
        harvestYear: null,
        clearcutPercent: null,
        geometry: box(-122.52, 53.888, 0.055, 0.028),
        source: 'Sample scenario',
      },
    ],
  }
}

export function targetAreaHectares(target: TargetPolygon): number {
  return polygonAreaMeters(target.geometry) / 10000
}

/** Bounding box covering the viewpoint and every polygon, for fitting the map. */
export function sceneBounds(scene: ForestryScene): BBox | null {
  const boxes: BBox[] = []
  if (scene.viewpoint.coordinates.length > 0) {
    const lngs = scene.viewpoint.coordinates.map(([lng]) => lng)
    const lats = scene.viewpoint.coordinates.map(([, lat]) => lat)
    boxes.push([Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)])
  }
  for (const target of scene.targets) boxes.push(polygonBounds(target.geometry) as BBox)
  if (boxes.length === 0) return null

  return [
    Math.min(...boxes.map((entry) => entry[0])),
    Math.min(...boxes.map((entry) => entry[1])),
    Math.max(...boxes.map((entry) => entry[2])),
    Math.max(...boxes.map((entry) => entry[3])),
  ]
}

export const ROLE_COLORS: Record<TargetRole, string> = {
  block: '#dc2626',
  landscape: '#0ea5e9',
  harvested: '#a16207',
}

/** Polygon outlines and fills, coloured by role and by whether a result exists. */
export function targetsToGeoJson(targets: TargetPolygon[], role: TargetRole): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: targets
      .filter((target) => target.role === role)
      .map((target) => ({
        type: 'Feature' as const,
        id: target.id,
        geometry: target.geometry,
        properties: {
          id: target.id,
          name: target.name,
          role: target.role,
          areaHectares: targetAreaHectares(target),
        },
      })),
  }
}

/** The road centreline, or an empty collection for a spot viewpoint. */
export function viewpointLineToGeoJson(viewpoint: Viewpoint): GeoJSON.FeatureCollection {
  if (viewpoint.mode !== 'corridor' || viewpoint.coordinates.length < 2) {
    return { type: 'FeatureCollection', features: [] }
  }
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: viewpoint.id,
        geometry: { type: 'LineString', coordinates: viewpoint.coordinates },
        properties: { id: viewpoint.id, name: viewpoint.name },
      },
    ],
  }
}

export function draftLineToGeoJson(coordinates: Array<[number, number]>): GeoJSON.FeatureCollection {
  if (coordinates.length < 2) return { type: 'FeatureCollection', features: [] }
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 'draft',
        geometry: { type: 'LineString', coordinates },
        properties: { id: 'draft' },
      },
    ],
  }
}

export function pointsToGeoJson(
  coordinates: Array<[number, number]>,
  properties: Record<string, unknown> = {},
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: coordinates.map((coordinate, index) => ({
      type: 'Feature',
      id: `${index}`,
      geometry: { type: 'Point', coordinates: coordinate },
      properties: { id: `${index}`, index, ...properties },
    })),
  }
}

/**
 * Sample points as map features, tagged with whether they are seen from the
 * road. `stationIndex` narrows the answer to one point on the road, which is
 * what drive mode shows.
 */
export function samplesToGeoJson(
  result: AnalysisResult | null,
  options: { stationIndex?: number | null; roles?: TargetRole[] } = {},
): GeoJSON.FeatureCollection {
  if (!result) return { type: 'FeatureCollection', features: [] }
  const roles = options.roles ?? ['block']
  const features: GeoJSON.Feature[] = []

  for (const target of result.targets) {
    if (!roles.includes(target.role)) continue
    const stationRow =
      options.stationIndex != null && options.stationIndex >= 0 ? options.stationIndex * target.sampleCount : null

    for (let index = 0; index < target.sampleCount; index += 1) {
      const visible =
        stationRow === null ? target.anyVisible[index] : target.visibleByStation[stationRow + index]
      features.push({
        type: 'Feature',
        id: `${target.targetId}-${index}`,
        geometry: {
          type: 'Point',
          coordinates: [target.positions[index * 2], target.positions[index * 2 + 1]],
        },
        properties: {
          id: `${target.targetId}-${index}`,
          targetId: target.targetId,
          visible,
          distanceMeters: target.visibleDistances[index],
        },
      })
    }
  }

  return { type: 'FeatureCollection', features }
}

/** The stations the analysis measured from, for the map and for drive playback. */
/**
 * The road itself, graded by how much of a block each stretch of it sees.
 *
 * Stations are discrete — one sightline calculation every `stationSpacingMeters`
 * — but the road is not, and a line of dots reads as a sampling artefact rather
 * than as exposure. Each segment between two stations carries the mean of their
 * two figures, so the colour runs continuously along the road and still says
 * only what was actually computed.
 */
export function corridorExposureToGeoJson(
  result: AnalysisResult | null,
  targetId: string | null,
): GeoJSON.FeatureCollection {
  const empty = { type: 'FeatureCollection' as const, features: [] }
  if (!result || result.stations.length < 2) return empty

  // The selected block if it was assessed, otherwise the worst case over all of
  // them — a road is exposed if it sees any of the proposal.
  const blocks = result.targets.filter((target) => target.role === 'block')
  const chosen = blocks.find((target) => target.targetId === targetId)
  const sources = chosen ? [chosen] : blocks
  if (sources.length === 0) return empty

  const exposureAt = (index: number) =>
    sources.reduce((worst, target) => Math.max(worst, target.stations[index]?.visiblePercent ?? 0), 0)

  const features: GeoJSON.Feature[] = []
  for (let index = 1; index < result.stations.length; index += 1) {
    const from = result.stations[index - 1]
    const to = result.stations[index]
    features.push({
      type: 'Feature',
      id: `corridor-${index}`,
      geometry: {
        type: 'LineString',
        coordinates: [
          [from.lng, from.lat],
          [to.lng, to.lat],
        ],
      },
      properties: {
        id: `corridor-${index}`,
        visiblePercent: (exposureAt(index - 1) + exposureAt(index)) / 2,
        unknown: sources.some((target) => (target.stations[index - 1]?.unknownPercent ?? 0) > 0 || (target.stations[index]?.unknownPercent ?? 0) > 0) ? 1 : 0,
        distanceAlongMeters: from.distanceAlongMeters,
      },
    })
  }
  return { type: 'FeatureCollection', features }
}

export function stationsToGeoJson(result: AnalysisResult | null): GeoJSON.FeatureCollection {
  if (!result) return { type: 'FeatureCollection', features: [] }
  return {
    type: 'FeatureCollection',
    features: result.stations.map((station, index) => ({
      type: 'Feature',
      id: `station-${index}`,
      geometry: { type: 'Point', coordinates: [station.lng, station.lat] },
      properties: {
        id: `station-${index}`,
        index,
        assessment: index === result.assessmentStationIndex ? 1 : 0,
        distanceAlongMeters: station.distanceAlongMeters,
      },
    })),
  }
}

type SerializedScene = {
  activeLandformId?: string | null
  assessmentYear?: number
  harvestInventory?: InventoryEvidence
  reportMetadata?: FormMetadata
  viaReview?: ViaReview
  version: 1
  viewpoint: Viewpoint
  targets: TargetPolygon[]
  settings: AnalysisSettings
  thresholds: VisualQualityThresholds
}

export function serializeScene(scene: ForestryScene): string {
  const payload: SerializedScene = { version: 1, ...scene }
  return JSON.stringify(payload, null, 2)
}

function isPolygonGeometry(value: unknown): value is GeoJSON.Polygon | GeoJSON.MultiPolygon {
  const geometry = value as { type?: string; coordinates?: unknown }
  return (geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon') && Array.isArray(geometry.coordinates)
}

function isClassId(value: unknown): value is VisualQualityClassId {
  return VISUAL_QUALITY_CLASSES.some((entry) => entry.id === value)
}

function isVacRating(value: unknown): value is VacRating {
  return VAC_RATINGS.includes(value as VacRating)
}

/**
 * Thresholds used to be one flat set of class percentages, before the
 * perspective and planimetric scales were separated. A scene saved then holds
 * the planimetric numbers under the old shape, so it is read back as those.
 */
function parseThresholds(raw: unknown): VisualQualityThresholds {
  const numeric = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback

  const node = (raw ?? {}) as Record<string, unknown>
  const legacyFlat = VISUAL_QUALITY_CLASSES.some((entry) => typeof node[entry.id] === 'number')

  const readBasis = (basis: AlterationBasis) => {
    const source = (legacyFlat && basis === 'planimetric' ? node : node[basis]) as Record<string, unknown> | undefined
    return Object.fromEntries(
      VISUAL_QUALITY_CLASSES.map((entry) => [
        entry.id,
        numeric(source?.[entry.id], DEFAULT_VISUAL_QUALITY_THRESHOLDS[basis][entry.id]),
      ]),
    ) as VisualQualityThresholds[AlterationBasis]
  }

  return { perspective: readBasis('perspective'), planimetric: readBasis('planimetric') }
}

/**
 * Rebuilds a scene from stored or imported JSON, dropping anything malformed.
 * A saved scene outliving a change to the settings shape should cost the user
 * the setting, not the scene.
 */
function percentOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null
}

export function parseScene(input: unknown): ForestryScene | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Partial<SerializedScene>
  const base = createEmptyScene()

  const coordinates = Array.isArray(raw.viewpoint?.coordinates)
    ? raw.viewpoint.coordinates.filter(
        (position): position is [number, number] =>
          Array.isArray(position) && Number.isFinite(position[0]) && Number.isFinite(position[1]),
      )
    : []

  const targets = Array.isArray(raw.targets)
    ? raw.targets.flatMap((target): TargetPolygon[] => {
        if (!target || !isPolygonGeometry(target.geometry)) return []
        return [
          {
            id: typeof target.id === 'string' ? target.id : createId('target'),
            name: typeof target.name === 'string' ? target.name : 'Polygon',
            role: target.role === 'landscape' ? 'landscape' : target.role === 'harvested' ? 'harvested' : 'block',
            objectiveId: isClassId(target.objectiveId) ? target.objectiveId : DEFAULT_VISUAL_QUALITY_CLASS_ID,
            vac: isVacRating(target.vac) ? target.vac : null,
            harvestYear: typeof target.harvestYear === 'number' ? target.harvestYear : null,
            clearcutPercent: typeof target.clearcutPercent === 'number' ? target.clearcutPercent : null,
            siteDisturbance: target.siteDisturbance === true,
            recoveryPercent: typeof target.recoveryPercent === 'number' && Number.isFinite(target.recoveryPercent) ? Math.max(0, Math.min(100, target.recoveryPercent)) : null,
            inventoryUnitId: typeof target.inventoryUnitId === 'string' ? target.inventoryUnitId : null,
            ...(target.harvestSystem === 'retention' || target.harvestSystem === 'partial'
              ? { harvestSystem: target.harvestSystem }
              : {}),
            retentionPercent: percentOrNull(target.retentionPercent),
            volumeRemovedPercent: percentOrNull(target.volumeRemovedPercent),
            residualHeightMeters:
              typeof target.residualHeightMeters === 'number' && target.residualHeightMeters > 0 && target.residualHeightMeters < 100
                ? target.residualHeightMeters
                : null,
            geometry: target.geometry,
            source: typeof target.source === 'string' ? target.source : 'Imported',
          },
        ]
      })
    : []

  const numeric = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback

  return {
    viewpoint: {
      id: typeof raw.viewpoint?.id === 'string' ? raw.viewpoint.id : base.viewpoint.id,
      name: typeof raw.viewpoint?.name === 'string' ? raw.viewpoint.name : base.viewpoint.name,
      mode: raw.viewpoint?.mode === 'corridor' ? 'corridor' : 'spot',
      coordinates,
    },
    targets,
    activeLandformId: typeof raw.activeLandformId === 'string' ? raw.activeLandformId : null,
    assessmentYear: numeric(raw.assessmentYear, base.assessmentYear ?? new Date().getFullYear()),
    harvestInventory: raw.harvestInventory && ['complete', 'partial', 'unavailable', 'not-requested', 'scenario-only'].includes(raw.harvestInventory.status) ? raw.harvestInventory : undefined,
    reportMetadata: raw.reportMetadata && typeof raw.reportMetadata === 'object' ? Object.fromEntries(Object.entries(raw.reportMetadata).filter(([, value]) => typeof value === 'string')) : {},
    viaReview: parseViaReview(raw.viaReview),
    settings: {
      demZoom: numeric(raw.settings?.demZoom, base.settings.demZoom),
      observerHeightMeters: numeric(raw.settings?.observerHeightMeters, base.settings.observerHeightMeters),
      targetOffsetMeters: numeric(raw.settings?.targetOffsetMeters, base.settings.targetOffsetMeters),
      stationSpacingMeters: numeric(raw.settings?.stationSpacingMeters, base.settings.stationSpacingMeters),
      maxViewDistanceMeters: numeric(raw.settings?.maxViewDistanceMeters, base.settings.maxViewDistanceMeters),
      sampleBudget: numeric(raw.settings?.sampleBudget, base.settings.sampleBudget),
      greenUpAgeYears: numeric(raw.settings?.greenUpAgeYears, base.settings.greenUpAgeYears),
      screeningEnabled:
        typeof raw.settings?.screeningEnabled === 'boolean'
          ? raw.settings.screeningEnabled
          : base.settings.screeningEnabled,
      minCrownClosurePercent: numeric(raw.settings?.minCrownClosurePercent, base.settings.minCrownClosurePercent),
      greenAreaConfirmed: raw.settings?.greenAreaConfirmed === true,
      existingDisturbanceConfirmed: raw.settings?.existingDisturbanceConfirmed === true,
    },
    thresholds: parseThresholds(raw.thresholds),
  }
}

export function loadStoredScene(): ForestryScene | null {
  try {
    const stored = window.localStorage.getItem(SCENE_STORAGE_KEY)
    return stored ? parseScene(JSON.parse(stored)) : null
  } catch {
    return null
  }
}

export function storeScene(scene: ForestryScene): void {
  try {
    window.localStorage.setItem(SCENE_STORAGE_KEY, serializeScene(scene))
  } catch {
    // A full or blocked storage quota is not worth interrupting the page for.
  }
}

/** Bounding box of one polygon, for zooming to it from the sidebar. */
export function targetBounds(target: TargetPolygon): BBox | null {
  return geometryBounds(target.geometry)
}

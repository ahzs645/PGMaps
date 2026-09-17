/**
 * The page's document: a viewpoint, the polygons to assess, and the settings
 * and thresholds they are assessed under. Kept separate from the React tree so
 * it can be saved, restored, exported, and turned into map layers.
 */

import { geometryBounds, type BBox } from '@/lib/geo'

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
  VISUAL_QUALITY_CLASSES,
  type VisualQualityClassId,
  type VisualQualityThresholds,
} from './vqo'

export const SCENE_STORAGE_KEY = 'pgmaps.forestry-visual-quality.v1'

export type ForestryScene = {
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
    viewpoint: { id: createId('viewpoint'), name: 'Viewpoint', mode: 'spot', coordinates: [] },
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
        geometry: box(-122.5085, 53.883, 0.009, 0.005),
        source: 'Sample scenario',
      },
      {
        id: createId('block'),
        name: 'Block B — over the height of land',
        role: 'block',
        objectiveId: 'partial-retention',
        geometry: box(-122.434, 53.873, 0.009, 0.005),
        source: 'Sample scenario',
      },
      {
        id: createId('landscape'),
        name: 'Tabor visual landscape unit',
        role: 'landscape',
        objectiveId: DEFAULT_VISUAL_QUALITY_CLASS_ID,
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
        stationRow === null ? target.anyVisible[index] === 1 : target.visibleByStation[stationRow + index] === 1
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
          visible: visible ? 1 : 0,
          distanceMeters: target.visibleDistances[index],
        },
      })
    }
  }

  return { type: 'FeatureCollection', features }
}

/** The stations the analysis measured from, for the map and for drive playback. */
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

/**
 * Rebuilds a scene from stored or imported JSON, dropping anything malformed.
 * A saved scene outliving a change to the settings shape should cost the user
 * the setting, not the scene.
 */
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
            role: target.role === 'landscape' ? 'landscape' : 'block',
            objectiveId: isClassId(target.objectiveId) ? target.objectiveId : DEFAULT_VISUAL_QUALITY_CLASS_ID,
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
    settings: {
      demZoom: numeric(raw.settings?.demZoom, base.settings.demZoom),
      observerHeightMeters: numeric(raw.settings?.observerHeightMeters, base.settings.observerHeightMeters),
      targetOffsetMeters: numeric(raw.settings?.targetOffsetMeters, base.settings.targetOffsetMeters),
      stationSpacingMeters: numeric(raw.settings?.stationSpacingMeters, base.settings.stationSpacingMeters),
      maxViewDistanceMeters: numeric(raw.settings?.maxViewDistanceMeters, base.settings.maxViewDistanceMeters),
      sampleBudget: numeric(raw.settings?.sampleBudget, base.settings.sampleBudget),
    },
    thresholds: Object.fromEntries(
      VISUAL_QUALITY_CLASSES.map((entry) => [
        entry.id,
        numeric(raw.thresholds?.[entry.id], entry.maxAlterationPercent),
      ]),
    ) as VisualQualityThresholds,
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

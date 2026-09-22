import { parseScene, serializeScene, type ForestryScene } from './scene'
import { sceneFingerprint } from './sceneInput'
import { lineLengthMeters } from './visibility'
import type { AnalysisResult } from './types'

export type SavedDriveView = {
  id: string
  name: string
  positionMeters: number
  lookAtTargetId: string | null
  yaw: number
  tilt: number
  treeHeightMeters: number
  roadClearWidthMeters: number
  harvestPhase: 'before' | 'after'
  existingForest?: boolean
  projectRecordedHeights?: boolean
  growthMetersPerYear?: number
  regenerationLagYears?: number
}
export const PREVIEW_STORAGE_KEY = 'pgmaps.forestry-driving-views.v1'

function validPosition(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    Math.abs(value[0]) <= 180 &&
    Math.abs(value[1]) < 85
  )
}
function validPolygon(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): boolean {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  return (
    polygons.length > 0 &&
    polygons.every(
      (polygon) =>
        Array.isArray(polygon) &&
        polygon.length > 0 &&
        polygon.every(
          (ring) =>
            Array.isArray(ring) &&
            ring.length >= 4 &&
            ring.every(validPosition) &&
            ring[0][0] === ring[ring.length - 1][0] &&
            ring[0][1] === ring[ring.length - 1][1],
        ),
    )
  )
}

export function previewInputError(scene: ForestryScene): string | null {
  if (scene.viewpoint.mode !== 'corridor' || scene.viewpoint.coordinates.length < 2)
    return 'Draw or import a road with at least two points.'
  if (!scene.targets.some((t) => t.role === 'block')) return 'Draw or import at least one cutblock.'
  if (!scene.viewpoint.coordinates.every(validPosition)) return 'The road must use longitude and latitude coordinates.'
  if (!scene.targets.every((target) => validPolygon(target.geometry)))
    return 'Cutblocks and landforms must contain closed polygons in longitude and latitude.'
  if (lineLengthMeters(scene.viewpoint.coordinates) < 1) return 'The road needs to be at least one metre long.'
  return null
}

/** Candidate ground views, not guarantees of seeing through foreground timber.
 * Rank the target's apparent visible area, keeping stops separated along the road. */
export function candidateDriveViews(result: AnalysisResult | null, targetId: string | null) {
  if (!result) return []
  const target =
    result.targets.find((t) => t.role === 'block' && t.targetId === targetId) ??
    result.targets.find((t) => t.role === 'block')
  if (!target) return []
  const ranked = target.stations
    .map((station, index) => ({
      index,
      positionMeters: station.distanceAlongMeters,
      targetId: target.targetId,
      score: target.visibleApparentSolidAngleByStation[index],
      visiblePercent: station.visiblePercent,
    }))
    .filter((s) => s.visiblePercent > 0 && Number.isFinite(s.score) && s.score > 0)
    .sort((a, b) => b.score - a.score)
  const chosen: typeof ranked = []
  const separation = Math.max(75, result.corridorLengthMeters / 8)
  for (const stop of ranked) {
    if (chosen.every((s) => Math.abs(s.positionMeters - stop.positionMeters) >= separation)) chosen.push(stop)
    if (chosen.length === 3) break
  }
  return chosen.sort((a, b) => a.positionMeters - b.positionMeters)
}

export function serializePreview(scene: ForestryScene, views: SavedDriveView[]) {
  return JSON.stringify(
    {
      type: 'pgmaps-driving-preview',
      version: 1,
      scene: JSON.parse(serializeScene(scene)),
      views,
      note: 'Illustrative forest. Live terrain and inventory are reloaded; this file is not an offline data snapshot.',
    },
    null,
    2,
  )
}

export function parsePreview(input: unknown): { scene: ForestryScene; views: SavedDriveView[] } | null {
  const raw = input as { type?: string; version?: number; scene?: unknown; views?: unknown[] } | null
  if (raw?.type !== 'pgmaps-driving-preview' || raw.version !== 1) return null
  const scene = parseScene(raw.scene)
  if (!scene || previewInputError(scene) || !sceneFingerprint(scene))
    throw new Error('This preview does not contain a valid road and cutblock.')
  const length = lineLengthMeters(scene.viewpoint.coordinates)
  const views = (Array.isArray(raw.views) ? raw.views : []).slice(0, 12).flatMap((entry, index): SavedDriveView[] => {
    if (!entry || typeof entry !== 'object') return []
    const v = entry as SavedDriveView
    if (![v.positionMeters, v.yaw, v.tilt, v.treeHeightMeters, v.roadClearWidthMeters].every(Number.isFinite)) return []
    if (
      v.positionMeters < 0 ||
      v.positionMeters > length + 1 ||
      v.tilt < -45 ||
      v.tilt > 20 ||
      v.treeHeightMeters < 5 ||
      v.treeHeightMeters > 60 ||
      v.roadClearWidthMeters < 0 ||
      v.roadClearWidthMeters > 500
    )
      return []
    return [
      {
        id: `view-${index}`,
        name: typeof v.name === 'string' ? v.name.slice(0, 80) : `View ${index + 1}`,
        positionMeters: Math.min(length, v.positionMeters),
        yaw: ((v.yaw % 360) + 360) % 360,
        tilt: v.tilt,
        lookAtTargetId: scene.targets.some((t) => t.role === 'block' && t.id === v.lookAtTargetId)
          ? v.lookAtTargetId
          : null,
        treeHeightMeters: v.treeHeightMeters,
        roadClearWidthMeters: v.roadClearWidthMeters,
        harvestPhase: v.harvestPhase === 'before' ? 'before' : 'after',
        ...(typeof v.existingForest === 'boolean' ? { existingForest: v.existingForest } : {}),
        ...(typeof v.projectRecordedHeights === 'boolean' ? { projectRecordedHeights: v.projectRecordedHeights } : {}),
        ...(Number.isFinite(v.growthMetersPerYear) && v.growthMetersPerYear! >= 0.1 && v.growthMetersPerYear! <= 1
          ? { growthMetersPerYear: v.growthMetersPerYear }
          : {}),
        ...(Number.isFinite(v.regenerationLagYears) && v.regenerationLagYears! >= 0 && v.regenerationLagYears! <= 10
          ? { regenerationLagYears: v.regenerationLagYears }
          : {}),
      },
    ]
  })
  return { scene, views }
}

/** Ignore startup, hidden tabs and isolated stalls. Three slow windows trigger
 * a single session downgrade; geometry and analysis stay unchanged. */
export class PreviewFrameBudget {
  private samples: number[] = []
  private slowWindows = 0
  push(milliseconds: number) {
    if (!Number.isFinite(milliseconds) || milliseconds <= 0 || milliseconds > 500) return false
    this.samples.push(milliseconds)
    if (this.samples.length < 90) return false
    const sorted = this.samples.sort((a, b) => a - b)
    this.slowWindows = sorted[Math.floor(sorted.length / 2)] > 38 ? this.slowWindows + 1 : 0
    this.samples = []
    return this.slowWindows >= 3
  }
}

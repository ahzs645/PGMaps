/**
 * The landform seen from a planned view of interest (`viewsOfInterest.ts`): the visible face of the ridge mass the
 * view's block sits on, read from the view's place alone, exactly as *Find a landform from the terrain*
 * (`TerrainLandformFinder.tsx`) reads its visible face from a chosen point: the same terrain zoom and search box,
 * `visibleFaceLandform` with its default 60° frame centred on the block, the scene's eye height, basemap water, and
 * both study options off.
 *
 * Like every terrain reading it is a candidate: shown on the plan, adopted only by the reviewer's click. Adopting it
 * adds a landform target (`role: 'landscape'`) built as the finder builds one (`landformTargetFromCandidate`, which
 * the finder's own *Use* shares) and records it as the view's `landformId`. Unlike the finder's *Use*, it never
 * replaces the landform the run assesses: each view keeps its own, and the run's active landform stays as it was.
 *
 * Pure: no DOM or network access. The page loads the terrain grid and passes it in.
 */
import { demTileRange, type DemTileRange, type ElevationSource } from './terrain'
import { RIDGE_LAYER_DEFAULTS, VISIBLE_FACE_DEFAULTS, visibleFaceLandform } from './ridgeLayers'
import { TERRAIN_LANDFORM_DEFAULTS } from './landformFromTerrain'
import type { ForestryScene } from './scene'
import type { TerrainCandidate } from './TerrainLandformFinder'
import type { TargetPolygon } from './types'
import { metersPerDegree, polygonBounds, type PolygonGeometry } from './visibility'
import type { ViewOfInterest } from './viewsOfInterest'
import { DEFAULT_VISUAL_QUALITY_CLASS_ID } from './vqo'

/** The finder's terrain zoom: about 22 m a pixel here, finer than the grid the face is read on. */
export const VIEW_LANDFORM_TERRAIN_ZOOM = 12

/** The terrain tiles a view's landform is read on: the finder's search box round the block, widened to the view. */
export function viewLandformTileRange(
  view: Pick<ViewOfInterest, 'lng' | 'lat'>,
  blockGeometry: PolygonGeometry,
): DemTileRange {
  const [west, south, east, north] = polygonBounds(blockGeometry)
  const centre = { lng: (west + east) / 2, lat: (south + north) / 2 }
  const scale = metersPerDegree(centre.lat)
  // One terrain load serves the finder's three readings: the wider of their search areas.
  const pad = Math.max(RIDGE_LAYER_DEFAULTS.radiusMeters, TERRAIN_LANDFORM_DEFAULTS.radiusMeters) + 500
  return demTileRange(
    [
      Math.min(centre.lng - pad / scale.lng, view.lng - 0.01),
      Math.min(centre.lat - pad / scale.lat, view.lat - 0.01),
      Math.max(centre.lng + pad / scale.lng, view.lng + 0.01),
      Math.max(centre.lat + pad / scale.lat, view.lat + 0.01),
    ],
    VIEW_LANDFORM_TERRAIN_ZOOM,
  )
}

/**
 * The visible face seen from the view's place, as a finder candidate (so the plan draws it with the finder's
 * candidates). Null when nothing of the block, or in front of it, is in view from there, or the view's place has
 * no terrain.
 */
export function viewLandformCandidate(
  ground: ElevationSource,
  view: Pick<ViewOfInterest, 'lng' | 'lat' | 'name'>,
  block: Pick<TargetPolygon, 'id' | 'name' | 'geometry'>,
  options: { water?: ReadonlyArray<PolygonGeometry>; eyeHeightMeters: number },
): TerrainCandidate | null {
  const visible = visibleFaceLandform(
    ground,
    block.geometry,
    { lng: view.lng, lat: view.lat },
    {
      water: options.water,
      eyeHeightMeters: options.eyeHeightMeters,
      stopAtFirstCrest: VISIBLE_FACE_DEFAULTS.stopAtFirstCrest,
      splitAtDraws: VISIBLE_FACE_DEFAULTS.splitAtDraws,
    },
  )
  if (!visible) return null
  return {
    ...visible,
    blockId: block.id,
    blockName: block.name,
    blockGeometry: block.geometry,
    vantageName: view.name,
  }
}

/**
 * A terrain candidate as a landform target, named and sourced as the finder's *Use* names it, with the objective
 * and VAC it inherits (the scene's current landform's, else the default class).
 */
export function landformTargetFromCandidate(
  candidate: TerrainCandidate,
  options: {
    id: string
    inherit?: Pick<TargetPolygon, 'objectiveId' | 'vac'> | null
    /** Overrides the finder's name, e.g. to say which planned view the face was read from. */
    name?: string
  },
): TargetPolygon {
  const vantage = candidate.vantageName ?? 'the road'
  return {
    id: options.id,
    name:
      options.name ??
      (candidate.method === 'ridge-layer'
        ? `Ridge layer around ${candidate.blockName}`
        : candidate.method === 'visible-face'
          ? `Visible face round ${candidate.blockName}`
          : `Terrain landform around ${candidate.blockName}`),
    role: 'landscape',
    objectiveId: options.inherit?.objectiveId ?? DEFAULT_VISUAL_QUALITY_CLASS_ID,
    vac: options.inherit?.vac ?? null,
    harvestYear: null,
    clearcutPercent: null,
    geometry: candidate.geometry,
    source:
      candidate.method === 'ridge-layer'
        ? `Ridge layer seen from ${vantage}; review against the view`
        : candidate.method === 'visible-face'
          ? `Visible face from ${vantage} (one station, water and frame break it); review against the view`
          : `Face turned to ${vantage}, from terrain; review against the view`,
  }
}

/** The name a view's adopted landform takes: the finder's, and the view it was read from. */
export function viewLandformName(candidate: TerrainCandidate, view: Pick<ViewOfInterest, 'name'>): string {
  return `Visible face round ${candidate.blockName} from ${view.name}`
}

const sameGeometry = (a: TargetPolygon['geometry'], b: TargetPolygon['geometry']) =>
  a === b || (a.type === b.type && JSON.stringify(a.coordinates) === JSON.stringify(b.coordinates))

/**
 * Adopts a landform for one planned view: adds `target` unless a landform with the same outline is already in the
 * scene (another view at the place adopted it), and sets the view's `landformId` to it. The run's landform is left
 * as it was: when the scene already had one landform and named none active, that one is named active, because two
 * landforms with none chosen cannot share a denominator (`activeLandform`). With no landform before, the adopted
 * one becomes the scene's, as any first landform does.
 */
export function adoptViewLandform(scene: ForestryScene, viewId: string, target: TargetPolygon): ForestryScene {
  const views = scene.viewsOfInterest ?? []
  if (!views.some((view) => view.id === viewId)) return scene
  const landforms = scene.targets.filter((entry) => entry.role === 'landscape')
  const existing = landforms.find((entry) => sameGeometry(entry.geometry, target.geometry))
  const landformId = existing?.id ?? target.id
  const activeLandformId =
    scene.activeLandformId && landforms.some((entry) => entry.id === scene.activeLandformId)
      ? scene.activeLandformId
      : landforms.length === 1
        ? landforms[0].id
        : landforms.length === 0
          ? landformId
          : (scene.activeLandformId ?? null)
  return {
    ...scene,
    targets: existing ? scene.targets : [...scene.targets, target],
    activeLandformId,
    viewsOfInterest: views.map((view) => (view.id === viewId ? { ...view, landformId } : view)),
  }
}

/** Takes a view's landform off the view; the landform target stays in the scene. */
export function clearViewLandform(views: readonly ViewOfInterest[], viewId: string): ViewOfInterest[] {
  return views.map((view) => {
    if (view.id !== viewId || !view.landformId) return view
    const next = { ...view }
    delete next.landformId
    return next
  })
}

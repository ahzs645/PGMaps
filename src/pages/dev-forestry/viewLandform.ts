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
import { demTileRange, type DemTileRange, type ElevationSource } from '@/lib/forestry/terrain/terrain'
import { RIDGE_LAYER_DEFAULTS, VISIBLE_FACE_DEFAULTS, visibleFaceLandform } from './ridgeLayers'
import { TERRAIN_LANDFORM_DEFAULTS } from './landformFromTerrain'
import { activeLandform } from './integrity'
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
 * A view's landform reading: the finder's candidate, and whether it was read round the block's visible ground
 * (`block`) or, the block being hidden from the view, from the land seen in front of it (`in-front`).
 */
export type ViewLandformCandidate = TerrainCandidate & { seededBy: 'block' | 'in-front' }

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
): ViewLandformCandidate | null {
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
    seededBy: visible.seededBy,
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

/** The name a view's adopted landform takes: what it is, round the block or in front of it, and the view. */
export function viewLandformName(
  candidate: TerrainCandidate & { seededBy?: 'block' | 'in-front' },
  view: Pick<ViewOfInterest, 'name'>,
): string {
  return candidate.seededBy === 'in-front'
    ? `Face in front of ${candidate.blockName} from ${view.name}`
    : `Visible face round ${candidate.blockName} from ${view.name}`
}

/**
 * What the control says about a reading, and whether it can be adopted. The reading itself is the finder's
 * (`visibleFaceLandform`); this only says it plainly:
 * - the block seen, with a face round it: adoptable;
 * - the block seen, but little hillside beyond it (`blockOnly`): not adoptable, it sits on a valley floor or a narrow
 *   bank as seen from here;
 * - the block hidden by the terrain: the reading is the land seen in front of it, adoptable only when that is a face
 *   of its own (more than `blockOnly`'s 2.5 × the block's area), never called a face round the block.
 */
export function viewLandformVerdict(
  candidate: Pick<TerrainCandidate, 'blockName' | 'areaHectares' | 'blockOnly'> & {
    seededBy?: 'block' | 'in-front'
  },
  blockHectares: number,
): { title: string; adoptable: boolean; tone: 'info' | 'warning' | null; note: string | null } {
  const ha = (value: number) => `${Math.round(value)} ha`
  const name = candidate.blockName
  if (candidate.seededBy === 'in-front')
    return candidate.blockOnly
      ? {
          title: `The land in front of ${name}, ${ha(candidate.areaHectares)}`,
          adoptable: false,
          tone: 'warning',
          note: `${name} is hidden from here: nearer ground stands between this place and the block, so no landform round it can be read from here. The ${ha(candidate.areaHectares)} drawn is the land seen in front of it, too little to judge the block against. Read it from a view that sees the block (step 1's Which see the block), or draw the landform by hand.`,
        }
      : {
          title: `Face in front of ${name}, ${ha(candidate.areaHectares)}`,
          adoptable: true,
          tone: 'info',
          note: `${name} is hidden from here, so this is the face of the land seen in front of it, not a face round the block. A VIA uses it only where the block cannot be seen; from a view that sees the block, its own face is read.`,
        }
  if (candidate.blockOnly)
    return {
      title: `Visible face round ${name}, ${ha(candidate.areaHectares)}`,
      adoptable: false,
      tone: 'warning',
      note: `From here the terrain finds little hillside round ${name} beyond the block itself (${ha(candidate.areaHectares)} against its ${ha(blockHectares)}): seen from this place it sits on a valley floor or a narrow bank, so there is no landform to adopt. Try a view farther off or across the valley, or draw the landform by hand.`,
    }
  return { title: `Visible face round ${name}, ${ha(candidate.areaHectares)}`, adoptable: true, tone: null, note: null }
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

// ---------------------------------------------------------------------------------------------------------------
// Who is assessed against what: the site's landform, and each view's own.

/**
 * A planned view's landform the stand made the run's (`set`), and the reviewer's own before it (`reviewer`), as the
 * page keeps them while it stands at a view.
 */
export type HeldLandform = { reviewer: string | null | undefined; set: string | null }

/**
 * The site landform: the one the reviewer chose for the assessment, which every view without a landform of its own is
 * assessed against. It is the run's landform, except while the page stands at a view whose own landform it made the
 * run's (`held`), when it is the one the reviewer had before. Null when the scene has none, or several with none
 * chosen.
 */
export function siteLandformOf(scene: ForestryScene, held?: HeldLandform | null): TargetPolygon | null {
  const standingOnAView = !!held && (scene.activeLandformId ?? null) === held.set
  try {
    return activeLandform(scene.targets, standingOnAView ? held.reviewer : scene.activeLandformId)
  } catch {
    return null
  }
}

/** A view of interest with the landform it is assessed against. */
export type ViewLandformUse = {
  view: ViewOfInterest
  block: TargetPolygon | null
  /** The view's own landform; null when it is assessed against the site's. */
  own: TargetPolygon | null
  /** The view names a landform that is no longer in the scene. */
  missing: boolean
}

export type LandformAssignments = {
  site: TargetPolygon | null
  views: ViewLandformUse[]
  /** Landforms that are neither the site's nor any view's: in the scene, assessed by nothing. */
  unused: TargetPolygon[]
}

/** Every landform in the scene by who is assessed against it: the site, each view of interest, or nothing. */
export function landformAssignments(scene: ForestryScene, site: TargetPolygon | null): LandformAssignments {
  const landforms = scene.targets.filter((target) => target.role === 'landscape')
  const blocks = scene.targets.filter((target) => target.role === 'block')
  const views = (scene.viewsOfInterest ?? []).map((view) => {
    const own = view.landformId ? (landforms.find((target) => target.id === view.landformId) ?? null) : null
    return {
      view,
      block: blocks.find((target) => target.id === view.blockId) ?? null,
      // A view that names the site's landform is assessed against the site's, like a view that names none.
      own: own && own.id !== site?.id ? own : null,
      missing: !!view.landformId && !own,
    }
  })
  const used = new Set(views.flatMap((entry) => (entry.own ? [entry.own.id] : [])))
  return {
    site,
    views,
    unused: landforms.filter((target) => target.id !== site?.id && !used.has(target.id)),
  }
}

/**
 * A change to the site landform's objective or VAC, carried to the views' own landforms that still held the site's
 * value: a face read from a view inherits both when it is adopted, and goes on following the site's until the
 * reviewer gives it another (a face in another sensitivity unit may have its own objective). Returns `targets`
 * itself when nothing follows.
 */
export function followSiteLandform(
  targets: readonly TargetPolygon[],
  views: readonly ViewOfInterest[],
  before: Pick<TargetPolygon, 'id' | 'objectiveId' | 'vac'>,
  patch: Partial<Pick<TargetPolygon, 'objectiveId' | 'vac'>>,
): readonly TargetPolygon[] {
  const own = new Set(views.flatMap((view) => (view.landformId ? [view.landformId] : [])))
  let changed = false
  const next = targets.map((target) => {
    if (target.role !== 'landscape' || target.id === before.id || !own.has(target.id)) return target
    const follows: Partial<Pick<TargetPolygon, 'objectiveId' | 'vac'>> = {}
    if (patch.objectiveId !== undefined && target.objectiveId === before.objectiveId)
      follows.objectiveId = patch.objectiveId
    if (patch.vac !== undefined && (target.vac ?? null) === (before.vac ?? null)) follows.vac = patch.vac
    if (!Object.keys(follows).length) return target
    changed = true
    return { ...target, ...follows }
  })
  return changed ? next : targets
}

/** Whether a view's own landform still holds the site's objective and VAC, so a change to the site's reaches it. */
export function followsSite(
  own: Pick<TargetPolygon, 'objectiveId' | 'vac'>,
  site: Pick<TargetPolygon, 'objectiveId' | 'vac'> | null,
): boolean {
  return !!site && own.objectiveId === site.objectiveId && (own.vac ?? null) === (site.vac ?? null)
}

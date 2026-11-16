/**
 * Views of interest: the views an assessment plans on the plan map before anyone opens the road view.
 *
 * A view is a place to stand (a map click, a VLI viewpoint or a rec site), a direction to face (the block, or a
 * compass bearing such as an inventory arrow's), the block it assesses, a lens and, optionally, the landform seen
 * from that spot. The list lives in the scene (`scene.viewsOfInterest`) so it travels with the scene file, but it is
 * a plan, not an input: it is out of `sceneFingerprint` and `AnalysisInput`, and editing it never stales the run.
 *
 * A view becomes a saved view (with its screenshot, class pass and figure camera) only when it is captured: the page
 * stands there, runs, opens the road view on that facing and saves, as a person would (`useViewCapture`). The saved
 * view carries `plannedViewId` and `plannedKey`; a planned view is captured while a saved view with its id and its
 * current key exists, and needs capturing again once its place, facing, lens, block or landform changes.
 *
 * Pure: no DOM or network access.
 */
import {
  bearingDegrees,
  haversineMeters,
  polygonInteriorPoint,
  type GeoPoint,
  type PolygonGeometry,
} from './visibility'
import { ARROW_AIM_DEGREES, type CandidateArrow, type ViewpointCandidate } from './viewpointInventory'

/** Where a view stands: picked on the map, or one of BC's inventory viewpoints or rec sites. */
export type ViewOfInterestSource =
  | { kind: 'map' }
  | {
      kind: 'vli' | 'rec-site'
      /** The candidate's key (`ViewpointCandidate.key`), so the finder can show which rows are already listed. */
      key: string
    }

/** Which way a view faces: the block it assesses, or a compass bearing (an inventory arrow's, or typed). */
export type ViewOfInterestFacing =
  | { kind: 'block' }
  | {
      kind: 'bearing'
      /** Degrees clockwise from north. */
      degrees: number
      /** The inventory arrow it came from, when it did; highlighted on the plan. */
      arrowId?: string | null
    }

/**
 * How the figure is framed. `landform` covers the landform the view sees with frames of the lens side by side, as
 * the analysis sheet always has (a panorama when the landform is wider than one frame); `single` is one frame of the
 * lens centred on the view's facing.
 */
export type ViewOfInterestFraming = 'landform' | 'single'

export type ViewOfInterest = {
  id: string
  name: string
  source: ViewOfInterestSource
  lng: number
  lat: number
  /** The block the view assesses: the one it faces by default and the one its summary reads. */
  blockId: string
  facing: ViewOfInterestFacing
  /** Full-frame-equivalent focal length, millimetres (`LENS_FOCAL_LENGTHS`). */
  focalMm: number
  framing: ViewOfInterestFraming
  /** A landform target (`role: 'landscape'`) this view is assessed against, when the reviewer adopted one for it. */
  landformId?: string | null
  /** Left out of every export while false; absent reads as included. */
  include?: boolean
}

/** The lenses offered: 50 mm is the reference sheets' lens (39.6° across), the default. */
export const LENS_FOCAL_LENGTHS = [50, 35, 28, 24] as const
export const DEFAULT_FOCAL_MM = 50
/** A full-frame sensor's half width, millimetres, as `figureFraming.ts` reads focal lengths. */
const HALF_FRAME_MM = 18
/** No more views than the saved-view limit, so every planned view can be captured. */
export const MAX_VIEWS_OF_INTEREST = 12
/** Inventory arrows aimed at the block that a viewpoint adds by default. */
export const DEFAULT_ARROWS_PER_VIEWPOINT = 2

/** The horizontal field of a full-frame-equivalent focal length, degrees. */
export function lensHfovDeg(focalMm: number): number {
  return (2 * Math.atan(HALF_FRAME_MM / focalMm) * 180) / Math.PI
}

/** "50 mm · 39.6° across". */
export function lensLabel(focalMm: number): string {
  return `${focalMm} mm · ${lensHfovDeg(focalMm).toFixed(1)}° across`
}

let counter = 0
export function createViewOfInterestId(): string {
  counter += 1
  return `voi-${Date.now().toString(36)}-${counter.toString(36)}`
}

/** The block's centre the views face: its interior point, which always lies inside it. */
export function blockCentre(geometry: PolygonGeometry): GeoPoint | null {
  return polygonInteriorPoint(geometry)
}

/** The compass bearing a view faces, given its block's centre; null when it faces a block that has no centre. */
export function viewBearing(view: ViewOfInterest, centre: GeoPoint | null): number | null {
  if (view.facing.kind === 'bearing') return normalizeBearing(view.facing.degrees)
  return centre ? bearingDegrees(view, centre) : null
}

export function normalizeBearing(degrees: number): number {
  return ((degrees % 360) + 360) % 360
}

/** "Arrow 2" for the arrow's place in its viewpoint's list, else "facing 245°". */
function facingName(arrow: CandidateArrow | null, index: number, blockName: string): string {
  return arrow ? `arrow ${index + 1}` : `toward ${blockName}`
}

/**
 * The views a VLI viewpoint or rec site adds for a block: one per arrow aimed at the block (within
 * `ARROW_AIM_DEGREES`, nearest the block's direction first), at most `DEFAULT_ARROWS_PER_VIEWPOINT`; else one view
 * facing the block. A viewpoint whose arrows all point elsewhere still faces the block: the reviewer can pick an
 * arrow afterwards. `bearingToBlock` is recomputed for `block`, since the finder ranked the candidate for another.
 */
export function viewsForCandidate(
  candidate: ViewpointCandidate,
  block: { id: string; name: string; geometry: PolygonGeometry },
  options: { arrowIds?: readonly string[]; focalMm?: number } = {},
): ViewOfInterest[] {
  const centre = blockCentre(block.geometry)
  const toBlock = centre ? bearingDegrees(candidate, centre) : candidate.bearingToBlock
  const offset = (arrow: CandidateArrow) => Math.abs(((arrow.bearing - toBlock + 540) % 360) - 180)
  const indexOf = (arrow: CandidateArrow) => candidate.arrows.findIndex((entry) => entry.id === arrow.id)
  const chosen = options.arrowIds
    ? candidate.arrows.filter((arrow) => options.arrowIds!.includes(arrow.id))
    : candidate.arrows
        .filter((arrow) => offset(arrow) <= ARROW_AIM_DEGREES)
        .sort((a, b) => offset(a) - offset(b))
        .slice(0, DEFAULT_ARROWS_PER_VIEWPOINT)
  const base = {
    source: { kind: candidate.kind, key: candidate.key } as const,
    lng: candidate.lng,
    lat: candidate.lat,
    blockId: block.id,
    focalMm: options.focalMm ?? DEFAULT_FOCAL_MM,
    framing: 'landform' as const,
  }
  if (!chosen.length)
    return [
      {
        ...base,
        id: createViewOfInterestId(),
        name: `${candidate.name}, ${facingName(null, 0, block.name)}`,
        facing: { kind: 'block' },
      },
    ]
  return chosen.map((arrow) => ({
    ...base,
    id: createViewOfInterestId(),
    name: `${candidate.name}, ${facingName(arrow, indexOf(arrow), block.name)}`,
    facing: { kind: 'bearing', degrees: normalizeBearing(arrow.bearing), arrowId: arrow.id },
  }))
}

/** A view placed by a click on the plan, facing the block. */
export function viewAtPoint(
  point: GeoPoint,
  block: { id: string; name: string },
  existing: readonly ViewOfInterest[],
  focalMm = DEFAULT_FOCAL_MM,
): ViewOfInterest {
  const placed = existing.filter((view) => view.source.kind === 'map').length
  return {
    id: createViewOfInterestId(),
    name: `Viewpoint ${placed + 1}, toward ${block.name}`,
    source: { kind: 'map' },
    lng: point.lng,
    lat: point.lat,
    blockId: block.id,
    facing: { kind: 'block' },
    focalMm,
    framing: 'landform',
  }
}

/**
 * Appends views, skipping any that repeat one already listed (the same place within 1 m, block and facing), and
 * stopping at `MAX_VIEWS_OF_INTEREST`. Returns the list and how many were skipped for each reason.
 */
export function addViews(
  existing: readonly ViewOfInterest[],
  added: readonly ViewOfInterest[],
): { views: ViewOfInterest[]; duplicates: number; overLimit: number } {
  const views = [...existing]
  let duplicates = 0
  let overLimit = 0
  for (const view of added) {
    if (views.some((other) => sameView(other, view))) {
      duplicates += 1
      continue
    }
    if (views.length >= MAX_VIEWS_OF_INTEREST) {
      overLimit += 1
      continue
    }
    views.push(view)
  }
  return { views, duplicates, overLimit }
}

function sameView(a: ViewOfInterest, b: ViewOfInterest): boolean {
  if (a.blockId !== b.blockId || haversineMeters(a, b) > 1) return false
  if (a.facing.kind !== b.facing.kind) return false
  return a.facing.kind === 'block' || Math.abs(a.facing.degrees - (b.facing as { degrees: number }).degrees) < 0.5
}

/**
 * What a capture of the view depends on: a saved view taken with another key is out of date. The name and the
 * include flag are left out, so renaming a view or leaving it out of an export keeps its capture.
 */
export function viewCaptureKey(view: ViewOfInterest): string {
  return JSON.stringify([
    Math.round(view.lng * 1e6) / 1e6,
    Math.round(view.lat * 1e6) / 1e6,
    view.blockId,
    view.facing.kind === 'bearing' ? Math.round(view.facing.degrees * 10) / 10 : 'block',
    view.focalMm,
    view.framing,
    view.landformId ?? null,
  ])
}

/** The views standing at one place, in list order: one stand and one run serve them all. */
export function groupByPlace(views: readonly ViewOfInterest[]): ViewOfInterest[][] {
  const groups: ViewOfInterest[][] = []
  for (const view of views) {
    const group = groups.find(
      (entry) =>
        haversineMeters(entry[0], view) <= 1 &&
        entry[0].blockId === view.blockId &&
        (entry[0].landformId ?? null) === (view.landformId ?? null),
    )
    if (group) group.push(view)
    else groups.push([view])
  }
  return groups
}

export const isIncluded = (view: ViewOfInterest) => view.include !== false

/** A captured view's state: captured with its current key, captured before an edit, or not yet. */
export type ViewCaptureState = 'captured' | 'outdated' | 'not-captured'

export function viewCaptureState(
  view: ViewOfInterest,
  savedViews: ReadonlyArray<{ plannedViewId?: string; plannedKey?: string }>,
): ViewCaptureState {
  const mine = savedViews.filter((saved) => saved.plannedViewId === view.id)
  if (!mine.length) return 'not-captured'
  const key = viewCaptureKey(view)
  return mine.some((saved) => saved.plannedKey === key) ? 'captured' : 'outdated'
}

/** Reads a stored list leniently: a malformed entry is dropped, never repaired into another view. */
export function parseViewsOfInterest(raw: unknown): ViewOfInterest[] {
  if (!Array.isArray(raw)) return []
  const views: ViewOfInterest[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const value = entry as Record<string, unknown>
    const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
    if (typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.blockId !== 'string') continue
    if (!finite(value.lng) || !finite(value.lat) || Math.abs(value.lng) > 180 || Math.abs(value.lat) > 90) continue
    const source = value.source as Record<string, unknown> | undefined
    const parsedSource: ViewOfInterestSource | null =
      source?.kind === 'map'
        ? { kind: 'map' }
        : (source?.kind === 'vli' || source?.kind === 'rec-site') && typeof source.key === 'string'
          ? { kind: source.kind, key: source.key }
          : null
    if (!parsedSource) continue
    const facing = value.facing as Record<string, unknown> | undefined
    const parsedFacing: ViewOfInterestFacing | null =
      facing?.kind === 'block'
        ? { kind: 'block' }
        : facing?.kind === 'bearing' && finite(facing.degrees)
          ? {
              kind: 'bearing',
              degrees: normalizeBearing(facing.degrees),
              ...(typeof facing.arrowId === 'string' ? { arrowId: facing.arrowId } : {}),
            }
          : null
    if (!parsedFacing) continue
    const focalMm =
      finite(value.focalMm) && value.focalMm >= 10 && value.focalMm <= 300 ? value.focalMm : DEFAULT_FOCAL_MM
    views.push({
      id: value.id,
      name: value.name,
      source: parsedSource,
      lng: value.lng,
      lat: value.lat,
      blockId: value.blockId,
      facing: parsedFacing,
      focalMm,
      framing: value.framing === 'single' ? 'single' : 'landform',
      ...(typeof value.landformId === 'string' ? { landformId: value.landformId } : {}),
      ...(value.include === false ? { include: false } : {}),
    })
    if (views.length >= MAX_VIEWS_OF_INTEREST) break
  }
  return views
}

/**
 * The views whose block is gone are kept but flagged: the reviewer re-points them rather than losing them. Returns
 * the ids of views whose `blockId` or `landformId` names no target in the scene.
 */
export function orphanedViews(
  views: readonly ViewOfInterest[],
  targets: ReadonlyArray<{ id: string; role: string }>,
): { missingBlock: string[]; missingLandform: string[] } {
  const blocks = new Set(targets.filter((target) => target.role === 'block').map((target) => target.id))
  const landforms = new Set(targets.filter((target) => target.role === 'landscape').map((target) => target.id))
  return {
    missingBlock: views.filter((view) => !blocks.has(view.blockId)).map((view) => view.id),
    missingLandform: views.filter((view) => view.landformId && !landforms.has(view.landformId)).map((view) => view.id),
  }
}

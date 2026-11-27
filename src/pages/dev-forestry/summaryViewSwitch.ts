/**
 * The Viewpoint summary's view switcher: which planned view of interest (`viewsOfInterest.ts`) the reviewer is
 * standing at now, and which one the ◀ ▶ arrows step to.
 *
 * A planned view is current when the reviewer stands within `SAME_PLACE_METERS` of its place. Several views can
 * share a place (one per inventory arrow, or one per block); the one whose facing matches the road view's look is
 * current, then the one for the summary's block, then the first listed.
 *
 * Pure: no DOM or network access.
 */
import { haversineMeters, type GeoPoint } from './visibility'
import { viewBearing, type ViewOfInterest } from './viewsOfInterest'

/** A view stands where the reviewer stands within this, metres, as `groupByPlace` and `addViews` read a place. */
export const SAME_PLACE_METERS = 1
/** A bearing look matches a view's facing within this, degrees. */
export const SAME_FACING_DEGREES = 1

/** What the road view is facing: a block it looks at, or a compass bearing. Both null while it faces neither. */
export type CurrentLook = { targetId: string | null; bearing: number | null }

const angleBetween = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)

/**
 * The planned view the reviewer stands at, or null when they stand anywhere else (the road, or a viewpoint that
 * is not planned). `centreOf` gives a block's centre, which a view facing its block turns toward.
 */
export function currentPlannedView(
  views: readonly ViewOfInterest[],
  standing: readonly [number, number] | null,
  options: {
    look?: CurrentLook | null
    /** The block the summary reads; breaks a tie between views that share a place and a facing. */
    blockId?: string | null
    centreOf?: (blockId: string) => GeoPoint | null
  } = {},
): ViewOfInterest | null {
  if (!standing) return null
  const here = { lng: standing[0], lat: standing[1] }
  const atPlace = views.filter((view) => haversineMeters(view, here) <= SAME_PLACE_METERS)
  if (atPlace.length <= 1) return atPlace[0] ?? null
  const look = options.look
  const facingMatches = (view: ViewOfInterest) => {
    if (!look) return false
    if (look.targetId) return view.facing.kind === 'block' && view.blockId === look.targetId
    if (look.bearing === null) return false
    const bearing = viewBearing(view, options.centreOf?.(view.blockId) ?? null)
    return bearing !== null && angleBetween(bearing, look.bearing) <= SAME_FACING_DEGREES
  }
  const facing = atPlace.filter(facingMatches)
  const pool = facing.length ? facing : atPlace
  return pool.find((view) => view.blockId === options.blockId) ?? pool[0]
}

/**
 * Where the assessment stands, read from the scene's own viewpoint so it holds after a reload: a spot's point, or the
 * middle of a stand's pullout (a `stand-` viewpoint is the pullout `pulloutThrough` lays centred on the place stood
 * at). Null for a road, which stands at no one place.
 */
export function assessedStandPoint(viewpoint: {
  id?: string
  mode: string
  coordinates: ReadonlyArray<readonly number[]>
}): [number, number] | null {
  const [first, second] = viewpoint.coordinates
  if (viewpoint.mode === 'spot') return first ? [first[0], first[1]] : null
  if (viewpoint.id?.startsWith('stand-') && viewpoint.coordinates.length === 2 && first && second)
    return [(first[0] + second[0]) / 2, (first[1] + second[1]) / 2]
  return null
}

/**
 * The view the arrows step to from `currentId`, wrapping at the ends. From nowhere (no planned view is current)
 * ▶ goes to the first view and ◀ to the last. Null when there is no view to step to.
 */
export function steppedView(
  views: readonly ViewOfInterest[],
  currentId: string | null,
  step: 1 | -1,
): ViewOfInterest | null {
  if (!views.length) return null
  const index = currentId ? views.findIndex((view) => view.id === currentId) : -1
  if (index < 0) return step > 0 ? views[0] : views[views.length - 1]
  const next = views[(index + step + views.length) % views.length]
  return next.id === currentId ? null : next
}

/** "2 of 5" for the current view; "5 planned" when none is current. */
export function viewPosition(views: readonly ViewOfInterest[], currentId: string | null): string {
  const index = currentId ? views.findIndex((view) => view.id === currentId) : -1
  return index >= 0 ? `${index + 1} of ${views.length}` : `${views.length} planned`
}

/**
 * The first planned view at the reviewer's place that assesses `blockId`: switching the summary's block to it
 * stands at that view rather than only turning the summary.
 */
export function viewForBlockHere(
  views: readonly ViewOfInterest[],
  standing: readonly [number, number] | null,
  blockId: string,
): ViewOfInterest | null {
  if (!standing) return null
  const here = { lng: standing[0], lat: standing[1] }
  return views.find((view) => view.blockId === blockId && haversineMeters(view, here) <= SAME_PLACE_METERS) ?? null
}

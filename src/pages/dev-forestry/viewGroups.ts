/**
 * Views of interest assessed together: step 4 (the ocular class, the design adjustments and the rating) is made once
 * for a group of views that see their block from the same perspective, and once for each view that does not.
 *
 * A group is led by one view; the others name it in `ViewOfInterest.assessedWith`. The step 4 record is kept by the
 * lead's id (`ViaReview.stations`). Grouping is the reviewer's: `groupSuggestion` proposes a view that looks at the
 * same block from within `SAME_PERSPECTIVE_DEGREES` of another, at a similar distance, and nothing is grouped until
 * the reviewer accepts.
 *
 * Pure: no DOM or network access.
 */
import { bearingDegrees, haversineMeters, type GeoPoint } from './visibility'
import type { ViewOfInterest } from './viewsOfInterest'

/** Two views look at their block from the same side when, seen from the block's centre, they are this close, degrees. */
export const SAME_PERSPECTIVE_DEGREES = 10
/** …and the nearer stands at least this share of the farther's distance from it. */
export const SAME_PERSPECTIVE_DISTANCE_RATIO = 0.8

type Grouped = Pick<ViewOfInterest, 'id' | 'assessedWith'>

/**
 * The view that leads `view`'s group: the view its `assessedWith` names, followed to a view that names none. A name
 * that is not listed, or a loop, leaves the view leading its own group.
 */
export function groupLeadOf<V extends Grouped>(view: V, views: readonly V[]): V {
  let lead = view
  const seen = new Set([view.id])
  while (lead.assessedWith) {
    const next = views.find((entry) => entry.id === lead.assessedWith)
    if (!next || seen.has(next.id)) return next ? view : lead
    seen.add(next.id)
    lead = next
  }
  return lead
}

/** The views assessed with `leadId`'s group, the lead first, in list order. */
export function groupMembers<V extends Grouped>(leadId: string, views: readonly V[]): V[] {
  const members = views.filter((view) => groupLeadOf(view, views).id === leadId)
  return members.sort((a, b) => (a.id === leadId ? -1 : b.id === leadId ? 1 : 0))
}

/** The group a view of this name belongs to, by its lead's id: what the reports read a saved view's step 4 under. */
export function groupIdForName(views: readonly ViewOfInterest[], name: string): string | null {
  const view = views.find((entry) => entry.name === name)
  return view ? groupLeadOf(view, views).id : null
}

/**
 * Assesses `viewId` (and, when it leads a group, every view in it) with `leadId`'s group. Returns the list unchanged
 * when either is not listed or they are already together.
 */
export function joinGroup(views: readonly ViewOfInterest[], viewId: string, leadId: string): ViewOfInterest[] {
  const view = views.find((entry) => entry.id === viewId)
  const target = views.find((entry) => entry.id === leadId)
  if (!view || !target) return [...views]
  const to = groupLeadOf(target, views).id
  const from = groupLeadOf(view, views).id
  if (to === from) return [...views]
  // A lead brings its whole group; a view assessed with another group comes alone.
  const moving = new Set(from === viewId ? groupMembers(viewId, views).map((entry) => entry.id) : [viewId])
  return views.map((entry) => (moving.has(entry.id) ? { ...entry, assessedWith: to } : entry))
}

/**
 * Gives `viewId` its own assessment. A view leading others hands the group to the next of them, which the caller
 * moves the group's step 4 record to: `newLeadId` names it, null when the view led no one or was only a member.
 */
export function leaveGroup(
  views: readonly ViewOfInterest[],
  viewId: string,
): { views: ViewOfInterest[]; newLeadId: string | null } {
  const view = views.find((entry) => entry.id === viewId)
  if (!view) return { views: [...views], newLeadId: null }
  const lead = groupLeadOf(view, views)
  if (lead.id !== viewId)
    return { views: views.map((entry) => (entry.id === viewId ? standAlone(entry) : entry)), newLeadId: null }
  return handOver(views, viewId)
}

/** Before a lead is removed: its group passes to the next of its views. `newLeadId` as for `leaveGroup`. */
export function handOver(
  views: readonly ViewOfInterest[],
  leadId: string,
): { views: ViewOfInterest[]; newLeadId: string | null } {
  const others = groupMembers(leadId, views).filter((entry) => entry.id !== leadId)
  if (!others.length) return { views: [...views], newLeadId: null }
  const next = others[0].id
  return {
    views: views.map((entry) => {
      if (entry.id === leadId) return standAlone(entry)
      if (entry.id === next) return standAlone(entry)
      if (others.some((other) => other.id === entry.id)) return { ...entry, assessedWith: next }
      return entry
    }),
    newLeadId: next,
  }
}

function standAlone(view: ViewOfInterest): ViewOfInterest {
  const rest = { ...view }
  delete rest.assessedWith
  return rest
}

/** Where a view stands as its block sees it: the bearing from the block's centre to the view and its distance. */
function perspective(view: GeoPoint, centre: GeoPoint): { bearing: number; distance: number } {
  return { bearing: bearingDegrees(centre, view), distance: haversineMeters(centre, view) }
}

export type PerspectiveMatch = { apartDegrees: number; distancesMeters: [number, number] }

/**
 * Whether two views see the same block from the same perspective: the same block, within `SAME_PERSPECTIVE_DEGREES`
 * of each other as seen from its centre, the nearer at least `SAME_PERSPECTIVE_DISTANCE_RATIO` of the farther's
 * distance away. Null when they do not, or the block has no centre.
 */
export function samePerspective(
  a: ViewOfInterest,
  b: ViewOfInterest,
  centreOf: (blockId: string) => GeoPoint | null,
): PerspectiveMatch | null {
  if (a.blockId !== b.blockId) return null
  const centre = centreOf(a.blockId)
  if (!centre) return null
  const pa = perspective(a, centre)
  const pb = perspective(b, centre)
  const apart = Math.abs(((pa.bearing - pb.bearing + 540) % 360) - 180)
  const far = Math.max(pa.distance, pb.distance)
  if (apart > SAME_PERSPECTIVE_DEGREES || far <= 0) return null
  if (Math.min(pa.distance, pb.distance) / far < SAME_PERSPECTIVE_DISTANCE_RATIO) return null
  return { apartDegrees: apart, distancesMeters: [pa.distance, pb.distance] }
}

/**
 * The group a view could be assessed with: the first group led by an earlier view that sees the same block from
 * the same perspective (`samePerspective` with its lead). Only for a view that leads a group of its own: a view
 * already assessed with another gets no suggestion, and the earlier view of a pair gets none either, so each pair is
 * proposed once, on the later row.
 */
export function groupSuggestion(
  view: ViewOfInterest,
  views: readonly ViewOfInterest[],
  centreOf: (blockId: string) => GeoPoint | null,
): ({ lead: ViewOfInterest } & PerspectiveMatch) | null {
  if (groupLeadOf(view, views).id !== view.id) return null
  const index = views.findIndex((entry) => entry.id === view.id)
  for (const lead of views.slice(0, Math.max(0, index))) {
    if (groupLeadOf(lead, views).id !== lead.id) continue
    const match = samePerspective(view, lead, centreOf)
    if (match) return { lead, ...match }
  }
  return null
}

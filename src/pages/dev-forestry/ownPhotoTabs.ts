/**
 * The own-photo window's three tabs (*Photos*, *Camera*, *Use*) and the one primary action its footer offers for the
 * active photo's state (docs/forestry-visual-quality-own-photo-redesign-2026-11-17.md, §2.8). The older step names
 * (`ownPhotoSteps.ts`: position, direction, check) still open the window: the first two land on *Camera* with the hand
 * tools showing, the check on *Camera* as it is.
 *
 * Like the steps, the primary action never says a camera is right: *Check this camera* draws the checks, *Accept
 * camera* is the reviewer's, and nothing before it is a verdict.
 *
 * Free of DOM and network access.
 */
import type { PhotoQueueStatus } from './photoOptions'
import type { OwnPhotoStep } from './ownPhotoSteps'

export type OwnPhotoTab = 'photos' | 'camera' | 'use'

export const OWN_PHOTO_TABS: ReadonlyArray<{ tab: OwnPhotoTab; label: string }> = [
  { tab: 'photos', label: 'Photos' },
  { tab: 'camera', label: 'Camera' },
  { tab: 'use', label: 'Use' },
]

/** Where the window can be opened at: a tab, or one of the older step names that still lead into it. */
export type OwnPhotoPlace = OwnPhotoTab | OwnPhotoStep

const isTab = (place: OwnPhotoPlace): place is OwnPhotoTab =>
  place === 'photos' || place === 'camera' || place === 'use'

/** The tab a place opens on. */
export function tabOf(place: OwnPhotoPlace): OwnPhotoTab {
  return isTab(place) ? place : 'camera'
}

/** Whether a place asks for the hand tools (*Adjust*): the old Position and Direction steps were those tools. */
export function adjustsAt(place: OwnPhotoPlace): boolean {
  return place === 'position' || place === 'direction'
}

export type OwnPhotoPrimary =
  | { kind: 'add'; label: string }
  | { kind: 'searching'; label: string }
  | { kind: 'search'; label: string }
  | { kind: 'accept'; label: string; reason: string | null }
  | { kind: 'viewpoint'; label: string; reason: string | null }
  | { kind: 'stand'; label: string; reason: string | null }
  | { kind: 'next'; label: string; nextId: string }
  | { kind: 'none'; label: string }

export interface OwnPhotoPrimaryInput {
  /** Photos open in the set. */
  count: number
  /** The active photo's id, when one is. */
  activeId: string | null
  /** The queue's position and size while it runs a photo. */
  queue: { running: boolean; position: number | null; total: number }
  /** The active photo's queue status (`PhotoQueueStatus`). */
  status: PhotoQueueStatus | null
  /** The active photo's acceptance as it stands. */
  acceptance: 'none' | 'accepted' | 'lapsed'
  /** Why Accept is refused now, from the gate (`acceptGate`); null when it may be pressed. */
  acceptReason: string | null
  /** The view of interest this photo is already a viewpoint for, when it is one. */
  viewpointId: string | null
  /** Why the road view cannot stand at the photo; null when it can. */
  standReason: string | null
  /** The next photo in time order that is not yet accepted, after the active one. */
  nextId: string | null
}

/**
 * The footer's primary action: no photos, add some; while the active photo is being searched, the queue's place in
 * it; options ready, accept the camera (one click, nothing asked first); accepted, make it a viewpoint, then stand
 * there; then the next photo. A lapsed acceptance is the same as none: the camera moved, so it is accepted again.
 */
export function ownPhotoPrimary(input: OwnPhotoPrimaryInput): OwnPhotoPrimary {
  if (!input.count || !input.activeId) return { kind: 'add', label: 'Add photos' }
  if (input.status === 'searching' || input.status === 'queued') {
    if (input.queue.running && input.queue.position)
      return { kind: 'searching', label: `Searching ${input.queue.position} of ${input.queue.total}` }
    return { kind: 'searching', label: 'Waiting its turn' }
  }
  // Never searched: a cancelled queue left it, or it came back from a file. Offer the search rather than a check.
  if (input.status === 'unsearched' && input.acceptance !== 'accepted')
    return { kind: 'search', label: 'Search for the camera' }
  if (input.acceptance === 'accepted') {
    if (!input.viewpointId) return { kind: 'viewpoint', label: 'Make a viewpoint', reason: null }
    if (!input.standReason) return { kind: 'stand', label: 'Stand here', reason: null }
    if (input.nextId) return { kind: 'next', label: 'Next photo', nextId: input.nextId }
    return { kind: 'stand', label: 'Stand here', reason: input.standReason }
  }
  return { kind: 'accept', label: 'Accept camera', reason: input.acceptReason }
}

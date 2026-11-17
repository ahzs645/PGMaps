/**
 * The decisions behind capturing planned views of interest (`useViewCapture.ts`): which views a batch captures and in
 * what order, where each place stands and which way it faces, when the road view is ready to save, which earlier
 * saves a recapture replaces, and how a saved view's figure is framed with its lens.
 *
 * Pure: no DOM or network access.
 */
import {
  focalForHfov,
  HFOV_50_MM,
  planFixedFraming,
  planFraming,
  type AngularExtent,
  type FigureFrame,
  type FramingPlan,
} from './figureFraming'
import { verticalFovFromHorizontal } from './exifPose'
import { groupByPlace, lensHfovDeg, normalizeBearing, type ViewOfInterest } from './viewsOfInterest'

/** The saved-view limit at one place (`saveView`): the road view keeps twelve comparisons. */
export const MAX_SAVED_VIEWS = 12

/** Longest each step of a capture waits before the view is reported as not captured. */
export const CAPTURE_TIMEOUTS = {
  /** The run for the place (it is the full sightline analysis). */
  runMs: 300_000,
  /** The road view opening on the place, its terrain and drawn timber loading. */
  roadViewMs: 120_000,
  /** The camera turning to the view's facing and lens. */
  facingMs: 20_000,
  /** The save: the screenshot, then the framed class pass (another engine's drawing can take minutes). */
  saveMs: 300_000,
} as const

/** Settle time after a facing or lens change, so the regrown stand's loading shows before readiness is judged. */
export const FACING_SETTLE_MS = 600

/** How close the camera's bearing must be to the one asked for, degrees. */
export const FACING_TOLERANCE_DEG = 1

/** One place of a batch: the views standing there, in list order. */
export type CapturePlace = { views: ViewOfInterest[] }

/**
 * The places a batch stands at, in the list's order: the requested views that are still listed, grouped by place
 * (`groupByPlace`), so one stand and one run serve every view there. Unknown ids are returned in `missing`.
 */
export function planCapture(
  views: readonly ViewOfInterest[],
  viewIds: readonly string[],
): { places: CapturePlace[]; missing: string[] } {
  const wanted = new Set(viewIds)
  const chosen = views.filter((view) => wanted.has(view.id))
  const listed = new Set(chosen.map((view) => view.id))
  return {
    places: groupByPlace(chosen).map((group) => ({ views: group })),
    missing: [...wanted].filter((id) => !listed.has(id)),
  }
}

/**
 * Where a place stands: the viewpoint's key and name. An inventory viewpoint or rec site keeps its candidate's key
 * (so standing there from the finder and from a view is one place, with one set of saved views); a map click is
 * keyed by its coordinates to the centimetre-ish (1e-6°), which `groupByPlace`'s 1 m already shares.
 */
export function standPlace(view: ViewOfInterest, candidateName?: string | null): { key: string; name: string } {
  if (view.source.kind !== 'map') return { key: view.source.key, name: candidateName ?? placeNameFromView(view.name) }
  return {
    key: `map-${view.lng.toFixed(6)},${view.lat.toFixed(6)}`,
    name: placeNameFromView(view.name),
  }
}

/** "VLI 144" from "VLI 144, arrow 1" or "VLI 144, toward Block 12"; a renamed view keeps its own name. */
export function placeNameFromView(name: string): string {
  const trimmed = name.replace(/, (arrow \d+|toward .+)$/, '').trim()
  return trimmed || name
}

/** Which way the road view faces for a view: its block, or its bearing. */
export function standFacing(view: ViewOfInterest): { lookAtTargetId: string | null; lookBearing: number | null } {
  return view.facing.kind === 'bearing'
    ? { lookAtTargetId: null, lookBearing: normalizeBearing(view.facing.degrees) }
    : { lookAtTargetId: view.blockId, lookBearing: null }
}

/** What the page reports while a capture waits on it. */
export type CaptureFacts = {
  /** The scene's fingerprint now. */
  key: string | null
  /** A run for `key` is held and current. */
  runFresh: boolean
  runRunning: boolean
  /** The run's error, when the last run failed. */
  runError: string | null
  /** The road view is open on a full run (not the preliminary terrain look). */
  roadViewOpen: boolean
  /** `canSaveView`: terrain, camera and drawn timber are ready. */
  canSave: boolean
  /** What the road view still waits for, in words, while it cannot save (`saveBlocker`); absent when not known. */
  saveBlocker?: string | null
  /** What the drive faces. */
  lookAtTargetId: string | null
  lookBearing: number | null
  /** The camera's bearing (the drive's last pose), and the bearing to the faced block's centre from it. */
  poseBearing: number | null
  blockBearing: number | null
  /** The road view's lens (null: MapLibre's own), and whether the eye map's field matches it now. */
  lensMm: number | null
  lensApplied: boolean
}

export type CaptureWant = {
  key: string
  lookAtTargetId: string | null
  lookBearing: number | null
  lensMm: number
}

export type CaptureWait = 'run' | 'road view' | 'timber' | 'facing' | 'lens' | null

const turn = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)

/**
 * What the capture still waits for at a place, or null once the view can be saved as asked: the run for the place's
 * key, the road view open on it, terrain and timber ready, the camera on the facing, the lens on the eye map.
 */
export function captureWaitingFor(facts: CaptureFacts, want: CaptureWant): CaptureWait {
  if (facts.key !== want.key || !facts.runFresh) return 'run'
  if (!facts.roadViewOpen) return 'road view'
  if (facts.lookAtTargetId !== want.lookAtTargetId) return 'facing'
  if (want.lookBearing !== null && (facts.lookBearing === null || turn(facts.lookBearing, want.lookBearing) > 0.05))
    return 'facing'
  if (facts.lensMm !== want.lensMm || !facts.lensApplied) return 'lens'
  if (facts.poseBearing === null) return 'facing'
  const aim = want.lookBearing ?? facts.blockBearing
  if (aim === null || turn(facts.poseBearing, aim) > FACING_TOLERANCE_DEG) return 'facing'
  if (!facts.canSave) return 'timber'
  return null
}

/** The page's words for what a step timed out waiting for. */
export function waitFailure(wait: Exclude<CaptureWait, null>, facts: CaptureFacts): string {
  switch (wait) {
    case 'run':
      return facts.runError
        ? `The run for this place failed: ${facts.runError}`
        : `The run for this place did not finish within ${minutes(CAPTURE_TIMEOUTS.runMs)}.`
    case 'road view':
      return `The road view did not open on this place within ${minutes(CAPTURE_TIMEOUTS.roadViewMs)}.`
    case 'timber':
      return `The road view's terrain or drawn timber did not finish loading within ${minutes(CAPTURE_TIMEOUTS.roadViewMs)}${
        facts.saveBlocker ? `: it was still waiting for ${facts.saveBlocker}` : ''
      }.`
    case 'lens':
      return 'The road view did not take the view’s lens.'
    case 'facing':
      return 'The camera did not turn to the view’s facing.'
  }
}

const minutes = (ms: number) => `${Math.round(ms / 60_000)} minute${ms === 60_000 ? '' : 's'}`

/** "Capturing 2 of 5: VLI 144, arrow 1…" */
export function captureMessage(index: number, total: number, name: string): string {
  return `Capturing ${index + 1} of ${total}: ${name}…`
}

/**
 * The batch's closing line: "Captured 4 of 5 views; 1 could not be captured." `warned` counts the saved views
 * without their analysis sheet (`sheet`), which are not counted as captured, or without their before-harvest render
 * (`before`): "Captured 2 of 3 views; 1 saved without its analysis sheet."
 */
export function captureSummary(
  captured: number,
  total: number,
  failed: number,
  cancelled: boolean,
  warned: { sheet?: number; before?: number } = {},
): string {
  // A view saved without its analysis sheet is not captured yet: the list and *Capture N views* take it again.
  const head = `Captured ${captured - (warned.sheet ?? 0)} of ${total} view${total === 1 ? '' : 's'}`
  const without = (count: number | undefined, what: string) =>
    count ? `${count} saved without ${count === 1 ? 'its' : 'their'} ${what}${count === 1 ? '' : 's'}` : ''
  const parts = [
    cancelled ? 'cancelled' : '',
    !cancelled && failed ? `${failed} could not be captured` : '',
    without(warned.sheet, 'analysis sheet'),
    without(warned.before, 'before-harvest render'),
  ].filter(Boolean)
  return parts.length ? `${head}; ${parts.join('; ')}.` : `${head}.`
}

/** "Drawing the before-harvest renders at VLI 144…" */
export function beforeMessage(count: number, placeName: string): string {
  return `Drawing the before-harvest render${count === 1 ? '' : 's'} at ${placeNameFromView(placeName)}…`
}

/** A view saved without its before-harvest render, with the page's reason when it named this view. */
export function beforeWarning(name: string, notes: readonly string[]): string {
  const own = notes.find((note) => note.startsWith(`${name}:`))
  const reason = own ? own.slice(name.length + 1).trim() : notes.join(' ')
  return `Saved, but its before-harvest render could not be taken${reason ? `: ${reason.replace(/^[A-Z]/, (c) => c.toLowerCase())}` : '.'}`
}

type SavedLike = { id: string; plannedViewId?: string }

/**
 * Removes every earlier save of a planned view, wherever it was saved: the current place's list and each shelved
 * place's. A recapture then replaces the view rather than adding a second one. Returns the lists and the removed ids.
 */
export function withoutPlannedView<V extends SavedLike>(
  saved: readonly V[],
  shelved: ReadonlyArray<{ key: string; views: V[] }>,
  plannedViewId: string,
): { saved: V[]; shelved: Array<{ key: string; views: V[] }>; removed: string[] } {
  const removed: string[] = []
  const keep = (view: V) => {
    if (view.plannedViewId !== plannedViewId) return true
    removed.push(view.id)
    return false
  }
  const nextSaved = saved.filter(keep)
  const nextShelved = shelved
    .map((entry) => ({ key: entry.key, views: entry.views.filter(keep) }))
    .filter((entry) => entry.views.length > 0)
  return { saved: nextSaved, shelved: nextShelved, removed }
}

/** Where a saved view's figure is framed from, as far as framing reads it (`FigureAt` in the page). */
export type FramingAt = {
  /** A lined-up field photo's horizontal field: it frames the view whatever the lens. */
  photoHfov: number | null
  /** The lens the view was saved with (View options → *Lens*, or a planned view's), horizontal degrees. */
  lensHfov?: number
  /** `single`: one frame of the lens centred on the view's facing; `landform` (or absent): framed on the landform. */
  framing?: 'landform' | 'single'
  /** The camera's bearing when saved: the facing a single frame is centred on. */
  pose: { bearing: number } | null
  /**
   * A photo viewpoint's pitch, degrees above the horizon: its single frame is centred on it, as the photo was, rather
   * than placed by the landform's foot.
   */
  framePitch?: number | null
}

/**
 * The frames a saved view's figure is drawn in: a single frame of the lens centred on the facing when the view asks
 * for one; else the scene's fixed frame when it set one; else the landform framed with the lens (the photo's, the
 * view's, else 50 mm). Null when there is nothing to frame on.
 */
export function figurePlanFor(
  at: FramingAt,
  extent: AngularExtent | null,
  figureFrame: FigureFrame | null,
): FramingPlan | null {
  const lens = at.photoHfov ?? at.lensHfov ?? HFOV_50_MM
  if (at.framing === 'single' && at.pose)
    return planSingleFrame(normalizeBearing(at.pose.bearing), lens, extent, at.framePitch ?? null)
  if (figureFrame) return planFixedFraming(figureFrame, extent)
  return extent ? planFraming(extent, { lensHfovDeg: lens }) : null
}

/** A single frame's shape, width over height: a full-frame camera's 3:2. */
export const SINGLE_FRAME_ASPECT = 3 / 2

/**
 * One frame of the lens, as a camera held at the viewpoint takes it: centred on the facing, 3:2, with the landform's
 * foot about a third of the way up when it is known (`planFixedFraming` keeps it there too), else level. Never tiled:
 * a wide lens is one rectilinear frame, not a panorama.
 */
export function planSingleFrame(
  bearingDeg: number,
  lensHfovDeg: number,
  extent: AngularExtent | null,
  /** Centre the frame on this pitch (a photo viewpoint's), degrees above the horizon. */
  pitchDeg: number | null = null,
): FramingPlan {
  const vfov = verticalFovFromHorizontal(lensHfovDeg, SINGLE_FRAME_ASPECT, 1)
  const pitch =
    pitchDeg !== null && Number.isFinite(pitchDeg) ? pitchDeg : extent ? extent.elBottomDeg - vfov * 0.3 + vfov / 2 : 0
  const top = pitch + vfov / 2
  const bottom = pitch - vfov / 2
  const shares = extent
    ? { sky: Math.max(0, (top - extent.elTopDeg) / vfov), ground: Math.max(0, (extent.elBottomDeg - bottom) / vfov) }
    : { sky: 0.5, ground: 0.5 }
  const bearing = normalizeBearing(bearingDeg)
  return {
    frames: [{ bearingDeg: bearing, pitchDeg: pitch, hfovDeg: lensHfovDeg, vfovDeg: vfov }],
    totalHfovDeg: lensHfovDeg,
    vfovDeg: vfov,
    shares,
    label: `single frame: ${Math.round(focalForHfov(lensHfovDeg))} mm full-frame equivalent, ${lensHfovDeg.toFixed(1)}° across, facing ${Math.round(bearing)}°`,
  }
}

/**
 * A planned view's lens as the horizontal field a figure records: a photo viewpoint's own field across (its
 * `focalMm` is rounded to a tenth of a millimetre, and a frame that is not 3:2 has no exact focal length), else its
 * focal length's.
 */
export const viewLensHfov = (view: Pick<ViewOfInterest, 'focalMm' | 'photo'>) =>
  view.photo && Number.isFinite(view.photo.hfov) && view.photo.hfov > 0 ? view.photo.hfov : lensHfovDeg(view.focalMm)

/**
 * Whether the eye map's vertical field is the lens's across its canvas now (`DriveCamera`'s `horizontalFovDegrees`).
 * No lens set reads as applied: the road view keeps MapLibre's own field. `hfovDeg`, when given, is the field the
 * road view was asked for in place of the focal length's (a photo viewpoint's, `viewLensHfov`).
 */
export function lensApplied(
  lensMm: number | null,
  eye: { verticalFovDeg: number; width: number; height: number } | null,
  hfovDeg: number | null = null,
): boolean {
  if (lensMm === null && hfovDeg === null) return true
  if (!eye || eye.width <= 0 || eye.height <= 0) return false
  const wanted = verticalFovFromHorizontal(hfovDeg ?? lensHfovDeg(lensMm!), eye.width, eye.height)
  return Math.abs(eye.verticalFovDeg - wanted) < 0.05
}

/**
 * The field photo a photo viewpoint's capture takes as its before picture: the record its photo link names, while
 * that record is still listed and holds an image. Null for any other view. The photo is the *existing* picture of a
 * before/after pair (`reportPairs.ts`); the before-harvest render is still taken for the with-timber figure, which a
 * photograph's framing cannot give.
 */
export function viewPhotoRecord<R extends { id: string; kind: string; image: string }>(
  view: Pick<ViewOfInterest, 'photo'>,
  records: readonly R[],
): R | null {
  const recordId = view.photo?.recordId
  if (!recordId) return null
  const record = records.find((entry) => entry.id === recordId)
  return record && record.kind === 'photo' && record.image ? record : null
}

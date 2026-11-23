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
import { acceptanceLapsed, type AcceptancePose } from './photoAcceptance'
import type { FieldRecord } from './assessmentTools'
import {
  equivalentFocalMm,
  focalForHfov,
  focalLabel,
  lensHfovDeg,
  parseViewEye,
  parseViewLens,
  type ViewEye,
  type ViewLensEntry,
} from './viewCamera'
import { parseViewPlaceEntry, type ViewPlaceEntry } from './viewCoordinates'

export { focalForHfov, lensHfovDeg }

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
  /**
   * The view whose step 4 assessment this one shares (`viewGroups.ts`): the reviewer's grouping of views that see the
   * block from the same perspective. Absent: the view is assessed on its own (or leads its group).
   */
  assessedWith?: string
  /**
   * The photo this view was made from (`viewFromAcceptedPhoto`): its field record and the accepted camera's altitude,
   * tilt, roll and lens, which a map view does not otherwise hold. The view's place and facing are the camera's.
   */
  photo?: ViewOfInterestPhoto | null
  /**
   * The place as typed (`viewCoordinates.ts`): the text, its system, datum and zone, and the precision its digits
   * state. It describes the view only while the view still stands where it put it (`placeEntryOf`): a drag on the plan
   * leaves it behind, unprinted.
   */
  place?: ViewPlaceEntry | null
  /**
   * The lens as entered (`viewCamera.ts`): a field across, or a focal length with its crop factor. `focalMm` is its
   * full-frame equivalent, which older readers and the capture key read. Absent: one of `LENS_FOCAL_LENGTHS`.
   */
  lens?: ViewLensEntry | null
  /**
   * A surveyed eye (`viewCamera.ts`): an elevation above sea level, or a height above the terrain model's ground. Out of
   * the run's stations; the capture and the road view stand there. Absent: the run's eye height over the model.
   */
  eye?: ViewEye | null
}

/**
 * A view's photo link. The source stays `map`: `parseViewsOfInterest` drops a kind it does not know, so a `photo`
 * kind would make an older PGMaps lose the whole view. Read by one, the view is an ordinary map view at the camera's
 * place facing its heading, at eye level with its own lens; the link is left out (it copies only the fields it
 * knows), and its capture key, which carries the photo camera, no longer matches, so it reads as needing capture
 * rather than passing a ground-level capture off as the photo's.
 */
export type ViewOfInterestPhoto = {
  /** The photo's field record (`FieldRecord.id`), which holds its bytes and its acceptance. */
  recordId: string
  /** Metres above sea level; null for a camera standing at eye height over the ground. */
  altitudeMeters: number | null
  /** Degrees above the horizon. */
  pitch: number
  /** Degrees; positive raises the photo's right side. */
  roll: number
  /** Degrees across the photo's width. */
  hfov: number
}

/** The lenses offered: 50 mm is the reference sheets' lens (39.6° across), the default. */
export const LENS_FOCAL_LENGTHS = [50, 35, 28, 24] as const
export const DEFAULT_FOCAL_MM = 50
/** Study capacity, independent of the number of views rendered in one batch. */
export const MAX_VIEWS_OF_INTEREST = 24
/** Inventory arrows aimed at the block that a viewpoint adds by default. */
export const DEFAULT_ARROWS_PER_VIEWPOINT = 2

/** "50 mm · 39.6° across" ("79.9 mm · 25.4° across" for a lens entered by its field). */
export function lensLabel(focalMm: number): string {
  return `${focalLabel(focalMm)} · ${lensHfovDeg(focalMm).toFixed(1)}° across`
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
  // Its place in the list (the number its marker shows), unless a view's name already uses that or a later number:
  // then the next unused one. Counting map views alone named the fourth view "Viewpoint 2", and repeated a name once
  // one was removed.
  const used = existing.flatMap((view) => {
    const match = /^Viewpoint (\d+)\b/.exec(view.name)
    return match ? [Number(match[1])] : []
  })
  const number = Math.max(existing.length + 1, ...used.map((n) => n + 1))
  return {
    id: createViewOfInterestId(),
    name: `Viewpoint ${number}, toward ${block.name}`,
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
  const tenth = (value: number) => Math.round(value * 10) / 10
  return JSON.stringify([
    Math.round(view.lng * 1e6) / 1e6,
    Math.round(view.lat * 1e6) / 1e6,
    view.blockId,
    view.facing.kind === 'bearing' ? tenth(view.facing.degrees) : 'block',
    view.focalMm,
    view.framing,
    view.landformId ?? null,
    // A photo's camera only when the view has one, so every other view keeps the key its captures were saved under.
    ...(view.photo
      ? [
          view.photo.altitudeMeters === null ? null : tenth(view.photo.altitudeMeters),
          tenth(view.photo.pitch),
          tenth(view.photo.roll),
          tenth(view.photo.hfov),
        ]
      : []),
    // A surveyed eye only when the view has one (and no photo, whose camera is its own), tagged so it is read by name.
    ...(view.eye && !view.photo ? [['eye', view.eye.reference, tenth(view.eye.meters)]] : []),
  ])
}

/**
 * The views standing at one place, in list order: one stand and one run serve them all. A photo viewpoint's eye is at
 * the photo's altitude, so it shares a stand only with views at that same eye: a ground view and an aircraft photo
 * over the same spot are different stands, and grouped they would save the photo's view from the ground.
 */
export function groupByPlace(views: readonly ViewOfInterest[]): ViewOfInterest[][] {
  const groups: ViewOfInterest[][] = []
  // A surveyed eye is a stand of its own too: an elevation or a height above the ground is the stand's run input.
  const eyeOf = (view: ViewOfInterest) =>
    view.photo ? view.photo.altitudeMeters : view.eye ? `${view.eye.reference}:${view.eye.meters}` : null
  for (const view of views) {
    const group = groups.find(
      (entry) =>
        haversineMeters(entry[0], view) <= 1 &&
        entry[0].blockId === view.blockId &&
        (entry[0].landformId ?? null) === (view.landformId ?? null) &&
        eyeOf(entry[0]) === eyeOf(view),
    )
    if (group) group.push(view)
    else groups.push([view])
  }
  return groups
}

export const isIncluded = (view: ViewOfInterest) => view.include !== false

/**
 * A planned view's capture: `captured` (a saved view with its current key, with its analysis sheet),
 * `screenshot-only` (saved with its current key and its screenshot, but its analysis sheet could not be drawn: only
 * the sheet is drawn again, `needsSheetOnly`), `no-figure` (saved with its current key, but neither sheet nor
 * screenshot is held, gone with an earlier session), `outdated` (captured before an edit) or `not-captured`. Only
 * `captured` is complete: every other state needs capturing, and *Capture N views* and an export's capture take it
 * again (`needsCapture`).
 */
export type ViewCaptureState = 'captured' | 'screenshot-only' | 'no-figure' | 'outdated' | 'not-captured'

/** A saved view as the capture state reads it: which planned view it captured, under which key. */
export type SavedViewCapture = { id?: string; plannedViewId?: string; plannedKey?: string }

/**
 * The planned view's capture state. `hasFigure` says whether a saved view has its analysis sheet (the page's
 * `viewImages[id]?.figure`); without it every current capture reads `captured`, as before the sheet was checked.
 * `hasScreenshot` says whether a saved view's screenshot is held with the camera it was taken from (the page's
 * `viewImages[id]?.figureAt`), so its sheet can be drawn again alone; without it a capture lacking its sheet reads
 * `no-figure`.
 */
export function viewCaptureState(
  view: ViewOfInterest,
  savedViews: ReadonlyArray<SavedViewCapture>,
  hasFigure?: (savedViewId: string) => boolean,
  hasScreenshot?: (savedViewId: string) => boolean,
): ViewCaptureState {
  const current = currentCaptures(view, savedViews)
  if (!current) return 'not-captured'
  if (!current.length) return 'outdated'
  if (!hasFigure) return 'captured'
  if (current.some((saved) => saved.id !== undefined && hasFigure(saved.id))) return 'captured'
  return sheetOnlyCapture(view, savedViews, hasScreenshot) ? 'screenshot-only' : 'no-figure'
}

/** The view's saves under its current key, oldest first; null when it was never saved. */
function currentCaptures<S extends SavedViewCapture>(view: ViewOfInterest, savedViews: ReadonlyArray<S>): S[] | null {
  const mine = savedViews.filter((saved) => saved.plannedViewId === view.id)
  if (!mine.length) return null
  const key = viewCaptureKey(view)
  return mine.filter((saved) => saved.plannedKey === key)
}

/**
 * The saved view whose analysis sheet is drawn again for a `screenshot-only` view: its latest save under the current
 * key whose screenshot is held (`hasScreenshot`). Null when there is none, or no way to tell.
 */
export function sheetOnlyCapture<S extends SavedViewCapture>(
  view: ViewOfInterest,
  savedViews: ReadonlyArray<S>,
  hasScreenshot?: (savedViewId: string) => boolean,
): (S & { id: string }) | null {
  if (!hasScreenshot) return null
  const current = currentCaptures(view, savedViews) ?? []
  return (
    current.filter((saved): saved is S & { id: string } => saved.id !== undefined && hasScreenshot(saved.id)).at(-1) ??
    null
  )
}

/** What a capture key records, in `viewCaptureKey`'s order, as a reviewer names it. */
const CAPTURE_KEY_PARTS = [
  'place',
  'place',
  'block',
  'facing',
  'lens',
  'framing',
  'landform',
  'altitude',
  'pitch',
  'roll',
  'lens',
] as const
export type CaptureKeyPart = (typeof CAPTURE_KEY_PARTS)[number] | 'eye'

/** A key part's name: a tagged part (`['eye', …]`) by its tag, the rest by place. */
const keyPartName = (part: unknown, index: number): CaptureKeyPart | undefined =>
  Array.isArray(part) && part[0] === 'eye' ? 'eye' : CAPTURE_KEY_PARTS[index]

/** A key's parts by name. */
function namedKeyParts(parts: readonly unknown[]): Map<CaptureKeyPart, string[]> {
  const named = new Map<CaptureKeyPart, string[]>()
  parts.forEach((part, index) => {
    const name = keyPartName(part, index)
    if (name) named.set(name, [...(named.get(name) ?? []), JSON.stringify(part)])
  })
  return named
}

/**
 * What changed since an outdated view was captured: the parts of its latest capture's key that differ from its key
 * now, each named once, in key order ("lens", "landform"). Empty when it is captured as it stands, or when no
 * capture's key can be read.
 */
export function captureKeyChanges(view: ViewOfInterest, savedViews: ReadonlyArray<SavedViewCapture>): CaptureKeyPart[] {
  const key = viewCaptureKey(view)
  const mine = savedViews.filter((saved) => saved.plannedViewId === view.id && saved.plannedKey)
  if (!mine.length || mine.some((saved) => saved.plannedKey === key)) return []
  return keyChanges(mine[mine.length - 1].plannedKey!, key)
}

/** The parts of `now` that differ from `before`, two capture keys, each named once in key order; empty when unread. */
function keyChanges(beforeKey: string, key: string): CaptureKeyPart[] {
  let before: unknown
  try {
    before = JSON.parse(beforeKey)
  } catch {
    return []
  }
  const now = JSON.parse(key) as unknown[]
  if (!Array.isArray(before) || before.length > CAPTURE_KEY_PARTS.length + 1) return []
  // A photo's camera or a surveyed eye lengthens the key: a part one key lacks reads as changed (a photo linked or
  // unlinked, an eye surveyed or cleared).
  const was = namedKeyParts(before)
  const is = namedKeyParts(now)
  // In key order, each part named once, at the first place it changes.
  const changed: CaptureKeyPart[] = []
  for (let index = 0; index < Math.max(now.length, before.length); index += 1) {
    for (const part of [keyPartName(before[index], index), keyPartName(now[index], index)]) {
      if (!part || changed.includes(part)) continue
      const differs = JSON.stringify(was.get(part) ?? null) !== JSON.stringify(is.get(part) ?? null)
      const here = JSON.stringify(before[index]) !== JSON.stringify(now[index])
      if (differs && here) changed.push(part)
    }
  }
  return changed
}

/**
 * A planned view's earlier captures: its saves made under an earlier version of it (another `plannedKey`, or none),
 * newest first, each with what has changed since (`changes`, empty when its key cannot be read). They no longer count
 * as the view's capture (`viewCaptureState`), and no output draws them while they carry its id (`resolvePackage`):
 * they are listed read-only under the view, and only *Keep as its own saved view* (`keptAsOwnView`) changes one.
 */
export function earlierCaptures<S extends SavedViewCapture & { id: string }>(
  view: ViewOfInterest,
  savedViews: ReadonlyArray<S>,
): Array<{ saved: S; changes: CaptureKeyPart[] }> {
  const key = viewCaptureKey(view)
  return savedViews
    .filter((saved) => saved.plannedViewId === view.id && saved.plannedKey !== key)
    .map((saved) => ({ saved, changes: saved.plannedKey ? keyChanges(saved.plannedKey, key) : [] }))
    .reverse()
}

/** How many saves, across every planned view, are earlier captures (`earlierCaptures`): for a summary line. */
export function earlierCaptureCount(
  views: readonly ViewOfInterest[],
  savedViews: ReadonlyArray<SavedViewCapture & { id: string }>,
): number {
  return views.reduce((sum, view) => sum + earlierCaptures(view, savedViews).length, 0)
}

/** "Since then its place and lens changed." for an earlier capture; a key that cannot be read names nothing. */
export function earlierCaptureText(parts: readonly CaptureKeyPart[]): string {
  if (!parts.length) return 'Taken under an earlier version of this view.'
  const listed = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  return `Since then its ${listed} changed.`
}

/**
 * *Keep as its own saved view*: the saved view `id` without its `plannedViewId` and `plannedKey`, so it is an ordinary
 * saved view again (listed, and drawn by the outputs, as any other). Only that view changes, wherever it is (the open
 * place's list or a shelved one); every other entry and list keeps its identity. Null when no list holds a view with
 * that id carrying a planned view's id: nothing to keep.
 */
export function keptAsOwnView<V extends SavedViewCapture & { id: string }>(
  lists: ReadonlyArray<readonly V[]>,
  id: string,
): V[][] | null {
  let found = false
  const next = lists.map((list) => {
    const at = list.findIndex((view) => view.id === id && view.plannedViewId !== undefined)
    if (at < 0) return list as V[]
    found = true
    const kept = { ...list[at] }
    delete kept.plannedViewId
    delete kept.plannedKey
    return list.map((view, index) => (index === at ? kept : view))
  })
  return found ? next : null
}

/** "Changed since captured: lens and landform." */
export function captureChangeText(parts: readonly CaptureKeyPart[]): string {
  if (!parts.length) return 'Changed since captured.'
  const listed = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  return `Changed since captured: ${listed}.`
}

/** Whether a planned view needs (re)capturing: anything short of a current capture with its analysis sheet. */
export const needsCapture = (state: ViewCaptureState) => state !== 'captured'

/** Whether a planned view needs only its analysis sheet drawn again (`screenshot-only`), not a whole capture. */
export const needsSheetOnly = (state: ViewCaptureState) => state === 'screenshot-only'

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
    // A lens entered by its field or focal length sets the equivalent focal length it was saved with; one that does not
    // read is dropped and the stored focal length kept.
    const lens = parseViewLens(value.lens)
    const focalMm = lens
      ? equivalentFocalMm(lens)
      : finite(value.focalMm) && value.focalMm >= 10 && value.focalMm <= 300
        ? value.focalMm
        : DEFAULT_FOCAL_MM
    // A photo link that does not read is dropped and the view kept: it stands where the photo was, facing its way.
    const photo = parseViewPhoto(value.photo)
    const place = parseViewPlaceEntry(value.place)
    const eye = parseViewEye(value.eye)
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
      ...(typeof value.assessedWith === 'string' && value.assessedWith !== value.id
        ? { assessedWith: value.assessedWith }
        : {}),
      ...(photo ? { photo } : {}),
      ...(place ? { place } : {}),
      ...(lens ? { lens } : {}),
      ...(eye ? { eye } : {}),
    })
    if (views.length >= MAX_VIEWS_OF_INTEREST) break
  }
  return views
}

function parseViewPhoto(raw: unknown): ViewOfInterestPhoto | null {
  const p = raw as Record<string, unknown> | null | undefined
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null
  const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
  if (typeof p.recordId !== 'string' || !p.recordId || p.recordId.length > 200) return null
  if (!finite(p.pitch) || !finite(p.roll) || !finite(p.hfov)) return null
  if (Math.abs(p.pitch) > 90 || Math.abs(p.roll) > 180 || p.hfov < 3 || p.hfov > 150) return null
  // The range a surveyed eye and an accepted camera take.
  const altitude = p.altitudeMeters ?? null
  if (altitude !== null && (!finite(altitude) || altitude < -500 || altitude > 9000)) return null
  return { recordId: p.recordId, altitudeMeters: altitude, pitch: p.pitch, roll: p.roll, hfov: p.hfov }
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

/** How far the road view may be turned from a view's facing and a hand save still be that view's capture, degrees. */
export const HAND_SAVE_FACING_DEGREES = 2

/**
 * What *Save viewpoint* (a view saved by hand from the road view) joins, so every saved view is a view of interest:
 * `update` saves it as the capture of the planned view stood at, when the road view still faces that view's way, or
 * of a listed view it repeats; `add` lists a new view where the eye stands, facing the block the road view looks at
 * (or the bearing it looks along); `none` saves it alone, with the reason.
 */
export type HandSaveLink =
  | { kind: 'update'; view: ViewOfInterest }
  | { kind: 'add'; view: ViewOfInterest }
  | { kind: 'none'; reason: string }

export function handSaveLink(input: {
  views: readonly ViewOfInterest[]
  /** The planned view stood at (`currentPlannedView`), if any. */
  standingView: ViewOfInterest | null
  /** The road view's eye and the way it looks (the drive's exact pose). */
  pose: { lng: number; lat: number; bearing: number } | null
  blocks: ReadonlyArray<{ id: string; name: string; geometry: PolygonGeometry }>
  /** The block the road view looks at, if it looks at one. */
  lookAtTargetId: string | null
  /** The block to list the view for when the road view looks at none (the summary's). */
  fallbackBlockId: string | null
  /** The road view's lens, else `DEFAULT_FOCAL_MM`. */
  focalMm: number | null
  /** The view's name: its planning-note caption. */
  name: string
}): HandSaveLink {
  const { views, standingView, pose, blocks } = input
  if (!pose) return { kind: 'none', reason: 'The road view had no position to list it at.' }
  const centreOf = (blockId: string) => {
    const block = blocks.find((entry) => entry.id === blockId)
    return block ? blockCentre(block.geometry) : null
  }
  const turned = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)
  if (standingView) {
    const bearing = viewBearing(standingView, centreOf(standingView.blockId))
    if (bearing !== null && turned(bearing, pose.bearing) <= HAND_SAVE_FACING_DEGREES)
      return { kind: 'update', view: standingView }
  }
  const block =
    blocks.find((entry) => entry.id === input.lookAtTargetId) ??
    blocks.find((entry) => entry.id === input.fallbackBlockId) ??
    blocks[0]
  if (!block) return { kind: 'none', reason: 'A view of interest is for a cutblock: add one to list this view.' }
  const centre = blockCentre(block.geometry)
  const facesBlock =
    input.lookAtTargetId === block.id &&
    !!centre &&
    turned(bearingDegrees(pose, centre), pose.bearing) <= HAND_SAVE_FACING_DEGREES
  const taken = new Set(views.map((view) => view.name))
  let name = input.name
  for (let n = 2; taken.has(name); n += 1) name = `${input.name} (${n})`
  const view: ViewOfInterest = {
    id: createViewOfInterestId(),
    name,
    source: { kind: 'map' },
    lng: pose.lng,
    lat: pose.lat,
    blockId: block.id,
    facing: facesBlock
      ? { kind: 'block' }
      : { kind: 'bearing', degrees: normalizeBearing(Math.round(pose.bearing * 10) / 10) },
    focalMm: input.focalMm ?? DEFAULT_FOCAL_MM,
    framing: 'landform',
  }
  const repeated = views.find((other) => sameView(other, view))
  if (repeated) return { kind: 'update', view: repeated }
  if (views.length >= MAX_VIEWS_OF_INTEREST)
    return {
      kind: 'none',
      reason: `The views of interest hold ${MAX_VIEWS_OF_INTEREST}: remove one to list this view with them.`,
    }
  return { kind: 'add', view }
}

/**
 * The view of interest an accepted photo camera makes (doc proposal §2.7, *A photo viewpoint*): standing at the
 * camera, facing its heading, one frame of its lens, with the photo linked for its altitude, tilt, roll and lens. It
 * assesses the block nearest the middle of the frame. `update` when a view already holds this photo (the view keeps
 * its id, name, block, landform and grouping; its camera follows the acceptance), `add` for a new one, `none` with the
 * reason: no acceptance, a camera moved since it was accepted (`current`), no cutblock, or a full list. Only the frames
 * the reviewer chooses become views; the rest stay evidence.
 */
export function viewFromAcceptedPhoto(
  record: Pick<FieldRecord, 'id' | 'name' | 'acceptance'>,
  scene: {
    targets: ReadonlyArray<{ id: string; name: string; role: string; geometry: PolygonGeometry }>
    viewsOfInterest?: readonly ViewOfInterest[]
  },
  /** The photo's camera as it stands now, when the page has it open. */
  current?: AcceptancePose | null,
): HandSaveLink {
  const acceptance = record.acceptance
  if (!acceptance)
    return { kind: 'none', reason: 'Accept the photo’s camera first: only an accepted camera becomes a viewpoint.' }
  if (current && acceptanceLapsed(acceptance, current))
    return { kind: 'none', reason: 'The camera has moved since it was accepted: check it and accept it again.' }
  const views = scene.viewsOfInterest ?? []
  const { pose } = acceptance
  const turned = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)
  const blocks = scene.targets.flatMap((target) => {
    const centre = target.role === 'block' ? blockCentre(target.geometry) : null
    return centre ? [{ target, offset: turned(bearingDegrees(pose, centre), pose.bearing) }] : []
  })
  const existing = views.find((view) => view.photo?.recordId === record.id)
  const kept = existing && blocks.find((entry) => entry.target.id === existing.blockId)
  // The block nearest the middle of the frame; with none in frame, still the nearest the heading, for the reviewer to
  // re-point.
  const chosen = kept ?? [...blocks].sort((a, b) => a.offset - b.offset)[0]
  if (!chosen)
    return { kind: 'none', reason: 'A view of interest is for a cutblock: add one to list this photo’s view.' }
  const camera = {
    lng: pose.lng,
    lat: pose.lat,
    blockId: chosen.target.id,
    facing: { kind: 'bearing' as const, degrees: normalizeBearing(Math.round(pose.bearing * 10) / 10) },
    // The view's lens is the photo's field across: the photo link keeps the exact field for a frame that is not 3:2.
    focalMm: Math.min(300, Math.max(10, Math.round(focalForHfov(pose.hfov) * 10) / 10)),
    framing: 'single' as const,
    photo: {
      recordId: record.id,
      altitudeMeters: pose.altitudeMeters,
      pitch: pose.pitch,
      roll: pose.roll,
      hfov: pose.hfov,
    },
  }
  // The photo's camera replaces a lens or eye entered by hand: the view is the photo's now.
  if (existing) return { kind: 'update', view: { ...existing, ...camera, lens: undefined, eye: undefined } }
  if (views.length >= MAX_VIEWS_OF_INTEREST)
    return {
      kind: 'none',
      reason: `The views of interest hold ${MAX_VIEWS_OF_INTEREST}: remove one to list this photo’s view. The photo stays evidence.`,
    }
  const base = `Photo ${record.name.replace(/\.[^.]+$/, '') || 'view'}, toward ${chosen.target.name}`
  const taken = new Set(views.map((view) => view.name))
  let name = base
  for (let n = 2; taken.has(name); n += 1) name = `${base} (${n})`
  return { kind: 'add', view: { id: createViewOfInterestId(), name, source: { kind: 'map' }, ...camera } }
}

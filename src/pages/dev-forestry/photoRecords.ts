/**
 * Own photos as field records (doc proposal `forestry-visual-quality-own-photo-redesign-2026-11-17.md`, §2.1 and
 * §2.7). Every photo opened becomes a `FieldRecord` of kind `photo` at once, so it outlives a reload in the assessment
 * tools' storage and the project file. The record's image is a re-encoded JPEG for showing; the photo's original bytes
 * stay the project attachment, linked to the record by its id. One record holds the photo and its acceptance, and
 * every job it does is a link to it (`uses`, a view's `photo.recordId`), never a copy.
 *
 * Also here: what the project file keeps of the open photo beyond its pose (where each value came from, the last
 * skyline search), and the sources a reopened photo shows.
 *
 * Free of DOM and network access: the re-encoded image and the original bytes are passed in.
 */
import { MAX_FIELD_RECORDS, PHOTO_JOBS, type FieldRecord, type PhotoJob } from './assessmentTools'
import type { ExifReading, OwnPose, OwnPoseSources, PoseSource } from './exifPose'
import type { AcceptancePose } from './photoAcceptance'
import { groupFlights } from './photoFlight'
import type { WideSearchResult } from './wideOrientation'

export const PHOTO_JOB_LABELS: Record<PhotoJob, string> = {
  viewpoint: 'Viewpoint',
  before: 'Before image',
  ground: 'Ground conditions',
  'drawn-check': 'Check against the drawn forest',
  regrowth: 'Regrowth over time',
  landform: 'Landform evidence',
}

/**
 * When the photo was taken, as the record keeps it: the GPS fix's time (UTC), else the camera clock's (no zone: the
 * clock carries none and may be wrong). Null when the photo records neither.
 */
export function photoTakenAt(exif: Pick<ExifReading, 'takenAt' | 'gpsTimeUtc'> | null): string | null {
  if (exif?.gpsTimeUtc && Number.isFinite(Date.parse(exif.gpsTimeUtc))) return exif.gpsTimeUtc
  const clock = exif?.takenAt?.trim()
  if (!clock) return null
  const iso = clock.replace(' ', 'T')
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(iso) && Number.isFinite(Date.parse(iso)) ? iso : null
}

/** Where a pose value came from that a record can vouch for: a place or reading someone took, not a stand-in. */
const RECORDED_POSITION = new Set<PoseSource>(['exif', 'record', 'reviewer', 'matched', 'controls'])
const RECORDED_ANGLE = new Set<PoseSource>(['record', 'reviewer', 'skyline', 'matched', 'controls'])

export type OwnPhotoRecordInput = {
  /** The record's id (`createId('field')`). */
  id: string
  /** The file's name as picked. */
  name: string
  /** The photo re-encoded for showing (`fieldImageFromBlob`, `toolImports.ts`). */
  image: { dataUrl: string; width: number; height: number }
  exif: ExifReading | null
  pose: OwnPose
  sources: OwnPoseSources
  /** Whether the reading's heading was recorded against true north (`OwnPhoto.headingReference`). */
  headingTrue?: boolean
  focalMm?: number | null
  focal35Mm?: number | null
  viewId?: string | null
  /** When it was taken (`takenAtUtc(tags).iso`, `photoFlight.ts`), which reads seconds and a zoned clock; else the EXIF reading's. */
  takenAtUtc?: string | null
}

/**
 * The field record of an opened own photo. It keeps only camera values a record can vouch for: a heading the phone
 * recorded against magnetic or unstated north, a stand-in from the road view and a default lens are left blank,
 * because a record's values reopen as "from the field record" and would read as a reviewer's. The phone's own heading
 * stays in the original's EXIF, read again when the photo is opened from it.
 */
export function photoRecordFromOwn(input: OwnPhotoRecordInput): FieldRecord {
  const { pose, sources, exif } = input
  const placed = pose.lng !== null && pose.lat !== null && !!sources.position && RECORDED_POSITION.has(sources.position)
  const headingKept = RECORDED_ANGLE.has(sources.heading) || (sources.heading === 'exif' && input.headingTrue === true)
  const fovKept = sources.fov !== 'default' && sources.fov !== 'road-view'
  // A tilt sensor's pitch is a start, like the phone's heading: level until something fixes it.
  const angle = (source: PoseSource, value: number) => (RECORDED_ANGLE.has(source) ? Math.round(value * 100) / 100 : 0)
  const takenAtUtc = input.takenAtUtc !== undefined ? input.takenAtUtc : photoTakenAt(exif)
  return {
    id: input.id,
    name: input.name.slice(0, 200),
    viewId: input.viewId ?? null,
    kind: 'photo',
    image: input.image.dataUrl,
    width: input.image.width,
    height: input.image.height,
    // The date the record has always shown; the time is in `takenAtUtc`.
    captured: takenAtUtc ? takenAtUtc.slice(0, 10) : '',
    notes: '',
    lng: placed ? pose.lng : null,
    lat: placed ? pose.lat : null,
    altitude: pose.altitudeMeters ?? exif?.altitudeMeters ?? null,
    verticalReference: '',
    bearing: headingKept ? Math.round(pose.bearing * 10) / 10 : null,
    pitch: angle(sources.pitch, pose.pitch),
    roll: angle(sources.roll, pose.roll),
    hfov: fovKept ? Math.round(pose.hfov * 10) / 10 : null,
    focalMm: input.focalMm ?? null,
    focal35Mm: input.focal35Mm ?? null,
    originalName: input.name,
    alignmentChecked: false,
    annotations: [],
    takenAtUtc,
  }
}

/** The camera a record holds, in an acceptance's terms; null without a place, heading and lens. */
export function recordCameraPose(record: FieldRecord): AcceptancePose | null {
  if (record.lng === null || record.lat === null || record.bearing === null || record.hfov === null) return null
  return {
    lng: record.lng,
    lat: record.lat,
    altitudeMeters: record.altitude,
    bearing: record.bearing,
    pitch: record.pitch,
    roll: record.roll,
    hfov: record.hfov,
  }
}

/** The original's attachment, kept with the record it belongs to (`ProjectAttachment.recordId`). */
export function photoAttachment(
  record: Pick<FieldRecord, 'id' | 'originalName' | 'name'>,
  original: Blob,
): { name: string; blob: Blob; recordId: string } {
  return { name: record.originalName || record.name, blob: original, recordId: record.id }
}

/**
 * The records with their photos grouped into flights (`groupFlights`, `photoFlight.ts`: by time, a gap over five
 * minutes starting another, a flight keeping the id most of its photos carry), each numbered from 0 in time order.
 * Photos with no time are in no flight. The list keeps its order, and a record that does not change is the same object.
 */
export function withFlights(fields: readonly FieldRecord[]): FieldRecord[] {
  const photos = fields.flatMap((record) =>
    record.kind === 'photo'
      ? [{ id: record.id, name: record.name, takenAtUtc: record.takenAtUtc ?? null, flightId: record.flightId ?? null }]
      : [],
  )
  const placed = new Map<string, { flightId: string; frameIndex: number }>()
  for (const flight of groupFlights(photos))
    if (flight.timed)
      flight.photos.forEach((photo, frameIndex) => placed.set(photo.id, { flightId: flight.id, frameIndex }))
  return fields.map((record) => {
    if (record.kind !== 'photo') return record
    const place = placed.get(record.id)
    const flightId = place?.flightId ?? null
    const frameIndex = place?.frameIndex ?? null
    if ((record.flightId ?? null) === flightId && (record.frameIndex ?? null) === frameIndex) return record
    return { ...record, flightId, frameIndex }
  })
}

/** A flight's photos in time order. */
export function flightPhotos(fields: readonly FieldRecord[], flightId: string): FieldRecord[] {
  return fields
    .filter((record) => record.kind === 'photo' && record.flightId === flightId)
    .sort((a, b) => (a.frameIndex ?? 0) - (b.frameIndex ?? 0))
}

const sameUse = (use: { job: PhotoJob; targetId?: string | null }, job: PhotoJob, targetId: string | null) =>
  use.job === job && (use.targetId ?? null) === targetId

/** Whether the photo does `job` (for `targetId`, when given; any target when not). */
export function hasPhotoJob(record: FieldRecord, job: PhotoJob, targetId?: string | null): boolean {
  return (record.uses ?? []).some((use) =>
    targetId === undefined ? use.job === job : sameUse(use, job, targetId ?? null),
  )
}

/** The record linked to one more job; the same record when it already does that job for that target. */
export function linkPhotoJob(record: FieldRecord, job: PhotoJob, targetId: string | null = null): FieldRecord {
  if (!PHOTO_JOBS.includes(job)) throw new Error(`A photo cannot be used for ${String(job)}.`)
  if ((record.uses ?? []).some((use) => sameUse(use, job, targetId))) return record
  return { ...record, uses: [...(record.uses ?? []), { job, ...(targetId !== null ? { targetId } : {}) }] }
}

/** The record no longer doing `job` for `targetId` (every target when `targetId` is undefined). */
export function unlinkPhotoJob(record: FieldRecord, job: PhotoJob, targetId?: string | null): FieldRecord {
  const uses = (record.uses ?? []).filter((use) =>
    targetId === undefined ? use.job !== job : !sameUse(use, job, targetId ?? null),
  )
  return uses.length === (record.uses ?? []).length ? record : { ...record, uses }
}

/**
 * Why `adding` more records do not fit beside `count` already held, or null when they do. A flight is often more
 * photos than the workspace has room for, so the message says how many fit.
 */
export function fieldRecordRoom(count: number, adding: number): string | null {
  if (count + adding <= MAX_FIELD_RECORDS) return null
  const room = Math.max(0, MAX_FIELD_RECORDS - count)
  if (!room) return `The workspace holds at most ${MAX_FIELD_RECORDS} attachments and is full: remove one to add more.`
  if (adding === 1) return `The workspace holds at most ${MAX_FIELD_RECORDS} attachments.`
  return `The workspace holds at most ${MAX_FIELD_RECORDS} attachments and has ${count}: ${room} of these ${adding} fit. Remove some, or choose fewer.`
}

/** Every pose source, so a stored one can be checked; the record type keeps the list complete. */
const POSE_SOURCES: Record<PoseSource, true> = {
  exif: true,
  record: true,
  'road-view': true,
  level: true,
  default: true,
  reviewer: true,
  skyline: true,
  matched: true,
  landmark: true,
  controls: true,
}
const isSource = (value: unknown): value is PoseSource =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(POSE_SOURCES, value)

/** A stored record of where each pose value came from; null when any value does not read. */
export function parseOwnPoseSources(raw: unknown): OwnPoseSources | null {
  const s = raw as Record<string, unknown> | null
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null
  const keys = ['heading', 'pitch', 'roll', 'fov', 'eyeHeight'] as const
  if (!keys.every((key) => isSource(s[key]))) return null
  if (s.position !== null && !isSource(s.position)) return null
  return {
    position: s.position as PoseSource | null,
    heading: s.heading as PoseSource,
    pitch: s.pitch as PoseSource,
    roll: s.roll as PoseSource,
    fov: s.fov as PoseSource,
    eyeHeight: s.eyeHeight as PoseSource,
  }
}

const near = (a: number | null | undefined, b: number | null | undefined, tolerance: number) =>
  (a ?? null) === null || (b ?? null) === null ? (a ?? null) === (b ?? null) : Math.abs(a! - b!) <= tolerance

/**
 * Where each value of a photo reopened from a project file came from. A file that kept the sources gives them back
 * (with no position source when it has no position). An older file kept only the pose: a value still equal to the
 * one the photo's EXIF starts from is the EXIF's, as before; one that moved is the field record's when the photo
 * came from one, else the reviewer's: someone changed it, and "from the field record" with no record would be false.
 */
export function ownSourcesOnReopen(
  saved: { pose: OwnPose; recordId: string | null; sources?: OwnPoseSources | null },
  start: { pose: OwnPose; sources: OwnPoseSources },
): OwnPoseSources {
  const placed = saved.pose.lng !== null && saved.pose.lat !== null
  const kept = saved.sources ? parseOwnPoseSources(saved.sources) : null
  if (kept) return { ...kept, position: placed ? kept.position : null }
  const moved: PoseSource = saved.recordId ? 'record' : 'reviewer'
  const { pose } = saved
  const from = start.pose
  return {
    position: !placed
      ? null
      : near(pose.lng, from.lng, 1e-7) && near(pose.lat, from.lat, 1e-7)
        ? start.sources.position
        : moved,
    heading: near(pose.bearing, from.bearing, 1e-6) ? start.sources.heading : moved,
    pitch: near(pose.pitch, from.pitch, 1e-6) ? start.sources.pitch : moved,
    roll: near(pose.roll, from.roll, 1e-6) ? start.sources.roll : moved,
    fov: near(pose.hfov, from.hfov, 1e-6) ? start.sources.fov : moved,
    eyeHeight:
      near(pose.eyeHeightMeters, from.eyeHeightMeters, 1e-6) && near(pose.altitudeMeters, from.altitudeMeters, 1e-6)
        ? start.sources.eyeHeight
        : moved,
  }
}

/** The skyline search as the project file keeps it: the winner, the runner-up, the columns and the scores. */
export type OwnSearchSummary = {
  bearing: number
  pitch: number
  roll: number
  /** Columns of the photo's skyline the search read, and how many of the judged ones agree. */
  columns: number
  agreeing: number
  /** Share of the judged columns that agree, 0–1. */
  agreement: number
  /** Share of the frame's width the agreeing columns span, 0–1. */
  span: number
  medianErrorPx: number
  /** Angular loss per column, degrees. */
  meanLoss: number
  trustworthy: boolean
  ambiguous: boolean
  runnerUp: WideSearchResult['runnerUp']
  hfov?: number
  /** The model view's score for the winner and the runner-up, when one was drawn for that heading. */
  modelScore: number | null
  runnerUpModelScore: number | null
}

const MODEL_VIEW_DEGREES = 0.5
const headingGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)

/**
 * The summary of a search, with the scores of the model views drawn for its two headings. A model view is matched to
 * a heading by its bearing, since the page keys them by "the camera" and "the runner-up", which swap.
 */
export function searchSummaryFrom(
  result: WideSearchResult,
  modelViews: ReadonlyArray<{ bearing: number; score: number } | undefined> = [],
): OwnSearchSummary {
  const scoreAt = (bearing: number) =>
    modelViews.find((view) => view && headingGap(view.bearing, bearing) <= MODEL_VIEW_DEGREES)?.score ?? null
  return {
    bearing: result.bearing,
    pitch: result.pitch,
    roll: result.roll,
    columns: result.columns,
    agreeing: result.fit.agreeing,
    agreement: result.fit.agreement,
    span: result.fit.span,
    medianErrorPx: result.fit.medianErrorPx,
    meanLoss: result.meanLoss,
    trustworthy: result.trustworthy,
    ambiguous: result.ambiguous,
    runnerUp: result.runnerUp ? { ...result.runnerUp } : null,
    ...(result.hfov === undefined ? {} : { hfov: result.hfov }),
    modelScore: scoreAt(result.bearing),
    runnerUpModelScore: result.runnerUp ? scoreAt(result.runnerUp.bearing) : null,
  }
}

/** A stored search summary; null when it does not read. A score that does not read is left blank. */
export function parseOwnSearchSummary(raw: unknown): OwnSearchSummary | null {
  const s = raw as Record<string, unknown> | null
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null
  const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
  const numbers = ['bearing', 'pitch', 'roll', 'columns', 'agreeing', 'agreement', 'span', 'medianErrorPx', 'meanLoss']
  if (!numbers.every((key) => finite(s[key]))) return null
  if (typeof s.trustworthy !== 'boolean' || typeof s.ambiguous !== 'boolean') return null
  const r = s.runnerUp as Record<string, unknown> | null | undefined
  let runnerUp: OwnSearchSummary['runnerUp'] = null
  if (r != null) {
    if (typeof r !== 'object' || ![r.bearing, r.pitch, r.roll, r.meanLoss].every(finite)) return null
    runnerUp = {
      bearing: r.bearing as number,
      pitch: r.pitch as number,
      roll: r.roll as number,
      meanLoss: r.meanLoss as number,
      ...(finite(r.hfov) ? { hfov: r.hfov } : {}),
    }
  }
  const score = (value: unknown) => (finite(value) ? value : null)
  return {
    bearing: s.bearing as number,
    pitch: s.pitch as number,
    roll: s.roll as number,
    columns: s.columns as number,
    agreeing: s.agreeing as number,
    agreement: s.agreement as number,
    span: s.span as number,
    medianErrorPx: s.medianErrorPx as number,
    meanLoss: s.meanLoss as number,
    trustworthy: s.trustworthy,
    ambiguous: s.ambiguous,
    runnerUp,
    ...(finite(s.hfov) ? { hfov: s.hfov } : {}),
    modelScore: score(s.modelScore),
    runnerUpModelScore: score(s.runnerUpModelScore),
  }
}

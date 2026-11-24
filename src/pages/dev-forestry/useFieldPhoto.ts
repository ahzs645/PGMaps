import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type SetStateAction } from 'react'

import type { FieldRecord, PhotoJob } from './assessmentTools'
import { HeicDecodeError } from '@/lib/heic/heicDecode'
import { heicDecodeConcurrency, showablePhoto } from '@/lib/heic/heicDecodeClient'
import { loadElevationGrid } from '@/lib/forestry/terrain/demLoader'
import { MAX_WALK_METERS, nearestStation } from './driveMath'
import {
  clampFov,
  eyeHeightOver,
  normalizeHeading,
  ownPhotoPose,
  readExif,
  startingPose,
  trueHeadingFromMagnetic,
  verticalFovFromHorizontal,
  type ExifReading,
  type HeadingReference,
  type OwnPose,
  type OwnPoseSources,
  type PoseSource,
  type RoadViewPose,
} from './exifPose'
import type { MatchedCamera } from './matchedCamera'
import { comparePhotoCameras, type CombinedResult, type CombinedSettings } from './photoCombinedSearch'
import { depthModelStored, estimatePhotoDepth, type DepthGrid, type PhotoDepthModel } from './photoDepth'
import {
  hasLocationRelief,
  photoLocationTrials,
  rankPhotoLocations,
  searchByOneReader,
  type PhotoLocation,
  type PhotoLocationCandidate,
  type PhotoLocationSearch,
} from './photoLocationSearch'
import type { PhotoMatcher } from './photoMatchers'
import { openPhotoFeatureMatcher } from './photoFeatureClient'
import {
  compareFlightProposals,
  currentFlightProposal,
  flightAnchor,
  planFlightMatches,
  type FlightCameraProposal,
  type FlightMatchFrame,
  type FlightMatchProgress,
} from './photoFlightMatching'
import type { OwnPhotoPlace } from './ownPhotoTabs'
import {
  fetchMapillaryImage,
  mapillaryToken,
  parseMapillaryInput,
  photoFieldOfView,
  photoPoseFor,
  rankPhotosToward,
  searchMapillaryImages,
  type MapillaryImage,
  type RankedPhoto,
  type RoadPhoto,
} from './mapillary'
import { panoViewPose, projectToPhoto, reprojectEquirect, terrainSkyline, type PhotoPose } from './photoPose'
import {
  SKYLINE_READERS,
  fitSkyline,
  photoSkyline,
  believableSkyline,
  readPhotoSkyline,
  skylineReaderKey,
  terrainProfile,
  type ProfilePoint,
  type SkylineFit,
  type SkylineReader,
} from './skylineFit'
import { wrapSigned } from './skylineAlign'
import {
  frameHalfDiagonal,
  horizonSlice,
  MIN_SKYLINE_COLUMNS,
  READER_SETTLED_AGREEMENT,
  searchRank,
  sunCheck,
  type SunCheck,
  type WideSearchInput,
  type WideSearchResult,
} from './wideOrientation'
import {
  landmarkAngles,
  orientFromLandmark,
  pairsNeeded,
  solveFromControls,
  type ControlPair,
  type ControlSolveResult,
  type UnknownSpec,
} from './controlPose'
import type { Bounds, Drape } from './photoViews'
import { loadImageryMosaic } from './imageryMosaic'
import { runWideOrientation } from './wideOrientationClient'
import { nearestPointOnLine } from './roadSnap'
import { createId, type ForestryScene } from './scene'
import type { ElevationSource } from '@/lib/forestry/terrain/terrain'
import type { AnalysisResult } from './types'
import { bearingDegrees, polygonBounds } from './visibility'
import { visibleProposalCentre } from './vqe'
import { PhotoCache } from './photoCache'
import { photoPoseKey, type HitBuffer } from './photoHitBuffer'
import { photoTerrainSpec, terrainSpecKey, type ImageryLayer, type PhotoTerrainSpec } from './photoWork'
import {
  castPhotoHits,
  drapePhotoOffThread,
  photoHorizon,
  renderPhotoModelView,
  transferPhotoCamera,
} from './photoWorkClient'
import { photoSeenBounds, readPhotoFeatures, type Box, type PhotoFeatureReads } from './photoFeatures'
import {
  acceptanceLapsed,
  makePhotoAcceptance,
  sameCamera,
  wrapHeading,
  type AcceptanceEvidence,
  type AcceptancePose,
  type PhotoAcceptance,
} from './photoAcceptance'
import { acceptanceSource } from './photoAcceptPreview'
import {
  burstNeighbour,
  cameraClockTime,
  instantOf,
  lensCheck,
  neighbourPriors,
  takenAtUtc,
  type LensCheck,
  type TakenAt,
} from './photoFlight'
import {
  narrowAgreement,
  photoOptions,
  type PhotoOption,
  type PhotoOptionKind,
  type PhotoOptionsInput,
  type PhotoQueueEntry,
  type PhotoQueueState,
} from './photoOptions'
import {
  fieldRecordRoom,
  ownSourcesOnReopen,
  photoRecordFromOwn,
  recordOfPickedPhoto,
  unfiledPhotoCount,
  type OwnSearchSummary,
} from './photoRecords'
import {
  airborneAltitude,
  checkedPoseFor,
  controlSolveSuspect,
  featuresKey,
  featuresNext,
  inLanes,
  horizonKey,
  IMAGERY_RINGS,
  imageryBox,
  imageryKey,
  imageryRingKeys,
  lensRangeFor,
  nextInQueue,
  photoFlights,
  photoQueueStatus,
  pitchRangeFor,
  PHOTO_TERRAIN_RINGS,
  queueMaySetPose,
  queueOrder,
  queueReasons,
  searchKey,
  SKYLINE_RADIUS_METERS,
  SKYLINE_ZOOM,
  sourcesForOption,
  WIDE_RADIUS_METERS,
  withCheckedPose,
  withPhotoUse,
  type PhotoFound,
} from './photoQueue'
import { highGroundNearFix, highGroundNote } from './highGround'
import { fieldImageFromBlob } from './toolImports'
import { loadPhotoDepth, savePhotoDepth } from './toolsStorage'
import { viewFromAcceptedPhoto, type ViewOfInterest } from './viewsOfInterest'
import { demTileRange } from '@/lib/forestry/terrain/terrain'
import { inventoryFetch } from '@/lib/offline/inventoryCopies'

/** The lens a view cut from a 360° photo is given: about a phone's, in portrait terms. */
const PANO_VIEW_FOV = 60
/** Height of that cut view, in pixels; its width follows the map's shape. */
const PANO_VIEW_HEIGHT = 720
/** The largest own photo read; the same limit as a field record's import. */
const OWN_PHOTO_MAX_BYTES = 25_000_000
/** The photo's width while its skyline is read, as the photo-matching bench reads it. */
const WIDE_WORK_WIDTH = 1050
/** The model view's width, pixels: enough to judge ground texture against the photo, quick in the worker. */
const MODEL_VIEW_WIDTH = 320
/** A drape follows a moving camera at about 60k cells, then draws in full once the camera has settled. */
const DRAPE_QUICK_CELLS = 60_000
const DRAPE_FULL_CELLS = 250_000
const DRAPE_DEBOUNCE_MS = 200
const DRAPE_SETTLE_MS = 700
/** The hit buffer follows the active camera this long after it stops moving. */
const HIT_DEBOUNCE_MS = 250

/**
 * The reviewer's own photo, lined up like a Mapillary one. It is read in the browser and never leaves it: a picked
 * file is an object URL, a field record its stored copy. Every pose value is a suggestion the reviewer can change.
 * Several can be open at once (a flight), each keyed by its field record's id; one is active.
 */
export type OwnPhoto = {
  /** The field record's id: the key of everything kept for this photo. */
  id: string
  name: string
  src: string
  /** The same picture small, for a strip of photos; `src` where none was made. */
  thumb?: string
  /** The camera's own clock when it was taken ("09:04:29"), for display; absent when the file gave none. */
  clock?: string | null
  /** Whether `src` is an object URL this hook made and must revoke. */
  objectUrl: boolean
  /** Original bytes for a local photo, shared with its project attachment. */
  original?: Blob
  /** `heic` when `src` is a JPEG decoded here from the picked HEIC file (`showablePhoto`). */
  decodedFrom?: 'heic' | null
  /** False when a decoded photo's colours could not be brought to sRGB; its geometry is unaffected. */
  srgb?: boolean
  width: number
  height: number
  /** The field record it is, so a confirmed pose can be saved back; null when the workspace had no room for it. */
  recordId: string | null
  exif: ExifReading | null
  pose: OwnPose
  sources: OwnPoseSources
  /** The pose it was opened with, for Reset. */
  start: { pose: OwnPose; sources: OwnPoseSources }
  /** The heading's reference when it came from EXIF; anything but `true` needs a declination. */
  headingReference: HeadingReference | null
  /** Degrees east added to a magnetic EXIF heading, when the reviewer gives one. */
  declinationEast: number | null
  /** The camera matched by the photo-matching bench, when one was applied: how it was found and what to check. */
  matched?: {
    fileName: string
    method: string
    trusted: boolean | null
    heldOut: MatchedCamera['heldOut']
    checks: string[]
    /** The camera itself, for the options card. */
    camera?: MatchedCamera
  } | null
  /** When it was taken (`takenAtUtc`, `photoFlight.ts`): ISO, the zoned clock first. Null without a time. */
  takenAtUtc: string | null
  /** How that time was read; null for a photo opened from a record, whose tags are not read again. */
  takenAt: TakenAt | null
  /** The lens it was taken through, and whether it was cropped since (`lensCheck`); null without its tags. */
  lens: LensCheck | null
  /** Its flight and its place in it (`groupFlights`); null with no time. */
  flightId: string | null
  frameIndex: number | null
  /** The reviewer's acceptance of its camera, as written to its record. */
  acceptance: PhotoAcceptance | null
  /** The jobs it does, as linked on its record. */
  uses: NonNullable<FieldRecord['uses']>
  /** The options row last used (`useOption`), so an acceptance says how the camera was found. */
  chosen: { rowId: string; kind: PhotoOptionKind; pose: AcceptancePose; evidence: AcceptanceEvidence } | null
  /** The skyline search the project file kept for it, when it was reopened from one. */
  savedSearch?: OwnSearchSummary | null
  /**
   * The GPS altitude its field record kept, for a photo opened from the record (whose tags are not read again): the
   * queue stands an aircraft photo's eye there as it would from the EXIF (`airborneAltitude`).
   */
  recordAltitudeMeters?: number | null
}

/** Whether the road view can stand where the own photo was taken, and why not. */
export type OwnStand =
  | { status: 'no-position' }
  | { status: 'too-far'; offRoadMeters: number }
  | { status: 'no-terrain'; offRoadMeters: number }
  | { status: 'ok'; offRoadMeters: number; alongMeters: number }

/** Each angle held near a value within a tolerance, degrees; absent is free. */
export type CameraPriors = NonNullable<WideSearchInput['priors']>

/** The photo laid on the plan for one camera (`photoViews.drapePhoto`), as an image the plan map draws. */
export type PhotoDrape = {
  url: string
  bounds: Bounds
  which: 'camera' | 'runner-up'
  bearing: number
  seenShare: number
}

/**
 * A drape kept with its cells, for `PhotoDrapeLayer`: the camera it was drawn for (`pose`, `poseKey`), and whether it
 * is the full drawing or the quick one made while the camera moves.
 */
export type OwnPhotoDrape = Drape & {
  which: 'camera' | 'runner-up'
  bearing: number
  pose: AcceptancePose
  poseKey: string
  full: boolean
}

export type PhotoModelViewKind = 'camera' | 'winner' | 'runner-up'

/** The model image, its ground imagery coverage and the camera that drew it. */
export type ModelViewImage = {
  url: string
  bearing: number
  score: number
  coverage: number
  pose: AcceptancePose
  poseKey: string
}

/** A narrow search's fit round a burst neighbour's camera, with its agreement with that camera. */
export type NarrowFit = {
  bearing: number
  pitch: number
  roll: number
  hfov?: number
  agreesDegrees: number
  agreeShare: number
  skyColumns: number
  skySpanShare: number
}

export type CameraSearch =
  | { status: 'idle' }
  | {
      status: 'working'
      stage: 'terrain' | 'photo' | 'search'
      done: number
      tiles?: { loaded: number; total: number }
    }
  | {
      status: 'done'
      result: WideSearchResult
      /** Where the sun was for the found camera and for the runner-up: evidence between the two headings. */
      sun: { best: SunCheck; runnerUp: SunCheck | null } | null
      /** The recorded heading's error against the found one, degrees; null without a recorded heading. */
      recordedOffBy: number | null
      seconds: number
      /** An accepted burst neighbour used as a separate hint before the full search. */
      neighbour?: {
        id: string
        name: string
        gapSeconds: number
        /** A narrow fit that agrees with the neighbour's camera (`narrowAgreement`). */
        narrow?: NarrowFit | null
      } | null
    }
  | { status: 'failed'; message: string }

/** What the features check read for what a camera sees (`readPhotoFeatures`). */
export type OwnPhotoFeatures =
  | { status: 'loading'; poseKey: string }
  | { status: 'ready'; poseKey: string; bounds: Box | null; reads: PhotoFeatureReads | null }
  | { status: 'failed'; poseKey: string; message: string }

type Landmark = {
  lng: number
  lat: number
  elevation: number
  bearing: number
  pitch: number
  distanceMeters: number
}

/** Everything worked out for one photo, kept by its id so a photo keeps its tools while another is active. */
export type OwnPhotoWork = {
  search: CameraSearch
  modelViews: Partial<Record<PhotoModelViewKind, ModelViewImage>>
  /**
   * Model views drawn ahead for the options card's other cameras (the phone's heading, a neighbour's camera, a point
   * solve…), by the camera's key, so a row shows its view and *Use* has it at once. Nobody asked for them, so they
   * are no check (`checked`); they are dropped when their option goes.
   */
  optionViews?: Record<string, ModelViewImage>
  previewModel?: ModelViewImage
  /** Every camera check images (model views, a full drape) were drawn for, the newest last. */
  checked: AcceptancePose[]
  features: OwnPhotoFeatures | null
  /** What the queue learned on the way: the lens, terrain and skyline, and why it stopped. */
  found: PhotoFound | null
  priors: CameraPriors
  landmark: Landmark | null
  pairs: ControlPair[]
  /** Terrain under the camera when a pair was placed, for the one-landmark starting camera. */
  pairGround?: { lng: number; lat: number; elevation: number }
  /** Paired points the reviewer left out of the solve: still drawn, as check points. Absent: all are in. */
  pairsOff?: string[]
  controlSolve: ControlSolveResult | null
  flightProposals?: FlightCameraProposal[]
  /**
   * The camera comparison the queue ran for a photo its skyline did not settle (`comparePhotoCameras`): ground
   * appearance, and depth when this browser already holds the model. Absent until it has run; null when it could not.
   */
  combined?: { result: CombinedResult; depth: boolean } | null
}

/** Every model view kept for a photo: the queue's, the reviewer's and those drawn ahead for its options. */
export const photoModelViews = (work: Pick<OwnPhotoWork, 'modelViews' | 'optionViews'>): ModelViewImage[] => [
  ...Object.values(work.modelViews),
  ...Object.values(work.optionViews ?? {}),
]

/** Names an option's camera for the views drawn ahead: two rows with one camera share a view. */
const optionViewKey = (pose: AcceptancePose) =>
  [
    pose.lng.toFixed(6),
    pose.lat.toFixed(6),
    pose.altitudeMeters === null ? 'ground' : pose.altitudeMeters.toFixed(1),
    pose.bearing.toFixed(2),
    pose.pitch.toFixed(2),
    pose.roll.toFixed(2),
    pose.hfov.toFixed(2),
  ].join('|')

const NO_CAMERAS: ReadonlyArray<{ key: string; pose: PhotoPose; terrain: PhotoTerrainSpec }> = []

const EMPTY_WORK: OwnPhotoWork = Object.freeze({
  search: { status: 'idle' },
  modelViews: {},
  checked: [],
  features: null,
  found: null,
  priors: {},
  landmark: null,
  pairs: [],
  controlSolve: null,
}) as OwnPhotoWork

/**
 * A record's starting camera with its eye where it was accepted. An accepted camera of an aircraft photo is up in the
 * air; reopened on the ground it would read its own acceptance as lapsed.
 */
function fromAcceptedAltitude(
  start: ReturnType<typeof startingPose>,
  record: Pick<FieldRecord, 'acceptance'>,
): ReturnType<typeof startingPose> {
  const altitude = record.acceptance?.pose.altitudeMeters ?? null
  if (altitude === null) return start
  return {
    ...start,
    pose: { ...start.pose, altitudeMeters: altitude },
    sources: { ...start.sources, eyeHeight: 'record' },
  }
}

/**
 * The assessment tools' field records, as the photo set needs them. The page makes the tools after this hook, so it
 * passes a ref it fills once they exist (`useAssessmentTools`' `addPhotoRecords`, `updateFieldRecord`, `setPhotoJob`).
 */
export type OwnPhotoRecordsBridge = {
  /** Field records held now, so a set too large is refused before any photo is read. */
  fieldCount?: () => number
  /** Adds the records, or returns why they do not fit (adding none). */
  addPhotoRecords: (records: FieldRecord[]) => string | null
  updateFieldRecord: (id: string, patch: Partial<FieldRecord>) => void
  setPhotoJob: (recordId: string, job: PhotoJob, on: boolean, targetId?: string | null) => void
  /** Drops a record. */
  removeFieldRecord?: (id: string) => void
  /**
   * The record held now under an id: a photo reopened from a project takes its acceptance and jobs from it, since
   * they live on the record, not in the photo's own entry in the file.
   */
  getRecord?: (id: string) => FieldRecord | null
  /** Every photo record held now: a photo chosen again is opened as the record it already is. */
  photoRecords?: () => readonly FieldRecord[]
}

/** A photo as a project file kept it: its original, pose, record, sources and search. */
export type SavedOwnPhoto = {
  pose: OwnPose
  recordId: string | null
  blob: Blob
  sources?: OwnPoseSources | null
  search?: OwnSearchSummary | null
  /** What its field record holds, when the caller read it; the record held now wins (`getRecord`). */
  acceptance?: PhotoAcceptance | null
  uses?: OwnPhoto['uses']
}

export type AddOwnFilesResult = {
  /** Ids of the photos added, in time order. */
  added: string[]
  /** Why none were added: the workspace has no room. */
  refused: string | null
  /** Files that could not be read, each with its reason. */
  errors: string[]
}

type QueueRun = {
  /** Photo ids waiting; they run in time order whatever order they wait in. */
  pending: string[]
  running: string | null
  paused: boolean
  cancelled: boolean
}

const isHeic = (file: File) => /\.hei[cf]$/i.test(file.name) || /image\/hei[cf]/i.test(file.type)

const decodeImage = async (src: string) => {
  const picture = new Image()
  picture.src = src
  await picture.decode()
  // Natural size is after the EXIF orientation, as the photo is shown.
  return { width: picture.naturalWidth, height: picture.naturalHeight }
}

/** The depth model the queue uses by itself, when this browser already holds it: the small one. */
const AUTO_DEPTH_MODEL: PhotoDepthModel = 'da2-small'

/**
 * A photo whose search came back without a camera to trust, or with no skyline to search by over terrain that did
 * load: its cameras are worth comparing by the ground, which is then the only evidence the page has by itself.
 */
const unsettled = (work: OwnPhotoWork) =>
  work.search.status === 'done'
    ? !work.search.result.trustworthy
    : work.search.status === 'failed' && work.found?.terrain === true && work.found.skyline === false

/** Whether everything that follows a photo's search is done: its features, and the comparison when it wants one. */
const followedUp = (work: OwnPhotoWork) =>
  work.search.status === 'done'
    ? work.features !== null && (!unsettled(work) || work.combined !== undefined)
    : // No camera was found, so there is no seen ground to read features for: only the comparison follows.
      work.combined !== undefined

/** Drops every reader's skyline kept for a picture. */
const forgetSkylines = (skylines: { delete(key: string): unknown }, src: string) => {
  for (const reader of SKYLINE_READERS) skylines.delete(`${src}|${skylineReaderKey(reader)}`)
}

const positioned = (photo: OwnPhoto): photo is OwnPhoto & { pose: OwnPose & { lng: number; lat: number } } =>
  photo.pose.lng !== null && photo.pose.lat !== null

/** The camera as it stands, in an acceptance's terms; null without a position. */
const acceptancePoseOf = (
  photo: OwnPhoto,
  angles?: { bearing: number; pitch: number; roll: number; hfov?: number },
): AcceptancePose | null =>
  photo.pose.lng === null || photo.pose.lat === null
    ? null
    : {
        lng: photo.pose.lng,
        lat: photo.pose.lat,
        altitudeMeters: photo.pose.altitudeMeters ?? null,
        bearing: wrapHeading(angles?.bearing ?? photo.pose.bearing),
        pitch: angles?.pitch ?? photo.pose.pitch,
        roll: angles?.roll ?? photo.pose.roll,
        hfov: angles?.hfov ?? photo.pose.hfov,
      }

const flightFrameOf = (photo: OwnPhoto): FlightMatchFrame => ({
  id: photo.id,
  name: photo.name,
  flightId: photo.flightId,
  takenAtUtc: photo.takenAtUtc,
  pose: acceptancePoseOf(photo),
  acceptance: photo.acceptance,
  eyeHeightMeters: photo.pose.eyeHeightMeters,
})

const CONTROL_FREE_POSITION = { east: { mode: 'free' }, north: { mode: 'free' } } as const
const CONTROL_FIXED_POSITION = { east: { mode: 'fixed' }, north: { mode: 'fixed' }, up: { mode: 'fixed' } } as const

function hasControlPositionPrior(photo: OwnPhoto) {
  const source = photo.sources.position === 'controls' ? photo.start.sources.position : photo.sources.position
  return source === 'exif' || source === 'record' || source === 'matched'
}

/** The terrain tiles round a photo's place, finest first. */
const specOf = (photo: { pose: { lng: number | null; lat: number | null } }): PhotoTerrainSpec =>
  photoTerrainSpec(photo.pose.lng ?? 0, photo.pose.lat ?? 0, PHOTO_TERRAIN_RINGS)

/** The UTC instant a photo was taken, for the sun; null when only a zone-less clock gives it. */
const utcOf = (photo: OwnPhoto): Date | null => {
  const iso = photo.takenAt?.zoneKnown ? photo.takenAt.iso : (photo.exif?.gpsTimeUtc ?? null)
  const t = instantOf(iso)
  return t === null ? null : new Date(t)
}

const rgbaDataUrl = (image: { width: number; height: number; data: Uint8ClampedArray }) => {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  // A canvas kept in memory, not on the GPU: encoding one on the GPU waits for the road view's frames to finish
  // (seconds a picture with the road view open on a software renderer).
  canvas
    .getContext('2d', { willReadFrequently: true })!
    .putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0)
  return canvas.toDataURL('image/png')
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error))
/** Whether work stopped because its own signal was aborted (a shared load cancelled by another caller is a failure). */
const aborted = (signal: AbortSignal | undefined) => !!signal?.aborted

/** The photos with their flights and places in them; a photo whose flight did not change is the same object. */
const withPhotoFlights = (photos: OwnPhoto[]): OwnPhoto[] => {
  const placed = photoFlights(photos.map(({ id, name, takenAtUtc, flightId }) => ({ id, name, takenAtUtc, flightId })))
  return photos.map((photo) => {
    const place = placed.get(photo.id)
    const flightId = place?.flightId ?? null
    const frameIndex = place?.frameIndex ?? null
    return photo.flightId === flightId && photo.frameIndex === frameIndex ? photo : { ...photo, flightId, frameIndex }
  })
}

export type PhotoMatch = {
  /** Degrees added to the photo's own bearing and pitch while lining it up. */
  nudge: { bearing: number; pitch: number }
  opacity: number
  showSkyline: boolean
  showBlock: boolean
}

export type PhotoDrawing = {
  pose: PhotoPose
  skyline: Array<{ x: number; y: number; reachMeters: number }>
  /** Cutblock outlines as SVG paths in photo pixels. */
  outlines: string[]
  /** Block ground the analysis says this station sees, in photo pixels. */
  visibleDots: Array<{ x: number; y: number }>
}

type Search = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  photos: RankedPhoto[]
  /** Every photo taken from the road, ordered along it, for showing while driving. */
  road: RoadPhoto[]
  error: string | null
  searched: number
  truncated: boolean
}

/**
 * A field photo from Mapillary, or a set of the reviewer's own, and everything needed to find each own photo's
 * camera, check it and accept it. The page and the photo window render; this owns the state, and the automatic
 * queue, which must outlive the window (`DialogShell` unmounts it while hidden).
 *
 * Own photos: each one added becomes a field record at once (`photoRecordFromOwn`, through `records`), is grouped into
 * a flight by time, and joins the queue, which runs one photo at a time in time order without being asked: terrain,
 * the 360° horizon, the skyline search (round an accepted burst neighbour's camera first), model views for the winner
 * and the runner-up, and the features check. Nothing is accepted automatically.
 */
export function useFieldPhoto({
  scene,
  result,
  ground,
  eyeHeightMeters,
  records,
  onOriginalPhoto,
  onRemoveOriginal,
  originalOf,
  setViewsOfInterest,
  assessedRoad,
}: {
  scene: ForestryScene
  result: AnalysisResult | null
  /**
   * The road under assessment, which *far from the road* is measured from. Standing at a view swaps the scene's
   * viewpoint for a short pull-out at that view, so read from the scene the note measured from wherever the road view
   * last stood (an aircraft frame's own viewpoint 23 km off, then the road 70 km off). Absent: the scene's viewpoint.
   */
  assessedRoad?: ReadonlyArray<readonly [number, number]>
  /** The preview's fixed terrain, when the drive is open; otherwise the skyline terrain is used. */
  ground: ElevationSource | null
  eyeHeightMeters: number
  /** The assessment tools' field records, through a ref the page fills once the tools exist. */
  records?: { readonly current: OwnPhotoRecordsBridge | null }
  /** Keeps a photo's original bytes as a project attachment named for its record (`ProjectAttachment.recordId`). */
  onOriginalPhoto?: (file: File, recordId: string) => void
  /** Drops the attachment of a removed photo's record. */
  onRemoveOriginal?: (recordId: string) => void
  /** The original kept for a photo's record, or null: a record opened again is read from it, at full size. */
  originalOf?: (recordId: string) => Blob | null
  /** The scene's views of interest, for *Make a viewpoint* and for unlinking a removed photo. */
  setViewsOfInterest?: (update: (views: ViewOfInterest[]) => ViewOfInterest[]) => void
}) {
  const [photos, setPhotos] = useState<OwnPhoto[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [work, setWork] = useState<Record<string, OwnPhotoWork>>({})
  const [flightMatchProgress, setFlightMatchProgress] = useState<FlightMatchProgress | null>(null)
  /** Which matcher the flight match pairs photos with: this session's choice, XFeat until the reviewer picks. */
  const [flightMatcher, setFlightMatcher] = useState<PhotoMatcher>('xfeat')
  const flightMatchAbort = useRef<AbortController | null>(null)
  useEffect(() => () => flightMatchAbort.current?.abort(), [])
  const [queueRun, setQueueRun] = useState<QueueRun>({ pending: [], running: null, paused: false, cancelled: false })
  const photosRef = useRef(photos)
  photosRef.current = photos
  const workRef = useRef(work)
  workRef.current = work
  const activeRef = useRef(activeId)
  const sceneRef = useRef(scene)
  sceneRef.current = scene
  const callbacks = useRef({ onOriginalPhoto, onRemoveOriginal, originalOf, setViewsOfInterest })
  callbacks.current = { onOriginalPhoto, onRemoveOriginal, originalOf, setViewsOfInterest }
  /** Bumped by `clear`: work begun before it is dropped when it ends. */
  const generation = useRef(0)
  /** Object URLs made for photos, by id, revoked when a photo goes. */
  const objectUrls = useRef(new Map<string, string>())
  useEffect(() => {
    const urls = objectUrls.current
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url)
      urls.clear()
    }
  }, [])

  const locationAbort = useRef<AbortController | null>(null)
  const [locationSearch, setLocationSearch] = useState<{ id: string; state: PhotoLocationSearch } | null>(null)
  useEffect(() => () => locationAbort.current?.abort(), [])

  const activate = useCallback((id: string | null) => {
    if (activeRef.current !== id) {
      locationAbort.current?.abort()
      setLocationSearch(null)
    }
    activeRef.current = id
    setActiveId(id)
  }, [])
  const own = useMemo(() => photos.find((photo) => photo.id === activeId) ?? null, [photos, activeId])
  const activeWork = (activeId && work[activeId]) || EMPTY_WORK
  const photoById = (id: string) => photosRef.current.find((photo) => photo.id === id) ?? null
  const patchPhoto = useCallback((id: string, update: (photo: OwnPhoto) => OwnPhoto) => {
    setPhotos((current) => current.map((photo) => (photo.id === id ? update(photo) : photo)))
  }, [])
  const patchWork = useCallback((id: string, update: (work: OwnPhotoWork) => OwnPhotoWork) => {
    setWork((current) => ({ ...current, [id]: update(current[id] ?? EMPTY_WORK) }))
  }, [])
  /** The active photo changed; `null` closes it (the set stays). */
  const setOwn = useCallback(
    (update: null | ((current: OwnPhoto | null) => OwnPhoto | null)) => {
      if (update === null) {
        activate(null)
        return
      }
      const id = activeRef.current
      if (id) patchPhoto(id, (photo) => update(photo) ?? photo)
    },
    [activate, patchPhoto],
  )

  /** Caches as maps, not one slot each: the frames of a burst share terrain and imagery, a photo keeps its pixels. */
  const [caches] = useState(() => ({
    /** The main thread's terrain round a place, by tile range: `ownCamera` and the skyline over the photo read it. */
    terrain: new PhotoCache<ElevationSource>({ maxEntries: 2, sizeOf: () => 0 }),
    /** The 360° horizon by eye (`horizonKey`). */
    horizon: new PhotoCache<ProfilePoint[]>({ maxEntries: 32, sizeOf: (profile) => profile.length * 32 }),
    /** The photo's pixels at the working width, by its URL. */
    pixels: new PhotoCache<ImageData>({ maxEntries: 8, sizeOf: (image) => image.data.byteLength }),
    /** The photo's own skyline, read once, by its URL. */
    skyline: new PhotoCache<Array<{ x: number; y: number } | null>>({ maxEntries: 32, sizeOf: () => 0 }),
    /** Search results by photo, camera start, ranges and priors (`searchKey`). */
    results: new PhotoCache<WideSearchResult | null>({ maxEntries: 64, sizeOf: () => 0 }),
    /** Imagery layers round a place (`imageryKey`). */
    // One ring a entry: a flight's photos share the far and middle rings and differ in a few near ones.
    imagery: new PhotoCache<ImageryLayer>({ maxEntries: 9, maxBytes: 160e6, sizeOf: (layer) => layer.data.byteLength }),
    /** Hit buffers by camera (`photoPoseKey`). */
    hits: new PhotoCache<HitBuffer>({ maxEntries: 6 }),
    /**
     * Hit buffers cast ahead for the open photo's option cameras, about 5 MB each, so *Use* lays the layers at once.
     * Apart from `hits`: the features checks and comparisons that follow the queue cast for every photo in the set,
     * and in one cache they pushed the open photo's options out again within seconds.
     */
    optionHits: new PhotoCache<HitBuffer>({ maxEntries: 8 }),
    /** A photo's depth estimate by picture and model: worked out once, kept in this browser's database too. */
    depth: new PhotoCache<DepthGrid>({ maxEntries: 32, sizeOf: (grid) => grid.inverse.byteLength }),
    /** Features read for a box (`featuresKey`). */
    features: new PhotoCache<PhotoFeatureReads>({ maxEntries: 12, sizeOf: () => 0 }),
  }))
  /** Bumped when terrain loads, so what is drawn from it follows. */
  const [terrainVersion, setTerrainVersion] = useState(0)

  const ownRequest = useRef(0)
  const [ownStatus, setOwnStatus] = useState<{
    loading: boolean
    error: string | null
    stage?: string
    /** What the last add did that the reviewer did not ask for in so many words: photos opened from their records. */
    note?: string
  }>({
    loading: false,
    error: null,
  })
  // The own photo's dialog (`OwnPhotoDialog`), kept here so it outlives the sidebar panel that opens it.
  const [ownDialog, setOwnDialog] = useState<{ open: boolean; step: OwnPhotoPlace }>({ open: false, step: 'photos' })
  const token = mapillaryToken()
  const [input, setInput] = useState('')
  const [image, setImage] = useState<MapillaryImage | null>(null)
  const [status, setStatus] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null })
  const [search, setSearch] = useState<Search>({
    status: 'idle',
    photos: [],
    road: [],
    error: null,
    searched: 0,
    truncated: false,
  })
  const [match, setMatch] = useState<PhotoMatch | null>(null)
  const [follow, setFollow] = useState(false)
  const [viewAspect, setViewAspect] = useState(16 / 9)
  const [panoPixels, setPanoPixels] = useState<{
    id: string
    width: number
    height: number
    data: Uint8ClampedArray
  } | null>(null)
  const [skylineGround, setSkylineGround] = useState<{ id: string; source: ElevationSource } | null>(null)
  const abort = useRef<AbortController | null>(null)
  const [pendingPixel, setPendingPixel] = useState<[number, number] | null>(null)
  const [photoDrape, setPhotoDrape] = useState<PhotoDrape | null>(null)
  const [toolsBusy, setToolsBusy] = useState<string | null>(null)
  const [toolsError, setToolsError] = useState<string | null>(null)
  const cameraAbort = useRef<AbortController | null>(null)
  const [alignment, setAlignment] = useState<{
    status: 'idle' | 'working' | 'done' | 'failed'
    fit: SkylineFit | null
    message: string | null
  }>({ status: 'idle', fit: null, message: null })

  // The active photo's tools, kept per photo.
  const cameraSearch = activeWork.search
  const priors = activeWork.priors
  const landmark = activeWork.landmark
  const pairs = activeWork.pairs
  const controlSolve = activeWork.controlSolve
  const freeControlPosition = !!own && !hasControlPositionPrior(own)
  const controlCheckCount = pairsNeeded(freeControlPosition ? CONTROL_FREE_POSITION : undefined) + 1
  const modelViews = activeWork.modelViews
  const setPriors = useCallback(
    (action: SetStateAction<CameraPriors>) => {
      const id = activeRef.current
      if (id)
        patchWork(id, (current) => ({
          ...current,
          priors: typeof action === 'function' ? action(current.priors) : action,
        }))
    },
    [patchWork],
  )
  const setPairs = useCallback(
    (update: (pairs: ControlPair[]) => ControlPair[]) => {
      const id = activeRef.current
      if (id) patchWork(id, (current) => ({ ...current, pairs: update(current.pairs) }))
    },
    [patchWork],
  )

  const road = scene.viewpoint.coordinates
  const onRoad = useMemo(() => (image && road.length > 1 ? nearestPointOnLine(road, image) : null), [image, road])

  const load = useCallback(
    async (value: string, { onLoaded }: { onLoaded?: (image: MapillaryImage) => void } = {}) => {
      const id = parseMapillaryInput(value)
      if (!id) {
        setStatus({ loading: false, error: 'Paste a Mapillary photo link, or its image key.' })
        return
      }
      if (!token) return
      ownRequest.current++
      setOwnStatus({ loading: false, error: null })
      abort.current?.abort()
      const controller = new AbortController()
      abort.current = controller
      setStatus({ loading: true, error: null })
      setMatch(null)
      try {
        const next = await fetchMapillaryImage(id, token, { signal: controller.signal })
        if (controller.signal.aborted) return
        setOwn(null)
        setImage(next)
        setInput(next.pageUrl)
        setStatus({ loading: false, error: null })
        onLoaded?.(next)
      } catch (error) {
        if (!controller.signal.aborted)
          setStatus({ loading: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
    [token, setOwn],
  )

  const findPhotos = useCallback(async () => {
    if (!token || road.length < 2) return
    const block = scene.targets.find((target) => target.role === 'block')
    const centre =
      (result && visibleProposalCentre(result)) ??
      (block ? (([w, s, e, n]) => ({ lng: (w + e) / 2, lat: (s + n) / 2 }))(polygonBounds(block.geometry)) : null)
    if (!centre) return
    const lngs = road.map(([lng]) => lng),
      lats = road.map(([, lat]) => lat)
    const pad = 0.0006
    setSearch((current) => ({ ...current, status: 'loading', error: null }))
    try {
      const found = await searchMapillaryImages(
        [Math.min(...lngs) - pad, Math.min(...lats) - pad, Math.max(...lngs) + pad, Math.max(...lats) + pad],
        token,
      )
      const photos = rankPhotosToward(
        found.images,
        centre,
        (point) => nearestPointOnLine(road, point)?.offsetMeters ?? Infinity,
      )
      const alongRoad = found.images
        .flatMap((image): RoadPhoto[] => {
          const on = nearestPointOnLine(road, image)
          return on && on.offsetMeters <= 30
            ? [{ ...image, alongMeters: on.distanceAlongMeters, offRoadMeters: on.offsetMeters }]
            : []
        })
        .sort((a, b) => a.alongMeters - b.alongMeters)
      setSearch({
        status: 'ready',
        photos,
        road: alongRoad,
        error: null,
        searched: found.images.length,
        truncated: found.truncated,
      })
    } catch (error) {
      setSearch({
        status: 'error',
        photos: [],
        road: [],
        error: error instanceof Error ? error.message : String(error),
        searched: 0,
        truncated: false,
      })
    }
  }, [token, road, scene.targets, result])

  // The point the skyline terrain is loaded around: the Mapillary photo, or the
  // own photo's position to about a kilometre (moving it further reloads).
  const ownLng = own?.pose.lng ?? null,
    ownLat = own?.pose.lat ?? null
  const skylineCentre = image
    ? { id: image.id, lng: image.lng, lat: image.lat }
    : own && ownLng !== null && ownLat !== null
      ? { id: `${own.id}@${ownLng.toFixed(2)},${ownLat.toFixed(2)}`, lng: ownLng, lat: ownLat }
      : null
  const skylineId = skylineCentre?.id ?? null
  const skylineSource = skylineGround && skylineGround.id === skylineId ? skylineGround.source : null

  // Coarse terrain out to 25 km around the photo, for the skyline: the preview's
  // own mosaic stops a kilometre or two past the road, short of most ridgelines.
  useEffect(() => {
    if (!skylineCentre || !match) return
    if (skylineGround?.id === skylineCentre.id) return
    const { id, lng, lat } = skylineCentre
    const controller = new AbortController()
    const degLat = SKYLINE_RADIUS_METERS / 110574
    const degLng = SKYLINE_RADIUS_METERS / (111320 * Math.cos((lat * Math.PI) / 180))
    const range = demTileRange([lng - degLng, lat - degLat, lng + degLng, lat + degLat], SKYLINE_ZOOM)
    loadElevationGrid({ range, signal: controller.signal, concurrency: 4 })
      .then(({ grid }) => {
        if (!controller.signal.aborted) setSkylineGround({ id, source: grid })
      })
      .catch(() => {
        /* The skyline is a guide; without terrain it is simply not drawn. */
      })
    return () => controller.abort()
    // The centre is rebuilt each render; its id names it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skylineId, match === null, skylineGround?.id])

  // A 360° photo's pixels, to cut views from. Mapillary's image host allows
  // cross-origin reads, so the canvas stays readable.
  useEffect(() => {
    if (!image?.isPano || !match || !image.thumbUrl || panoPixels?.id === image.id) return
    let cancelled = false
    const picture = new Image()
    picture.crossOrigin = 'anonymous'
    picture.src = image.thumbUrl
    picture
      .decode()
      .then(() => {
        if (cancelled) return
        const canvas = document.createElement('canvas')
        canvas.width = picture.naturalWidth
        canvas.height = picture.naturalHeight
        const context = canvas.getContext('2d', { willReadFrequently: true })!
        context.drawImage(picture, 0, 0)
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
        setPanoPixels({ id: image.id, width: pixels.width, height: pixels.height, data: pixels.data })
      })
      .catch(() => {
        /* Without its pixels the panorama simply is not drawn; the skyline still is. */
      })
    return () => {
      cancelled = true
    }
  }, [image, match, panoPixels?.id])

  /** Where the road view looks while comparing: the photo's own pose, or for a panorama wherever it is turned. */
  const look =
    image && match
      ? {
          bearing: image.bearing + match.nudge.bearing,
          pitch: (image.isPano ? 0 : image.pitch) + match.nudge.pitch,
        }
      : own && match
        ? { bearing: own.pose.bearing, pitch: own.pose.pitch }
        : null
  const panoView =
    image?.isPano && look
      ? {
          bearing: look.bearing,
          pitch: look.pitch,
          verticalFovDegrees: PANO_VIEW_FOV,
          height: PANO_VIEW_HEIGHT,
          width: Math.round(PANO_VIEW_HEIGHT * viewAspect),
        }
      : null
  const panoFrame = useMemo(
    () =>
      panoView && image && panoPixels?.id === image.id
        ? {
            width: panoView.width,
            height: panoView.height,
            data: reprojectEquirect(panoPixels, { rotation: image.rotation, bearing: image.bearing }, panoView),
          }
        : null,
    // The view is rebuilt from primitives, so depend on those rather than the object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [image, panoPixels, panoView?.bearing, panoView?.pitch, panoView?.width],
  )

  /** A comparison that starts on the photo's own pose, or a panorama turned toward the cutblock. */
  const startMatch = (next: MapillaryImage): PhotoMatch => {
    let bearing = 0
    if (next.isPano) {
      const block = scene.targets.find((target) => target.role === 'block')
      const centre =
        (result && visibleProposalCentre(result)) ??
        (block ? (([w, s, e, n]) => ({ lng: (w + e) / 2, lat: (s + n) / 2 }))(polygonBounds(block.geometry)) : null)
      if (centre) bearing = ((bearingDegrees(next, centre) - next.bearing + 540) % 360) - 180
    }
    return { nudge: { bearing, pitch: 0 }, opacity: next.isPano ? 0.85 : 0.6, showSkyline: true, showBlock: true }
  }

  const fov = image ? photoFieldOfView(image) : null
  const ownFov = own
    ? { horizontal: own.pose.hfov, vertical: verticalFovFromHorizontal(own.pose.hfov, own.width, own.height) }
    : null
  const viewFov = image?.isPano ? PANO_VIEW_FOV : (fov?.vertical ?? ownFov?.vertical ?? null)
  /** The photo's own horizontal field, degrees: the lens an analysis sheet framed on it takes. */
  const viewHfov = image?.isPano ? null : (fov?.horizontal ?? ownFov?.horizontal ?? null)
  const ownOnRoad = useMemo(
    () =>
      ownLng !== null && ownLat !== null && road.length ? nearestPointOnLine(road, { lng: ownLng, lat: ownLat }) : null,
    [ownLng, ownLat, road],
  )
  /** The road view's ground under the own photo's spot (the coarse skyline terrain until it loads). */
  const ownGroundMeters = useMemo(() => {
    if (ownLng === null || ownLat === null) return Number.NaN
    const near = ground?.elevationAt(ownLng, ownLat)
    if (near !== undefined && Number.isFinite(near)) return near
    const coarse = skylineSource?.elevationAt(ownLng, ownLat)
    return coarse !== undefined && Number.isFinite(coarse) ? coarse : Number.NaN
  }, [ownLng, ownLat, ground, skylineSource])
  /** The own photo's eye above that ground: from its altitude when it has one (from the air, or matched). */
  const ownEyeHeight = own ? eyeHeightOver(own.pose, ownGroundMeters) : null
  const photoOnRoad = image ? onRoad : ownOnRoad
  const station = result && photoOnRoad ? nearestStation(result.stations, photoOnRoad.distanceAlongMeters) : null

  /** Whether the road view can stand where the own photo was taken: on loaded ground, within a walk of the road. */
  const ownStand = useMemo<OwnStand | null>(() => {
    if (!own) return null
    if (ownLng === null || ownLat === null) return { status: 'no-position' }
    const offRoadMeters = ownOnRoad?.offsetMeters ?? 0
    if (!ownOnRoad || offRoadMeters > MAX_WALK_METERS) return { status: 'too-far', offRoadMeters }
    const z = ground?.elevationAt(ownLng, ownLat)
    // Before the road view's terrain is loaded there is nothing to check against yet.
    if (ground && (z === undefined || !Number.isFinite(z))) return { status: 'no-terrain', offRoadMeters }
    return { status: 'ok', offRoadMeters, alongMeters: ownOnRoad.distanceAlongMeters }
  }, [own, ownLng, ownLat, ownOnRoad, ground])

  const drawing = useMemo<PhotoDrawing | null>(() => {
    if ((!image && !own) || !match) return null
    const far = skylineSource
    const groundAt = (lng: number, lat: number) => {
      const near = ground?.elevationAt(lng, lat)
      if (near !== undefined && Number.isFinite(near)) return near
      const coarse = far?.elevationAt(lng, lat)
      return coarse !== undefined && Number.isFinite(coarse) ? coarse : Number.NaN
    }
    let pose: PhotoPose | null = null
    if (image) {
      const base = groundAt(image.lng, image.lat)
      if (!Number.isFinite(base)) return null
      const at = { lng: image.lng, lat: image.lat, altitudeMeters: base + eyeHeightMeters }
      const photo = image.isPano
        ? panoView
          ? panoViewPose(at, panoView)
          : null
        : photoPoseFor(image, base + eyeHeightMeters)
      if (!photo) return null
      pose = image.isPano
        ? photo
        : { ...photo, bearing: photo.bearing + match.nudge.bearing, pitch: photo.pitch + match.nudge.pitch }
    } else if (own && own.pose.lng !== null && own.pose.lat !== null) {
      const base = groundAt(own.pose.lng, own.pose.lat)
      if (!Number.isFinite(base)) return null
      pose = ownPhotoPose({ ...own.pose, lng: own.pose.lng, lat: own.pose.lat }, base, own.width, own.height)
    }
    if (!pose) return null
    const skyline =
      far && match.showSkyline
        ? terrainSkyline(pose, far, { columns: 160, maxDistanceMeters: SKYLINE_RADIUS_METERS })
        : []

    const outlines: string[] = []
    if (match.showBlock) {
      for (const block of scene.targets.filter((target) => target.role === 'block')) {
        const rings =
          block.geometry.type === 'Polygon'
            ? [block.geometry.coordinates[0]]
            : block.geometry.coordinates.map((polygon) => polygon[0])
        for (const ring of rings) {
          let path = ''
          let pen = false
          for (let i = 1; i < ring.length; i += 1) {
            const [a, b] = [ring[i - 1], ring[i]]
            const steps = Math.max(1, Math.ceil(Math.hypot((b[0] - a[0]) * 65000, (b[1] - a[1]) * 111000) / 10))
            for (let step = i === 1 ? 0 : 1; step <= steps; step += 1) {
              const lng = a[0] + ((b[0] - a[0]) * step) / steps
              const lat = a[1] + ((b[1] - a[1]) * step) / steps
              const z = groundAt(lng, lat)
              const point = Number.isFinite(z) ? projectToPhoto(pose, lng, lat, z) : null
              if (!point) {
                pen = false
                continue
              }
              path += `${pen ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`
              pen = true
            }
          }
          if (path) outlines.push(path)
        }
      }
    }

    const visibleDots: Array<{ x: number; y: number }> = []
    if (match.showBlock && result && station !== null) {
      for (const target of result.targets.filter((entry) => entry.role === 'block')) {
        const stride = Math.max(1, Math.ceil(target.sampleCount / 1500))
        for (let i = 0; i < target.sampleCount; i += stride) {
          if (target.visibleByStation[station * target.sampleCount + i] !== 1) continue
          const point = projectToPhoto(pose, target.positions[i * 2], target.positions[i * 2 + 1], target.elevations[i])
          if (point) visibleDots.push({ x: point.x, y: point.y })
        }
      }
    }
    return { pose, skyline, outlines, visibleDots }
    // The pano view is rebuilt from primitives, so depend on those.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    image,
    own,
    match,
    skylineSource,
    ground,
    eyeHeightMeters,
    scene.targets,
    result,
    station,
    panoView?.bearing,
    panoView?.pitch,
    panoView?.width,
  ])

  /** Reads the photo's own skyline and searches heading and pitch to lay it on the terrain's. */
  const autoAlign = useCallback(async () => {
    if ((!image && !own) || !match || !drawing) return
    const far = skylineSource
    const src = image ? image.thumbUrl : own!.src
    if (!far || !src) {
      setAlignment({ status: 'failed', fit: null, message: 'The skyline terrain is still loading.' })
      return
    }
    setAlignment({ status: 'working', fit: null, message: null })
    try {
      // The photo's own pixels, or for a panorama the view cut from it; either
      // way in the frame `drawing.pose` describes.
      let pixels: { width: number; height: number; data: Uint8ClampedArray }
      if (image?.isPano) {
        if (!panoFrame) throw new Error('the panorama is still loading')
        pixels = panoFrame
      } else {
        const picture = new Image()
        picture.crossOrigin = 'anonymous'
        picture.src = src
        await picture.decode()
        const width = Math.min(1024, picture.naturalWidth)
        const height = Math.round((picture.naturalHeight * width) / picture.naturalWidth)
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d', { willReadFrequently: true })!
        context.drawImage(picture, 0, 0, width, height)
        pixels = context.getImageData(0, 0, width, height)
      }
      const sx = drawing.pose.width / pixels.width,
        sy = drawing.pose.height / pixels.height
      const skyline = photoSkyline(pixels, 220).map((point) => (point ? { x: point.x * sx, y: point.y * sy } : null))
      const base = drawing.pose
      const half = (Math.atan2(base.width / 2, base.focalPx) * 180) / Math.PI + 6
      const profile = terrainProfile(base, far, {
        from: base.bearing - half,
        to: base.bearing + half,
        step: 0.1,
        maxDistanceMeters: SKYLINE_RADIUS_METERS,
      })
      const fit = fitSkyline(base, profile, skyline)
      if (!fit || !fit.trustworthy) {
        setAlignment({
          status: 'failed',
          fit,
          message: !fit
            ? 'Too little open sky in this photo to align by. Nudge by hand.'
            : fit.agreeing < 20 || fit.span < 0.15
              ? `Only ${fit.agreeing} columns show a skyline a kilometre or more away; the rest is nearby trees or poles. Too few to fix the view. Nudge by hand.`
              : `The skyline agrees in only ${Math.round(fit.agreement * 100)}% of the columns that can be judged. Nudge by hand.`,
        })
        return
      }
      if (image)
        setMatch({
          ...match,
          nudge: { bearing: match.nudge.bearing + fit.nudge.bearing, pitch: match.nudge.pitch + fit.nudge.pitch },
        })
      else
        setOwn((current) =>
          current
            ? {
                ...current,
                pose: {
                  ...current.pose,
                  bearing: normalizeHeading(current.pose.bearing + fit.nudge.bearing),
                  pitch: current.pose.pitch + fit.nudge.pitch,
                },
                sources: { ...current.sources, heading: 'skyline', pitch: 'skyline' },
              }
            : current,
        )
      setAlignment({ status: 'done', fit, message: null })
    } catch (error) {
      setAlignment({
        status: 'failed',
        fit: null,
        message: `Could not read the photo: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }, [image, own, match, drawing, skylineSource, panoFrame, setOwn])

  // ---------------------------------------------------------------------------------------------------------------
  // Terrain, pixels and the camera, shared by the queue and the hand tools.

  /**
   * Terrain round a photo for its camera tools: the zoom-11 mosaic to 25 km over a zoom-9 ring to 90 km, kept by tile
   * range so the frames of a burst share it. The tools need no road view, so they work for a photo taken far from the
   * scene's road. The photo worker loads the same tiles itself (`photoTerrainSpec`).
   */
  const loadOwnTerrain = useCallback(
    async (lng: number, lat: number, signal: AbortSignal, onTiles?: (loaded: number, total: number) => void) => {
      const spec = photoTerrainSpec(lng, lat, PHOTO_TERRAIN_RINGS)
      const key = terrainSpecKey(spec)
      const held = caches.terrain.get(key)
      if (held) return held
      // Shared by every caller asking for these tiles: it stops only once all of them have given up.
      const source = await caches.terrain.getOrCreate(
        key,
        async (shared) => {
          const total = spec.layers.reduce((sum, range) => sum + range.tileCount, 0)
          const done = spec.layers.map(() => 0)
          const grids = await Promise.all(
            spec.layers.map((range, i) =>
              loadElevationGrid({
                range,
                signal: shared,
                concurrency: i === 0 ? 4 : 2,
                onProgress: (loaded) => {
                  done[i] = loaded
                  onTiles?.(
                    done.reduce((a, b) => a + b, 0),
                    total,
                  )
                },
              }),
            ),
          )
          const layered: ElevationSource = {
            elevationAt: (x, y) => {
              for (const { grid } of grids) {
                const z = grid.elevationAt(x, y)
                if (Number.isFinite(z)) return z
              }
              return Number.NaN
            },
          }
          return layered
        },
        signal,
      )
      setTerrainVersion((version) => version + 1)
      return source
    },
    [caches],
  )
  /** A photo's camera in its own pixels (as displayed), standing on `terrain`, at `angles` when given. */
  const cameraOf = (
    photo: OwnPhoto,
    terrain: ElevationSource,
    angles?: { bearing: number; pitch: number; roll: number; hfov?: number },
  ): PhotoPose => {
    const lng = photo.pose.lng!,
      lat = photo.pose.lat!
    return ownPhotoPose(
      {
        ...photo.pose,
        lng,
        lat,
        ...(angles ? { bearing: angles.bearing, pitch: angles.pitch, roll: angles.roll } : {}),
        ...(angles?.hfov !== undefined ? { hfov: angles.hfov } : {}),
      },
      terrain.elevationAt(lng, lat),
      photo.width,
      photo.height,
    )
  }
  const ownCamera = cameraOf
  /**
   * The terrain under the active photo, once loaded; null until then. Read with `get`, not `peek`, so it is the most
   * recently used each time terrain loads: the queue loads other photos' terrain behind it, and the cache keeps two.
   */
  const ownTerrainKey = own && positioned(own) ? terrainSpecKey(specOf(own)) : null
  const ownTerrainSpec = useMemo(
    () => (own && positioned(own) ? specOf(own) : null),
    // The tiles are named by their key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ownTerrainKey],
  )
  const cachedOwnTerrain = useMemo(
    () => (ownTerrainKey ? (caches.terrain.get(ownTerrainKey) ?? null) : null),
    // The cache is read again whenever terrain loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ownTerrainKey, terrainVersion, caches],
  )
  // Held for as long as the photo is open, whatever the cache does: the queue's follow-up work loads other photos'
  // terrain, and when that pushed the open photo's out of the cache its camera had no ground to stand on, so
  // everything drawn over the photo went away and came back about half a second later, at no click of the reviewer's.
  const [heldOwnTerrain, setHeldOwnTerrain] = useState<{ key: string; terrain: ElevationSource } | null>(null)
  if (
    ownTerrainKey &&
    cachedOwnTerrain &&
    (heldOwnTerrain?.key !== ownTerrainKey || heldOwnTerrain.terrain !== cachedOwnTerrain)
  )
    setHeldOwnTerrain({ key: ownTerrainKey, terrain: cachedOwnTerrain })
  const ownSkylineTerrain =
    cachedOwnTerrain ?? (heldOwnTerrain && heldOwnTerrain.key === ownTerrainKey ? heldOwnTerrain.terrain : null)
  /**
   * The terrain's skyline for the active photo's camera as it stands, in the photo's pixels: drawn over the photo in
   * its window, so a camera can be judged against the ridgeline with no road view. Null until the terrain is loaded.
   */
  const ownSkyline = useMemo(() => {
    if (!own || !ownSkylineTerrain || !positioned(own)) return null
    const pose = ownCamera(own, ownSkylineTerrain)
    if (!Number.isFinite(pose.altitudeMeters)) return null
    return terrainSkyline(pose, ownSkylineTerrain, { columns: 200, maxDistanceMeters: WIDE_RADIUS_METERS * 0.95 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [own, ownSkylineTerrain])
  /** The active photo's camera as it stands, in its pixels; null without a position or terrain under it. */
  const activePose = useMemo(() => {
    if (!own || !ownSkylineTerrain || !positioned(own)) return null
    const pose = ownCamera(own, ownSkylineTerrain)
    return Number.isFinite(pose.altitudeMeters) ? pose : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [own, ownSkylineTerrain])
  const activePoseKey = activePose ? photoPoseKey(activePose) : null
  const [ownSkylineStatus, setOwnSkylineStatus] = useState<{ loading: boolean; error: string | null }>({
    loading: false,
    error: null,
  })
  /** Loads the terrain round the active photo so its skyline can be drawn over it. */
  const loadOwnSkyline = useCallback(async () => {
    if (ownLng === null || ownLat === null) return
    setOwnSkylineStatus({ loading: true, error: null })
    try {
      await loadOwnTerrain(ownLng, ownLat, new AbortController().signal)
      setOwnSkylineStatus({ loading: false, error: null })
    } catch (error) {
      setOwnSkylineStatus({ loading: false, error: `The terrain did not load: ${reason(error)}` })
    }
  }, [ownLng, ownLat, loadOwnTerrain])
  // The active photo's terrain, loaded whenever it is missing: a photo opened from the strip after the queue moved on
  // (or after a reload) has none, and without it nothing is drawn over the photo and no check can be made.
  const ownTerrainMissing = !!own && positioned(own) && !ownSkylineTerrain
  useEffect(() => {
    if (ownTerrainMissing) void loadOwnSkyline()
  }, [ownTerrainMissing, loadOwnSkyline])
  /** A photo's pixels at the bench's working width, kept by its URL. */
  const readPixels = (photo: OwnPhoto) =>
    caches.pixels.getOrCreate(photo.src, async () => {
      const picture = new Image()
      picture.src = photo.src
      await picture.decode()
      const width = Math.min(WIDE_WORK_WIDTH, picture.naturalWidth)
      const height = Math.round((picture.naturalHeight * width) / picture.naturalWidth)
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d', { willReadFrequently: true })!
      context.drawImage(picture, 0, 0, width, height)
      return context.getImageData(0, 0, width, height)
    })
  /** The photo's own skyline by one reader, read once, in `pose`'s pixels. */
  /** A photo's skyline as one reader reads it, in the working pixels' own coordinates; read once. */
  const skylineRead = (photo: OwnPhoto, pixels: ImageData, reader: SkylineReader) => {
    const key = `${photo.src}|${skylineReaderKey(reader)}`
    let read = caches.skyline.get(key)
    if (!read) {
      read = readPhotoSkyline(pixels, reader, 200)
      caches.skyline.set(key, read)
    }
    return read
  }
  const skylineOf = (photo: OwnPhoto, pixels: ImageData, pose: PhotoPose, reader: SkylineReader = { mode: 'auto' }) => {
    const read = skylineRead(photo, pixels, reader)
    const sx = pose.width / pixels.width,
      sy = pose.height / pixels.height
    return read.map((point) => (point ? { x: point.x * sx, y: point.y * sy } : null))
  }
  /**
   * Imagery near, middle and far round a place (`IMAGERY_RINGS`), each ring kept by the tiles it holds, so the photos
   * of a flight share the rings they have in common.
   */
  const imageryLayers = (lng: number, lat: number, signal: AbortSignal) => {
    const keys = imageryRingKeys(lng, lat)
    return Promise.all(
      IMAGERY_RINGS.map(({ radiusMeters, maxZoom }, ring) =>
        caches.imagery.getOrCreate(
          keys[ring],
          async (shared) => (await loadImageryMosaic(imageryBox(lng, lat, radiusMeters), maxZoom, shared)).layer,
          signal,
        ),
      ),
    )
  }
  /** An accepted photo within a burst of this one, whose camera can seed its search. */
  const neighbourOf = (photo: OwnPhoto) => {
    if (!positioned(photo)) return null
    const accepted = photosRef.current.flatMap((other) =>
      other.acceptance && other.id !== photo.id
        ? [
            {
              id: other.id,
              takenAtUtc: other.takenAtUtc,
              lng: other.acceptance.pose.lng,
              lat: other.acceptance.pose.lat,
              name: other.name,
              pose: other.acceptance.pose,
            },
          ]
        : [],
    )
    return burstNeighbour(
      { id: photo.id, takenAtUtc: photo.takenAtUtc, lng: photo.pose.lng, lat: photo.pose.lat },
      accepted,
    )
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The search, the model views and the features check, one photo at a time.

  /** Searches every heading for a photo's camera, its result kept by photo, start, ranges and priors. */
  const runSearch = (
    photo: OwnPhoto,
    base: PhotoPose,
    profile: ProfilePoint[],
    skyline: Array<{ x: number; y: number } | null>,
    searchPriors: CameraPriors,
    signal: AbortSignal,
    onProgress: (done: number) => void,
    reader: SkylineReader = { mode: 'auto' },
  ) => {
    const pitchRange = pitchRangeFor({ tilt: photo.exif?.tilt, airborne: photo.pose.altitudeMeters != null })
    const rollRange = [-15, 15] as const
    const hfovRange = lensRangeFor(photo.lens)
    const key = searchKey({
      photoId: photo.src,
      pose: base,
      pitchRange,
      rollRange,
      headingSpan: 180,
      hfovRange,
      priors: searchPriors,
    })
    return caches.results.getOrCreate(
      // The skyline searched is the reader's, so a result is kept by reader too.
      `${key}|${skylineReaderKey(reader)}`,
      (shared) =>
        runWideOrientation(
          {
            pose: { ...base, roll: 0 },
            profile,
            skyline,
            pitchRange,
            rollRange,
            headingSpan: 180,
            priors: searchPriors,
            ...(hfovRange ? { hfovRange } : {}),
          },
          shared,
          onProgress,
        ),
      signal,
    )
  }

  /**
   * Finds a photo's camera from its skyline: terrain, the 360° horizon (in the worker), the photo's skyline, then the
   * search. A pass round an accepted burst neighbour supplies context for the full search.
   * `setPose` applies the winner. A stopped search keeps its reason on the photo.
   */
  const searchStage = async (
    id: string,
    {
      searchPriors,
      neighbourFirst,
      setPose,
    }: {
      searchPriors: CameraPriors
      neighbourFirst: boolean
      /**
       * Whether the winner becomes the camera: `true` for a search the reviewer asked for; `'if-automatic'` for the
       * queue's, which applies it only while the camera is still where the queue found it (`queueMaySetPose`), so a
       * camera the reviewer set or moved during the search is never overwritten.
       */
      setPose: boolean | 'if-automatic'
    },
    signal: AbortSignal,
  ): Promise<{ result: WideSearchResult; terrain: ElevationSource; pixels: ImageData } | null> => {
    const t0 = performance.now()
    const first = photoById(id)
    if (!first) return null
    const stop = (message: string, found: PhotoFound) => {
      patchWork(id, (current) => ({ ...current, search: { status: 'failed', message }, found }))
      return null
    }
    if (!positioned(first))
      return stop('No position: search an approximate area, or pick or enter a known camera location.', {
        lens: first.lens,
        stopped: 'No position yet',
      })
    patchWork(id, (current) => ({ ...current, search: { status: 'working', stage: 'terrain', done: 0 } }))
    const terrain = await loadOwnTerrain(first.pose.lng, first.pose.lat, signal, (loaded, total) =>
      patchWork(id, (current) => ({
        ...current,
        search: { status: 'working', stage: 'terrain', done: loaded / total, tiles: { loaded, total } },
      })),
    )
    const held = photoById(id) ?? first
    if (!positioned(held)) return null
    // A photo whose GPS altitude is well above the ground was taken from the air: its eye stands there before the
    // search, or the search would fit an aircraft's skyline from the ground under it.
    const groundMeters = terrain.elevationAt(held.pose.lng, held.pose.lat)
    const lifted =
      held.pose.altitudeMeters === null || held.pose.altitudeMeters === undefined
        ? airborneAltitude({
            gpsAltitudeMeters: held.exif?.altitudeMeters ?? held.recordAltitudeMeters,
            groundMeters,
            eyeSource: held.sources.eyeHeight,
          })
        : null
    const lift = <P extends OwnPhoto>(current: P): P =>
      lifted === null
        ? current
        : {
            ...current,
            pose: { ...current.pose, altitudeMeters: lifted },
            sources: { ...current.sources, eyeHeight: 'exif' as const },
          }
    const photo = lift(held)
    if (lifted !== null)
      patchPhoto(id, (current) =>
        current.pose.altitudeMeters === null || current.pose.altitudeMeters === undefined
          ? current.sources.eyeHeight === 'default'
            ? lift(current)
            : current
          : current,
      )
    // A fix far below its GPS altitude may have missed the high ground the phone stood on: the nearest ground at that
    // altitude becomes an option (`highGroundNearFix`), never the camera. Read from the fix, so a camera moved there
    // and searched again keeps the option it came from.
    const fix = photo.exif?.position
    const fixAltitude = photo.exif?.altitudeMeters ?? null
    const highGround =
      fix && fixAltitude !== null && (photo.sources.position === 'exif' || photo.sources.position === 'gps-altitude')
        ? highGroundNearFix({
            lng: fix.lng,
            lat: fix.lat,
            gpsAltitudeMeters: fixAltitude,
            eyeHeightMeters: photo.pose.eyeHeightMeters,
            horizontalErrorMeters: photo.exif?.horizontalErrorMeters ?? null,
            elevationAt: (lng, lat) => terrain.elevationAt(lng, lat),
          })
        : null
    const base = ownCamera(photo, terrain)
    if (!Number.isFinite(base.altitudeMeters))
      return stop('No terrain under the camera: the photo was taken where no elevation data loaded.', {
        lens: photo.lens,
        terrain: false,
      })
    const eye = { lng: base.lng, lat: base.lat, altitudeMeters: base.altitudeMeters }
    const profile = await caches.horizon.getOrCreate(
      horizonKey(eye),
      (shared) => photoHorizon({ eye, terrain: specOf(photo), maxDistanceMeters: WIDE_RADIUS_METERS * 0.95 }, shared),
      signal,
    )
    if (!profile.length)
      return stop('No terrain round the camera to search against.', { lens: photo.lens, terrain: false })
    patchWork(id, (current) => ({ ...current, search: { status: 'working', stage: 'photo', done: 0 } }))
    const pixels = await readPixels(photo)
    const progress = (from: number, share: number) => (done: number) =>
      patchWork(id, (current) => ({
        ...current,
        search: { status: 'working', stage: 'search', done: from + done * share },
      }))
    patchWork(id, (current) => ({ ...current, search: { status: 'working', stage: 'search', done: 0 } }))
    const neighbour = neighbourFirst ? neighbourOf(photo) : null
    // The colour reader first; when its fit does not settle it, the brightness readers side by side (each search runs
    // in a worker of its own), keeping the result that fits best (`searchRank`). They read a sky the colour reader
    // cannot: lit from behind, under dark cloud, in haze.
    const full = neighbour ? 0.8 : 1
    type Tried = { result: WideSearchResult; skyline: Array<{ x: number; y: number } | null>; reader: SkylineReader }
    const tryReader = async (reader: SkylineReader, onProgress: (done: number) => void): Promise<Tried | null> => {
      const skyline = skylineOf(photo, pixels, base, reader)
      if (skyline.filter(Boolean).length < MIN_SKYLINE_COLUMNS) return null
      // A line with no sky above it (a shadow's edge across forest) is not a skyline, however well a camera fits it.
      if (!believableSkyline(pixels, skylineRead(photo, pixels, reader))) return null
      const result = await runSearch(photo, base, profile, skyline, searchPriors, signal, onProgress, reader)
      return result ? { result, skyline, reader } : null
    }
    const [colourReader, ...others] = SKYLINE_READERS
    let chosen = await tryReader(colourReader, progress(0, full / 2))
    signal.throwIfAborted()
    if (!chosen || !(chosen.result.fit.trustworthy && chosen.result.fit.agreement >= READER_SETTLED_AGREEMENT)) {
      const share = full / 2
      const done = others.map(() => 0)
      const more = await Promise.all(
        others.map((reader, k) =>
          tryReader(reader, (value) => {
            done[k] = value
            progress(full / 2, share)(done.reduce((sum, each) => sum + each, 0) / others.length)
          }),
        ),
      )
      signal.throwIfAborted()
      // In the readers' order, so a tie keeps the earlier reader.
      for (const tried of more)
        if (tried && (!chosen || searchRank(tried.result) > searchRank(chosen.result))) chosen = tried
    }
    // A "best" heading with next to no column on the terrain's skyline is no fit at all: it once came back as the
    // best fit with 0 columns, 140° from the camera.
    if (!chosen || chosen.result.fit.agreeing < MIN_SKYLINE_COLUMNS)
      return stop('Too little open sky over distant terrain to search by. Pair points instead.', {
        lens: photo.lens,
        terrain: true,
        skyline: false,
        highGround,
        notes: highGround && fixAltitude !== null ? [highGroundNote(highGround, fixAltitude)] : [],
      })
    const found = chosen.result
    let narrowFit: NarrowFit | null = null
    if (neighbour) {
      const narrow = await runSearch(
        photo,
        base,
        profile,
        chosen.skyline,
        neighbourPriors(neighbour.photo.pose),
        signal,
        progress(full, 1 - full),
        chosen.reader,
      )
      const agrees = narrowAgreement(narrow, neighbour.photo.pose.bearing)
      if (narrow && agrees)
        narrowFit = {
          bearing: narrow.bearing,
          pitch: narrow.pitch,
          roll: narrow.roll,
          ...(narrow.hfov !== undefined ? { hfov: narrow.hfov } : {}),
          ...agrees,
          skyColumns: narrow.fit.agreeing,
          skySpanShare: narrow.fit.span,
        }
    }
    signal.throwIfAborted()
    const result = found
    const utc = utcOf(photo)
    const at = (angles: { bearing: number; pitch: number; roll: number; hfov?: number }) =>
      sunCheck(cameraOf(photo, terrain, angles), utc!)
    const recorded = photo.exif?.heading?.degrees ?? null
    const notes: string[] = []
    if (lifted !== null)
      notes.push(
        `Taken from the air: its GPS altitude is ${Math.round(lifted - groundMeters)} m above the ground, so the eye stands at ${Math.round(lifted)} m.`,
      )
    if (highGround && fixAltitude !== null) notes.push(highGroundNote(highGround, fixAltitude))
    if (chosen.reader.mode === 'luma')
      notes.push(
        'The sky is lit from behind or hazy: the skyline was read from where the picture darkens, not from the sky’s colour.',
      )
    if (photo.lens?.cropped && result.hfov !== undefined)
      notes.push(`Cropped: the lens that fits best is ${result.hfov.toFixed(0)}° across.`)
    patchWork(id, (current) => ({
      ...current,
      search: {
        status: 'done',
        result,
        sun: utc ? { best: at(result), runnerUp: result.runnerUp ? at(result.runnerUp) : null } : null,
        recordedOffBy: recorded === null ? null : ((recorded - result.bearing + 540) % 360) - 180,
        seconds: (performance.now() - t0) / 1000,
        neighbour: neighbour
          ? {
              id: neighbour.photo.id,
              name: neighbour.photo.name,
              gapSeconds: neighbour.gapSeconds,
              narrow: narrowFit,
            }
          : null,
      },
      found: { lens: photo.lens, terrain: true, skyline: true, notes, highGround },
    }))
    if (setPose)
      patchPhoto(id, (current) => {
        if (
          setPose === 'if-automatic' &&
          (!queueMaySetPose(current.sources, result.hfov !== undefined) ||
            current.pose.lng !== photo.pose.lng ||
            current.pose.lat !== photo.pose.lat ||
            current.pose.eyeHeightMeters !== photo.pose.eyeHeightMeters ||
            current.pose.hfov !== photo.pose.hfov ||
            (current.pose.altitudeMeters ?? null) !== (photo.pose.altitudeMeters ?? null))
        )
          return current
        return {
          ...current,
          pose: {
            ...current.pose,
            bearing: result.bearing,
            pitch: result.pitch,
            roll: result.roll,
            ...(result.hfov !== undefined ? { hfov: clampFov(result.hfov) } : {}),
          },
          sources: {
            ...current.sources,
            heading: 'skyline',
            pitch: 'skyline',
            roll: 'skyline',
            ...(result.hfov !== undefined ? { fov: 'skyline' as const } : {}),
          },
        }
      })
    return { result, terrain, pixels }
  }

  /**
   * Draws a model view for a photo at `angles` in the worker and scores it. Drawn on the reviewer's request it is a
   * check for that camera; drawn by the queue (`check: false`) nobody has looked at it yet, so it opens no gate.
   */
  const drawModelView = async (
    id: string,
    which: PhotoModelViewKind,
    angles: { bearing: number; pitch: number; roll: number; hfov?: number },
    signal: AbortSignal,
    onProgress?: (done: number) => void,
    { check = true, preview = false }: { check?: boolean; preview?: boolean } = {},
  ) => {
    const photo = photoById(id)
    if (!photo || !positioned(photo)) return null
    const terrain = await loadOwnTerrain(photo.pose.lng, photo.pose.lat, signal)
    const [layers, pixels] = await Promise.all([
      imageryLayers(photo.pose.lng, photo.pose.lat, signal),
      readPixels(photo),
    ])
    const pose = cameraOf(photo, terrain, angles)
    const { image: drawn, agreement } = await renderPhotoModelView(
      {
        pose,
        terrain: specOf(photo),
        imagery: { key: imageryKey(photo.pose.lng, photo.pose.lat), value: layers },
        photo: { key: photo.src, value: pixels },
        width: preview ? 180 : MODEL_VIEW_WIDTH,
        maxMeters: WIDE_RADIUS_METERS,
      },
      signal,
      (_, done) => onProgress?.(done),
    )
    if (signal.aborted) return null
    const checkedPose = acceptancePoseOf(photo, { ...angles, hfov: angles.hfov ?? photo.pose.hfov })!
    const view: ModelViewImage = {
      url: rgbaDataUrl(drawn),
      bearing: pose.bearing,
      score: agreement?.score ?? Number.NaN,
      coverage: agreement?.coverage ?? 0,
      pose: checkedPose,
      poseKey: photoPoseKey(pose),
    }
    patchWork(id, (current) =>
      preview
        ? { ...current, previewModel: view }
        : {
            ...current,
            modelViews: { ...current.modelViews, [which]: view },
            checked:
              check && Number.isFinite(view.score) ? withCheckedPose(current.checked, checkedPose) : current.checked,
          },
    )
    return view
  }

  /**
   * An option's camera as the photo would stand at it: the pose *Use* gives the photo (`useOption`), so what is cast
   * and drawn for it ahead is found again under the same key once it is the camera.
   */
  const optionCamera = async (photo: OwnPhoto, option: AcceptancePose, signal: AbortSignal) => {
    // An eye at an altitude needs no ground under it, so another photo's terrain is not loaded onto this thread.
    const ground =
      option.altitudeMeters === null
        ? (await loadOwnTerrain(option.lng, option.lat, signal)).elevationAt(option.lng, option.lat)
        : 0
    const pose = ownPhotoPose(
      { ...photo.pose, ...option, hfov: clampFov(option.hfov) },
      ground,
      photo.width,
      photo.height,
    )
    return Number.isFinite(pose.altitudeMeters)
      ? { pose, terrain: photoTerrainSpec(option.lng, option.lat, PHOTO_TERRAIN_RINGS) }
      : null
  }

  /**
   * Draws the model view for one of a photo's option cameras ahead of any click, quietly: no busy line, no check
   * recorded. A tenth of a second or so in the worker once the place's imagery is held.
   */
  const drawOptionView = async (id: string, option: AcceptancePose, signal: AbortSignal) => {
    const photo = photoById(id)
    if (!photo) return
    const camera = await optionCamera(photo, option, signal)
    if (!camera) return
    const [layers, pixels] = await Promise.all([imageryLayers(option.lng, option.lat, signal), readPixels(photo)])
    const { image: drawn, agreement } = await renderPhotoModelView(
      {
        pose: camera.pose,
        terrain: camera.terrain,
        imagery: { key: imageryKey(option.lng, option.lat), value: layers },
        photo: { key: photo.src, value: pixels },
        width: MODEL_VIEW_WIDTH,
        maxMeters: WIDE_RADIUS_METERS,
      },
      signal,
    )
    if (signal.aborted) return
    const view: ModelViewImage = {
      url: rgbaDataUrl(drawn),
      bearing: camera.pose.bearing,
      score: agreement?.score ?? Number.NaN,
      coverage: agreement?.coverage ?? 0,
      pose: option,
      poseKey: photoPoseKey(camera.pose),
    }
    patchWork(id, (current) => ({
      ...current,
      optionViews: { ...current.optionViews, [optionViewKey(option)]: view },
    }))
  }

  /**
   * The features check for a photo's camera: what the camera sees (`photoSeenBounds` of its hit buffer), then lakes,
   * roads and recent cutblocks read for that box, which can lie 5–30 km past the scene's own data.
   */
  const checkFeatures = async (
    id: string,
    angles: { bearing: number; pitch: number; roll: number; hfov?: number },
    signal: AbortSignal,
  ) => {
    const photo = photoById(id)
    if (!photo || !positioned(photo)) return
    const terrain = await loadOwnTerrain(photo.pose.lng, photo.pose.lat, signal)
    const pose = cameraOf(photo, terrain, angles)
    const poseKey = photoPoseKey(pose)
    patchWork(id, (current) => ({ ...current, features: { status: 'loading', poseKey } }))
    try {
      const buffer = await caches.hits.getOrCreate(
        poseKey,
        (shared) => castPhotoHits({ pose, terrain: specOf(photo) }, shared),
        signal,
      )
      const bounds = photoSeenBounds(buffer)
      const reads = bounds
        ? await caches.features.getOrCreate(
            featuresKey(bounds),
            (shared) => readPhotoFeatures(bounds, inventoryFetch, { signal: shared }),
            signal,
          )
        : null
      patchWork(id, (current) => ({ ...current, features: { status: 'ready', poseKey, bounds, reads } }))
    } catch (error) {
      if (aborted(signal)) throw error
      patchWork(id, (current) => ({
        ...current,
        features: { status: 'failed', poseKey, message: `The features were not read: ${reason(error)}` },
      }))
    }
  }

  const addNote = (id: string, note: string) =>
    patchWork(id, (current) => ({
      ...current,
      found: { ...current.found, notes: [...(current.found?.notes ?? []), note] },
    }))

  /** One photo through the queue: the search, then model views for the winner and the runner-up. */
  const runPhoto = async (id: string, signal: AbortSignal) => {
    const photo = photoById(id)
    if (!photo) return
    try {
      const stage = await searchStage(id, { searchPriors: {}, neighbourFirst: true, setPose: 'if-automatic' }, signal)
      if (!stage) return
      const { result } = stage
      const winner = { bearing: result.bearing, pitch: result.pitch, roll: result.roll, hfov: result.hfov }
      try {
        await drawModelView(id, 'winner', winner, signal, undefined, { check: false })
        if (result.runnerUp)
          await drawModelView(
            id,
            'runner-up',
            { ...result.runnerUp, hfov: result.runnerUp.hfov ?? result.hfov },
            signal,
            undefined,
            {
              check: false,
            },
          )
      } catch (error) {
        if (aborted(signal)) throw error
        addNote(id, `The model views were not drawn: ${reason(error)}`)
      }
      // The features are read after the searches (`featuresNext`, below), never between two of them.
    } catch (error) {
      if (aborted(signal)) {
        patchWork(id, (current) =>
          current.search.status === 'working' ? { ...current, search: { status: 'idle' } } : current,
        )
        return
      }
      patchWork(id, (current) => ({
        ...current,
        search: { status: 'failed', message: `The camera search stopped: ${reason(error)}` },
        found: { ...current.found, stopped: reason(error) },
      }))
    }
  }
  const runPhotoRef = useRef(runPhoto)
  runPhotoRef.current = runPhoto

  // The queue: one photo at a time, in time order, without being asked. It lives here, not in the window, because the
  // window is unmounted while hidden.
  const queueAbort = useRef<AbortController | null>(null)
  // A layout effect, so the next photo is running before the frame that ends the last one is painted: as a plain
  // effect the window showed "12 waiting" with no Cancel for a frame between every two photos.
  useLayoutEffect(() => {
    if (queueRun.running || queueRun.paused || !queueRun.pending.length) return
    const id = nextInQueue(queueRun.pending, photosRef.current)
    if (!id) {
      // Only photos removed since they were queued are left.
      setQueueRun((current) => ({ ...current, pending: [] }))
      return
    }
    const controller = new AbortController()
    queueAbort.current = controller
    const started = generation.current
    setQueueRun((current) => ({ ...current, running: id, pending: current.pending.filter((other) => other !== id) }))
    void runPhotoRef.current(id, controller.signal).finally(() => {
      if (queueAbort.current === controller) queueAbort.current = null
      if (started !== generation.current) return
      setQueueRun((current) => (current.running === id ? { ...current, running: null } : current))
    })
  }, [queueRun])
  useEffect(() => () => queueAbort.current?.abort(), [])
  const enqueue = useCallback((ids: string[]) => {
    if (!ids.length) return
    setQueueRun((current) => ({
      ...current,
      cancelled: false,
      pending: [...current.pending, ...ids.filter((id) => !current.pending.includes(id) && id !== current.running)],
    }))
  }, [])

  // The features check, after the searches: one read at a time, the open photo first and at once, the others in time
  // order once every search is done. A read is six requests and megabytes of shapes from DataBC; run inside the queue it
  // held the next photo's search back about three seconds, fourteen times over.
  const [featuresRunning, setFeaturesRunning] = useState<string | null>(null)
  const featuresAbort = useRef<AbortController | null>(null)
  const checkFeaturesRef = useRef(checkFeatures)
  checkFeaturesRef.current = checkFeatures
  /**
   * Compares cameras for a photo its skyline did not settle, as *Combined camera search* does on a click: ground
   * appearance for the options and a coarse sweep of headings, and depth where this browser already holds the model
   * or the photo's estimate. It never starts a model download. The result is a suggestion on the photo, never its
   * camera.
   */
  const compareUnsettled = async (id: string, signal: AbortSignal) => {
    const photo = photoById(id)
    const usesDepth =
      !!photo &&
      (caches.depth.get(`${photo.src}|${AUTO_DEPTH_MODEL}`) !== undefined || (await depthModelStored(AUTO_DEPTH_MODEL)))
    const result = await runCombinedCameraSearch(
      id,
      { useSkyline: true, depthModel: usesDepth ? AUTO_DEPTH_MODEL : null },
      signal,
      () => undefined,
    )
    patchWork(id, (current) => ({ ...current, combined: { result, depth: !!result.depthModel } }))
  }
  const compareRef = useRef(compareUnsettled)
  compareRef.current = compareUnsettled
  useEffect(() => {
    if (featuresRunning) return
    const id = featuresNext({
      photos: photos.map((photo) => ({
        id: photo.id,
        takenAtUtc: photo.takenAtUtc,
        name: photo.name,
        positioned: positioned(photo),
        searched: (work[photo.id] ?? EMPTY_WORK).search.status === 'done' || unsettled(work[photo.id] ?? EMPTY_WORK),
        // Done once its features are read and, where the skyline did not settle it, its cameras are compared.
        read: followedUp(work[photo.id] ?? EMPTY_WORK),
      })),
      activeId,
      searching: !!queueRun.running || queueRun.pending.length > 0,
      held: queueRun.paused || queueRun.cancelled,
    })
    const photo = id ? photoById(id) : null
    if (!id || !photo) return
    const controller = new AbortController()
    featuresAbort.current = controller
    setFeaturesRunning(id)
    const before = work[id] ?? EMPTY_WORK
    const follow = async () => {
      if (before.features === null && before.search.status === 'done')
        await checkFeaturesRef.current(
          id,
          { bearing: photo.pose.bearing, pitch: photo.pose.pitch, roll: photo.pose.roll },
          controller.signal,
        )
      if (before.combined === undefined && unsettled(before)) await compareRef.current(id, controller.signal)
    }
    void follow()
      .catch((error: unknown) => {
        // Stopped because the photo went or the set was cleared: nothing is left to mark.
        if (controller.signal.aborted || !photoById(id)) return
        // Anything else (the terrain did not load) is kept as failed, or the photo would be tried again without end.
        patchWork(id, (current) => ({
          ...current,
          features:
            current.features && current.features.status !== 'loading'
              ? current.features
              : { status: 'failed', poseKey: '', message: `The features were not read: ${reason(error)}` },
          // Tried, and it could not be made: never tried again by itself.
          combined: current.combined === undefined ? null : current.combined,
        }))
      })
      .finally(() => {
        if (featuresAbort.current === controller) featuresAbort.current = null
        setFeaturesRunning((current) => (current === id ? null : current))
      })
    // The read takes the photo by id; its caches and work updater are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featuresRunning, photos, work, activeId, queueRun])
  useEffect(() => () => featuresAbort.current?.abort(), [])

  // ---------------------------------------------------------------------------------------------------------------
  // The options card, acceptance and the photo's jobs.

  const runFlightMatch = async (flightId: string) => {
    if (flightMatchAbort.current) return
    const group = photosRef.current.filter((photo) => photo.flightId === flightId)
    const byId = new Map(group.map((photo) => [photo.id, photo]))
    const frames = group.map(flightFrameOf)
    const { pairs } = planFlightMatches(frames, flightId)
    if (!pairs.length) return
    const controller = new AbortController()
    const { signal } = controller
    flightMatchAbort.current = controller
    const pairedBy = flightMatcher
    let progress: FlightMatchProgress = {
      flightId,
      matcher: pairedBy,
      phase: 'matching',
      total: pairs.length,
      attempted: 0,
      overlapping: 0,
      failed: 0,
    }
    const publish = (patch: Partial<FlightMatchProgress>) => {
      progress = { ...progress, ...patch }
      if (flightMatchAbort.current === controller) setFlightMatchProgress(progress)
    }
    publish({})
    const sent = new Set<string>()
    const proposals = new Map<string, FlightCameraProposal[]>()
    let matcher: ReturnType<typeof openPhotoFeatureMatcher> | null = null
    try {
      matcher = openPhotoFeatureMatcher(signal)
      for (const { referenceId, targetId } of pairs) {
        signal.throwIfAborted()
        const reference = byId.get(referenceId)!
        const target = byId.get(targetId)!
        const accepted = flightAnchor(flightFrameOf(reference))!
        const targetPose = acceptancePoseOf(target)!
        publish({ targetName: target.name })
        try {
          const [refPixels, targetPixels] = await Promise.all([readPixels(reference), readPixels(target)])
          const requestFrame = (photo: OwnPhoto, pixels: ImageData) => ({
            key: photo.id,
            pixels: sent.has(photo.id) ? undefined : pixels,
          })
          const overlap = await matcher.match({
            reference: requestFrame(reference, refPixels),
            target: requestFrame(target, targetPixels),
            focalRatio: Math.tan((accepted.pose.hfov * Math.PI) / 360) / Math.tan((targetPose.hfov * Math.PI) / 360),
            matcher: pairedBy,
          })
          sent.add(referenceId)
          sent.add(targetId)
          if (!overlap.matches.length) continue
          progress = { ...progress, overlapping: progress.overlapping + 1 }
          const frame = (photo: OwnPhoto, pose: AcceptancePose, { width, height }: ImageData) => ({
            pose,
            width,
            height,
            eyeHeightMeters: photo.pose.eyeHeightMeters,
          })
          const { transfer, relative, airborne } = await transferPhotoCamera(
            {
              reference: frame(reference, accepted.pose, refPixels),
              target: {
                ...frame(target, targetPose, targetPixels),
                gpsAltitudeMeters:
                  target.sources.eyeHeight === 'default'
                    ? (target.exif?.altitudeMeters ?? target.recordAltitudeMeters)
                    : null,
              },
              matches: overlap.matches,
              terrain: specOf({ pose: accepted.pose }),
            },
            signal,
          )
          const terrain = transfer.status === 'candidate' && transfer.pose ? transfer : null
          const solved = terrain?.pose ?? relative?.pose
          const held = terrain ? (terrain.model === 'adjusted' ? terrain.adjusted : terrain.fixed) : relative
          if (!solved || !held) continue
          const { lng, lat, altitudeMeters, bearing, pitch, roll, hfov } = solved
          const proposal: FlightCameraProposal = {
            referenceId,
            referenceName: reference.name,
            acceptedAt: accepted.acceptedAt,
            referencePose: accepted.pose,
            referenceEyeHeight: reference.pose.eyeHeightMeters,
            pose: {
              lng,
              lat,
              altitudeMeters: airborne ? altitudeMeters : null,
              bearing,
              pitch,
              roll,
              hfov,
            },
            basis: terrain ? 'terrain' : 'image',
            matches: overlap.matches.length,
            controls: terrain?.controls ?? relative!.controls,
            medianPx: held.medianPx,
            p90Px: held.p90Px,
            matcher: pairedBy,
          }
          const list = proposals.get(targetId) ?? []
          list.push(proposal)
          proposals.set(targetId, list)
        } catch (error) {
          signal.throwIfAborted()
          progress = { ...progress, failed: progress.failed + 1, message: reason(error) }
        } finally {
          if (!signal.aborted) publish({ attempted: progress.attempted + 1 })
        }
      }
      signal.throwIfAborted()
      if (progress.failed === progress.total) {
        publish({ phase: 'failed' })
        return
      }
      const livePhotos = new Map(photosRef.current.map((photo) => [photo.id, photo]))
      const live = new Map([...livePhotos.values()].map((photo) => [photo.id, flightFrameOf(photo)]))
      setWork((current) => {
        const next = { ...current }
        for (const original of frames) {
          const target = live.get(original.id)
          const autoLifted =
            original.pose?.altitudeMeters === null &&
            byId.get(original.id)?.sources.eyeHeight === 'default' &&
            livePhotos.get(original.id)?.sources.eyeHeight === 'exif'
          if (
            target?.flightId !== flightId ||
            flightAnchor(target) ||
            !original.pose ||
            !target.pose ||
            target.eyeHeightMeters !== original.eyeHeightMeters ||
            !sameCamera(original.pose, {
              ...target.pose,
              altitudeMeters: autoLifted ? original.pose.altitudeMeters : target.pose.altitudeMeters,
              bearing: original.pose.bearing,
              pitch: original.pose.pitch,
              roll: original.pose.roll,
            })
          )
            continue
          const options = (proposals.get(original.id) ?? [])
            .filter((proposal) => currentFlightProposal(proposal, live.get(proposal.referenceId), flightId))
            .sort(compareFlightProposals)
          next[original.id] = { ...(current[original.id] ?? EMPTY_WORK), flightProposals: options.slice(0, 3) }
        }
        return next
      })
      publish({ phase: 'done' })
    } catch (error) {
      publish(signal.aborted ? { phase: 'cancelled' } : { phase: 'failed', message: reason(error) })
    } finally {
      matcher?.close()
      if (flightMatchAbort.current === controller) flightMatchAbort.current = null
    }
  }

  /** The candidate cameras for a photo (`photoOptions`), ranked by the evidence behind each. */
  const optionsFor = useCallback(
    (id: string): PhotoOption[] => {
      const photo = photos.find((entry) => entry.id === id)
      if (!photo || !positioned(photo)) return []
      const w = work[id] ?? EMPTY_WORK
      const search = w.search.status === 'done' ? w.search : null
      const airborne = photo.pose.altitudeMeters != null
      const heading = photo.exif?.heading
      const tilt = photo.exif?.tilt
      const neighbour = (() => {
        const near = neighbourOf(photo)
        return near
          ? {
              id: near.photo.id,
              label: near.photo.name,
              gapSeconds: near.gapSeconds,
              distanceMeters: near.distanceMeters,
              pose: near.photo.pose,
            }
          : null
      })()
      const solve = w.controlSolve
      const heldOut = solve?.pairs.flatMap((pair) => (pair.heldOutPx === null ? [] : [pair.heldOutPx])) ?? []
      const matched = photo.matched?.camera
      const enabled = w.pairs.filter((pair) => !w.pairsOff?.includes(pair.id))
      const ground = w.pairGround
      const landmark =
        enabled.length === 1 && ground?.lng === photo.pose.lng && ground.lat === photo.pose.lat
          ? orientFromLandmark(ownPhotoPose(photo.pose, ground.elevation, photo.width, photo.height), enabled[0])
          : null
      const input: PhotoOptionsInput = {
        base: {
          lng: photo.pose.lng,
          lat: photo.pose.lat,
          altitudeMeters: photo.pose.altitudeMeters ?? null,
          hfov: photo.pose.hfov,
        },
        search: search ? { result: search.result, sun: search.sun } : null,
        modelScores: photoModelViews(w).flatMap((view) =>
          Number.isFinite(view.score) ? [{ pose: view.pose, score: view.score }] : [],
        ),
        phone: heading
          ? {
              bearing:
                photo.headingReference === 'true'
                  ? heading.degrees
                  : trueHeadingFromMagnetic(heading.degrees, photo.declinationEast ?? 0),
              reference: heading.reference,
              pitch: tilt && Math.abs(tilt.g - 1) <= 0.05 ? tilt.pitch : null,
              airborne,
            }
          : null,
        highGround:
          w.found?.highGround && (photo.sources.position === 'exif' || photo.sources.position === 'gps-altitude')
            ? w.found.highGround
            : null,
        neighbour,
        narrow: search?.neighbour?.narrow
          ? {
              pose: search.neighbour.narrow,
              neighbourId: search.neighbour.id,
              label: search.neighbour.name,
              agreesDegrees: search.neighbour.narrow.agreesDegrees,
              agreeShare: search.neighbour.narrow.agreeShare,
              skyColumns: search.neighbour.narrow.skyColumns,
              skySpanShare: search.neighbour.narrow.skySpanShare,
            }
          : null,
        landmark: landmark && { ...landmark, roll: photo.pose.roll },
        points: solve
          ? {
              pose: {
                lng: solve.pose.lng,
                lat: solve.pose.lat,
                altitudeMeters: airborne ? solve.pose.altitudeMeters : null,
                bearing: wrapHeading(solve.pose.bearing),
                pitch: solve.pose.pitch,
                roll: solve.pose.roll,
                hfov: solve.pose.hfov,
              },
              pairs: solve.pairs.length,
              worstPairPixels: heldOut.length ? Math.max(...heldOut) : null,
              heldOutMeters: solve.heldOutMetresMax,
              photoWidth: photo.width,
              suspect: controlSolveSuspect(solve),
            }
          : null,
        matched: matched && photo.matched ? { camera: matched, checks: photo.matched.checks } : null,
        flightProposals: w.flightProposals?.filter((proposal) => {
          const reference = photos.find((entry) => entry.id === proposal.referenceId)
          return currentFlightProposal(proposal, reference && flightFrameOf(reference), photo.flightId)
        }),
      }
      return photoOptions(input)
    },
    // neighbourOf reads the photos through their ref, which `photos` keeps current.
    [photos, work],
  )

  /** Compare several cameras without moving or checking the active camera. */
  /**
   * A photo's depth by a model: the estimate kept for it (in memory, else in this browser's database), else a fresh
   * one, which is then kept. The estimate is the same every time, and costs a model load and a second or more.
   */
  const photoDepthFor = (photo: OwnPhoto, pixels: ImageData, model: PhotoDepthModel, signal: AbortSignal) =>
    caches.depth.getOrCreate(
      `${photo.src}|${model}`,
      async (shared) => {
        const stored = photo.recordId ? await loadPhotoDepth(photo.recordId, model).catch(() => null) : null
        if (stored) return { width: stored.width, height: stored.height, inverse: stored.inverse }
        const depth = await estimatePhotoDepth(pixels, model, shared)
        if (photo.recordId) void savePhotoDepth(photo.recordId, model, depth).catch(() => undefined)
        return depth
      },
      signal,
    )

  const runCombinedCameraSearch = async (
    id: string,
    settings: CombinedSettings,
    signal: AbortSignal,
    onProgress: (message: string) => void,
  ) => {
    const target = photoById(id)
    const current = target && acceptancePoseOf(target)
    if (!target || !current || !positioned(target)) throw Error('Set an approximate camera position first.')
    onProgress('Loading terrain and imagery…')
    const { lng, lat } = current
    const [terrain, pixels, imagery] = await Promise.all([
      loadOwnTerrain(lng, lat, signal),
      readPixels(target),
      imageryLayers(lng, lat, signal).catch(() => []),
    ])
    signal.throwIfAborted()
    return comparePhotoCameras({
      settings,
      current,
      options: optionsFor(id),
      overlapP90: target.matched?.camera?.overlapP90Px ?? null,
      photoWidth: target.width,
      eyeHeightMeters: target.pose.eyeHeightMeters,
      terrain,
      terrainSpec: specOf(target),
      pixels: { key: target.src, value: pixels },
      // No imagery (offline) is a key of its own, so the worker never keeps an empty set under the place's key.
      imagery: { key: imagery.length ? imageryKey(lng, lat) : `${imageryKey(lng, lat)}|none`, value: imagery },
      signal,
      onProgress,
      depthFor: (model, depthSignal) => photoDepthFor(target, pixels, model, depthSignal),
    })
  }

  /** Uses an options row: the photo's camera becomes that row's, each value marked as found that way. */
  const useOption = useCallback(
    (id: string, rowId: string) => {
      const row = optionsFor(id).find((option) => option.id === rowId)
      if (!row) return false
      const sources = sourcesForOption(row.kind)
      patchPhoto(id, (photo) => {
        const moves = !!sources.position
        return {
          ...photo,
          pose: {
            ...photo.pose,
            bearing: row.pose.bearing,
            pitch: row.pose.pitch,
            roll: row.pose.roll,
            hfov: clampFov(row.pose.hfov),
            ...(moves
              ? {
                  lng: row.pose.lng,
                  lat: row.pose.lat,
                  altitudeMeters: row.pose.altitudeMeters,
                }
              : {}),
          },
          sources: {
            ...photo.sources,
            heading: sources.heading,
            pitch: sources.pitch,
            roll: sources.roll ?? photo.sources.roll,
            ...(moves
              ? {
                  position: sources.position!,
                  fov: sources.keepsLens ? photo.sources.fov : sources.position!,
                  eyeHeight: sources.position!,
                }
              : {}),
            ...(!moves && photo.pose.hfov !== row.pose.hfov ? { fov: sources.heading } : {}),
          },
          chosen: { rowId: row.id, kind: row.kind, pose: row.pose, evidence: row.evidence },
        }
      })
      return true
    },
    [optionsFor, patchPhoto],
  )

  // Views drawn ahead for the options card, one photo at a time: the open photo's at once, the others' once nothing is
  // being searched or read, so the queue is never held back and a photo opened later already has its rows' views (a
  // score arriving after a photo opens can move its rows). Each option is tried once: a view that could not be drawn
  // leaves its row offering to draw it.
  const [viewsRunning, setViewsRunning] = useState<string | null>(null)
  const viewsTried = useRef(new Set<string>())
  const viewsAbort = useRef<AbortController | null>(null)
  const drawOptionViewRef = useRef(drawOptionView)
  drawOptionViewRef.current = drawOptionView
  const optionCameraRef = useRef(optionCamera)
  optionCameraRef.current = optionCamera
  useEffect(() => {
    if (viewsRunning) return
    const wanting = (photo: OwnPhoto) => {
      const w = work[photo.id] ?? EMPTY_WORK
      if (w.search.status === 'working') return []
      const views = photoModelViews(w)
      return optionsFor(photo.id).filter(
        (option) =>
          !views.some((view) => sameCamera(view.pose, option.pose)) &&
          !viewsTried.current.has(`${photo.id}|${optionViewKey(option.pose)}`),
      )
    }
    const open = photos.find((photo) => photo.id === activeId)
    const idle =
      !queueRun.running && !queueRun.pending.length && !queueRun.paused && !queueRun.cancelled && !featuresRunning
    const target =
      (open && wanting(open).length ? open : null) ??
      (idle ? photos.find((photo) => wanting(photo).length) : null) ??
      null
    if (!target) return
    const id = target.id
    const todo = wanting(target)
    const kept = new Set(optionsFor(id).map((option) => optionViewKey(option.pose)))
    const controller = new AbortController()
    viewsAbort.current = controller
    setViewsRunning(id)
    // Views of options that have gone (a solve made again, a neighbour no longer accepted) go with them.
    patchWork(id, (current) =>
      current.optionViews && Object.keys(current.optionViews).some((key) => !kept.has(key))
        ? {
            ...current,
            optionViews: Object.fromEntries(Object.entries(current.optionViews).filter(([key]) => kept.has(key))),
          }
        : current,
    )
    void (async () => {
      for (const option of todo) {
        if (controller.signal.aborted) return
        viewsTried.current.add(`${id}|${optionViewKey(option.pose)}`)
        try {
          await drawOptionViewRef.current(id, option.pose, controller.signal)
        } catch {
          /* No imagery, or the photo went: the row keeps its offer to draw the view. */
        }
      }
    })().finally(() => {
      if (viewsAbort.current === controller) viewsAbort.current = null
      setViewsRunning((current) => (current === id ? null : current))
    })
  }, [viewsRunning, photos, work, activeId, queueRun, featuresRunning, optionsFor, patchWork])
  useEffect(() => () => viewsAbort.current?.abort(), [])

  /** The camera the check images were drawn for, the one matching the camera as it stands when there is one. */
  const checksDrawnFor = useCallback(
    (id: string): AcceptancePose | null => {
      const photo = photos.find((entry) => entry.id === id)
      if (!photo) return null
      return checkedPoseFor((work[id] ?? EMPTY_WORK).checked, acceptancePoseOf(photo))
    },
    [photos, work],
  )
  /** Records that the checks over the photo (skyline and layers) were drawn and shown for its camera as it stands. */
  const markChecked = useCallback(
    (id: string) => {
      const photo = photoById(id)
      const pose = photo && acceptancePoseOf(photo)
      if (pose) patchWork(id, (current) => ({ ...current, checked: withCheckedPose(current.checked, pose) }))
    },
    [patchWork],
  )
  /** Whether a photo's camera is accepted, and whether it has moved since (the acceptance then lapses). */
  const acceptanceState = useCallback(
    (id: string): 'none' | 'accepted' | 'lapsed' => {
      const photo = photos.find((entry) => entry.id === id)
      if (!photo?.acceptance) return 'none'
      const pose = acceptancePoseOf(photo)
      return pose && !acceptanceLapsed(photo.acceptance, pose) ? 'accepted' : 'lapsed'
    },
    [photos],
  )

  /**
   * Accepts a photo's camera as it stands (`makePhotoAcceptance`): the checks must have been drawn for this camera,
   * a point solve's held-out pair must land, a fit that is not settled needs a note, and initials are typed. Written
   * to its field record with the camera.
   */
  const acceptCamera = useCallback(
    (
      id: string,
      { initials, note }: { initials: string; note: string },
    ): { ok: true; acceptance: PhotoAcceptance } | { ok: false; reason: string } => {
      const photo = photos.find((entry) => entry.id === id)
      const pose = photo && acceptancePoseOf(photo)
      if (!photo || !pose) return { ok: false, reason: 'Set where the photo was taken first.' }
      const bridge = records?.current
      if (!photo.recordId || !bridge)
        return {
          ok: false,
          reason: 'This photo is not in the workspace’s field records, so an acceptance has nowhere to be kept.',
        }
      // The same rule the window shows before the click (`acceptanceSource`).
      const { method, evidence } = acceptanceSource({
        pose,
        chosen: photo.chosen,
        rows: optionsFor(id),
        headingSource: photo.sources.heading,
      })
      const made = makePhotoAcceptance(
        {
          pose,
          checkedPose: checksDrawnFor(id),
          method,
          evidence,
          note,
          initials,
          photoWidth: photo.width,
        },
        new Date(),
      )
      if (!made.ok) return made
      const { acceptance } = made
      bridge.updateFieldRecord(photo.recordId, {
        acceptance,
        lng: acceptance.pose.lng,
        lat: acceptance.pose.lat,
        altitude: acceptance.pose.altitudeMeters,
        bearing: Math.round(acceptance.pose.bearing * 10) / 10,
        pitch: Math.round(acceptance.pose.pitch * 100) / 100,
        roll: Math.round(acceptance.pose.roll * 100) / 100,
        hfov: Math.round(acceptance.pose.hfov * 10) / 10,
      })
      patchPhoto(id, (current) => ({ ...current, acceptance }))
      return made
    },
    [photos, optionsFor, checksDrawnFor, records, patchPhoto],
  )

  /**
   * The photo's acceptance for a job that draws from its camera: the one it has while the camera is still the one
   * accepted, else one made now, by this click, for the camera as it stands. A reviewer never has to visit an
   * acceptance form before putting a photo to use; the record still says when and on what evidence.
   */
  const ensureAccepted = useCallback(
    (
      id: string,
      fields: { initials: string; note: string } = { initials: '', note: '' },
    ): { ok: true; acceptance: PhotoAcceptance } | { ok: false; reason: string } => {
      const photo = photos.find((entry) => entry.id === id)
      if (photo?.acceptance && acceptanceState(id) === 'accepted') return { ok: true, acceptance: photo.acceptance }
      return acceptCamera(id, fields)
    },
    [photos, acceptanceState, acceptCamera],
  )

  /** Links a photo to a job, or takes it off one, on its record and here. */
  const setJob = useCallback(
    (id: string, job: PhotoJob, on: boolean, targetId: string | null = null) => {
      const photo = photoById(id)
      if (!photo) return
      if (photo.recordId) records?.current?.setPhotoJob(photo.recordId, job, on, targetId)
      patchPhoto(id, (current) => ({ ...current, uses: withPhotoUse(current.uses, job, on, targetId) }))
    },
    [records, patchPhoto],
  )

  /**
   * Makes a photo's camera a view of interest (`viewFromAcceptedPhoto`), or updates the one it already made, and
   * links the photo to it as a viewpoint. A camera not yet accepted is accepted by this click (`ensureAccepted`).
   */
  const makeViewpoint = useCallback(
    (
      id: string,
      fields?: { initials: string; note: string },
    ): { ok: true; viewId: string; added: boolean } | { ok: false; reason: string } => {
      const photo = photos.find((entry) => entry.id === id)
      if (!photo) return { ok: false, reason: 'That photo is no longer open.' }
      const set = callbacks.current.setViewsOfInterest
      if (!set) return { ok: false, reason: 'Views of interest cannot be listed from here.' }
      if (!photo.recordId) return { ok: false, reason: 'The photo is not in the workspace’s field records.' }
      const accepted = ensureAccepted(id, fields)
      if (!accepted.ok) return accepted
      const link = viewFromAcceptedPhoto(
        { id: photo.recordId, name: photo.name, acceptance: accepted.acceptance },
        sceneRef.current,
        acceptancePoseOf(photo),
      )
      if (link.kind === 'none') return { ok: false, reason: link.reason }
      const { view } = link
      if (link.kind === 'add') set((views) => [...views, view])
      else set((views) => views.map((other) => (other.id === view.id ? view : other)))
      setJob(id, 'viewpoint', true, view.id)
      return { ok: true, viewId: view.id, added: link.kind === 'add' }
    },
    [photos, setJob, ensureAccepted],
  )

  // ---------------------------------------------------------------------------------------------------------------
  // Opening photos.

  /**
   * Reads one picked file: decoded, its tags, its lens and time, its starting pose and its record. `recordFor` names
   * the record the photo already is, once its name and time are read: it is then opened as that record (its id, the
   * camera it holds, its acceptance and jobs) and `existing` says so, so no second record is filed.
   */
  const readOwnFile = async (
    file: File,
    roadView: RoadViewPose | null,
    saved: SavedOwnPhoto | null,
    onDecoding: () => void,
    recordFor?: (found: { name: string; takenAtUtc: string | null }) => FieldRecord | null,
  ): Promise<{ photo: OwnPhoto; record: FieldRecord; existing: FieldRecord | null }> => {
    if (file.size > OWN_PHOTO_MAX_BYTES) throw new Error('Use a photo smaller than 25 MB.')
    let src: string | null = null
    try {
      // A HEIC photo is shown by Safari and decoded here everywhere else; its tags are read from the file itself.
      const shown = await showablePhoto(file, { onDecoding })
      src = URL.createObjectURL(shown.blob)
      let tags: Record<string, unknown> | null = null
      try {
        const exifr = await import('exifr')
        tags =
          ((await exifr.parse(file, { translateValues: false, makerNote: true })) as
            | Record<string, unknown>
            | undefined) ?? null
      } catch {
        /* No readable EXIF: every value starts from the road view. */
      }
      const size = await decodeImage(src)
      const exif = readExif(tags, size)
      const lens = tags ? lensCheck({ exif: tags, decodedWidth: size.width, decodedHeight: size.height }) : null
      const taken = takenAtUtc(tags)
      const existing = saved ? null : (recordFor?.({ name: file.name, takenAtUtc: taken?.iso ?? null }) ?? null)
      // A record's camera comes first, as it does for its stored copy; the EXIF fills what the record does not hold.
      const read = startingPose({ exif, record: existing, roadView, eyeHeightMeters })
      const start = existing ? fromAcceptedAltitude(read, existing) : read
      const id = saved?.recordId ?? existing?.id ?? createId('field')
      const pose = saved?.pose ?? start.pose
      const sources = saved ? ownSourcesOnReopen(saved, start) : start.sources
      const recordImage = await fieldImageFromBlob(shown.blob)
      const record = photoRecordFromOwn({
        id,
        name: file.name,
        image: recordImage,
        exif,
        pose,
        sources,
        headingTrue: start.headingReference === 'true',
        focal35Mm: lens?.focal35Mm ?? null,
        takenAtUtc: taken?.iso ?? null,
      })
      const photo: OwnPhoto = {
        id,
        name: file.name.slice(0, 200),
        src,
        thumb: recordImage.thumb,
        clock: cameraClockTime(tags),
        objectUrl: true,
        original: saved?.blob ?? file,
        decodedFrom: shown.decodedFrom,
        srgb: shown.srgb,
        ...size,
        recordId: id,
        exif,
        pose,
        sources,
        start: { pose: start.pose, sources: start.sources },
        headingReference: start.headingReference,
        declinationEast: null,
        takenAtUtc: taken?.iso ?? null,
        takenAt: taken,
        lens,
        flightId: null,
        frameIndex: null,
        acceptance: saved?.acceptance ?? existing?.acceptance ?? null,
        uses: saved?.uses ?? existing?.uses ?? [],
        chosen: null,
        savedSearch: saved?.search ?? null,
      }
      return { photo, record, existing }
    } catch (error) {
      if (src) URL.revokeObjectURL(src)
      throw new Error(
        error instanceof HeicDecodeError || isHeic(file)
          ? `This HEIC photo could not be decoded here: ${reason(error)} Export it as JPEG, keeping its location, and open that.`
          : `Could not read the photo: ${reason(error)}`,
      )
    }
  }

  /**
   * Puts photos into the set as the active one's neighbours, makes `activeId` (else the earliest) active and queues
   * them. `joining` photos come after the first of one add: they only join the set and the queue, and the photo that
   * is open stays open.
   */
  const takePhotos = (made: OwnPhoto[], activeId?: string | null, { joining = false }: { joining?: boolean } = {}) => {
    for (const photo of made) {
      // A photo opened again replaces its earlier copy: release that copy's URL and pixels.
      const earlier = photosRef.current.find((other) => other.id === photo.id)
      if (earlier && earlier.src !== photo.src) {
        caches.pixels.delete(earlier.src)
        forgetSkylines(caches.skyline, earlier.src)
        if (earlier.objectUrl) URL.revokeObjectURL(earlier.src)
      }
      if (photo.objectUrl) objectUrls.current.set(photo.id, photo.src)
      else objectUrls.current.delete(photo.id)
    }
    const ids = new Set(made.map((photo) => photo.id))
    setPhotos((current) => withPhotoFlights([...current.filter((photo) => !ids.has(photo.id)), ...made]))
    if (!joining) {
      const first =
        (activeId && made.some((photo) => photo.id === activeId) ? activeId : null) ?? queueOrder(made)[0] ?? null
      abort.current?.abort()
      setImage(null)
      setMatch(null)
      setAlignment({ status: 'idle', fit: null, message: null })
      setToolsError(null)
      if (first) activate(first)
    }
    enqueue(queueOrder(made))
  }

  /**
   * Adds the reviewer's own photos: each decoded (a HEIC in a worker), its EXIF read, its record made and added to
   * the assessment tools, its original kept as the record's attachment, grouped into flights, and queued. A set
   * larger than the workspace's room is refused before any is read.
   *
   * Several are read side by side (`heicDecodeConcurrency`), and each joins the set, and the queue, as soon as it is
   * read, so the first photo's search starts while the rest decode. The set opens on the first photo read, then on an
   * earlier one in time when that arrives, unless the reviewer has opened another photo meanwhile.
   */
  const addOwnFiles = useCallback(
    async (files: File[], roadView: RoadViewPose | null = null): Promise<AddOwnFilesResult> => {
      const started = generation.current
      const bridge = records?.current
      const filed = () => bridge?.photoRecords?.() ?? []
      // A photo imported before is opened as its record and takes no new room. By name here, before any is read; a
      // name that turns out to be another photo is counted when its record is added.
      const refused = fieldRecordRoom(
        bridge?.fieldCount?.() ?? 0,
        unfiledPhotoCount(
          filed(),
          files.map((file) => file.name),
        ),
      )
      if (refused) {
        setOwnStatus({ loading: false, error: refused })
        return { added: [], refused, errors: [] }
      }
      const added: OwnPhoto[] = []
      const errors: string[] = []
      let read = 0,
        decoding = 0,
        reopened = 0,
        already = 0,
        full: string | null = null
      /** The photo this add opened by itself; it gives way to an earlier one only while it is still the open photo. */
      let opened: string | null = null
      const say = () =>
        setOwnStatus({
          loading: true,
          error: null,
          stage:
            (files.length > 1 ? `Reading photos: ${read} of ${files.length} read…` : 'Reading the photo…') +
            (decoding ? ` Decoding ${files.length > 1 ? 'HEIC photos' : 'the HEIC photo'} in this browser…` : ''),
        })
      say()
      const take = (photo: OwnPhoto) => {
        if (!opened) {
          takePhotos([photo])
          opened = photo.id
        } else {
          takePhotos([photo], null, { joining: true })
          const earliest = queueOrder([...added, photo])[0]
          if (activeRef.current === opened && earliest && earliest !== opened) {
            activate(earliest)
            opened = earliest
          }
        }
        added.push(photo)
      }
      await inLanes(files, heicDecodeConcurrency(), async (file) => {
        if (started !== generation.current || full) return
        let decodingThis = false
        try {
          const made = await readOwnFile(
            file,
            roadView,
            null,
            () => {
              decodingThis = true
              decoding++
              say()
            },
            (found) => recordOfPickedPhoto(filed(), found),
          )
          // The set was cleared, or the workspace filled, while this one was read.
          if (started !== generation.current || full) {
            URL.revokeObjectURL(made.photo.src)
            return
          }
          if (made.existing) {
            const earlier = photoById(made.existing.id)
            // Open from its original already: the same photo twice is one photo.
            if (earlier?.original) {
              URL.revokeObjectURL(made.photo.src)
              already++
              return
            }
            if (!callbacks.current.originalOf?.(made.existing.id))
              callbacks.current.onOriginalPhoto?.(file, made.existing.id)
            // Open from its record's small copy: the camera worked on stays, the picture becomes the original.
            take(
              earlier
                ? { ...made.photo, pose: earlier.pose, sources: earlier.sources, chosen: earlier.chosen }
                : made.photo,
            )
            reopened++
            return
          }
          const noRoom = bridge ? bridge.addPhotoRecords([made.record]) : null
          if (noRoom) {
            URL.revokeObjectURL(made.photo.src)
            full = noRoom
            return
          }
          const photo = bridge ? made.photo : { ...made.photo, recordId: null }
          callbacks.current.onOriginalPhoto?.(file, photo.id)
          take(photo)
        } catch (error) {
          errors.push(files.length > 1 ? `${file.name}: ${reason(error)}` : reason(error))
        } finally {
          if (decodingThis) decoding--
          read++
          if (started === generation.current && read < files.length) say()
        }
      })
      if (started !== generation.current) return { added: [], refused: null, errors }
      const failed = [full, ...errors].filter(Boolean).join(' ')
      const note = [
        reopened
          ? `${reopened === 1 ? 'One photo was' : `${reopened} photos were`} imported before: ${
              reopened === 1 ? 'its field record was' : 'their field records were'
            } opened, with the camera, acceptance and jobs ${reopened === 1 ? 'it holds' : 'they hold'}, not filed again.`
          : null,
        already ? `${already === 1 ? 'One was' : `${already} were`} already open.` : null,
      ]
        .filter(Boolean)
        .join(' ')
      setOwnStatus({
        loading: false,
        error: added.length || already ? failed || null : failed || 'No photo was read.',
        ...(note ? { note } : {}),
      })
      return { added: queueOrder(added), refused: full, errors }
    },
    // takePhotos and readOwnFile read refs and stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eyeHeightMeters, records, activate, enqueue],
  )

  /**
   * Opens photos a project file kept, all into the set at once: each keeps its record and pose, and where each value
   * came from (`ownSourcesOnReopen`): the sources the file kept, else, for an older file, the EXIF's for a value that
   * has not moved and the record's or reviewer's for one that has. The acceptance and jobs are the record's
   * (`getRecord`). `activeId` is the photo that was open; the rest wait in the strip and the queue.
   */
  const openSavedPhotos = useCallback(
    async (entries: Array<{ file: File; saved: SavedOwnPhoto }>, activeId?: string | null): Promise<boolean> => {
      const started = generation.current
      const bridge = records?.current
      const errors: string[] = []
      let read = 0,
        stopped = false
      const say = () =>
        setOwnStatus({
          loading: true,
          error: null,
          stage: entries.length > 1 ? `Reading photos: ${read} of ${entries.length} read…` : 'Reading the photo…',
        })
      say()
      // Read side by side, as `addOwnFiles` reads them; taken into the set together, in the order the file kept.
      const slots = await inLanes(entries, heicDecodeConcurrency(), async ({ file, saved }) => {
        if (stopped) return null
        const record = saved.recordId ? (bridge?.getRecord?.(saved.recordId) ?? null) : null
        const held = record ? { ...saved, acceptance: record.acceptance ?? null, uses: record.uses ?? [] } : saved
        try {
          const { photo, record: madeRecord } = await readOwnFile(file, null, held, () => undefined)
          if (stopped || started !== generation.current) {
            stopped = true
            URL.revokeObjectURL(photo.src)
            return null
          }
          // An older project kept a photo with no record: it becomes one now when there is room.
          const recorded = saved.recordId ? true : !(bridge?.addPhotoRecords([madeRecord]) ?? 'none')
          return recorded ? photo : { ...photo, recordId: null }
        } catch (error) {
          errors.push(entries.length > 1 ? `${file.name}: ${reason(error)}` : reason(error))
          return null
        } finally {
          read++
          if (!stopped && started === generation.current && read < entries.length) say()
        }
      })
      const made = slots.filter((photo): photo is OwnPhoto => photo !== null)
      if (stopped || started !== generation.current) {
        for (const other of made) URL.revokeObjectURL(other.src)
        return false
      }
      if (made.length) takePhotos(made, activeId)
      setOwnStatus({ loading: false, error: errors.length ? errors.join(' ') : null })
      return made.length > 0
    },
    // takePhotos and readOwnFile read refs and stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [records, activate, enqueue, eyeHeightMeters],
  )

  /**
   * Opens one photo: a picked file joins the set as `addOwnFiles` adds it; one a project file kept (`saved`) as
   * `openSavedPhotos` opens it.
   */
  const openOwnFile = useCallback(
    async (file: File, roadView: RoadViewPose | null, saved?: SavedOwnPhoto): Promise<true | undefined> => {
      if (!saved) {
        const added = await addOwnFiles([file], roadView)
        return added.added.length ? true : undefined
      }
      return (await openSavedPhotos([{ file, saved }])) || undefined
    },
    [addOwnFiles, openSavedPhotos],
  )

  /** A record's stored copy as a photo in the set, starting from the camera the record holds. */
  const copyOfRecord = (record: FieldRecord, roadView: RoadViewPose | null): OwnPhoto => {
    // The record's GPS altitude lifts an aircraft photo before its search, as the EXIF would.
    const start = fromAcceptedAltitude(startingPose({ exif: null, record, roadView, eyeHeightMeters }), record)
    return {
      id: record.id,
      name: record.name,
      src: record.image,
      objectUrl: false,
      width: record.width,
      height: record.height,
      recordId: record.id,
      exif: null,
      pose: start.pose,
      sources: start.sources,
      start: { pose: start.pose, sources: start.sources },
      headingReference: start.headingReference,
      declinationEast: null,
      takenAtUtc: record.takenAtUtc ?? null,
      takenAt: null,
      lens: null,
      flightId: record.flightId ?? null,
      frameIndex: record.frameIndex ?? null,
      acceptance: record.acceptance ?? null,
      uses: record.uses ?? [],
      chosen: null,
      recordAltitudeMeters: record.altitude ?? null,
    }
  }

  /**
   * Opens field records' photos into the set: the same records carried on with (their ids, the cameras they hold,
   * their acceptances and jobs), never new ones. Each is read from its original where one is kept, so it comes back
   * at full size with its EXIF, time and lens; a record with no original (filed before originals were kept, or from
   * a workspace file, which carries none) opens as its stored 1,600-pixel copy. One record opens as the active
   * photo; several open on the earliest.
   */
  const openOwnRecords = useCallback(
    async (list: readonly FieldRecord[], roadView: RoadViewPose | null): Promise<void> => {
      ownRequest.current++
      const closed = list.filter((record) => !photosRef.current.some((photo) => photo.id === record.id))
      if (!closed.length) {
        if (list[0]) activate(list[0].id)
        return
      }
      const started = generation.current
      const kept = closed.filter((record) => callbacks.current.originalOf?.(record.id)).length
      const errors: string[] = []
      let read = 0
      const say = () =>
        setOwnStatus({
          loading: true,
          error: null,
          stage: kept > 1 ? `Reading photos: ${read} of ${kept} read…` : 'Reading the photo…',
        })
      if (kept) say()
      const made = await inLanes(closed, heicDecodeConcurrency(), async (record) => {
        const original = callbacks.current.originalOf?.(record.id) ?? null
        if (!original || started !== generation.current) return copyOfRecord(record, roadView)
        try {
          const file = new File([original], record.originalName || record.name, { type: original.type })
          const { photo } = await readOwnFile(
            file,
            roadView,
            null,
            () => undefined,
            () => record,
          )
          return { ...photo, name: record.name, original }
        } catch (error) {
          errors.push(`${record.name}: ${reason(error)} Its stored copy was opened instead.`)
          return copyOfRecord(record, roadView)
        } finally {
          read++
          if (started === generation.current && read < kept) say()
        }
      })
      if (started !== generation.current) {
        for (const photo of made) if (photo.objectUrl) URL.revokeObjectURL(photo.src)
        return
      }
      takePhotos(made, list.length === 1 ? list[0].id : null)
      setOwnStatus({ loading: false, error: errors.length ? errors.join(' ') : null })
    },
    // takePhotos, readOwnFile and copyOfRecord read refs and stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eyeHeightMeters, activate, enqueue],
  )

  /** Opens one field record's photo (`openOwnRecords`). */
  const openOwnRecord = useCallback(
    (record: FieldRecord, roadView: RoadViewPose | null) => openOwnRecords([record], roadView),
    [openOwnRecords],
  )

  /**
   * Removes a photo: its record, its attachment and any view of interest's link to it go, and anything worked out for
   * it. A view made from it stays, unlinked: the reviewer listed it. `id` may name a photo record that is not open in
   * the set (Field records' *Remove*): its record, attachment and links go all the same.
   */
  const removePhoto = useCallback(
    (id: string) => {
      const photo = photoById(id)
      const recordId = photo ? photo.recordId : id
      if (recordId) {
        records?.current?.removeFieldRecord?.(recordId)
        callbacks.current.onRemoveOriginal?.(recordId)
        callbacks.current.setViewsOfInterest?.((views) =>
          views.some((view) => view.photo?.recordId === recordId)
            ? views.map((view) => (view.photo?.recordId === recordId ? { ...view, photo: null } : view))
            : views,
        )
      }
      if (!photo) return
      if (queueRun.running === id) queueAbort.current?.abort()
      if (featuresRunning === id) featuresAbort.current?.abort()
      setQueueRun((current) => ({ ...current, pending: current.pending.filter((other) => other !== id) }))
      const url = objectUrls.current.get(id)
      if (url) URL.revokeObjectURL(url)
      objectUrls.current.delete(id)
      caches.pixels.delete(photo.src)
      forgetSkylines(caches.skyline, photo.src)
      setPhotos((current) => withPhotoFlights(current.filter((other) => other.id !== id)))
      const rest = photosRef.current.filter((other) => other.id !== id)
      setWork((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)))
      if (activeRef.current === id) {
        // Its drape goes with it: left on, the next photo opened would be laid on the plan unasked.
        setDrapeView((current) => (current.shown ? { ...current, shown: false } : current))
        activate(queueOrder(rest)[0] ?? null)
      }
    },
    [queueRun.running, featuresRunning, records, caches, activate],
  )

  // ---------------------------------------------------------------------------------------------------------------
  // The hand tools, on the active photo.

  const findLocation = async (id: string, centre: PhotoLocation) => {
    const photo = photoById(id)
    if (!photo || activeRef.current !== id) return
    locationAbort.current?.abort()
    const controller = new AbortController()
    locationAbort.current = controller
    const { signal } = controller
    const show = (state: PhotoLocationSearch) => {
      if (!signal.aborted && activeRef.current === id) setLocationSearch({ id, state })
    }
    const locations = photoLocationTrials(centre)
    show({ status: 'searching', checked: 0, total: locations.length })
    try {
      const pixels = await readPixels(photo)
      // Every reader that finds a believable skyline in this photo may be searched, as the camera search tries them; one
      // reader is kept for the whole search (`searchByOneReader`), so every place's fit measures the same skyline.
      const readers = SKYLINE_READERS.filter((reader) => {
        const skyline = skylineRead(photo, pixels, reader)
        return skyline.filter(Boolean).length >= MIN_SKYLINE_COLUMNS && believableSkyline(pixels, skyline)
      })
      if (!readers.length) {
        show({
          status: 'error',
          message:
            'There is too little clear skyline to locate this photo. Set a rough camera location in Adjust and pair landmarks.',
        })
        return
      }
      const spec = photoTerrainSpec(centre.lng, centre.lat, PHOTO_TERRAIN_RINGS)
      const terrain = await loadOwnTerrain(centre.lng, centre.lat, signal)
      const { hfov, eyeHeightMeters, altitudeMeters } = photo.pose
      let knownGround = 0
      let belowGround = 0
      let sampled = 0
      // Each place's terrain horizon, read once on the first reader's pass; null where the place cannot be searched.
      const horizons: Array<{ base: ReturnType<typeof ownPhotoPose>; profile: ProfilePoint[] } | null> = []
      const horizonAt = async (place: number) => {
        if (place < horizons.length) return horizons[place]
        const location = locations[place]
        const ground = terrain.elevationAt(location.lng, location.lat)
        let horizon: (typeof horizons)[number] = null
        if (Number.isFinite(ground)) {
          knownGround += 1
          if (altitudeMeters != null && altitudeMeters <= ground) belowGround += 1
        }
        if (Number.isFinite(ground) && (altitudeMeters == null || altitudeMeters > ground)) {
          const base = ownPhotoPose({ ...photo.pose, ...location }, ground, photo.width, photo.height)
          const profile = await photoHorizon(
            { eye: base, terrain: spec, maxDistanceMeters: WIDE_RADIUS_METERS * 0.95 },
            signal,
          )
          if (profile.length) sampled += 1
          if (hasLocationRelief(profile)) horizon = { base, profile }
        }
        horizons[place] = horizon
        return horizon
      }
      const chosen = await searchByOneReader(
        readers,
        locations.length,
        async (reader, place) => {
          signal.throwIfAborted()
          const horizon = await horizonAt(place)
          if (!horizon) return null
          const { base, profile } = horizon
          const skyline = skylineOf(photo, pixels, base, reader)
          if (skyline.filter(Boolean).length < MIN_SKYLINE_COLUMNS) return null
          const fit = await runWideOrientation(
            {
              pose: { ...base, roll: 0 },
              profile,
              skyline,
              pitchRange: pitchRangeFor({ tilt: undefined, airborne: altitudeMeters != null }),
              rollRange: [-15, 15],
              headingSpan: 180,
            },
            signal,
          )
          signal.throwIfAborted()
          // A fit is a candidate only where the terrain it faces has relief enough to tell places apart.
          return fit && hasLocationRelief(horizonSlice(profile, fit.bearing, frameHalfDiagonal(base))) ? fit : null
        },
        (pass, done) =>
          show({
            status: 'searching',
            checked: done,
            total: locations.length,
            ...(pass === 'others' ? { otherReaders: true as const } : {}),
          }),
      )
      const candidates: PhotoLocationCandidate[] = (chosen?.results ?? []).flatMap((fit, place) =>
        fit ? [{ ...locations[place], fit }] : [],
      )
      if (knownGround > 0 && belowGround === knownGround) {
        show({ status: 'error', message: 'The camera altitude is below the terrain in this area. Check it in Adjust.' })
        return
      }
      show({
        status: 'done',
        ...rankPhotoLocations(candidates),
        sampled,
        basis: { hfov, eyeHeightMeters, altitudeMeters: altitudeMeters ?? null },
      })
    } catch (error) {
      show({ status: 'error', message: `The location search stopped: ${reason(error)}` })
    }
  }

  const useLocation = (id: string, candidate: PhotoLocationCandidate) => {
    const photo = photoById(id)
    const search = locationSearch?.id === id ? locationSearch.state : null
    // A near tie offers no start: the top of a tie is not a suggestion (`undecidedHeadings`).
    if (
      !photo ||
      activeRef.current !== id ||
      search?.status !== 'done' ||
      search.ambiguous ||
      !search.candidates.includes(candidate)
    )
      return
    const { hfov, eyeHeightMeters, altitudeMeters } = search.basis
    if (
      photo.pose.hfov !== hfov ||
      photo.pose.eyeHeightMeters !== eyeHeightMeters ||
      (photo.pose.altitudeMeters ?? null) !== altitudeMeters
    ) {
      setLocationSearch({
        id,
        state: { status: 'error', message: 'The lens or eye height changed. Search again with the current settings.' },
      })
      return
    }
    setOwnPose(
      {
        lng: candidate.lng,
        lat: candidate.lat,
        bearing: candidate.fit.bearing,
        pitch: candidate.fit.pitch,
        roll: candidate.fit.roll,
      },
      'skyline',
    )
    patchWork(id, (current) => ({
      ...current,
      search: { status: 'idle' },
      features: EMPTY_WORK.features,
      controlSolve: null,
    }))
    setLocationSearch(null)
  }

  /**
   * Finds heading, pitch and roll from the active photo's skyline over every heading (`wideOrientation.ts`, in a
   * worker), within the reviewer's priors: for a photo from the air, or any photo whose recorded heading is not
   * trusted. The camera found is applied.
   */
  /** Searches the active photo's camera; `held` replaces the held angles for this search (and is kept as them). */
  const findCamera = useCallback(
    async (held?: CameraPriors) => {
      if (!own || !positioned(own)) return
      if (held) setPriors(held)
      cameraAbort.current?.abort()
      const controller = new AbortController()
      cameraAbort.current = controller
      const id = own.id
      try {
        await searchStage(id, { searchPriors: held ?? priors, neighbourFirst: false, setPose: true }, controller.signal)
      } catch (error) {
        if (aborted(controller.signal)) return
        patchWork(id, (current) => ({
          ...current,
          search: { status: 'failed', message: `The camera search stopped: ${reason(error)}` },
        }))
      }
    },
    // searchStage reads refs and stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [own, priors, patchWork, setPriors],
  )

  /** Turns a spot picked on the plan at the photo's centre into heading and pitch, and holds them as priors. */
  const pickLandmark = useCallback(
    async (lng: number, lat: number) => {
      if (!own || !positioned(own)) return
      const id = own.id
      const controller = new AbortController()
      setToolsBusy('Loading terrain…')
      try {
        const terrain = await loadOwnTerrain(own.pose.lng, own.pose.lat, controller.signal)
        const elevation = terrain.elevationAt(lng, lat)
        if (!Number.isFinite(elevation)) throw new Error('no terrain at that spot')
        const look = landmarkAngles(ownCamera(own, terrain), { lng, lat, elevation })
        patchWork(id, (current) => ({
          ...current,
          landmark: { lng, lat, elevation, ...look },
          priors: {
            ...current.priors,
            heading: { value: look.bearing, tolerance: current.priors.heading?.tolerance ?? 10 },
            pitch: { value: look.pitch, tolerance: current.priors.pitch?.tolerance ?? 5 },
          },
        }))
        patchPhoto(id, (current) => ({
          ...current,
          pose: { ...current.pose, bearing: look.bearing, pitch: look.pitch },
          sources: { ...current.sources, heading: 'landmark', pitch: 'landmark' },
        }))
        setToolsError(null)
      } catch (error) {
        setToolsError(`Could not use that spot: ${reason(error)}`)
      } finally {
        setToolsBusy(null)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [own, loadOwnTerrain, patchWork, patchPhoto],
  )

  /** Pairs the pixel clicked in the photo with the spot clicked on the plan. */
  const addPair = useCallback(
    async (pixel: [number, number], lng: number, lat: number) => {
      if (!own || !positioned(own)) return
      try {
        const terrain = await loadOwnTerrain(own.pose.lng, own.pose.lat, new AbortController().signal)
        const elevation = terrain.elevationAt(lng, lat)
        if (!Number.isFinite(elevation)) throw new Error('no terrain at that spot')
        patchWork(own.id, (current) => ({
          ...current,
          pairs: [...current.pairs, { id: `pair-${Date.now().toString(36)}`, pixel, lng, lat, elevation }],
          pairGround: {
            lng: own.pose.lng,
            lat: own.pose.lat,
            elevation: terrain.elevationAt(own.pose.lng, own.pose.lat),
          },
        }))
        setPendingPixel(null)
        setToolsError(null)
      } catch (error) {
        setToolsError(`Could not place that point: ${reason(error)}`)
      }
    },
    [own, loadOwnTerrain, patchWork],
  )

  /** Solves the camera from the paired points, with the priors, and applies it to the photo. */
  const solveFromPoints = useCallback(async () => {
    if (!own || !positioned(own)) return
    const id = own.id
    setToolsBusy('Solving from the points…')
    try {
      const terrain = await loadOwnTerrain(own.pose.lng, own.pose.lat, new AbortController().signal)
      const start = { ...ownCamera(own, terrain), hfov: own.pose.hfov }
      const angle = (key: 'heading' | 'pitch' | 'roll'): UnknownSpec =>
        priors[key] ? { mode: 'prior', ...priors[key]! } : { mode: 'free' }
      const off = new Set(activeWork.pairsOff ?? [])
      const enabled = pairs.filter((pair) => !off.has(pair.id))
      const holdPosition = enabled.length === 2
      const positionUnknowns = holdPosition ? CONTROL_FIXED_POSITION : freeControlPosition ? CONTROL_FREE_POSITION : {}
      const solved = solveFromControls({
        start,
        pairs: enabled,
        unknowns: {
          heading: angle('heading'),
          pitch: angle('pitch'),
          roll: angle('roll'),
          // Two pairs constrain the angles. More pairs let the solve adjust the camera's position.
          ...positionUnknowns,
        },
      })
      if (!solved) {
        setToolsError(
          `Pair at least ${pairsNeeded(positionUnknowns)} points: click a spot in the photo, then the same spot on the plan.`,
        )
        return
      }
      patchWork(id, (current) => ({ ...current, controlSolve: solved }))
      const airborne = own.pose.altitudeMeters !== null && own.pose.altitudeMeters !== undefined
      patchPhoto(id, (current) => ({
        ...current,
        pose: {
          ...current.pose,
          lng: solved.pose.lng,
          lat: solved.pose.lat,
          bearing: solved.pose.bearing,
          pitch: solved.pose.pitch,
          roll: solved.pose.roll,
          ...(airborne
            ? { altitudeMeters: solved.pose.altitudeMeters }
            : { eyeHeightMeters: Math.max(0.5, current.pose.eyeHeightMeters + solved.shift.up) }),
        },
        sources: {
          ...current.sources,
          position: holdPosition ? current.sources.position : 'controls',
          heading: 'controls',
          pitch: 'controls',
          roll: 'controls',
        },
      }))
      setToolsError(null)
    } catch (error) {
      setToolsError(`The solve stopped: ${reason(error)}`)
    } finally {
      setToolsBusy(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [own, pairs, activeWork.pairsOff, priors, freeControlPosition, loadOwnTerrain, patchWork, patchPhoto])

  /** The angles and lens of the current camera or a skyline candidate. */
  const candidateAngles = (which: PhotoModelViewKind) => {
    if (which === 'camera') return own?.pose ?? null
    if (cameraSearch.status !== 'done') return null
    const result = cameraSearch.result
    const candidate = which === 'winner' ? result : result.runnerUp
    return candidate && { ...candidate, hfov: candidate.hfov ?? result.hfov }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The photo on the plan: both candidates at once, redrawn as the camera moves.

  const [drapeView, setDrapeView] = useState<{ shown: boolean; which: 'camera' | 'runner-up' }>({
    shown: false,
    which: 'camera',
  })
  const [drapes, setDrapes] = useState<
    ({ photoId: string } & Partial<Record<'camera' | 'runner-up', OwnPhotoDrape>>) | null
  >(null)
  const drapesRef = useRef(drapes)
  drapesRef.current = drapes
  const [drapeBusy, setDrapeBusy] = useState<string | null>(null)

  /** Lays a photo on the plan for one camera in the worker, and keeps it. */
  const drawDrape = async (
    photo: OwnPhoto,
    which: 'camera' | 'runner-up',
    pose: PhotoPose,
    full: boolean,
    signal: AbortSignal,
  ) => {
    const pixels = await readPixels(photo)
    const drape = await drapePhotoOffThread(
      {
        pose,
        terrain: specOf(photo),
        photo: { key: photo.src, value: pixels },
        options: { maxCells: full ? DRAPE_FULL_CELLS : DRAPE_QUICK_CELLS },
      },
      signal,
    )
    if (!drape) return null
    const checked = acceptancePoseOf(photo, {
      bearing: pose.bearing,
      pitch: pose.pitch,
      roll: pose.roll,
      hfov: (Math.atan(pose.width / (2 * pose.focalPx)) * 360) / Math.PI,
    })!
    const kept: OwnPhotoDrape = {
      ...drape,
      which,
      bearing: pose.bearing,
      pose: checked,
      poseKey: photoPoseKey(pose),
      full,
    }
    setDrapes((current) => ({ ...(current?.photoId === photo.id ? current : { photoId: photo.id }), [which]: kept }))
    // A drape drawn in full is a check image for its camera.
    if (full) patchWork(photo.id, (current) => ({ ...current, checked: withCheckedPose(current.checked, checked) }))
    return kept
  }

  /** The cameras the plan shows the photo for while it is shown: the camera as it stands and the runner-up. */
  const drapeTargets = useMemo(() => {
    if (!drapeView.shown || !own || !ownSkylineTerrain || !positioned(own)) return []
    const runnerUp = candidateAngles('runner-up')
    const targets: Array<{ which: 'camera' | 'runner-up'; pose: PhotoPose }> = [
      { which: 'camera', pose: ownCamera(own, ownSkylineTerrain) },
    ]
    if (runnerUp) targets.push({ which: 'runner-up', pose: ownCamera(own, ownSkylineTerrain, runnerUp) })
    return targets.filter((target) => Number.isFinite(target.pose.altitudeMeters))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drapeView.shown, own, ownSkylineTerrain, cameraSearch])
  const drapeTargetsKey = drapeTargets.length
    ? `${own?.id}|${drapeTargets.map((target) => `${target.which}:${photoPoseKey(target.pose)}`).join(';')}`
    : null
  // Redraws after the camera moves: quick while it moves, in full once it has settled.
  useEffect(() => {
    if (!drapeTargetsKey || !own) return
    const photo = own
    const stale = (which: 'camera' | 'runner-up', key: string, full: boolean) => {
      const held = drapesRef.current?.photoId === photo.id ? drapesRef.current[which] : undefined
      return !held || held.poseKey !== key || (full && !held.full)
    }
    if (!drapeTargets.some((target) => stale(target.which, photoPoseKey(target.pose), true))) return
    const controller = new AbortController()
    let settle: number | undefined
    const pass = async (full: boolean) => {
      for (const target of drapeTargets)
        if (stale(target.which, photoPoseKey(target.pose), full))
          await drawDrape(photo, target.which, target.pose, full, controller.signal)
    }
    const quick = window.setTimeout(() => {
      setDrapeBusy('Laying the photo on the map…')
      pass(false)
        .then(() => {
          settle = window.setTimeout(() => {
            pass(true)
              .catch(() => {
                /* Superseded by a newer camera, or the drape could not be drawn: the quick one stays. */
              })
              .finally(() => {
                if (!controller.signal.aborted) setDrapeBusy(null)
              })
          }, DRAPE_SETTLE_MS)
        })
        .catch(() => {
          if (!controller.signal.aborted) setDrapeBusy(null)
        })
    }, DRAPE_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(quick)
      window.clearTimeout(settle)
      controller.abort()
    }
    // The targets are named by their key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drapeTargetsKey])

  /**
   * Lays the photo on the plan for a camera: a wrong heading puts its roads and openings in the wrong place. It stays
   * on the plan, following the camera, until taken off.
   */
  const showOnMap = useCallback(
    async (which: 'camera' | 'runner-up') => {
      const angles = candidateAngles(which)
      if (!own || !angles || !positioned(own)) return false
      setToolsBusy('Laying the photo on the map…')
      try {
        const terrain = await loadOwnTerrain(own.pose.lng, own.pose.lat, new AbortController().signal)
        const drape = await drawDrape(own, which, ownCamera(own, terrain, angles), true, new AbortController().signal)
        if (!drape) throw new Error('the camera sees no ground')
        setPhotoDrape({
          url: rgbaDataUrl(drape),
          bounds: drape.bounds,
          which,
          bearing: angles.bearing,
          seenShare: drape.seenShare,
        })
        setDrapeView({ shown: true, which })
        setToolsError(null)
        return true
      } catch (error) {
        setToolsError(`Could not lay the photo on the map: ${reason(error)}`)
        return false
      } finally {
        setToolsBusy(null)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [own, cameraSearch, loadOwnTerrain],
  )
  const hideDrape = useCallback(() => {
    setPhotoDrape(null)
    setDrapeView((current) => ({ ...current, shown: false }))
  }, [])

  /** Satellite imagery seen from a camera, scored against the photo: ground texture where the skyline is useless. */
  const renderModel = useCallback(
    async (which: PhotoModelViewKind | 'both candidates') => {
      if (!own || !positioned(own)) return
      setToolsBusy('Loading imagery…')
      try {
        const views = which === 'both candidates' ? (['winner', 'runner-up'] as const) : [which]
        for (const view of views) {
          const angles = candidateAngles(view)
          if (angles)
            await drawModelView(own.id, view, angles, new AbortController().signal, (done) =>
              setToolsBusy(`Drawing the model view… ${Math.round(done * 100)}%`),
            )
        }
        setToolsError(null)
      } catch (error) {
        setToolsError(`Could not draw the model view: ${reason(error)}`)
      } finally {
        setToolsBusy(null)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [own, cameraSearch],
  )

  /**
   * Draws the model view for the camera as it stands without a busy line: a smaller one while fine-tuning, which
   * records no check, or (`full`) the full one the comparison shows, drawn as soon as that camera is looked at.
   */
  const previewCamera = useCallback(
    async (id: string, signal: AbortSignal, { full = false }: { full?: boolean } = {}) => {
      const current = photoById(id)
      if (!current || !positioned(current)) return
      const { bearing, pitch, roll } = current.pose
      await drawModelView(id, 'camera', { bearing, pitch, roll }, signal, undefined, { preview: !full })
    },
    // The draw reads the photo by ID. Its worker, caches and work updater are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadOwnTerrain, patchWork],
  )

  /** Reads the features again for the active photo's camera as it stands. */
  const readFeatures = useCallback(async () => {
    if (!own || !positioned(own)) return
    try {
      await checkFeatures(
        own.id,
        { bearing: own.pose.bearing, pitch: own.pose.pitch, roll: own.pose.roll },
        new AbortController().signal,
      )
    } catch {
      /* Kept on the photo as failed. */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [own])

  // ---------------------------------------------------------------------------------------------------------------
  // The hit buffer for the active photo's camera, for what is drawn over the photo.

  const [hits, setHits] = useState<{ photoId: string; buffer: HitBuffer } | null>(null)
  useEffect(() => {
    if (!own || !activePose || !activePoseKey || !positioned(own)) return
    const photo = own,
      pose = activePose
    const held = caches.hits.get(activePoseKey) ?? caches.optionHits.get(activePoseKey)
    if (held) {
      setHits({ photoId: photo.id, buffer: held })
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      caches.hits
        .getOrCreate(
          activePoseKey,
          (shared) => castPhotoHits({ pose, terrain: specOf(photo) }, shared),
          controller.signal,
        )
        .then((buffer) => {
          if (!controller.signal.aborted) setHits({ photoId: photo.id, buffer })
        })
        .catch(() => {
          /* A newer camera replaced it, or the terrain did not load: the overlays wait for the next. */
        })
    }, HIT_DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
    // The camera is named by its key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePoseKey, own?.id])

  // The ground under each of the open photo's option cameras, cast ahead while its window is open, so *Use* lays the
  // layers on the photo at once rather than a second later. After the camera's own cast, which the reviewer is
  // waiting on; a cast already held is skipped.
  const ownOptionPoses = own && ownDialog.open ? optionsFor(own.id).map((option) => option.pose) : []
  const ownOptionsKey = ownOptionPoses.map(optionViewKey).join(';')
  // The same cameras, for what else is made ahead for them (the layers laid on the photo, `usePhotoLaidLayers`).
  const [optionCameras, setOptionCameras] = useState<{
    photoId: string
    cameras: Array<{ key: string; pose: PhotoPose; terrain: PhotoTerrainSpec }>
  } | null>(null)
  useEffect(() => {
    if (!own || !ownOptionPoses.length) return
    const photo = own
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void (async () => {
        const cameras: Array<{ key: string; pose: PhotoPose; terrain: PhotoTerrainSpec }> = []
        for (const option of ownOptionPoses) {
          const camera = await optionCameraRef.current(photo, option, controller.signal)
          if (camera) cameras.push({ key: photoPoseKey(camera.pose), ...camera })
        }
        if (controller.signal.aborted) return
        setOptionCameras({ photoId: photo.id, cameras })
        for (const camera of cameras) {
          if (controller.signal.aborted) return
          const key = camera.key
          if (caches.optionHits.peek(key)) continue
          // One already cast as the photo's camera is kept here too: `hits` lets it go as other photos are read.
          const cast = caches.hits.peek(key)
          if (cast) {
            caches.optionHits.set(key, cast)
            continue
          }
          await caches.optionHits.getOrCreate(key, (shared) => castPhotoHits(camera, shared), controller.signal)
        }
      })().catch(() => {
        /* The photo changed, or the terrain did not load: the cast is made when the option is used. */
      })
    }, HIT_DEBOUNCE_MS * 3)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
    // The options are named by their key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [own?.id, ownOptionsKey])
  /**
   * The hit buffer for the camera as it stands: the one last cast for it, else one already held for that camera (an
   * option's, cast ahead), read here so the frame that makes an option the camera already has its ground; else the
   * last one cast, which the overlays tell apart by its `poseKey`.
   */
  const activeHits =
    hits && hits.photoId === activeId && hits.buffer.poseKey === activePoseKey
      ? hits.buffer
      : ((activePoseKey ? (caches.hits.peek(activePoseKey) ?? caches.optionHits.peek(activePoseKey)) : undefined) ??
        (hits && hits.photoId === activeId ? hits.buffer : null))

  /**
   * A check the reviewer asked for (*Check this camera*): it counts once what is drawn over the photo has a hit buffer
   * for that exact camera, never before, and is dropped if the camera moves first. Kept here, not in the window, which
   * is unmounted while it steps aside for the plan.
   */
  const [pendingCheck, setPendingCheck] = useState<{ id: string; pose: AcceptancePose } | null>(null)
  const requestCheck = useCallback((id: string) => {
    const photo = photoById(id)
    const pose = photo && acceptancePoseOf(photo)
    setPendingCheck(pose ? { id, pose } : null)
  }, [])
  const pendingPhoto = pendingCheck ? (photos.find((photo) => photo.id === pendingCheck.id) ?? null) : null
  const pendingPose = pendingPhoto ? acceptancePoseOf(pendingPhoto) : null
  const pendingMoved = !!pendingCheck && (!pendingPose || !sameCamera(pendingPose, pendingCheck.pose))
  const pendingLanded =
    !!pendingCheck &&
    !pendingMoved &&
    activeId === pendingCheck.id &&
    !!activePoseKey &&
    hits?.photoId === pendingCheck.id &&
    hits.buffer.poseKey === activePoseKey
  if (pendingMoved) setPendingCheck(null)
  useEffect(() => {
    if (!pendingLanded || !pendingCheck) return
    markChecked(pendingCheck.id)
    setPendingCheck(null)
  }, [pendingLanded, pendingCheck, markChecked])

  // ---------------------------------------------------------------------------------------------------------------
  // Editing the active photo's pose.

  /** The reviewer's change to the pose; each changed value is marked as theirs (or `source`). */
  const setOwnPose = useCallback(
    (patch: Partial<OwnPose>, source: PoseSource = 'reviewer') => {
      setOwn((current) => {
        if (!current) return current
        const pose = { ...current.pose, ...patch }
        // A typed eye height stands the eye over the ground again, unless an altitude comes with it.
        if (patch.eyeHeightMeters !== undefined && patch.altitudeMeters === undefined) pose.altitudeMeters = null
        if (patch.bearing !== undefined) pose.bearing = normalizeHeading(patch.bearing)
        if (patch.hfov !== undefined) pose.hfov = clampFov(patch.hfov)
        if (patch.roll !== undefined) pose.roll = wrapSigned(patch.roll)
        const sources = { ...current.sources }
        if (patch.lng !== undefined || patch.lat !== undefined) sources.position = source
        if (patch.bearing !== undefined) sources.heading = source
        if (patch.pitch !== undefined) sources.pitch = source
        if (patch.roll !== undefined) sources.roll = source
        if (patch.hfov !== undefined) sources.fov = source
        if (patch.eyeHeightMeters !== undefined || patch.altitudeMeters !== undefined) sources.eyeHeight = source
        return { ...current, pose, sources }
      })
    },
    [setOwn],
  )

  const restoreCamera = useCallback(
    (id: string, startingCamera: Pick<OwnPhoto, 'pose' | 'sources' | 'chosen'>) => {
      patchPhoto(id, (current) => ({ ...current, ...startingCamera }))
    },
    [patchPhoto],
  )

  /**
   * A camera matched by the photo-matching bench: its position, altitude, heading, pitch, roll and lens, each marked
   * as matched. It also becomes the pose Reset returns to.
   */
  const applyMatchedCamera = useCallback(
    (id: string, camera: MatchedCamera, fileName: string, checks: string[]) => {
      patchPhoto(id, (current) => {
        const pose: OwnPose = {
          ...current.pose,
          lng: camera.lng,
          lat: camera.lat,
          altitudeMeters: camera.altitudeMeters,
          bearing: normalizeHeading(camera.bearing),
          pitch: camera.pitch,
          roll: camera.roll,
          hfov: clampFov(camera.hfov),
        }
        const sources: OwnPoseSources = {
          position: 'matched',
          heading: 'matched',
          pitch: 'matched',
          roll: 'matched',
          fov: 'matched',
          eyeHeight: 'matched',
        }
        return {
          ...current,
          pose,
          sources,
          start: { pose, sources },
          chosen: null,
          matched: {
            fileName: fileName.slice(0, 200),
            method: camera.method,
            trusted: camera.trusted,
            heldOut: camera.heldOut,
            checks,
            camera,
          },
        }
      })
    },
    [patchPhoto],
  )

  /** A photo taken from the air: the eye stands at its GPS altitude (on), or back at the ground plus eye height. */
  const setFromAir = useCallback(
    (fromAir: boolean) => {
      setOwn((current) => {
        const altitude = current?.exif?.altitudeMeters
        if (!current || (fromAir && (altitude === null || altitude === undefined))) return current
        return {
          ...current,
          pose: { ...current.pose, altitudeMeters: fromAir ? altitude : null },
          // Off is the reviewer's word that it was taken on the ground: the queue never lifts it again.
          sources: { ...current.sources, eyeHeight: fromAir ? 'exif' : 'reviewer' },
        }
      })
    },
    [setOwn],
  )

  /** A declination for a magnetic EXIF heading: the heading becomes the recorded one plus it. */
  const setDeclination = useCallback(
    (declinationEast: number | null) => {
      setOwn((current) => {
        const recorded = current?.exif?.heading
        if (!current || !recorded) return current
        return {
          ...current,
          declinationEast,
          pose: { ...current.pose, bearing: trueHeadingFromMagnetic(recorded.degrees, declinationEast ?? 0) },
          sources: { ...current.sources, heading: 'exif' },
        }
      })
    },
    [setOwn],
  )

  /** Turns and tilts the compared view: the Mapillary photo's nudge, or the own photo's pose itself. */
  const nudge = (bearing: number, pitch: number) => {
    if (!match) return
    if (image) {
      setMatch({ ...match, nudge: { bearing: match.nudge.bearing + bearing, pitch: match.nudge.pitch + pitch } })
      return
    }
    if (!own) return
    setOwnPose({
      ...(bearing ? { bearing: own.pose.bearing + bearing } : {}),
      ...(pitch ? { pitch: own.pose.pitch + pitch } : {}),
    })
  }
  const resetNudge = () => {
    if (!match) return
    if (image) setMatch({ ...match, nudge: { bearing: 0, pitch: 0 } })
    else
      setOwn((current) =>
        current
          ? {
              ...current,
              pose: { ...current.pose, bearing: current.start.pose.bearing, pitch: current.start.pose.pitch },
              sources: {
                ...current.sources,
                heading: current.start.sources.heading,
                pitch: current.start.sources.pitch,
              },
            }
          : current,
      )
  }
  const startOwnMatch = () => {
    setAlignment({ status: 'idle', fit: null, message: null })
    setMatch({ nudge: { bearing: 0, pitch: 0 }, opacity: 0.5, showSkyline: true, showBlock: true })
  }
  const comparingOwn = !!own && !!match && ownStand?.status === 'ok'

  // ---------------------------------------------------------------------------------------------------------------
  // The set, its flights and the queue, as the window shows them.

  const order = useMemo(() => queueOrder(photos), [photos])
  const ownPhotos = useMemo(() => {
    const byId = new Map(photos.map((photo) => [photo.id, photo]))
    return order.map((id) => byId.get(id)!)
  }, [photos, order])
  const ownFlights = useMemo(() => {
    const flights = new Map<string, { id: string; photoIds: string[]; start: string | null; end: string | null }>()
    for (const photo of ownPhotos) {
      if (!photo.flightId) continue
      const flight = flights.get(photo.flightId) ?? { id: photo.flightId, photoIds: [], start: null, end: null }
      flight.photoIds.push(photo.id)
      flight.start ??= photo.takenAtUtc
      flight.end = photo.takenAtUtc
      flights.set(photo.flightId, flight)
    }
    return [...flights.values()]
  }, [ownPhotos])
  const farFrom = assessedRoad ?? road
  const queue = useMemo(() => {
    const entries: PhotoQueueEntry[] = ownPhotos.map((photo) => {
      const w = work[photo.id] ?? EMPTY_WORK
      const pose = acceptancePoseOf(photo)
      const options = optionsFor(photo.id)
      const winner = options.find((option) => option.kind === 'winner')
      const statusNow = photoQueueStatus({
        running: queueRun.running === photo.id,
        queued: queueRun.pending.includes(photo.id),
        acceptance: photo.acceptance,
        pose,
        checked: w.checked,
        search: w.search.status,
        found: w.found,
        hasCameraOption: options.some(
          (option) => option.kind === 'matched' || option.kind === 'landmark' || option.kind === 'high-ground',
        ),
      })
      const notes = [...(w.found?.notes ?? [])]
      if (w.found?.stopped) notes.unshift(w.found.stopped)
      if (photo.lens?.cropped) notes.push(photo.lens.note)
      if (photo.acceptance && pose && acceptanceLapsed(photo.acceptance, pose))
        notes.push('The camera has moved since it was accepted: check it and accept it again.')
      // Far from the road is a note, never a block: a photo from the air is expected to be.
      if (pose && farFrom.length > 1) {
        const off = nearestPointOnLine(farFrom, pose)?.offsetMeters ?? 0
        if (off > MAX_WALK_METERS) notes.push(`${(off / 1000).toFixed(off < 10000 ? 1 : 0)} km from the road`)
      }
      return {
        recordId: photo.id,
        status: statusNow,
        reasons: queueReasons({
          found: w.found,
          search: w.search.status === 'done' ? w.search.result : null,
          otherOptions: options.filter((option) => option.kind !== 'phone' && option.kind !== 'high-ground').length,
          neighbourGap: winner?.evidence.neighbourAgreesDegrees ?? null,
        }),
        notes,
      }
    })
    const done = entries.filter((entry) => entry.status !== 'queued' && entry.status !== 'searching').length
    const state: PhotoQueueState & {
      paused: boolean
      /** Photos past the queue (anything but queued or searching), and all of them: "Searching 3 of 14". */
      done: number
      total: number
      /** Where the running photo is in the set, from 1; null while idle. */
      position: number | null
    } = {
      entries,
      running: queueRun.running,
      cancelled: queueRun.cancelled,
      paused: queueRun.paused,
      done,
      total: entries.length,
      position: queueRun.running ? order.indexOf(queueRun.running) + 1 : null,
    }
    return state
  }, [ownPhotos, work, queueRun, optionsFor, order, farFrom])

  return {
    alignment,
    autoAlign,
    cameraSearch,
    locationSearch: locationSearch?.id === activeId ? locationSearch.state : null,
    findLocation,
    useLocation,
    cancelLocationSearch: () => {
      locationAbort.current?.abort()
      setLocationSearch(null)
    },
    findCamera,
    priors,
    setPriors,
    landmark,
    pickLandmark,
    pairs,
    pendingPixel,
    setPendingPixel,
    addPair,
    removePair: (id: string) => setPairs((current) => current.filter((pair) => pair.id !== id)),
    clearPairs: () => {
      setPairs(() => [])
      setPendingPixel(null)
      const id = activeRef.current
      if (id) patchWork(id, (current) => ({ ...current, controlSolve: null }))
    },
    pairsNeeded: pairsNeeded(),
    controlCheckCount,
    /** Ids of the active photo's pairs left out of the solve (check points). */
    pairsOff: activeWork.pairsOff ?? [],
    /** Puts a pair into the solve, or leaves it out as a check point; the next solve follows. */
    setPairOn: (id: string, on: boolean) => {
      const photoId = activeRef.current
      if (!photoId) return
      patchWork(photoId, (current) => {
        const off = new Set(current.pairsOff ?? [])
        if (on) off.delete(id)
        else off.add(id)
        return { ...current, pairsOff: [...off] }
      })
    },
    controlSolve,
    solveFromPoints,
    photoDrape,
    showOnMap,
    hideDrape,
    modelViews,
    renderModel,
    previewCamera,
    restoreCamera,
    toolsBusy,
    toolsError,
    cancelCameraSearch: () => {
      cameraAbort.current?.abort()
      const id = activeRef.current
      if (id)
        patchWork(id, (current) =>
          current.search.status === 'working' ? { ...current, search: { status: 'idle' } } : current,
        )
    },
    look,
    viewFov,
    viewHfov,
    panoFrame,
    setViewAspect,
    startMatch,
    token,
    input,
    setInput,
    image,
    status,
    load,
    search,
    findPhotos,
    follow,
    setFollow,
    match,
    setMatch,
    onRoad,
    fov,
    drawing,
    skylineReady: !!skylineSource,
    /** The active own photo; null when none is (a Mapillary photo, or nothing open). */
    own,
    ownStatus,
    /** The own photo's dialog: whether it is open, and on which step. */
    ownDialog,
    openOwnDialog: (step?: OwnPhotoPlace) => setOwnDialog((current) => ({ open: true, step: step ?? current.step })),
    closeOwnDialog: () => {
      if (locationSearch?.state.status === 'searching') {
        locationAbort.current?.abort()
        setLocationSearch(null)
      }
      setOwnDialog((current) => ({ ...current, open: false }))
    },
    /** The terrain skyline for the active photo's camera, in its pixels; null until its terrain is loaded. */
    ownSkyline,
    ownSkylineStatus,
    loadOwnSkyline,
    ownFov,
    ownOnRoad,
    ownStand,
    openOwnFile,
    openOwnRecord,
    openOwnRecords,
    /** Whether a record's original is kept, so it opens at full size. */
    originalKept: (recordId: string) => !!callbacks.current.originalOf?.(recordId),
    openSavedPhotos,
    setOwnPose,
    applyMatchedCamera,
    setFromAir,
    /** The road view's ground under the own photo, metres; NaN until it is known. */
    ownGroundMeters,
    /** The own photo's eye above that ground; null without an own photo. */
    ownEyeHeight,
    setDeclination,
    nudge,
    resetNudge,
    startOwnMatch,
    /** Where the road view's eye stands while an own photo is compared; null on the road. */
    standAt:
      comparingOwn && own.pose.lng !== null && own.pose.lat !== null ? { lng: own.pose.lng, lat: own.pose.lat } : null,
    /**
     * The own photo's eye height while it is compared (from its altitude when it has one, never under a metre, where
     * the drive camera would refuse it); the settings' otherwise.
     */
    standEyeHeightMeters: comparingOwn ? Math.max(1, ownEyeHeight ?? own.pose.eyeHeightMeters) : null,
    clear: () => {
      generation.current++
      ownRequest.current++
      abort.current?.abort()
      cameraAbort.current?.abort()
      queueAbort.current?.abort()
      featuresAbort.current?.abort()
      const match = flightMatchAbort.current
      flightMatchAbort.current = null
      match?.abort()
      setFlightMatchProgress(null)
      for (const url of objectUrls.current.values()) URL.revokeObjectURL(url)
      objectUrls.current.clear()
      caches.pixels.clear()
      caches.skyline.clear()
      caches.results.clear()
      setImage(null)
      photosRef.current = []
      setPhotos([])
      activate(null)
      setWork({})
      setQueueRun({ pending: [], running: null, paused: false, cancelled: false })
      setMatch(null)
      setInput('')
      setPendingPixel(null)
      setPhotoDrape(null)
      setDrapes(null)
      setDrapeView({ shown: false, which: 'camera' })
      setHits(null)
      setStatus({ loading: false, error: null })
      setOwnStatus({ loading: false, error: null })
    },

    // ---- The set of own photos ----
    /** Every own photo open, in time order (flights in order, each frame in its flight's order). */
    ownPhotos,
    /** The flights the photos group into, in time order, each with its photos' ids in time order. */
    ownFlights,
    /** The active photo's id. */
    activeId,
    /** Makes a photo the active one (the window, the overlays and the hand tools follow it). */
    selectOwnPhoto: (id: string | null) => {
      setPendingPixel(null)
      activate(id && photosRef.current.some((photo) => photo.id === id) ? id : null)
    },
    addOwnFiles,
    removePhoto,
    /**
     * Clears the street photo (a Mapillary image and its line-up) and nothing else. `clear` empties the reviewer's
     * own photos too, which is what that panel's button once did to a set it had nothing to do with.
     */
    clearStreetPhoto: () => {
      abort.current?.abort()
      setImage(null)
      setMatch(null)
      setInput('')
      setAlignment({ status: 'idle', fit: null, message: null })
      setToolsError(null)
    },
    /** Everything worked out for a photo: its search, model views, checks, features, priors and pairs. */
    workFor: (id: string): OwnPhotoWork => work[id] ?? EMPTY_WORK,

    // ---- The queue ----
    queue,
    /** Stops after the photo running now; the rest wait. */
    pauseQueue: () => setQueueRun((current) => ({ ...current, paused: true })),
    resumeQueue: () => setQueueRun((current) => ({ ...current, paused: false, cancelled: false })),
    /** Stops the photo running now and drops the rest from the queue. */
    cancelQueue: () => {
      queueAbort.current?.abort()
      setQueueRun((current) => ({ ...current, pending: [], paused: false, cancelled: true }))
    },
    /** Runs a photo through the queue again (after its position or lens changed, or a load failed). */
    rerun: (id: string) => {
      if (queueRun.running === id || !photosRef.current.some((photo) => photo.id === id)) return
      patchWork(id, (current) => ({ ...current, search: { status: 'idle' }, found: null }))
      enqueue([id])
    },

    // ---- Options, checks and acceptance ----
    optionsFor,
    runCombinedCameraSearch,
    /** Keeps a comparison the reviewer ran as the photo's latest, so what it favours is offered beside its options. */
    keepCombined: (id: string, result: CombinedResult) =>
      patchWork(id, (current) => ({ ...current, combined: { result, depth: !!result.depthModel } })),
    /**
     * Compares a photo's cameras with depth, downloading the small model when this browser does not hold it yet (the
     * reviewer's click is the asking). Every other photo compared without depth is then compared again by the queue,
     * which finds the model here.
     */
    compareWithDepth: async (id: string, signal: AbortSignal) => {
      const result = await runCombinedCameraSearch(
        id,
        { useSkyline: true, depthModel: AUTO_DEPTH_MODEL },
        signal,
        () => undefined,
      )
      setWork((current) =>
        Object.fromEntries(
          Object.entries(current).map(([key, entry]) => [
            key,
            key === id
              ? { ...entry, combined: { result, depth: !!result.depthModel } }
              : entry.combined && !entry.combined.depth && result.depthModel
                ? { ...entry, combined: undefined }
                : entry,
          ]),
        ),
      )
      return result
    },
    flightMatchProgress,
    flightMatcher,
    setFlightMatcher,
    flightMatchFrames: ownPhotos.map(flightFrameOf),
    runFlightMatch,
    cancelFlightMatch: () => flightMatchAbort.current?.abort(),
    useOption,
    /** `useOption` under a name that is not read as a React hook where it is called from a click. */
    chooseOption: useOption,
    checksDrawnFor,
    markChecked,
    requestCheck,
    /** Whether a check asked for is waiting for its camera's hit buffer. */
    checkPending: !!pendingCheck && pendingCheck.id === activeId,
    acceptCamera,
    ensureAccepted,
    acceptanceState,

    // ---- Use ----
    makeViewpoint,
    setJob,

    // ---- The photo on the plan, both candidates at once ----
    /** The active photo's drapes, by candidate, with their cells, hidden-ground mask, footprint and range. */
    drapes: drapes && drapes.photoId === activeId ? { camera: drapes.camera, 'runner-up': drapes['runner-up'] } : null,
    /** Whether the photo is on the plan, and which candidate is in front. */
    drapeShown: drapeView.shown,
    drapeWhich: drapeView.which,
    setDrapeWhich: (which: 'camera' | 'runner-up') => setDrapeView((current) => ({ ...current, which })),
    /** Puts the photo on the plan (following the camera) without drawing anything first. */
    showDrape: (which?: 'camera' | 'runner-up') =>
      setDrapeView((current) => ({ shown: true, which: which ?? current.which })),
    /** The heading the front drape was drawn for, degrees; the card compares it with the camera's now. */
    drapeDrawnFor:
      drapes && drapes.photoId === activeId ? (drapes[drapeView.which]?.bearing ?? null) : (null as number | null),
    /** What the drape is drawing, while it is. */
    drapeBusy,
    /** The features check for the active photo, and a way to read it again for the camera as it stands. */
    ownFeatures: activeWork.features,
    readFeatures,

    // ---- The active camera, for overlays ----
    /** The active photo's camera as it stands, in its pixels; null without a position or terrain. */
    activePose,
    activePoseKey,
    /** Where each working pixel's ray meets the ground for the active camera (debounced; compare its `poseKey`). */
    hitBuffer: activeHits,
    /** The tiles of the terrain round the active photo, as the photo worker is asked for them; null without a place. */
    ownTerrainSpec,
    /** The open photo's option cameras, as the photo would stand at each: what is made ahead is made for these. */
    optionCameras: optionCameras && optionCameras.photoId === activeId ? optionCameras.cameras : NO_CAMERAS,
    /** The photo whose options' model views are being drawn ahead now; null when none are. */
    optionViewsFor: viewsRunning,
    /** The main thread's terrain round the active photo (what `activePose` stands on); overlays lay features on it. */
    ownTerrain: ownSkylineTerrain,
    /** The scene, for what is drawn over a photo (its blocks, openings, landform, masks and views of interest). */
    ownScene: scene,
  }
}

export type FieldPhotoState = ReturnType<typeof useFieldPhoto>

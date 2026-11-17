import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react'

import { MAX_FIELD_RECORDS, type FieldRecord, type PhotoJob } from './assessmentTools'
import { HeicDecodeError } from '@/lib/heic/heicDecode'
import { showablePhoto } from '@/lib/heic/heicDecodeClient'
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
import { fitSkyline, photoSkyline, terrainProfile, type ProfilePoint, type SkylineFit } from './skylineFit'
import { wrapSigned } from './skylineAlign'
import {
  MIN_SKYLINE_COLUMNS,
  sunCheck,
  type SunCheck,
  type WideSearchInput,
  type WideSearchResult,
} from './wideOrientation'
import {
  landmarkAngles,
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
import { castPhotoHits, drapePhotoOffThread, photoHorizon, renderPhotoModelView } from './photoWorkClient'
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
import { fieldRecordRoom, ownSourcesOnReopen, photoRecordFromOwn, type OwnSearchSummary } from './photoRecords'
import {
  airborneAltitude,
  checkedPoseFor,
  controlSolveSuspect,
  featuresKey,
  horizonKey,
  imageryKey,
  lensRangeFor,
  narrowSearchSettles,
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
import { fieldImageFromBlob } from './toolImports'
import { viewFromAcceptedPhoto, type ViewOfInterest } from './viewsOfInterest'
import { demTileRange } from '@/lib/forestry/terrain/terrain'

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

/** A model view: the imagery seen from a camera, scored against the photo, and the camera it was drawn for. */
export type ModelViewImage = { url: string; bearing: number; score: number; pose?: AcceptancePose; poseKey?: string }

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
      /** The accepted burst neighbour the search started round, and whether its narrow search stood alone. */
      neighbour?: {
        id: string
        name: string
        gapSeconds: number
        narrowStood: boolean
        /**
         * The narrow search's fit when it did not stand alone but agreed with the neighbour's camera
         * (`narrowAgreement`): evidence beside the full search, which alone settles a fit.
         */
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
  modelViews: Partial<Record<'camera' | 'runner-up', ModelViewImage>>
  /** Every camera check images (model views, a full drape) were drawn for, the newest last. */
  checked: AcceptancePose[]
  features: OwnPhotoFeatures | null
  /** What the queue learned on the way: the lens, terrain and skyline, and why it stopped. */
  found: PhotoFound | null
  priors: CameraPriors
  landmark: Landmark | null
  pairs: ControlPair[]
  /** Paired points the reviewer left out of the solve: still drawn, as check points. Absent: all are in. */
  pairsOff?: string[]
  controlSolve: ControlSolveResult | null
}

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
  /** The scene's views of interest, for *Make a viewpoint* and for unlinking a removed photo. */
  setViewsOfInterest?: (update: (views: ViewOfInterest[]) => ViewOfInterest[]) => void
}) {
  const [photos, setPhotos] = useState<OwnPhoto[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [work, setWork] = useState<Record<string, OwnPhotoWork>>({})
  const [queueRun, setQueueRun] = useState<QueueRun>({ pending: [], running: null, paused: false, cancelled: false })
  const photosRef = useRef(photos)
  photosRef.current = photos
  const workRef = useRef(work)
  workRef.current = work
  const activeRef = useRef(activeId)
  const sceneRef = useRef(scene)
  sceneRef.current = scene
  const callbacks = useRef({ onOriginalPhoto, onRemoveOriginal, setViewsOfInterest })
  callbacks.current = { onOriginalPhoto, onRemoveOriginal, setViewsOfInterest }
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

  const activate = useCallback((id: string | null) => {
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
    imagery: new PhotoCache<ImageryLayer[]>({ maxEntries: 2 }),
    /** Hit buffers by camera (`photoPoseKey`). */
    hits: new PhotoCache<HitBuffer>({ maxEntries: 6 }),
    /** Features read for a box (`featuresKey`). */
    features: new PhotoCache<PhotoFeatureReads>({ maxEntries: 12, sizeOf: () => 0 }),
  }))
  /** Bumped when terrain loads, so what is drawn from it follows. */
  const [terrainVersion, setTerrainVersion] = useState(0)

  const ownRequest = useRef(0)
  const [ownStatus, setOwnStatus] = useState<{ loading: boolean; error: string | null; stage?: string }>({
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
  const ownSkylineTerrain = useMemo(
    () => (own && positioned(own) ? (caches.terrain.get(terrainSpecKey(specOf(own))) ?? null) : null),
    // The cache is read again whenever terrain loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ownLng, ownLat, terrainVersion, caches],
  )
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
  /** The photo's own skyline, read once, in `pose`'s pixels. */
  const skylineOf = (photo: OwnPhoto, pixels: ImageData, pose: PhotoPose) => {
    let read = caches.skyline.get(photo.src)
    if (!read) {
      read = photoSkyline(pixels, 200)
      caches.skyline.set(photo.src, read)
    }
    const sx = pose.width / pixels.width,
      sy = pose.height / pixels.height
    return read.map((point) => (point ? { x: point.x * sx, y: point.y * sy } : null))
  }
  /** Imagery near (zoom 14 to 6 km), middle (zoom 11 to 25 km) and far (zoom 9 to 90 km) round a place. */
  const imageryLayers = (lng: number, lat: number, signal: AbortSignal) =>
    caches.imagery.getOrCreate(
      imageryKey(lng, lat),
      async (shared) => {
        const box = (radius: number): [number, number, number, number] => {
          const degLat = radius / 110574,
            degLng = radius / (111320 * Math.cos((lat * Math.PI) / 180))
          return [lng - degLng, lat - degLat, lng + degLng, lat + degLat]
        }
        const layers = await Promise.all([
          loadImageryMosaic(box(6000), 14, shared),
          loadImageryMosaic(box(25000), 11, shared),
          loadImageryMosaic(box(WIDE_RADIUS_METERS), 9, shared),
        ])
        return layers.map((mosaic) => mosaic.layer)
      },
      signal,
    )
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
      key,
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
   * search, first round an accepted burst neighbour's camera when asked and one is near, and over every heading when
   * that does not settle. `setPose` applies the winner. Null when it stopped, with the reason kept on the photo.
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
      return stop('No position: pick where it was taken on the plan, or type it, then run it again.', {
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
    const skyline = skylineOf(photo, pixels, base)
    if (skyline.filter(Boolean).length < MIN_SKYLINE_COLUMNS)
      return stop('Too little open sky over distant terrain to search by. Pair points instead.', {
        lens: photo.lens,
        terrain: true,
        skyline: false,
      })
    const progress = (from: number, share: number) => (done: number) =>
      patchWork(id, (current) => ({
        ...current,
        search: { status: 'working', stage: 'search', done: from + done * share },
      }))
    patchWork(id, (current) => ({ ...current, search: { status: 'working', stage: 'search', done: 0 } }))
    const neighbour = neighbourFirst ? neighbourOf(photo) : null
    let found: WideSearchResult | null = null
    let narrowStood = false
    let narrowFit: NarrowFit | null = null
    if (neighbour) {
      const narrow = await runSearch(
        photo,
        base,
        profile,
        skyline,
        neighbourPriors(neighbour.photo.pose),
        signal,
        progress(0, 0.2),
      )
      narrowStood = narrowSearchSettles(narrow)
      if (narrowStood) found = narrow
      else {
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
    }
    if (!found)
      found = await runSearch(photo, base, profile, skyline, searchPriors, signal, progress(neighbour ? 0.2 : 0, 0.8))
    signal.throwIfAborted()
    if (!found)
      return stop('Too little open sky over distant terrain to search by. Pair points instead.', {
        lens: photo.lens,
        terrain: true,
        skyline: false,
      })
    const result = found
    const utc = utcOf(photo)
    const at = (angles: { bearing: number; pitch: number; roll: number }) => sunCheck({ ...base, ...angles }, utc!)
    const recorded = photo.exif?.heading?.degrees ?? null
    const notes: string[] = []
    if (lifted !== null)
      notes.push(
        `Taken from the air: its GPS altitude is ${Math.round(lifted - groundMeters)} m above the ground, so the eye stands at ${Math.round(lifted)} m.`,
      )
    if (neighbour && narrowStood)
      notes.push(
        `Found round ${neighbour.photo.name}’s camera (${Math.abs(Math.round(neighbour.gapSeconds))} s ${neighbour.gapSeconds < 0 ? 'before' : 'after'}); the all-headings search was not needed.`,
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
              narrowStood,
              narrow: narrowFit,
            }
          : null,
      },
      found: { lens: photo.lens, terrain: true, skyline: true, notes },
    }))
    if (setPose)
      patchPhoto(id, (current) => {
        if (
          setPose === 'if-automatic' &&
          (!queueMaySetPose(current.sources.heading) ||
            current.pose.lng !== photo.pose.lng ||
            current.pose.lat !== photo.pose.lat ||
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
    which: 'camera' | 'runner-up',
    angles: { bearing: number; pitch: number; roll: number; hfov?: number },
    signal: AbortSignal,
    onProgress?: (done: number) => void,
    { check = true }: { check?: boolean } = {},
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
        width: MODEL_VIEW_WIDTH,
        maxMeters: WIDE_RADIUS_METERS,
      },
      signal,
      (_, done) => onProgress?.(done),
    )
    const checkedPose = acceptancePoseOf(photo, { ...angles, hfov: angles.hfov ?? photo.pose.hfov })!
    const view: ModelViewImage = {
      url: rgbaDataUrl(drawn),
      bearing: pose.bearing,
      score: agreement ? agreement.score : Number.NaN,
      pose: checkedPose,
      poseKey: photoPoseKey(pose),
    }
    patchWork(id, (current) => ({
      ...current,
      modelViews: { ...current.modelViews, [which]: view },
      checked: check ? withCheckedPose(current.checked, checkedPose) : current.checked,
    }))
    return view
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
            (shared) => readPhotoFeatures(bounds, (url, init) => fetch(url, init), { signal: shared }),
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

  /** One photo through the queue: the search, model views for the winner and the runner-up, the features check. */
  const runPhoto = async (id: string, signal: AbortSignal) => {
    const photo = photoById(id)
    if (!photo) return
    try {
      const stage = await searchStage(id, { searchPriors: {}, neighbourFirst: true, setPose: 'if-automatic' }, signal)
      if (!stage) return
      const { result } = stage
      const winner = { bearing: result.bearing, pitch: result.pitch, roll: result.roll, hfov: result.hfov }
      try {
        await drawModelView(id, 'camera', winner, signal, undefined, { check: false })
        if (result.runnerUp)
          await drawModelView(id, 'runner-up', { ...result.runnerUp, hfov: result.hfov }, signal, undefined, {
            check: false,
          })
      } catch (error) {
        if (aborted(signal)) throw error
        addNote(id, `The model views were not drawn: ${reason(error)}`)
      }
      await checkFeatures(id, winner, signal)
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
  useEffect(() => {
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

  // ---------------------------------------------------------------------------------------------------------------
  // The options card, acceptance and the photo's jobs.

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
      const input: PhotoOptionsInput = {
        base: {
          lng: photo.pose.lng,
          lat: photo.pose.lat,
          altitudeMeters: photo.pose.altitudeMeters ?? null,
          hfov: photo.pose.hfov,
        },
        search: search ? { result: search.result, sun: search.sun } : null,
        modelScores: Object.fromEntries(
          (['camera', 'runner-up'] as const).flatMap((which) => {
            const view = w.modelViews[which]
            return view && Number.isFinite(view.score) ? [[which, { bearing: view.bearing, score: view.score }]] : []
          }),
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
      }
      return photoOptions(input)
    },
    // neighbourOf reads the photos through their ref, which `photos` keeps current.
    [photos, work],
  )

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
            ...(moves
              ? {
                  lng: row.pose.lng,
                  lat: row.pose.lat,
                  hfov: clampFov(row.pose.hfov),
                  ...(row.pose.altitudeMeters !== null ? { altitudeMeters: row.pose.altitudeMeters } : {}),
                }
              : {}),
          },
          sources: {
            ...photo.sources,
            heading: sources.heading,
            pitch: sources.pitch,
            roll: sources.roll,
            ...(moves ? { position: sources.position!, fov: sources.position!, eyeHeight: sources.position! } : {}),
          },
          chosen: { rowId: row.id, kind: row.kind, pose: row.pose, evidence: row.evidence },
        }
      })
      return true
    },
    [optionsFor, patchPhoto],
  )

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
   * Makes an accepted photo's camera a view of interest (`viewFromAcceptedPhoto`), or updates the one it already
   * made, and links the photo to it as a viewpoint.
   */
  const makeViewpoint = useCallback(
    (id: string): { ok: true; viewId: string; added: boolean } | { ok: false; reason: string } => {
      const photo = photos.find((entry) => entry.id === id)
      if (!photo) return { ok: false, reason: 'That photo is no longer open.' }
      const set = callbacks.current.setViewsOfInterest
      if (!set) return { ok: false, reason: 'Views of interest cannot be listed from here.' }
      if (!photo.recordId) return { ok: false, reason: 'The photo is not in the workspace’s field records.' }
      const link = viewFromAcceptedPhoto(
        { id: photo.recordId, name: photo.name, acceptance: photo.acceptance },
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
    [photos, setJob],
  )

  // ---------------------------------------------------------------------------------------------------------------
  // Opening photos.

  /** Reads one picked file: decoded, its tags, its lens and time, its starting pose and its record. */
  const readOwnFile = async (
    file: File,
    roadView: RoadViewPose | null,
    saved: SavedOwnPhoto | null,
    onDecoding: () => void,
  ): Promise<{ photo: OwnPhoto; record: FieldRecord }> => {
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
      const start = startingPose({ exif, roadView, eyeHeightMeters })
      const lens = tags ? lensCheck({ exif: tags, decodedWidth: size.width, decodedHeight: size.height }) : null
      const taken = takenAtUtc(tags)
      const id = saved?.recordId ?? createId('field')
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
        acceptance: saved?.acceptance ?? null,
        uses: saved?.uses ?? [],
        chosen: null,
        savedSearch: saved?.search ?? null,
      }
      return { photo, record }
    } catch (error) {
      if (src) URL.revokeObjectURL(src)
      throw new Error(
        error instanceof HeicDecodeError || isHeic(file)
          ? `This HEIC photo could not be decoded here: ${reason(error)} Export it as JPEG, keeping its location, and open that.`
          : `Could not read the photo: ${reason(error)}`,
      )
    }
  }

  /** Puts photos into the set as the active one's neighbours, makes `activeId` (else the earliest) active and queues them. */
  const takePhotos = (made: OwnPhoto[], activeId?: string | null) => {
    for (const photo of made) {
      // A photo opened again replaces its earlier copy: release that copy's URL and pixels.
      const earlier = photosRef.current.find((other) => other.id === photo.id)
      if (earlier && earlier.src !== photo.src) {
        caches.pixels.delete(earlier.src)
        caches.skyline.delete(earlier.src)
        if (earlier.objectUrl) URL.revokeObjectURL(earlier.src)
      }
      if (photo.objectUrl) objectUrls.current.set(photo.id, photo.src)
      else objectUrls.current.delete(photo.id)
    }
    const ids = new Set(made.map((photo) => photo.id))
    setPhotos((current) => withPhotoFlights([...current.filter((photo) => !ids.has(photo.id)), ...made]))
    const first =
      (activeId && made.some((photo) => photo.id === activeId) ? activeId : null) ?? queueOrder(made)[0] ?? null
    abort.current?.abort()
    setImage(null)
    setMatch(null)
    setAlignment({ status: 'idle', fit: null, message: null })
    setToolsError(null)
    if (first) activate(first)
    enqueue(queueOrder(made))
  }

  /**
   * Adds the reviewer's own photos: each decoded (a HEIC in a worker), its EXIF read, its record made and added to
   * the assessment tools, its original kept as the record's attachment, grouped into flights, and queued. A set
   * larger than the workspace's room is refused before any is read.
   */
  const addOwnFiles = useCallback(
    async (files: File[], roadView: RoadViewPose | null = null): Promise<AddOwnFilesResult> => {
      const started = generation.current
      const bridge = records?.current
      const refused = fieldRecordRoom(bridge?.fieldCount?.() ?? 0, files.length)
      if (refused || files.length > MAX_FIELD_RECORDS) {
        const text = refused ?? fieldRecordRoom(0, files.length)!
        setOwnStatus({ loading: false, error: text })
        return { added: [], refused: text, errors: [] }
      }
      const made: Array<{ photo: OwnPhoto; record: FieldRecord; file: File }> = []
      const errors: string[] = []
      for (const [i, file] of files.entries()) {
        const stage = files.length > 1 ? `Reading photo ${i + 1} of ${files.length}…` : 'Reading the photo…'
        setOwnStatus({ loading: true, error: null, stage })
        try {
          const read = await readOwnFile(file, roadView, null, () =>
            setOwnStatus({ loading: true, error: null, stage: `${stage} Decoding the HEIC photo in this browser…` }),
          )
          made.push({ ...read, file })
        } catch (error) {
          errors.push(files.length > 1 ? `${file.name}: ${reason(error)}` : reason(error))
        }
        if (started !== generation.current) {
          for (const { photo } of made) URL.revokeObjectURL(photo.src)
          return { added: [], refused: null, errors }
        }
      }
      if (!made.length) {
        setOwnStatus({ loading: false, error: errors.join(' ') || 'No photo was read.' })
        return { added: [], refused: null, errors }
      }
      const full = bridge ? bridge.addPhotoRecords(made.map(({ record }) => record)) : null
      if (full) {
        for (const { photo } of made) URL.revokeObjectURL(photo.src)
        setOwnStatus({ loading: false, error: full })
        return { added: [], refused: full, errors }
      }
      const photosMade = made.map(({ photo }) => (bridge ? photo : { ...photo, recordId: null }))
      for (const { file, photo } of made) callbacks.current.onOriginalPhoto?.(file, photo.id)
      takePhotos(photosMade)
      setOwnStatus({ loading: false, error: errors.length ? errors.join(' ') : null })
      return { added: queueOrder(photosMade), refused: null, errors }
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
      const made: OwnPhoto[] = []
      const errors: string[] = []
      for (const [i, { file, saved }] of entries.entries()) {
        const stage = entries.length > 1 ? `Reading photo ${i + 1} of ${entries.length}…` : 'Reading the photo…'
        setOwnStatus({ loading: true, error: null, stage })
        const record = saved.recordId ? (bridge?.getRecord?.(saved.recordId) ?? null) : null
        const held = record ? { ...saved, acceptance: record.acceptance ?? null, uses: record.uses ?? [] } : saved
        try {
          const { photo, record: madeRecord } = await readOwnFile(file, null, held, () =>
            setOwnStatus({ loading: true, error: null, stage: `${stage} Decoding the HEIC photo in this browser…` }),
          )
          if (started !== generation.current) {
            URL.revokeObjectURL(photo.src)
            for (const other of made) URL.revokeObjectURL(other.src)
            return false
          }
          // An older project kept a photo with no record: it becomes one now when there is room.
          const recorded = saved.recordId ? true : !(bridge?.addPhotoRecords([madeRecord]) ?? 'none')
          made.push(recorded ? photo : { ...photo, recordId: null })
        } catch (error) {
          errors.push(entries.length > 1 ? `${file.name}: ${reason(error)}` : reason(error))
        }
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

  /** Opens a field record's stored photo into the set, starting from the camera the record holds. */
  const openOwnRecord = useCallback(
    (record: FieldRecord, roadView: RoadViewPose | null) => {
      ownRequest.current++
      if (photosRef.current.some((photo) => photo.id === record.id)) {
        activate(record.id)
        return
      }
      const start = startingPose({ exif: null, record, roadView, eyeHeightMeters })
      // An accepted camera stands its eye where it was accepted (an aircraft photo up in the air), or the reopened
      // photo would stand on the ground and read its acceptance as lapsed. Without one, the record's GPS altitude
      // lifts an aircraft photo before its search, as the EXIF would.
      const acceptedAltitude = record.acceptance?.pose.altitudeMeters ?? null
      const pose = acceptedAltitude === null ? start.pose : { ...start.pose, altitudeMeters: acceptedAltitude }
      const sources: OwnPoseSources =
        acceptedAltitude === null ? start.sources : { ...start.sources, eyeHeight: 'record' }
      setOwnStatus({ loading: false, error: null })
      takePhotos([
        {
          id: record.id,
          name: record.name,
          src: record.image,
          objectUrl: false,
          width: record.width,
          height: record.height,
          recordId: record.id,
          exif: null,
          pose,
          sources,
          start: { pose, sources },
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
        },
      ])
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eyeHeightMeters, activate],
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
      setQueueRun((current) => ({ ...current, pending: current.pending.filter((other) => other !== id) }))
      const url = objectUrls.current.get(id)
      if (url) URL.revokeObjectURL(url)
      objectUrls.current.delete(id)
      caches.pixels.delete(photo.src)
      caches.skyline.delete(photo.src)
      setPhotos((current) => withPhotoFlights(current.filter((other) => other.id !== id)))
      const rest = photosRef.current.filter((other) => other.id !== id)
      setWork((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)))
      if (activeRef.current === id) activate(queueOrder(rest)[0] ?? null)
    },
    [queueRun.running, records, caches, activate],
  )

  // ---------------------------------------------------------------------------------------------------------------
  // The hand tools, on the active photo.

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
      const known = own.sources.position === 'exif' || own.sources.position === 'record'
      const off = new Set(activeWork.pairsOff ?? [])
      const solved = solveFromControls({
        start,
        pairs: pairs.filter((pair) => !off.has(pair.id)),
        unknowns: {
          heading: angle('heading'),
          pitch: angle('pitch'),
          roll: angle('roll'),
          // A picked position is a guess: free it, unless the photo's own fix or a record gave it.
          ...(known ? {} : { east: { mode: 'free' }, north: { mode: 'free' } }),
        },
      })
      if (!solved) {
        setToolsError(
          `Pair at least ${pairsNeeded()} points: click a spot in the photo, then the same spot on the plan.`,
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
          position: 'controls',
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
  }, [own, pairs, activeWork.pairsOff, priors, loadOwnTerrain, patchWork, patchPhoto])

  /** The angles of the camera to check: the photo's current one, or the skyline search's runner-up. */
  const candidateAngles = (which: 'camera' | 'runner-up') =>
    which === 'runner-up' && cameraSearch.status === 'done' && cameraSearch.result.runnerUp
      ? cameraSearch.result.runnerUp
      : own
        ? { bearing: own.pose.bearing, pitch: own.pose.pitch, roll: own.pose.roll }
        : null

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
    const checked = acceptancePoseOf(photo, { bearing: pose.bearing, pitch: pose.pitch, roll: pose.roll })!
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
    const runnerUp = cameraSearch.status === 'done' ? cameraSearch.result.runnerUp : null
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
    async (which: 'camera' | 'runner-up') => {
      const angles = candidateAngles(which)
      if (!own || !angles || !positioned(own)) return
      setToolsBusy('Loading imagery…')
      try {
        await drawModelView(own.id, which, angles, new AbortController().signal, (done) =>
          setToolsBusy(`Drawing the model view… ${Math.round(done * 100)}%`),
        )
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

  /** Swaps to the search's runner-up heading, to compare it with the photo. */
  const tryRunnerUp = useCallback(() => {
    if (!own || cameraSearch.status !== 'done' || !cameraSearch.result.runnerUp) return
    const id = own.id
    const { result } = cameraSearch
    const runnerUp = result.runnerUp!
    patchPhoto(id, (current) => ({
      ...current,
      pose: { ...current.pose, bearing: runnerUp.bearing, pitch: runnerUp.pitch, roll: runnerUp.roll },
    }))
    patchWork(id, (current) => ({
      ...current,
      search: {
        ...cameraSearch,
        result: {
          ...result,
          bearing: runnerUp.bearing,
          pitch: runnerUp.pitch,
          roll: runnerUp.roll,
          meanLoss: runnerUp.meanLoss,
          runnerUp: { bearing: result.bearing, pitch: result.pitch, roll: result.roll, meanLoss: result.meanLoss },
        },
        sun:
          cameraSearch.sun && cameraSearch.sun.runnerUp
            ? { best: cameraSearch.sun.runnerUp, runnerUp: cameraSearch.sun.best }
            : cameraSearch.sun,
        recordedOffBy:
          cameraSearch.recordedOffBy === null
            ? null
            : ((cameraSearch.recordedOffBy + result.bearing - runnerUp.bearing + 540) % 360) - 180,
      },
      // The model views are keyed by "the camera" and "the runner-up", which have just swapped.
      modelViews: { camera: current.modelViews['runner-up'], 'runner-up': current.modelViews.camera },
    }))
  }, [own, cameraSearch, patchPhoto, patchWork])

  // ---------------------------------------------------------------------------------------------------------------
  // The hit buffer for the active photo's camera, for what is drawn over the photo.

  const [hits, setHits] = useState<{ photoId: string; buffer: HitBuffer } | null>(null)
  useEffect(() => {
    if (!own || !activePose || !activePoseKey || !positioned(own)) return
    const photo = own,
      pose = activePose
    const held = caches.hits.get(activePoseKey)
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

  /**
   * A camera matched by the photo-matching bench: its position, altitude, heading, pitch, roll and lens, each marked
   * as matched. It also becomes the pose Reset returns to.
   */
  const applyMatchedCamera = useCallback(
    (camera: MatchedCamera, fileName: string, checks: string[]) => {
      setOwn((current) => {
        if (!current) return current
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
    [setOwn],
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
          otherOptions: options.filter((option) => option.kind !== 'phone').length,
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
    findCamera,
    tryRunnerUp,
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
    closeOwnDialog: () => setOwnDialog((current) => ({ ...current, open: false })),
    /** The terrain skyline for the active photo's camera, in its pixels; null until its terrain is loaded. */
    ownSkyline,
    ownSkylineStatus,
    loadOwnSkyline,
    ownFov,
    ownOnRoad,
    ownStand,
    openOwnFile,
    openOwnRecord,
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
    useOption,
    /** `useOption` under a name that is not read as a React hook where it is called from a click. */
    chooseOption: useOption,
    checksDrawnFor,
    markChecked,
    requestCheck,
    /** Whether a check asked for is waiting for its camera's hit buffer. */
    checkPending: !!pendingCheck && pendingCheck.id === activeId,
    acceptCamera,
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
    hitBuffer: hits && hits.photoId === activeId ? hits.buffer : null,
    /** The main thread's terrain round the active photo (what `activePose` stands on); overlays lay features on it. */
    ownTerrain: ownSkylineTerrain,
    /** The scene, for what is drawn over a photo (its blocks, openings, landform, masks and views of interest). */
    ownScene: scene,
  }
}

export type FieldPhotoState = ReturnType<typeof useFieldPhoto>

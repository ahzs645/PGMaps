import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { FieldRecord } from './assessmentTools'
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
import { sunCheck, type SunCheck, type WideSearchInput, type WideSearchResult } from './wideOrientation'
import {
  landmarkAngles,
  pairsNeeded,
  solveFromControls,
  type ControlPair,
  type ControlSolveResult,
  type UnknownSpec,
} from './controlPose'
import {
  drapePhoto,
  modelAgreement,
  modelViewHeight,
  renderModelView,
  type Bounds,
  type ImagerySampler,
} from './photoViews'
import { layeredSampler, loadImageryMosaic } from './imageryMosaic'
import { runWideOrientation } from './wideOrientationClient'
import { nearestPointOnLine } from './roadSnap'
import type { ForestryScene } from './scene'
import { demTileRange, type ElevationSource } from '@/lib/forestry/terrain/terrain'
import type { AnalysisResult } from './types'
import { bearingDegrees, polygonBounds } from './visibility'
import { visibleProposalCentre } from './vqe'

/** How far the photo skyline looks, and the coarse terrain it is drawn from. */
const SKYLINE_RADIUS_METERS = 25000
const SKYLINE_ZOOM = 11
/** The lens a view cut from a 360° photo is given: about a phone's, in portrait terms. */
const PANO_VIEW_FOV = 60
/** Height of that cut view, in pixels; its width follows the map's shape. */
const PANO_VIEW_HEIGHT = 720
/** The largest own photo read; the same limit as a field record's import. */
const OWN_PHOTO_MAX_BYTES = 25_000_000

/**
 * The reviewer's own photo, lined up like a Mapillary one. It is read in the
 * browser and never leaves it: a picked file is an object URL, a field record
 * its stored copy. Every pose value is a suggestion the reviewer can change.
 */
export type OwnPhoto = {
  id: string
  name: string
  src: string
  /** Whether `src` is an object URL this hook made and must revoke. */
  objectUrl: boolean
  width: number
  height: number
  /** The field record it came from, so a confirmed pose can be saved back. */
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
  } | null
}

/** Whether the road view can stand where the own photo was taken, and why not. */
export type OwnStand =
  | { status: 'no-position' }
  | { status: 'too-far'; offRoadMeters: number }
  | { status: 'no-terrain'; offRoadMeters: number }
  | { status: 'ok'; offRoadMeters: number; alongMeters: number }

/**
 * Terrain for the all-headings search: an aircraft sees ridges far beyond the overlay's 25 km. The overlay's own
 * terrain (zoom 11 to 25 km) is used first; past it a coarser ring at zoom 9 (about 180 m cells, some 20 tiles)
 * is enough for ridges 25–90 km off.
 */
const WIDE_RADIUS_METERS = 90000
const WIDE_MAX_ZOOM = 9
const WIDE_MAX_TILES = 40
/** A tilt-sensor pitch is used only while it reads gravity alone (|a| within this of 1 g), then ± this many degrees. */
const TILT_G_TOLERANCE = 0.05
const TILT_PITCH_SPAN = 6
/** The photo's width while its skyline is read, as the photo-matching bench reads it. */
const WIDE_WORK_WIDTH = 1050

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

export type ModelViewImage = { url: string; bearing: number; score: number }

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
    }
  | { status: 'failed'; message: string }

const isHeic = (file: File) => /\.hei[cf]$/i.test(file.name) || /image\/hei[cf]/i.test(file.type)

const decodeImage = async (src: string) => {
  const picture = new Image()
  picture.src = src
  await picture.decode()
  // Natural size is after the EXIF orientation, as the photo is shown.
  return { width: picture.naturalWidth, height: picture.naturalHeight }
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
 * A field photo from Mapillary and everything needed to stand the preview
 * camera where it was taken, and to draw the terrain skyline and the cutblock
 * onto it. The page renders the panel and the overlay; this owns the state.
 */
export function useFieldPhoto({
  scene,
  result,
  ground,
  eyeHeightMeters,
}: {
  scene: ForestryScene
  result: AnalysisResult | null
  /** The preview's fixed terrain, when the drive is open; otherwise the skyline terrain is used. */
  ground: ElevationSource | null
  eyeHeightMeters: number
}) {
  const [own, setOwn] = useState<OwnPhoto | null>(null)
  const [ownStatus, setOwnStatus] = useState<{ loading: boolean; error: string | null }>({
    loading: false,
    error: null,
  })
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
  const [cameraSearch, setCameraSearch] = useState<CameraSearch>({ status: 'idle' })
  const [priors, setPriors] = useState<CameraPriors>({})
  const [landmark, setLandmark] = useState<{
    lng: number
    lat: number
    elevation: number
    bearing: number
    pitch: number
    distanceMeters: number
  } | null>(null)
  const [pairs, setPairs] = useState<ControlPair[]>([])
  const [pendingPixel, setPendingPixel] = useState<[number, number] | null>(null)
  const [controlSolve, setControlSolve] = useState<ControlSolveResult | null>(null)
  const [photoDrape, setPhotoDrape] = useState<PhotoDrape | null>(null)
  const [modelViews, setModelViews] = useState<Partial<Record<'camera' | 'runner-up', ModelViewImage>>>({})
  const [toolsBusy, setToolsBusy] = useState<string | null>(null)
  const [toolsError, setToolsError] = useState<string | null>(null)
  const cameraAbort = useRef<AbortController | null>(null)
  const wideHorizon = useRef<{ id: string; profile: ProfilePoint[] } | null>(null)
  const [alignment, setAlignment] = useState<{
    status: 'idle' | 'working' | 'done' | 'failed'
    fit: SkylineFit | null
    message: string | null
  }>({ status: 'idle', fit: null, message: null })

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
    [token],
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

  // A picked file's object URL lives as long as the photo is open.
  const ownObjectUrl = own?.objectUrl ? own.src : null
  useEffect(() => {
    if (!ownObjectUrl) return
    return () => URL.revokeObjectURL(ownObjectUrl)
  }, [ownObjectUrl])

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
  }, [image, own, match, drawing, skylineSource, panoFrame])

  /**
   * Terrain round the own photo for its camera tools: the zoom-11 mosaic to 25 km over a zoom-9 ring to 90 km, loaded
   * once per spot. The tools need no road view, so they work for a photo taken far from the scene's road.
   */
  const ownTerrain = useRef<{ id: string; source: ElevationSource } | null>(null)
  const loadOwnTerrain = useCallback(
    async (lng: number, lat: number, signal: AbortSignal, onTiles?: (loaded: number, total: number) => void) => {
      const id = `${lng.toFixed(3)},${lat.toFixed(3)}`
      if (ownTerrain.current?.id === id) return ownTerrain.current.source
      const rangeFor = (radius: number, maxZoom: number, maxTiles: number) => {
        const degLat = radius / 110574
        const degLng = radius / (111320 * Math.cos((lat * Math.PI) / 180))
        const bounds: [number, number, number, number] = [lng - degLng, lat - degLat, lng + degLng, lat + degLat]
        let zoom = maxZoom
        let range = demTileRange(bounds, zoom)
        while (range.tileCount > maxTiles && zoom > 4) range = demTileRange(bounds, --zoom)
        return range
      }
      const nearRange = rangeFor(SKYLINE_RADIUS_METERS, SKYLINE_ZOOM, 160)
      const farRange = rangeFor(WIDE_RADIUS_METERS, WIDE_MAX_ZOOM, WIDE_MAX_TILES)
      const total = nearRange.tileCount + farRange.tileCount
      let nearDone = 0,
        farDone = 0
      const [near, far] = await Promise.all([
        loadElevationGrid({
          range: nearRange,
          signal,
          concurrency: 4,
          onProgress: (loaded) => onTiles?.((nearDone = loaded) + farDone, total),
        }),
        loadElevationGrid({
          range: farRange,
          signal,
          concurrency: 2,
          onProgress: (loaded) => onTiles?.(nearDone + (farDone = loaded), total),
        }),
      ])
      const source: ElevationSource = {
        elevationAt: (x, y) => {
          const z = near.grid.elevationAt(x, y)
          return Number.isFinite(z) ? z : far.grid.elevationAt(x, y)
        },
      }
      ownTerrain.current = { id, source }
      return source
    },
    [],
  )
  /** The own photo's camera in its own pixels (as displayed), standing on `terrain`. */
  const ownCamera = (
    current: OwnPhoto,
    terrain: ElevationSource,
    angles?: { bearing: number; pitch: number; roll: number },
  ) => {
    const lng = current.pose.lng!,
      lat = current.pose.lat!
    return ownPhotoPose(
      { ...current.pose, lng, lat, ...angles },
      terrain.elevationAt(lng, lat),
      current.width,
      current.height,
    )
  }
  /** The own photo's pixels at the bench's working width, kept while the photo is open. */
  const ownPixels = useRef<{ src: string; pixels: ImageData } | null>(null)
  const readOwnPixels = async (current: OwnPhoto) => {
    if (ownPixels.current?.src === current.src) return ownPixels.current.pixels
    const picture = new Image()
    picture.src = current.src
    await picture.decode()
    const width = Math.min(WIDE_WORK_WIDTH, picture.naturalWidth)
    const height = Math.round((picture.naturalHeight * width) / picture.naturalWidth)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })!
    context.drawImage(picture, 0, 0, width, height)
    const pixels = context.getImageData(0, 0, width, height)
    ownPixels.current = { src: current.src, pixels }
    return pixels
  }

  /**
   * Finds heading, pitch and roll from the photo's skyline over every heading (`wideOrientation.ts`, in a worker),
   * within the reviewer's priors: for a photo from the air, or any photo whose recorded heading is not trusted.
   */
  const findCamera = useCallback(async () => {
    if (!own || own.pose.lng === null || own.pose.lat === null) return
    cameraAbort.current?.abort()
    const controller = new AbortController()
    cameraAbort.current = controller
    const t0 = performance.now()
    try {
      setCameraSearch({ status: 'working', stage: 'terrain', done: 0 })
      const terrain = await loadOwnTerrain(own.pose.lng, own.pose.lat, controller.signal, (loaded, total) =>
        setCameraSearch({ status: 'working', stage: 'terrain', done: loaded / total, tiles: { loaded, total } }),
      )
      const base = ownCamera(own, terrain)
      const { lng, lat, altitudeMeters } = base
      const id = `${lng.toFixed(4)},${lat.toFixed(4)},${Math.round(altitudeMeters)}`
      let profile = wideHorizon.current?.id === id ? wideHorizon.current.profile : null
      if (!profile) {
        profile = terrainProfile({ lng, lat, altitudeMeters }, terrain, {
          from: 0,
          to: 359.9,
          step: 0.1,
          maxDistanceMeters: WIDE_RADIUS_METERS * 0.95,
        })
        wideHorizon.current = { id, profile }
      }
      setCameraSearch({ status: 'working', stage: 'photo', done: 0 })
      const pixels = await readOwnPixels(own)
      const sx = base.width / pixels.width,
        sy = base.height / pixels.height
      const skyline = photoSkyline(pixels, 200).map((point) => (point ? { x: point.x * sx, y: point.y * sy } : null))
      const tilt = own.exif?.tilt
      const tiltOk = !!tilt && Math.abs(tilt.g - 1) <= TILT_G_TOLERANCE
      const airborne = own.pose.altitudeMeters !== null && own.pose.altitudeMeters !== undefined
      const pitchRange: [number, number] = tiltOk
        ? [tilt.pitch - TILT_PITCH_SPAN, tilt.pitch + TILT_PITCH_SPAN]
        : airborne
          ? [-50, 10]
          : [-20, 15]
      setCameraSearch({ status: 'working', stage: 'search', done: 0 })
      const result = await runWideOrientation(
        { pose: { ...base, roll: 0 }, profile, skyline, pitchRange, rollRange: [-15, 15], headingSpan: 180, priors },
        controller.signal,
        (done) => setCameraSearch({ status: 'working', stage: 'search', done }),
      )
      if (controller.signal.aborted) return
      if (!result) {
        setCameraSearch({
          status: 'failed',
          message: 'Too little open sky over distant terrain to search by. Pair points instead.',
        })
        return
      }
      const utc = own.exif?.gpsTimeUtc ? new Date(own.exif.gpsTimeUtc) : null
      const at = (pose: { bearing: number; pitch: number; roll: number }) => sunCheck({ ...base, ...pose }, utc!)
      const recorded = own.exif?.heading?.degrees ?? null
      setOwn((current) =>
        current
          ? {
              ...current,
              pose: { ...current.pose, bearing: result.bearing, pitch: result.pitch, roll: result.roll },
              sources: { ...current.sources, heading: 'skyline', pitch: 'skyline', roll: 'skyline' },
            }
          : current,
      )
      setCameraSearch({
        status: 'done',
        result,
        sun: utc ? { best: at(result), runnerUp: result.runnerUp ? at(result.runnerUp) : null } : null,
        recordedOffBy: recorded === null ? null : ((recorded - result.bearing + 540) % 360) - 180,
        seconds: (performance.now() - t0) / 1000,
      })
    } catch (error) {
      if (controller.signal.aborted) return
      setCameraSearch({
        status: 'failed',
        message: `The camera search stopped: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
    // ownCamera and readOwnPixels read only refs and their arguments.
  }, [own, priors, loadOwnTerrain])

  /** Turns a spot picked on the plan at the photo's centre into heading and pitch, and holds them as priors. */
  const pickLandmark = useCallback(
    async (lng: number, lat: number) => {
      if (!own || own.pose.lng === null || own.pose.lat === null) return
      const controller = new AbortController()
      setToolsBusy('Loading terrain…')
      try {
        const terrain = await loadOwnTerrain(own.pose.lng, own.pose.lat, controller.signal)
        const elevation = terrain.elevationAt(lng, lat)
        if (!Number.isFinite(elevation)) throw new Error('no terrain at that spot')
        const look = landmarkAngles(ownCamera(own, terrain), { lng, lat, elevation })
        setLandmark({ lng, lat, elevation, ...look })
        setPriors((current) => ({
          ...current,
          heading: { value: look.bearing, tolerance: current.heading?.tolerance ?? 10 },
          pitch: { value: look.pitch, tolerance: current.pitch?.tolerance ?? 5 },
        }))
        setOwn((current) =>
          current
            ? {
                ...current,
                pose: { ...current.pose, bearing: look.bearing, pitch: look.pitch },
                sources: { ...current.sources, heading: 'landmark', pitch: 'landmark' },
              }
            : current,
        )
        setToolsError(null)
      } catch (error) {
        setToolsError(`Could not use that spot: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        setToolsBusy(null)
      }
    },

    [own, loadOwnTerrain],
  )

  /** Adds the map half of a pair to the pixel clicked in the photo. */
  const addPairPoint = useCallback(
    async (lng: number, lat: number) => {
      if (!own || !pendingPixel || own.pose.lng === null || own.pose.lat === null) return
      const pixel = pendingPixel
      try {
        const terrain = await loadOwnTerrain(own.pose.lng, own.pose.lat, new AbortController().signal)
        const elevation = terrain.elevationAt(lng, lat)
        if (!Number.isFinite(elevation)) throw new Error('no terrain at that spot')
        setPairs((current) => [...current, { id: `pair-${Date.now().toString(36)}`, pixel, lng, lat, elevation }])
        setPendingPixel(null)
        setToolsError(null)
      } catch (error) {
        setToolsError(`Could not place that point: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
    [own, pendingPixel, loadOwnTerrain],
  )

  /** Solves the camera from the paired points, with the priors, and applies it to the photo. */
  const solveFromPoints = useCallback(async () => {
    if (!own || own.pose.lng === null || own.pose.lat === null) return
    setToolsBusy('Solving from the points…')
    try {
      const terrain = await loadOwnTerrain(own.pose.lng, own.pose.lat, new AbortController().signal)
      const start = { ...ownCamera(own, terrain), hfov: own.pose.hfov }
      const angle = (key: 'heading' | 'pitch' | 'roll'): UnknownSpec =>
        priors[key] ? { mode: 'prior', ...priors[key]! } : { mode: 'free' }
      const known = own.sources.position === 'exif' || own.sources.position === 'record'
      const result = solveFromControls({
        start,
        pairs,
        unknowns: {
          heading: angle('heading'),
          pitch: angle('pitch'),
          roll: angle('roll'),
          // A picked position is a guess: free it, unless the photo's own fix or a record gave it.
          ...(known ? {} : { east: { mode: 'free' }, north: { mode: 'free' } }),
        },
      })
      if (!result) {
        setToolsError(
          `Pair at least ${pairsNeeded()} points: click a spot in the photo, then the same spot on the plan.`,
        )
        return
      }
      setControlSolve(result)
      const airborne = own.pose.altitudeMeters !== null && own.pose.altitudeMeters !== undefined
      setOwn((current) =>
        current
          ? {
              ...current,
              pose: {
                ...current.pose,
                lng: result.pose.lng,
                lat: result.pose.lat,
                bearing: result.pose.bearing,
                pitch: result.pose.pitch,
                roll: result.pose.roll,
                ...(airborne
                  ? { altitudeMeters: result.pose.altitudeMeters }
                  : { eyeHeightMeters: Math.max(0.5, current.pose.eyeHeightMeters + result.shift.up) }),
              },
              sources: {
                ...current.sources,
                position: 'controls',
                heading: 'controls',
                pitch: 'controls',
                roll: 'controls',
              },
            }
          : current,
      )
      setToolsError(null)
    } catch (error) {
      setToolsError(`The solve stopped: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setToolsBusy(null)
    }
  }, [own, pairs, priors, loadOwnTerrain])

  /** The angles of the camera to check: the photo's current one, or the skyline search's runner-up. */
  const candidateAngles = (which: 'camera' | 'runner-up') =>
    which === 'runner-up' && cameraSearch.status === 'done' && cameraSearch.result.runnerUp
      ? cameraSearch.result.runnerUp
      : own
        ? { bearing: own.pose.bearing, pitch: own.pose.pitch, roll: own.pose.roll }
        : null

  /** Lays the photo on the plan for a camera: a wrong heading puts its roads and openings in the wrong place. */
  const showOnMap = useCallback(
    async (which: 'camera' | 'runner-up') => {
      const angles = candidateAngles(which)
      if (!own || !angles || own.pose.lng === null || own.pose.lat === null) return
      setToolsBusy('Laying the photo on the map…')
      try {
        const terrain = await loadOwnTerrain(own.pose.lng, own.pose.lat, new AbortController().signal)
        const pixels = await readOwnPixels(own)
        const drape = drapePhoto(ownCamera(own, terrain, angles), terrain, pixels)
        if (!drape) throw new Error('the camera sees no ground')
        const canvas = document.createElement('canvas')
        canvas.width = drape.width
        canvas.height = drape.height
        canvas
          .getContext('2d')!
          .putImageData(new ImageData(new Uint8ClampedArray(drape.data), drape.width, drape.height), 0, 0)
        setPhotoDrape({
          url: canvas.toDataURL('image/png'),
          bounds: drape.bounds,
          which,
          bearing: angles.bearing,
          seenShare: drape.seenShare,
        })
        setToolsError(null)
      } catch (error) {
        setToolsError(`Could not lay the photo on the map: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        setToolsBusy(null)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [own, cameraSearch, loadOwnTerrain],
  )

  /** Satellite imagery seen from a camera, scored against the photo: ground texture where the skyline is useless. */
  const imagery = useRef<{ id: string; sampler: ImagerySampler } | null>(null)
  const renderModel = useCallback(
    async (which: 'camera' | 'runner-up') => {
      const angles = candidateAngles(which)
      if (!own || !angles || own.pose.lng === null || own.pose.lat === null) return
      const controller = new AbortController()
      setToolsBusy('Loading imagery…')
      try {
        const { lng, lat } = { lng: own.pose.lng, lat: own.pose.lat }
        const terrain = await loadOwnTerrain(lng, lat, controller.signal)
        const id = `${lng.toFixed(3)},${lat.toFixed(3)}`
        if (imagery.current?.id !== id) {
          const box = (radius: number): [number, number, number, number] => {
            const degLat = radius / 110574,
              degLng = radius / (111320 * Math.cos((lat * Math.PI) / 180))
            return [lng - degLng, lat - degLat, lng + degLng, lat + degLat]
          }
          const [near, middle, far] = await Promise.all([
            loadImageryMosaic(box(6000), 14, controller.signal),
            loadImageryMosaic(box(25000), 11, controller.signal),
            loadImageryMosaic(box(WIDE_RADIUS_METERS), 9, controller.signal),
          ])
          imagery.current = { id, sampler: layeredSampler(near.sampler, middle.sampler, far.sampler) }
        }
        const pose = ownCamera(own, terrain, angles)
        const width = 320
        const height = modelViewHeight(pose, width)
        const into = { width, height, data: new Uint8ClampedArray(width * height * 4) }
        for (let from = 0; from < height; from += 12) {
          setToolsBusy(`Drawing the model view… ${Math.round((from / height) * 100)}%`)
          renderModelView(pose, terrain, imagery.current.sampler, width, WIDE_RADIUS_METERS, {
            from,
            to: from + 12,
            into,
          })
          await new Promise((resolve) => setTimeout(resolve, 0))
        }
        const agreement = modelAgreement(await readOwnPixels(own), into)
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        canvas.getContext('2d')!.putImageData(new ImageData(into.data, width, height), 0, 0)
        setModelViews((current) => ({
          ...current,
          [which]: { url: canvas.toDataURL('image/png'), bearing: angles.bearing, score: agreement.score },
        }))
        setToolsError(null)
      } catch (error) {
        setToolsError(`Could not draw the model view: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        setToolsBusy(null)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [own, cameraSearch, loadOwnTerrain],
  )

  /** Swaps to the search's runner-up heading, to compare it with the photo. */
  const tryRunnerUp = useCallback(() => {
    if (cameraSearch.status !== 'done' || !cameraSearch.result.runnerUp) return
    const { result } = cameraSearch
    const runnerUp = result.runnerUp!
    setOwn((current) =>
      current
        ? {
            ...current,
            pose: { ...current.pose, bearing: runnerUp.bearing, pitch: runnerUp.pitch, roll: runnerUp.roll },
          }
        : current,
    )
    setCameraSearch({
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
    })
  }, [cameraSearch])

  /** Opens the reviewer's own photo, read here and kept here, with its EXIF as the starting pose. */
  const openOwnFile = useCallback(
    async (file: File, roadView: RoadViewPose | null) => {
      if (file.size > OWN_PHOTO_MAX_BYTES) {
        setOwnStatus({ loading: false, error: 'Use a photo smaller than 25 MB.' })
        return
      }
      setOwnStatus({ loading: true, error: null })
      const src = URL.createObjectURL(file)
      try {
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
        abort.current?.abort()
        setImage(null)
        setMatch(null)
        setAlignment({ status: 'idle', fit: null, message: null })
        cameraAbort.current?.abort()
        setCameraSearch({ status: 'idle' })
        setPriors({})
        setLandmark(null)
        setPairs([])
        setPendingPixel(null)
        setControlSolve(null)
        setPhotoDrape(null)
        setModelViews({})
        setToolsError(null)
        setOwn({
          id: `own-${Date.now().toString(36)}`,
          name: file.name.slice(0, 200),
          src,
          objectUrl: true,
          ...size,
          recordId: null,
          exif,
          pose: start.pose,
          sources: start.sources,
          start: { pose: start.pose, sources: start.sources },
          headingReference: start.headingReference,
          declinationEast: null,
        })
        setOwnStatus({ loading: false, error: null })
      } catch (error) {
        URL.revokeObjectURL(src)
        setOwnStatus({
          loading: false,
          error: isHeic(file)
            ? 'This browser cannot show HEIC photos (Safari can). Export it as JPEG, keeping its location, and open that.'
            : `Could not read the photo: ${error instanceof Error ? error.message : String(error)}`,
        })
      }
    },
    [eyeHeightMeters],
  )

  /** Opens a field record's stored photo, starting from the camera the record holds. */
  const openOwnRecord = useCallback(
    (record: FieldRecord, roadView: RoadViewPose | null) => {
      const start = startingPose({ exif: null, record, roadView, eyeHeightMeters })
      abort.current?.abort()
      setImage(null)
      setMatch(null)
      setAlignment({ status: 'idle', fit: null, message: null })
      setOwnStatus({ loading: false, error: null })
      setOwn({
        id: `record-${record.id}`,
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
      })
    },
    [eyeHeightMeters],
  )

  /** The reviewer's change to the pose; each changed value is marked as theirs (or `source`). */
  const setOwnPose = useCallback((patch: Partial<OwnPose>, source: PoseSource = 'reviewer') => {
    setOwn((current) => {
      if (!current) return current
      const pose = { ...current.pose, ...patch }
      // A typed eye height stands the eye over the ground again, unless an altitude comes with it.
      if (patch.eyeHeightMeters !== undefined && patch.altitudeMeters === undefined) pose.altitudeMeters = null
      if (patch.bearing !== undefined) pose.bearing = normalizeHeading(patch.bearing)
      if (patch.hfov !== undefined) pose.hfov = clampFov(patch.hfov)
      const sources = { ...current.sources }
      if (patch.lng !== undefined || patch.lat !== undefined) sources.position = source
      if (patch.bearing !== undefined) sources.heading = source
      if (patch.pitch !== undefined) sources.pitch = source
      if (patch.roll !== undefined) sources.roll = source
      if (patch.hfov !== undefined) sources.fov = source
      if (patch.eyeHeightMeters !== undefined || patch.altitudeMeters !== undefined) sources.eyeHeight = source
      return { ...current, pose, sources }
    })
  }, [])

  /**
   * A camera matched by the photo-matching bench: its position, altitude, heading, pitch, roll and lens, each marked
   * as matched. It also becomes the pose Reset returns to.
   */
  const applyMatchedCamera = useCallback((camera: MatchedCamera, fileName: string, checks: string[]) => {
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
        },
      }
    })
  }, [])

  /** A photo taken from the air: the eye stands at its GPS altitude (on), or back at the ground plus eye height. */
  const setFromAir = useCallback((fromAir: boolean) => {
    setOwn((current) => {
      const altitude = current?.exif?.altitudeMeters
      if (!current || (fromAir && (altitude === null || altitude === undefined))) return current
      return {
        ...current,
        pose: { ...current.pose, altitudeMeters: fromAir ? altitude : null },
        sources: { ...current.sources, eyeHeight: fromAir ? 'exif' : 'default' },
      }
    })
  }, [])

  /** A declination for a magnetic EXIF heading: the heading becomes the recorded one plus it. */
  const setDeclination = useCallback((declinationEast: number | null) => {
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
  }, [])

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
    addPairPoint,
    removePair: (id: string) => setPairs((current) => current.filter((pair) => pair.id !== id)),
    clearPairs: () => {
      setPairs([])
      setPendingPixel(null)
      setControlSolve(null)
    },
    pairsNeeded: pairsNeeded(),
    controlSolve,
    solveFromPoints,
    photoDrape,
    showOnMap,
    hideDrape: () => setPhotoDrape(null),
    modelViews,
    renderModel,
    toolsBusy,
    toolsError,
    cancelCameraSearch: () => {
      cameraAbort.current?.abort()
      setCameraSearch({ status: 'idle' })
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
    own,
    ownStatus,
    ownFov,
    ownOnRoad,
    ownStand,
    openOwnFile,
    openOwnRecord,
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
      abort.current?.abort()
      setImage(null)
      setOwn(null)
      setMatch(null)
      setStatus({ loading: false, error: null })
      setOwnStatus({ loading: false, error: null })
    },
  }
}

export type FieldPhotoState = ReturnType<typeof useFieldPhoto>

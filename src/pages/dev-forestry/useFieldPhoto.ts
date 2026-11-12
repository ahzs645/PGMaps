import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { FieldRecord } from './assessmentTools'
import { loadElevationGrid } from './demLoader'
import { MAX_WALK_METERS, nearestStation } from './driveMath'
import {
  clampFov,
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
import { fitSkyline, photoSkyline, terrainProfile, type SkylineFit } from './skylineFit'
import { nearestPointOnLine } from './roadSnap'
import type { ForestryScene } from './scene'
import { demTileRange, type ElevationSource } from './terrain'
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
}

/** Whether the road view can stand where the own photo was taken, and why not. */
export type OwnStand =
  | { status: 'no-position' }
  | { status: 'too-far'; offRoadMeters: number }
  | { status: 'no-terrain'; offRoadMeters: number }
  | { status: 'ok'; offRoadMeters: number; alongMeters: number }

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
          tags = ((await exifr.parse(file, { translateValues: false })) as Record<string, unknown> | undefined) ?? null
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
          error: `Could not read the photo: ${error instanceof Error ? error.message : String(error)}`,
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
      if (patch.bearing !== undefined) pose.bearing = normalizeHeading(patch.bearing)
      if (patch.hfov !== undefined) pose.hfov = clampFov(patch.hfov)
      const sources = { ...current.sources }
      if (patch.lng !== undefined || patch.lat !== undefined) sources.position = source
      if (patch.bearing !== undefined) sources.heading = source
      if (patch.pitch !== undefined) sources.pitch = source
      if (patch.roll !== undefined) sources.roll = source
      if (patch.hfov !== undefined) sources.fov = source
      if (patch.eyeHeightMeters !== undefined) sources.eyeHeight = source
      return { ...current, pose, sources }
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
    setDeclination,
    nudge,
    resetNudge,
    startOwnMatch,
    /** Where the road view's eye stands while an own photo is compared; null on the road. */
    standAt:
      comparingOwn && own.pose.lng !== null && own.pose.lat !== null ? { lng: own.pose.lng, lat: own.pose.lat } : null,
    /** The own photo's eye height while it is compared; the settings' otherwise. */
    standEyeHeightMeters: comparingOwn ? own.pose.eyeHeightMeters : null,
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

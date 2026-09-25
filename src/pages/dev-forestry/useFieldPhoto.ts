import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { loadElevationGrid } from './demLoader'
import { nearestStation } from './driveMath'
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
  const [panoPixels, setPanoPixels] = useState<{ id: string; width: number; height: number; data: Uint8ClampedArray } | null>(null)
  const [skylineGround, setSkylineGround] = useState<{ id: string; source: ElevationSource } | null>(null)
  const abort = useRef<AbortController | null>(null)
  const [alignment, setAlignment] = useState<{ status: 'idle' | 'working' | 'done' | 'failed'; fit: SkylineFit | null; message: string | null }>({ status: 'idle', fit: null, message: null })

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
          return on && on.offsetMeters <= 30 ? [{ ...image, alongMeters: on.distanceAlongMeters, offRoadMeters: on.offsetMeters }] : []
        })
        .sort((a, b) => a.alongMeters - b.alongMeters)
      setSearch({ status: 'ready', photos, road: alongRoad, error: null, searched: found.images.length, truncated: found.truncated })
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

  // Coarse terrain out to 25 km around the photo, for the skyline: the preview's
  // own mosaic stops a kilometre or two past the road, short of most ridgelines.
  useEffect(() => {
    if (!image || !match) return
    if (skylineGround?.id === image.id) return
    const controller = new AbortController()
    const degLat = SKYLINE_RADIUS_METERS / 110574
    const degLng = SKYLINE_RADIUS_METERS / (111320 * Math.cos((image.lat * Math.PI) / 180))
    const range = demTileRange(
      [image.lng - degLng, image.lat - degLat, image.lng + degLng, image.lat + degLat],
      SKYLINE_ZOOM,
    )
    loadElevationGrid({ range, signal: controller.signal, concurrency: 4 })
      .then(({ grid }) => {
        if (!controller.signal.aborted) setSkylineGround({ id: image.id, source: grid })
      })
      .catch(() => {
        /* The skyline is a guide; without terrain it is simply not drawn. */
      })
    return () => controller.abort()
  }, [image, match, skylineGround?.id])

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
  const look = image && match
    ? {
        bearing: image.bearing + match.nudge.bearing,
        pitch: (image.isPano ? 0 : image.pitch) + match.nudge.pitch,
      }
    : null
  const panoView =
    image?.isPano && look
      ? { bearing: look.bearing, pitch: look.pitch, verticalFovDegrees: PANO_VIEW_FOV, height: PANO_VIEW_HEIGHT, width: Math.round(PANO_VIEW_HEIGHT * viewAspect) }
      : null
  const panoFrame = useMemo(
    () =>
      panoView && image && panoPixels?.id === image.id
        ? { width: panoView.width, height: panoView.height, data: reprojectEquirect(panoPixels, { rotation: image.rotation, bearing: image.bearing }, panoView) }
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
  const viewFov = image?.isPano ? PANO_VIEW_FOV : (fov?.vertical ?? null)
  const station = result && onRoad ? nearestStation(result.stations, onRoad.distanceAlongMeters) : null

  const drawing = useMemo<PhotoDrawing | null>(() => {
    if (!image || !match) return null
    const far = skylineGround?.id === image.id ? skylineGround.source : null
    const groundAt = (lng: number, lat: number) => {
      const near = ground?.elevationAt(lng, lat)
      if (near !== undefined && Number.isFinite(near)) return near
      const coarse = far?.elevationAt(lng, lat)
      return coarse !== undefined && Number.isFinite(coarse) ? coarse : Number.NaN
    }
    const base = groundAt(image.lng, image.lat)
    if (!Number.isFinite(base)) return null
    const at = { lng: image.lng, lat: image.lat, altitudeMeters: base + eyeHeightMeters }
    const photo = image.isPano ? (panoView ? panoViewPose(at, panoView) : null) : photoPoseFor(image, base + eyeHeightMeters)
    if (!photo) return null
    const pose = image.isPano ? photo : { ...photo, bearing: photo.bearing + match.nudge.bearing, pitch: photo.pitch + match.nudge.pitch }
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
  }, [image, match, skylineGround, ground, eyeHeightMeters, scene.targets, result, station, panoView?.bearing, panoView?.pitch, panoView?.width])

  /** Reads the photo's own skyline and searches heading and pitch to lay it on the terrain's. */
  const autoAlign = useCallback(async () => {
    if (!image || !match || !drawing) return
    const far = skylineGround?.id === image.id ? skylineGround.source : null
    const src = image.thumbUrl
    if (!far || !src) {
      setAlignment({ status: 'failed', fit: null, message: 'The skyline terrain is still loading.' })
      return
    }
    setAlignment({ status: 'working', fit: null, message: null })
    try {
      // The photo's own pixels, or for a panorama the view cut from it; either
      // way in the frame `drawing.pose` describes.
      let pixels: { width: number; height: number; data: Uint8ClampedArray }
      if (image.isPano) {
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
      const sx = drawing.pose.width / pixels.width, sy = drawing.pose.height / pixels.height
      const skyline = photoSkyline(pixels, 220).map((point) => (point ? { x: point.x * sx, y: point.y * sy } : null))
      const base = drawing.pose
      const half = (Math.atan2(base.width / 2, base.focalPx) * 180) / Math.PI + 6
      const profile = terrainProfile(base, far, { from: base.bearing - half, to: base.bearing + half, step: 0.1, maxDistanceMeters: SKYLINE_RADIUS_METERS })
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
      setMatch({ ...match, nudge: { bearing: match.nudge.bearing + fit.nudge.bearing, pitch: match.nudge.pitch + fit.nudge.pitch } })
      setAlignment({ status: 'done', fit, message: null })
    } catch (error) {
      setAlignment({ status: 'failed', fit: null, message: `Could not read the photo: ${error instanceof Error ? error.message : String(error)}` })
    }
  }, [image, match, drawing, skylineGround, panoFrame])

  return {
    alignment,
    autoAlign,
    look,
    viewFov,
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
    skylineReady: !!image && skylineGround?.id === image.id,
    clear: () => {
      abort.current?.abort()
      setImage(null)
      setMatch(null)
      setStatus({ loading: false, error: null })
    },
  }
}

export type FieldPhotoState = ReturnType<typeof useFieldPhoto>

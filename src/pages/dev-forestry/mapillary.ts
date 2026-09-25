/**
 * Street-level photos from Mapillary, as field photos for handbook 3.2 and the
 * accuracy check in 3.3.4.
 *
 * Mapillary's Graph API returns each image's computed position, orientation
 * and camera model, which is what it takes to stand the preview camera where
 * the photographer stood. Requests need a client token (`VITE_MAPILLARY_TOKEN`
 * in `.env.local`); client tokens are meant for browsers. Never put a client
 * secret here: nothing on this page needs one.
 *
 * Images are CC BY-SA 4.0: every display credits the photographer and links
 * back to the image.
 */

import { fieldOfView, normalizeBearing, orientationFromRotation, type PhotoPose } from './photoPose'
import { bearingDegrees, haversineMeters, type GeoPoint } from './visibility'

export const MAPILLARY_GRAPH_URL = 'https://graph.mapillary.com'

export function mapillaryToken(): string | null {
  const token = (import.meta.env.VITE_MAPILLARY_TOKEN as string | undefined)?.trim()
  return token ? token : null
}

const IMAGE_FIELDS = [
  'id',
  'computed_geometry',
  'geometry',
  'computed_compass_angle',
  'compass_angle',
  'computed_rotation',
  'computed_altitude',
  'camera_type',
  'camera_parameters',
  'captured_at',
  'creator',
  'width',
  'height',
  'make',
  'model',
  'is_pano',
  'sequence',
  'thumb_1024_url',
  'thumb_2048_url',
].join(',')

const SEARCH_FIELDS = [
  'id',
  'computed_geometry',
  'geometry',
  'computed_compass_angle',
  'compass_angle',
  'captured_at',
  'is_pano',
  'thumb_256_url',
].join(',')

export type MapillaryImage = {
  id: string
  lng: number
  lat: number
  bearing: number
  pitch: number
  roll: number
  /** Whether the orientation came from Mapillary's reconstruction or only the device compass. */
  poseSource: 'computed' | 'compass'
  /** OpenSfM world-to-camera rotation, when reconstructed; panoramas are cut from it. */
  rotation: [number, number, number] | null
  cameraType: string
  focal: number | null
  k1: number
  k2: number
  width: number
  height: number
  capturedAt: string | null
  creator: string | null
  camera: string | null
  isPano: boolean
  sequence: string | null
  thumbUrl: string | null
  pageUrl: string
}

export type MapillaryListing = {
  id: string
  lng: number
  lat: number
  bearing: number | null
  capturedAt: string | null
  isPano: boolean
  thumbUrl: string | null
  /** A larger rendition, for showing the photo rather than picking it. */
  largeUrl?: string | null
}

/** The image id from a Mapillary link, or a bare id. */
export function parseMapillaryInput(input: string): string | null {
  const text = input.trim()
  if (/^\d{6,20}$/.test(text)) return text
  try {
    const url = new URL(text)
    if (!/(^|\.)mapillary\.com$/.test(url.hostname)) return null
    const key = url.searchParams.get('pKey') ?? url.searchParams.get('image_key')
    if (key && /^\d{6,20}$/.test(key)) return key
    const path = url.pathname.match(/\/(?:photo|map\/im)\/(\d{6,20})/)
    return path ? path[1] : null
  } catch {
    return null
  }
}

export function mapillaryPageUrl(id: string): string {
  return `https://www.mapillary.com/app/?pKey=${encodeURIComponent(id)}&focus=photo`
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

async function graph<T>(path: string, token: string, fetchImpl: Fetch, signal?: AbortSignal): Promise<T> {
  const response = await fetchImpl(`${MAPILLARY_GRAPH_URL}${path}`, {
    headers: { Authorization: `OAuth ${token}` },
    signal,
  })
  const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null
  if (!response.ok || !body || body.error) {
    throw new Error(`Mapillary: ${body?.error?.message ?? `request failed (${response.status})`}`)
  }
  return body as T
}

type RawPoint = { type: 'Point'; coordinates: [number, number] } | undefined

function point(computed: RawPoint, recorded: RawPoint): [number, number] | null {
  return computed?.coordinates ?? recorded?.coordinates ?? null
}

function isoDate(ms: unknown): string | null {
  return typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

/** One image with the pose a camera needs. */
export async function fetchMapillaryImage(
  id: string,
  token: string,
  { fetchImpl = fetch, signal }: { fetchImpl?: Fetch; signal?: AbortSignal } = {},
): Promise<MapillaryImage> {
  const raw = await graph<Record<string, unknown>>(
    `/${encodeURIComponent(id)}?fields=${IMAGE_FIELDS}`,
    token,
    fetchImpl,
    signal,
  )
  const position = point(raw.computed_geometry as RawPoint, raw.geometry as RawPoint)
  if (!position) throw new Error('Mapillary: this image has no position.')
  const rotation = raw.computed_rotation as [number, number, number] | undefined
  const fromRotation = Array.isArray(rotation) && rotation.length === 3 ? orientationFromRotation(rotation) : null
  const compass =
    typeof raw.computed_compass_angle === 'number'
      ? raw.computed_compass_angle
      : typeof raw.compass_angle === 'number'
        ? raw.compass_angle
        : 0
  const parameters = Array.isArray(raw.camera_parameters) ? (raw.camera_parameters as number[]) : []
  const cameraType = typeof raw.camera_type === 'string' ? raw.camera_type : 'perspective'
  const creator =
    raw.creator && typeof raw.creator === 'object' ? ((raw.creator as { username?: string }).username ?? null) : null
  const make = typeof raw.make === 'string' ? raw.make : ''
  const model = typeof raw.model === 'string' ? raw.model : ''
  return {
    id: String(raw.id ?? id),
    lng: position[0],
    lat: position[1],
    bearing: normalizeBearing(fromRotation?.bearing ?? compass),
    pitch: fromRotation?.pitch ?? 0,
    roll: fromRotation?.roll ?? 0,
    poseSource: fromRotation ? 'computed' : 'compass',
    rotation: fromRotation ? rotation! : null,
    cameraType,
    focal: cameraType === 'perspective' || cameraType === 'fisheye' ? (parameters[0] ?? null) : null,
    k1: parameters[1] ?? 0,
    k2: parameters[2] ?? 0,
    width: Number(raw.width) || 0,
    height: Number(raw.height) || 0,
    capturedAt: isoDate(raw.captured_at),
    creator,
    camera: `${make} ${model}`.trim() || null,
    isPano: raw.is_pano === true || cameraType === 'spherical' || cameraType === 'equirectangular',
    sequence: typeof raw.sequence === 'string' ? raw.sequence : null,
    thumbUrl: (raw.thumb_2048_url as string | undefined) ?? (raw.thumb_1024_url as string | undefined) ?? null,
    pageUrl: mapillaryPageUrl(String(raw.id ?? id)),
  }
}

/** The camera for a perspective image, at `eyeAltitudeMeters` above sea level. */
export function photoPoseFor(image: MapillaryImage, altitudeMeters: number): PhotoPose | null {
  if (image.isPano || image.focal === null || !image.width || !image.height) return null
  return {
    lng: image.lng,
    lat: image.lat,
    altitudeMeters,
    bearing: image.bearing,
    pitch: image.pitch,
    roll: image.roll,
    width: image.width,
    height: image.height,
    focalPx: image.focal * Math.max(image.width, image.height),
    k1: image.k1,
    k2: image.k2,
  }
}

export function photoFieldOfView(image: MapillaryImage): { horizontal: number; vertical: number } | null {
  return image.focal === null || !image.width || !image.height
    ? null
    : fieldOfView(image.focal, image.width, image.height)
}

/**
 * Tiles covering a bounding box, each small enough for the images endpoint
 * (which refuses large boxes). Capped, so a long corridor cannot fan out into
 * hundreds of requests.
 */
export function searchTiles(
  bounds: [number, number, number, number],
  size = 0.01,
  cap = 24,
): Array<[number, number, number, number]> {
  const [west, south, east, north] = bounds
  const tiles: Array<[number, number, number, number]> = []
  for (let x = west; x < east && tiles.length < cap; x += size) {
    for (let y = south; y < north && tiles.length < cap; y += size) {
      tiles.push([x, y, Math.min(east, x + size), Math.min(north, y + size)])
    }
  }
  return tiles
}

/** Images inside a bounding box, deduplicated across tiles. */
export async function searchMapillaryImages(
  bounds: [number, number, number, number],
  token: string,
  {
    fetchImpl = fetch,
    signal,
    limitPerTile = 200,
  }: { fetchImpl?: Fetch; signal?: AbortSignal; limitPerTile?: number } = {},
): Promise<{ images: MapillaryListing[]; tiles: number; truncated: boolean }> {
  const tiles = searchTiles(bounds)
  const byId = new Map<string, MapillaryListing>()
  let truncated = false
  for (const tile of tiles) {
    const bbox = tile.map((v) => v.toFixed(6)).join(',')
    const body = await graph<{ data?: Array<Record<string, unknown>> }>(
      `/images?fields=${SEARCH_FIELDS}&bbox=${bbox}&limit=${limitPerTile}`,
      token,
      fetchImpl,
      signal,
    )
    // A busy road fills the limit with ordinary photos; ask for 360° ones
    // separately, since any of them can be turned to face the block.
    const panoramas = await graph<{ data?: Array<Record<string, unknown>> }>(
      `/images?fields=${SEARCH_FIELDS}&bbox=${bbox}&is_pano=true&limit=50`,
      token,
      fetchImpl,
      signal,
    )
    if ((body.data ?? []).length >= limitPerTile) truncated = true
    const rows: Array<Record<string, unknown>> = [
      ...(body.data ?? []),
      ...(panoramas.data ?? []).map((row) => ({ ...row, is_pano: true })),
    ]
    for (const raw of rows) {
      const position = point(raw.computed_geometry as RawPoint, raw.geometry as RawPoint)
      if (!position) continue
      const id = String(raw.id)
      const bearing =
        typeof raw.computed_compass_angle === 'number'
          ? raw.computed_compass_angle
          : typeof raw.compass_angle === 'number'
            ? raw.compass_angle
            : null
      byId.set(id, {
        id,
        lng: position[0],
        lat: position[1],
        bearing: bearing === null ? null : normalizeBearing(bearing),
        capturedAt: isoDate(raw.captured_at),
        isPano: raw.is_pano === true,
        thumbUrl: (raw.thumb_256_url as string | undefined) ?? null,
        largeUrl: (raw.thumb_1024_url as string | undefined) ?? null,
      })
    }
  }
  return { images: [...byId.values()], tiles: tiles.length, truncated: truncated || tiles.length >= 24 }
}

export type RankedPhoto = MapillaryListing & {
  /** Distance from the road centreline, metres. */
  offRoadMeters: number
  /** Distance to the target, metres. */
  targetMeters: number
  /** Angle between where the camera points and the target, degrees. */
  offAxisDegrees: number | null
  facesTarget: boolean
}

/**
 * Photos taken from the road that look toward a target — the cutblock's
 * visible centre. A perspective photo counts when the target is within
 * `halfFieldDegrees` of its axis; panoramas see everything but cannot be
 * overlaid, so they rank after them. Closest to the target first.
 */
export function rankPhotosToward(
  images: readonly MapillaryListing[],
  target: GeoPoint,
  offRoad: (point: GeoPoint) => number,
  {
    maxOffRoadMeters = 30,
    halfFieldDegrees = 35,
    limit = 12,
  }: { maxOffRoadMeters?: number; halfFieldDegrees?: number; limit?: number } = {},
): RankedPhoto[] {
  const ranked: RankedPhoto[] = []
  for (const image of images) {
    const offRoadMeters = offRoad(image)
    if (!(offRoadMeters <= maxOffRoadMeters)) continue
    const toward = bearingDegrees(image, target)
    const offAxis = image.bearing === null ? null : Math.abs(((image.bearing - toward + 540) % 360) - 180)
    const facesTarget = image.isPano || (offAxis !== null && offAxis <= halfFieldDegrees)
    ranked.push({
      ...image,
      offRoadMeters,
      targetMeters: haversineMeters(image, target),
      offAxisDegrees: offAxis,
      facesTarget,
    })
  }
  return ranked
    .filter((photo) => photo.facesTarget)
    .sort((a, b) => Number(a.isPano) - Number(b.isPano) || a.targetMeters - b.targetMeters)
    .slice(0, limit)
}

export type RoadPhoto = MapillaryListing & { alongMeters: number; offRoadMeters: number }

/**
 * The street photo to show while driving: the one nearest the eye along the
 * road, within `maxGapMeters`, taken looking within `maxTurnDegrees` of where
 * the camera looks. Panoramas look every way, so they always qualify.
 */
export function photoNearDrive(
  photos: readonly RoadPhoto[],
  positionMeters: number,
  lookBearing: number,
  { maxGapMeters = 60, maxTurnDegrees = 50 }: { maxGapMeters?: number; maxTurnDegrees?: number } = {},
): RoadPhoto | null {
  let best: RoadPhoto | null = null
  for (const photo of photos) {
    const gap = Math.abs(photo.alongMeters - positionMeters)
    if (gap > maxGapMeters) continue
    if (!photo.isPano) {
      if (photo.bearing === null) continue
      if (Math.abs(((photo.bearing - lookBearing + 540) % 360) - 180) > maxTurnDegrees) continue
    }
    if (!best || gap < Math.abs(best.alongMeters - positionMeters)) best = photo
  }
  return best
}


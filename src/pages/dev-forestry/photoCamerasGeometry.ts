import { viewerConeFeatures } from '@/lib/geo/viewerCone'

/**
 * The plan's photo cameras (`PhotoCamerasLayer`): a cone for each camera out to its frame's far hit, a point at
 * each camera, and a track joining a flight's cameras in time order. Kept free of DOM access.
 */
export type PlanPhotoCamera = {
  /** The photo's field record id. */
  id: string
  lng: number
  lat: number
  /** Compass bearing of the frame's centre, degrees. */
  bearing: number
  /** Horizontal field of view, degrees. */
  hfov: number
  /** How far the frame's far edge meets the ground, metres; null when it meets none (sky, or past the terrain). */
  farMeters: number | null
  /** When it was taken, ISO with time (GPS time, else the camera's clock); a camera without one joins no track. */
  takenAtUtc?: string | null
  /** The flight it belongs to (`FieldRecord.flightId`); cameras without one share a single track. */
  flightId?: string | null
  /** Shown on hover: the photo's name or frame number. */
  label?: string
}

/** Shortest cone: a camera pitched down at its feet still shows which way it looked. */
export const PHOTO_CONE_MIN_METERS = 300
/**
 * Longest cone: the zoom-11 terrain a far frame is drawn on reaches about 25 km, and a cone past it would claim
 * ground nobody looked at.
 */
export const PHOTO_CONE_MAX_METERS = 25_000
/** A frame that meets no ground (all sky, or past the terrain) still gets a cone of this length. */
export const PHOTO_CONE_FALLBACK_METERS = 2_000

export function photoConeLength(farMeters: number | null): number {
  if (farMeters === null || !Number.isFinite(farMeters) || farMeters <= 0) return PHOTO_CONE_FALLBACK_METERS
  return Math.min(PHOTO_CONE_MAX_METERS, Math.max(PHOTO_CONE_MIN_METERS, farMeters))
}

const usable = (camera: PlanPhotoCamera) => [camera.lng, camera.lat, camera.bearing, camera.hfov].every(Number.isFinite)

const timeOf = (camera: PlanPhotoCamera) => {
  const t = camera.takenAtUtc ? Date.parse(camera.takenAtUtc) : Number.NaN
  return Number.isFinite(t) ? t : null
}

/**
 * Each flight's cameras in time order, as id lists, flights in the order their first camera was taken. A
 * camera with no readable time is left off: putting it anywhere would draw a leg nobody flew. Equal times keep
 * the order given.
 */
export function flightTracks(cameras: readonly PlanPhotoCamera[]): string[][] {
  const flights = new Map<string, { id: string; t: number; index: number }[]>()
  cameras.forEach((camera, index) => {
    const t = timeOf(camera)
    if (t === null || !usable(camera)) return
    const key = camera.flightId ?? ''
    const list = flights.get(key) ?? []
    list.push({ id: camera.id, t, index })
    flights.set(key, list)
  })
  return [...flights.values()]
    .map((list) => list.sort((a, b) => a.t - b.t || a.index - b.index))
    .filter((list) => list.length > 1)
    .sort((a, b) => a[0].t - b[0].t || a[0].index - b[0].index)
    .map((list) => list.map((entry) => entry.id))
}

export type PhotoCameraCollections = {
  /** One wedge a camera (`kind: 'cone'`, `id`, `active` 1/0). */
  cones: GeoJSON.FeatureCollection
  /** One point a camera (`kind: 'eye'`, `id`, `active`, `label`); the active camera last, so it draws on top. */
  eyes: GeoJSON.FeatureCollection
  /** One dashed line a flight (`kind: 'track'`, `flight`). */
  tracks: GeoJSON.FeatureCollection
}

export function photoCameraCollections(
  cameras: readonly PlanPhotoCamera[],
  activeId: string | null,
): PhotoCameraCollections {
  const cones: GeoJSON.Feature[] = []
  const eyes: GeoJSON.Feature[] = []
  const shown = cameras.filter(usable)
  for (const camera of shown) {
    const active = camera.id === activeId ? 1 : 0
    const cone = viewerConeFeatures(
      { lng: camera.lng, lat: camera.lat, bearing: camera.bearing, fovDegrees: camera.hfov },
      photoConeLength(camera.farMeters),
    ).features.find((feature) => feature.properties?.kind === 'cone')
    if (cone) cones.push({ ...cone, id: camera.id, properties: { kind: 'cone', id: camera.id, active } })
    eyes.push({
      type: 'Feature',
      id: camera.id,
      geometry: { type: 'Point', coordinates: [camera.lng, camera.lat] },
      properties: { kind: 'eye', id: camera.id, active, label: camera.label ?? '' },
    })
  }
  eyes.sort((a, b) => Number(a.properties?.active) - Number(b.properties?.active))
  const byId = new Map(shown.map((camera) => [camera.id, camera]))
  const tracks: GeoJSON.Feature[] = flightTracks(shown).map((ids, index) => ({
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: ids.map((id) => {
        const camera = byId.get(id)!
        return [camera.lng, camera.lat]
      }),
    },
    properties: { kind: 'track', flight: index },
  }))
  return {
    cones: { type: 'FeatureCollection', features: cones },
    eyes: { type: 'FeatureCollection', features: eyes },
    tracks: { type: 'FeatureCollection', features: tracks },
  }
}

/** A paired point on the plan: the reviewer's ground point and, once solved, where the camera puts its pixel. */
export type PlanPhotoPair = {
  id: string
  lng: number
  lat: number
  /** Where the solved camera's ray through the pair's pixel meets the ground; null before a solve. */
  solved?: { lng: number; lat: number } | null
  /** Left out of the solve: still drawn, as a check point. */
  off?: boolean
}

/**
 * Paired points (`kind: 'pair'`, `off` 1/0), the reference point (`kind: 'reference'`) and each pair's residual
 * on the ground (`kind: 'residual'`, a line from the reviewer's point to the solved one).
 */
export function photoPairCollection(
  pairs: readonly PlanPhotoPair[],
  reference: { lng: number; lat: number } | null = null,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  for (const pair of pairs) {
    if (!Number.isFinite(pair.lng) || !Number.isFinite(pair.lat)) continue
    if (pair.solved && Number.isFinite(pair.solved.lng) && Number.isFinite(pair.solved.lat))
      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [pair.lng, pair.lat],
            [pair.solved.lng, pair.solved.lat],
          ],
        },
        properties: { kind: 'residual', id: pair.id },
      })
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [pair.lng, pair.lat] },
      properties: { kind: 'pair', id: pair.id, off: pair.off ? 1 : 0 },
    })
  }
  if (reference && Number.isFinite(reference.lng) && Number.isFinite(reference.lat))
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [reference.lng, reference.lat] },
      properties: { kind: 'reference', id: 'reference' },
    })
  return { type: 'FeatureCollection', features }
}

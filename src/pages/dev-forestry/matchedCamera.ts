/**
 * A camera matched outside the page, by the photo-matching bench (`scripts/forestry/photo-matching/`), read from its
 * case file so the road view can stand exactly there: position, absolute altitude, heading, pitch, roll and lens.
 *
 * The bench fits heading, pitch and roll to the photo's skyline (a phone's recorded heading is often far out from an
 * aircraft) and can refine the position against mapped features. Its altitude is above sea level, on the same
 * Terrarium terrain the road view stands on. The case file also carries how the camera was found and its held-out
 * accuracy, which the panel shows beside it.
 *
 * Free of DOM and network access: the file's text is passed in.
 */

const RAD = Math.PI / 180

export type MatchedCamera = {
  lng: number
  lat: number
  /** Metres above sea level. */
  altitudeMeters: number
  /** Degrees clockwise from true north. */
  bearing: number
  /** Degrees above the horizon. */
  pitch: number
  /** Degrees; positive raises the photo's right side. */
  roll: number
  /** Degrees across the photo's width. */
  hfov: number
  /** How the bench found it, as it recorded it ("skyline", "solve (skyline + controls; held hfov)"). */
  method: string
  /** The bench's verdict on the skyline fit; null when the file does not say. */
  trusted: boolean | null
  /** Held-out error of each control group, metres across the view at its distance. */
  heldOut: Array<{ name: string; metres: number }>
  /** The photo file the case was made for, by name only. */
  photoName: string | null
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null

/**
 * Reads a bench case file (or a bare `{ lng, lat, alt, bearing, pitch, roll, hfov }` camera). Throws with a reason a
 * reviewer can act on when the text is not one.
 */
export function parseMatchedCamera(text: string): MatchedCamera {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw Error('This is not a photo-matching case file (it is not JSON).')
  }
  const root = record(parsed)
  if (!root) throw Error('This is not a photo-matching case file.')
  const pose = record(root.pose) ?? (finite(root.lng) && finite(root.bearing) ? root : null)
  if (!pose) throw Error('This case file has no camera yet: run the bench’s orient.ts (or match.ts) on it first.')
  const { lng, lat, alt, bearing, pitch, roll, hfov } = pose
  if (!finite(lng) || !finite(lat) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
    throw Error('The camera’s position is missing or out of range.')
  if (!finite(alt) || alt < -500 || alt > 9000) throw Error('The camera’s altitude is missing or out of range.')
  if (!finite(bearing) || !finite(pitch) || !finite(roll) || Math.abs(pitch) > 90 || Math.abs(roll) > 90)
    throw Error('The camera’s heading, pitch or roll is missing or out of range.')
  if (!finite(hfov) || hfov < 3 || hfov > 150) throw Error('The camera’s field of view is missing or out of range.')

  const results = record(root.results)
  const orientation = record(results?.orientation)
  const solve = record(results?.solve)
  const groups = Array.isArray(solve?.groups) ? solve.groups : []
  const heldOut = groups.flatMap((group) => {
    const g = record(group)
    if (!g || typeof g.name !== 'string' || !finite(g.heldOut) || !finite(g.mPerPx)) return []
    return [{ name: g.name.slice(0, 80), metres: g.heldOut * g.mPerPx }]
  })
  const photo = typeof root.photo === 'string' ? root.photo.split(/[\\/]/).pop() || null : null
  return {
    lng,
    lat,
    altitudeMeters: alt,
    bearing: ((bearing % 360) + 360) % 360,
    pitch,
    roll,
    hfov,
    method: typeof pose.source === 'string' ? pose.source.slice(0, 120) : 'not stated',
    trusted: typeof orientation?.trustworthy === 'boolean' ? orientation.trustworthy : null,
    heldOut,
    photoName: photo ? photo.slice(0, 200) : null,
  }
}

/** Metres between two lon/lat points (haversine). */
function metresBetween(a: { lng: number; lat: number }, b: { lng: number; lat: number }): number {
  const dLat = (b.lat - a.lat) * RAD,
    dLng = (b.lng - a.lng) * RAD
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** A matched camera moves tens of metres from a phone's GPS fix; past this it is likely another photo's. */
export const MATCHED_CAMERA_MAX_SHIFT_METERS = 300

const stem = (name: string) => name.replace(/\.[^.]+$/, '').toLowerCase()

/** What the reviewer should know before trusting a matched camera on this photo; empty when nothing stands out. */
export function matchedCameraChecks(
  camera: MatchedCamera,
  photo: { name: string; gpsPosition: { lng: number; lat: number } | null },
): string[] {
  const out: string[] = []
  if (camera.photoName && stem(camera.photoName) !== stem(photo.name))
    out.push(`This camera was matched for ${camera.photoName}, not ${photo.name}.`)
  if (photo.gpsPosition) {
    const shift = metresBetween(camera, photo.gpsPosition)
    if (shift > MATCHED_CAMERA_MAX_SHIFT_METERS)
      out.push(
        `The camera stands ${Math.round(shift)} m from this photo’s GPS position; a matched camera usually moves tens of metres.`,
      )
  }
  if (camera.trusted === false)
    out.push('The bench did not trust this camera’s skyline fit (too few columns, or another heading fits as well).')
  return out
}

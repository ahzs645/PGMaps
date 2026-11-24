/**
 * A photo whose GPS altitude stands far above the ground under its fix (doc **A photo of your own**, *A fix far below
 * its altitude*): from the air, or from high ground the fix missed. `highGroundNearFix` finds the nearest ground at that
 * altitude, which the options card offers as a place to stand with the phone's heading; the queue never moves a
 * camera there.
 *
 * Free of DOM and network access: the terrain is passed in as `elevationAt`.
 */

/**
 * A phone's GPS altitude this far above the ground under it is an aircraft, not a GPS error: phone altitude is good to
 * some tens of metres, and a helicopter photo is hundreds of metres up.
 */
export const AIRBORNE_ABOVE_GROUND_METERS = 100

/**
 * How far from a fix the queue looks for ground at the photo's GPS altitude (`highGroundNearFix`). A phone on a bluff,
 * stating 125 m, put its photo 1.1 km out on the valley floor below; 2 km takes that in and stays close enough for the
 * nearest such ground to be one place.
 */
export const HIGH_GROUND_RADIUS_METERS = 2000
/** The rings' spacing, and the spacing of samples round each: about the overlay terrain's cell at 54°N. */
export const HIGH_GROUND_STEP_METERS = 25
/** Ground this close to the GPS altitude less the eye height is where the phone could have stood: GPS height scatter. */
export const HIGH_GROUND_TOLERANCE_METERS = 15

/** The nearest ground at a photo's GPS altitude, where its fix lies far below it: a guess at where the phone stood. */
export type HighGround = {
  lng: number
  lat: number
  groundMeters: number
  /** From the fix, metres across the ground, and its bearing in degrees from true north. */
  distanceMeters: number
  bearing: number
  /** The GPS altitude over the ground under the fix. */
  aboveFixMeters: number
  /** The phone's own figure for its position's error, when it gave one. */
  statedErrorMeters: number | null
}

/**
 * The nearest ground within `HIGH_GROUND_RADIUS_METERS` of a fix that stands at its GPS altitude, when the fix itself
 * is `AIRBORNE_ABOVE_GROUND_METERS` or more below that altitude; else null. Such a photo is either from the air or
 * from high ground the fix missed, and nothing in its tags tells the two apart: the queue still searches it from the
 * air at the fix, and this place becomes one more option to look at, never the camera. Rings are walked outward, so
 * the first ring with ground in tolerance holds the answer; within it the ground closest to the altitude wins.
 */
export function highGroundNearFix({
  lng,
  lat,
  gpsAltitudeMeters,
  eyeHeightMeters,
  horizontalErrorMeters = null,
  elevationAt,
}: {
  lng: number
  lat: number
  gpsAltitudeMeters: number | null | undefined
  eyeHeightMeters: number
  horizontalErrorMeters?: number | null
  elevationAt: (lng: number, lat: number) => number
}): HighGround | null {
  if (gpsAltitudeMeters === null || gpsAltitudeMeters === undefined || !Number.isFinite(gpsAltitudeMeters)) return null
  const atFix = elevationAt(lng, lat)
  if (!Number.isFinite(atFix) || gpsAltitudeMeters - atFix < AIRBORNE_ABOVE_GROUND_METERS) return null
  const target = gpsAltitudeMeters - eyeHeightMeters
  const perLat = 111320
  const perLng = 111320 * Math.cos((lat * Math.PI) / 180)
  for (let radius = HIGH_GROUND_STEP_METERS; radius <= HIGH_GROUND_RADIUS_METERS; radius += HIGH_GROUND_STEP_METERS) {
    const samples = Math.max(8, Math.ceil((2 * Math.PI * radius) / HIGH_GROUND_STEP_METERS))
    let best: HighGround | null = null
    let bestOff = Infinity
    for (let k = 0; k < samples; k++) {
      const bearing = (360 * k) / samples
      const east = radius * Math.sin((bearing * Math.PI) / 180)
      const north = radius * Math.cos((bearing * Math.PI) / 180)
      const at = { lng: lng + east / perLng, lat: lat + north / perLat }
      const ground = elevationAt(at.lng, at.lat)
      const off = Math.abs(ground - target)
      if (!Number.isFinite(ground) || off > HIGH_GROUND_TOLERANCE_METERS || off >= bestOff) continue
      bestOff = off
      best = {
        ...at,
        groundMeters: ground,
        distanceMeters: radius,
        bearing,
        aboveFixMeters: gpsAltitudeMeters - atFix,
        statedErrorMeters: horizontalErrorMeters,
      }
    }
    if (best) return best
  }
  return null
}

/** A bearing as one of sixteen compass points, for a sentence. */
export function compassPoint(bearing: number): string {
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  return points[Math.round((((bearing % 360) + 360) % 360) / 22.5) % 16]
}

/** A distance across the ground for a sentence: metres to the ten under a kilometre, else kilometres to one place. */
export function groundDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`
}

/** What the queue says about a fix far below its GPS altitude, with the high ground it found (`highGroundNearFix`). */
export function highGroundNote(high: HighGround, gpsAltitudeMeters: number): string {
  const stated =
    high.statedErrorMeters !== null
      ? ` (the phone gave its position as good to ${Math.round(high.statedErrorMeters)} m)`
      : ''
  return (
    `Its GPS altitude, ${Math.round(gpsAltitudeMeters)} m, is ${Math.round(high.aboveFixMeters)} m above the ground at its fix${stated}. ` +
    `It was taken from the air, or the fix is off: ground at that height lies ${groundDistance(high.distanceMeters)} ` +
    `${compassPoint(high.bearing)}, and an option stands a camera there with the phone’s heading.`
  )
}

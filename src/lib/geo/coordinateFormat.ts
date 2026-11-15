/**
 * Coordinate formats for map readouts and copy actions: decimal degrees, degrees-minutes-seconds,
 * degrees-decimal-minutes and UTM. No DOM or network access.
 *
 * UTM is computed here (Snyder's transverse Mercator series on WGS 84) rather than through proj4,
 * so every map route can show it without loading a projection library. It agrees with proj4 to
 * well under a millimetre inside a zone (`coordinateFormat.test.ts`).
 */

export const COORDINATE_FORMATS = ['dd', 'dms', 'ddm', 'utm'] as const
export type CoordinateFormat = (typeof COORDINATE_FORMATS)[number]

export const COORDINATE_FORMAT_LABELS: Readonly<Record<CoordinateFormat, string>> = {
  dd: 'Decimal degrees',
  dms: 'Degrees, minutes, seconds',
  ddm: 'Degrees, decimal minutes',
  utm: 'UTM (WGS 84)',
}

export function isCoordinateFormat(value: unknown): value is CoordinateFormat {
  return typeof value === 'string' && (COORDINATE_FORMATS as readonly string[]).includes(value)
}

/** The format after `format`, wrapping round: the status bar cycles through them on click. */
export function nextCoordinateFormat(format: CoordinateFormat): CoordinateFormat {
  return COORDINATE_FORMATS[(COORDINATE_FORMATS.indexOf(format) + 1) % COORDINATE_FORMATS.length]
}

/** Longitude wrapped into [-180, 180), which MapLibre does not do for a world copy. */
export function wrapLongitude(lng: number): number {
  const wrapped = ((((lng + 180) % 360) + 360) % 360) - 180
  return Object.is(wrapped, -0) ? 0 : wrapped
}

const hemisphere = (value: number, positive: string, negative: string) => (value < 0 ? negative : positive)

/** `53.91710° N, 122.74970° W`. */
export function formatDecimalDegrees(lng: number, lat: number, digits = 5): string {
  const x = wrapLongitude(lng)
  return `${Math.abs(lat).toFixed(digits)}° ${hemisphere(lat, 'N', 'S')}, ${Math.abs(x).toFixed(digits)}° ${hemisphere(x, 'E', 'W')}`
}

/** `53.91710, -122.74970`: latitude first, as Google Maps, GPS units and most forms take it. */
export function formatLatLngPlain(lng: number, lat: number, digits = 5): string {
  return `${lat.toFixed(digits)}, ${wrapLongitude(lng).toFixed(digits)}`
}

/**
 * Splits |value| into whole degrees and minutes rounded to `minuteDigits`, carrying a minute that
 * rounds up to 60 into the degrees so `59.9999…′` never prints as `60.000′`.
 */
function degreesMinutes(value: number, minuteDigits: number): [number, number] {
  const scale = 10 ** minuteDigits
  const totalMinutes = Math.round(Math.abs(value) * 60 * scale) / scale
  const degrees = Math.floor(totalMinutes / 60 + 1e-12)
  return [degrees, totalMinutes - degrees * 60]
}

function degreesMinutesSeconds(value: number, secondDigits: number): [number, number, number] {
  const scale = 10 ** secondDigits
  const totalSeconds = Math.round(Math.abs(value) * 3600 * scale) / scale
  const degrees = Math.floor(totalSeconds / 3600 + 1e-12)
  const minutes = Math.floor((totalSeconds - degrees * 3600) / 60 + 1e-12)
  return [degrees, minutes, totalSeconds - degrees * 3600 - minutes * 60]
}

const pad = (value: number, digits: number, width: number) => value.toFixed(digits).padStart(width, '0')

/** `53°55′01.6″ N, 122°44′59.0″ W`. */
export function formatDms(lng: number, lat: number, secondDigits = 1): string {
  const x = wrapLongitude(lng)
  const part = (value: number, positive: string, negative: string) => {
    const [d, m, s] = degreesMinutesSeconds(value, secondDigits)
    const width = secondDigits > 0 ? secondDigits + 3 : 2
    return `${d}°${String(m).padStart(2, '0')}′${pad(s, secondDigits, width)}″ ${hemisphere(value, positive, negative)}`
  }
  return `${part(lat, 'N', 'S')}, ${part(x, 'E', 'W')}`
}

/** `53°55.027′ N, 122°44.982′ W`. */
export function formatDdm(lng: number, lat: number, minuteDigits = 3): string {
  const x = wrapLongitude(lng)
  const part = (value: number, positive: string, negative: string) => {
    const [d, m] = degreesMinutes(value, minuteDigits)
    return `${d}°${pad(m, minuteDigits, minuteDigits + 3)}′ ${hemisphere(value, positive, negative)}`
  }
  return `${part(lat, 'N', 'S')}, ${part(x, 'E', 'W')}`
}

export interface UtmCoordinate {
  zone: number
  /** The MGRS latitude band letter (C–X), e.g. U for 48–56° N. */
  band: string
  hemisphere: 'N' | 'S'
  easting: number
  northing: number
}

const BANDS = 'CDEFGHJKLMNPQRSTUVWXX'

/** UTM zone for a point, with the Norway (32V) and Svalbard (31X–37X) exceptions. */
export function utmZone(lng: number, lat: number): number {
  const x = wrapLongitude(lng)
  if (lat >= 56 && lat < 64 && x >= 3 && x < 12) return 32
  if (lat >= 72 && lat < 84) {
    if (x >= 0 && x < 9) return 31
    if (x >= 9 && x < 21) return 33
    if (x >= 21 && x < 33) return 35
    if (x >= 33 && x < 42) return 37
  }
  return Math.min(60, Math.floor((x + 180) / 6) + 1)
}

/** The latitude band letter, or null outside UTM's 80° S – 84° N. */
export function utmBand(lat: number): string | null {
  if (!(lat >= -80 && lat <= 84)) return null
  return BANDS[Math.min(20, Math.floor((lat + 80) / 8))]
}

// WGS 84
const A = 6378137
const F = 1 / 298.257223563
const E2 = F * (2 - F)
const EP2 = E2 / (1 - E2)
const K0 = 0.9996

/**
 * WGS 84 UTM coordinates, or null outside 80° S – 84° N (the poles use UPS, not UTM).
 * Snyder, *Map Projections — A Working Manual* (USGS PP 1395, 1987), eqs. 8-9 to 8-10.
 */
export function toUtm(lng: number, lat: number, zoneOverride?: number): UtmCoordinate | null {
  const band = utmBand(lat)
  if (!band || !Number.isFinite(lng)) return null
  const zone = zoneOverride ?? utmZone(lng, lat)
  const phi = (lat * Math.PI) / 180
  const lambda0 = (((zone - 1) * 6 - 180 + 3) * Math.PI) / 180
  const lambda = (wrapLongitude(lng) * Math.PI) / 180

  const sin = Math.sin(phi)
  const cos = Math.cos(phi)
  const tan = Math.tan(phi)
  const N = A / Math.sqrt(1 - E2 * sin * sin)
  const T = tan * tan
  const C = EP2 * cos * cos
  let dLambda = lambda - lambda0
  if (dLambda > Math.PI) dLambda -= 2 * Math.PI
  if (dLambda < -Math.PI) dLambda += 2 * Math.PI
  const Ac = cos * dLambda

  const e4 = E2 * E2
  const e6 = e4 * E2
  const M =
    A *
    ((1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi -
      ((3 * E2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi) +
      ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi) -
      ((35 * e6) / 3072) * Math.sin(6 * phi))

  const easting =
    K0 * N * (Ac + ((1 - T + C) * Ac ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * Ac ** 5) / 120) + 500000
  let northing =
    K0 *
    (M +
      N *
        tan *
        ((Ac * Ac) / 2 +
          ((5 - T + 9 * C + 4 * C * C) * Ac ** 4) / 24 +
          ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * Ac ** 6) / 720))
  if (lat < 0) northing += 10000000

  return { zone, band, hemisphere: lat < 0 ? 'S' : 'N', easting, northing }
}

/** `10U 515234 E 5973112 N`, or null where UTM does not apply. */
export function formatUtm(lng: number, lat: number): string | null {
  const utm = toUtm(lng, lat)
  if (!utm) return null
  return `${utm.zone}${utm.band} ${Math.round(utm.easting)} E ${Math.round(utm.northing)} N`
}

/** The point in `format`. UTM falls back to decimal degrees near the poles, where it has no value. */
export function formatCoordinate(lng: number, lat: number, format: CoordinateFormat): string {
  switch (format) {
    case 'dms':
      return formatDms(lng, lat)
    case 'ddm':
      return formatDdm(lng, lat)
    case 'utm':
      return formatUtm(lng, lat) ?? formatDecimalDegrees(lng, lat)
    default:
      return formatDecimalDegrees(lng, lat)
  }
}

/** A Google Maps search link for the point; it opens the place with a pin in a new tab. */
export function googleMapsUrl(lng: number, lat: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${wrapLongitude(lng).toFixed(6)}`
}

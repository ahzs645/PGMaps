/**
 * Dated satellite imagery from NASA's Global Imagery Browse Services (GIBS),
 * which needs no account or key and is free to use with credit.
 *
 * The layers are the Harmonized Landsat and Sentinel-2 (HLS) daily true-colour
 * products: `S30` from the Sentinel-2 satellites and `L30` from Landsat 8 and
 * 9, both at 30 m. Between them a place in BC is passed over every two or
 * three days. A day's image is whatever the satellite saw, cloud included, and
 * covers only the strips flown that day; everywhere else is transparent.
 *
 * This answers "what does it look like now", not "what is the sharpest photo":
 * the undated Esri imagery is far finer (under a metre in places) but can be
 * years old.
 */

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best'

export const RECENT_IMAGERY_LAYERS = [
  'HLS_L30_Nadir_BRDF_Adjusted_Reflectance',
  'HLS_S30_Nadir_BRDF_Adjusted_Reflectance',
] as const

/** GIBS serves these layers to zoom 12 (about 38 m a pixel at the equator); MapLibre stretches beyond. */
export const RECENT_IMAGERY_MAX_ZOOM = 12
export const RECENT_IMAGERY_ATTRIBUTION =
  'Recent imagery: NASA GIBS, Harmonized Landsat Sentinel-2 (contains modified Copernicus Sentinel data)'

/**
 * Days between a satellite pass and its image reaching GIBS. On 11 November
 * 2026 the newest day served was 4 November, so a week is the safe default.
 */
export const RECENT_IMAGERY_LAG_DAYS = 7
/** GIBS keeps a rolling archive of these layers; in November 2026 it began on 2 March. */
export const RECENT_IMAGERY_ARCHIVE_DAYS = 240

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function isIsoDate(value: string): boolean {
  return ISO_DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
}

/** yyyy-mm-dd, `days` away from `date`, in UTC so a time zone cannot shift the day. */
export function shiftIsoDate(date: string, days: number): string {
  const shifted = new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000)
  return shifted.toISOString().slice(0, 10)
}

export function todayIsoDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/** The newest day likely to be served, and the oldest still archived. */
export function recentImageryRange(today: string): { earliest: string; latest: string } {
  return {
    earliest: shiftIsoDate(today, -RECENT_IMAGERY_ARCHIVE_DAYS),
    latest: shiftIsoDate(today, -RECENT_IMAGERY_LAG_DAYS),
  }
}

/** Keeps a date inside what GIBS serves; anything unreadable becomes the newest day. */
export function clampImageryDate(date: string, today: string): string {
  const { earliest, latest } = recentImageryRange(today)
  if (!isIsoDate(date)) return latest
  if (date > latest) return latest
  if (date < earliest) return earliest
  return date
}

/** The tile template for one layer on one day. Note GIBS orders the path {z}/{y}/{x}. */
export function recentImageryTiles(layer: (typeof RECENT_IMAGERY_LAYERS)[number], date: string): string {
  if (!isIsoDate(date)) throw new Error(`Not a date: ${date}`)
  return `${GIBS}/${layer}/default/${date}/GoogleMapsCompatible_Level${RECENT_IMAGERY_MAX_ZOOM}/{z}/{y}/{x}.png`
}

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
import { shiftIsoDate, type ImageryFeed, type ImageryFrame } from './feed'

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

/** The newest day likely to be served, and the oldest still archived. */
export function recentImageryRange(today: string): { earliest: string; latest: string } {
  return {
    earliest: shiftIsoDate(today, -RECENT_IMAGERY_ARCHIVE_DAYS),
    latest: shiftIsoDate(today, -RECENT_IMAGERY_LAG_DAYS),
  }
}

/** The tile template for one layer on one day. Note GIBS orders the path {z}/{y}/{x}. */
export function recentImageryTiles(layer: (typeof RECENT_IMAGERY_LAYERS)[number], date: string): string {
  if (!isIsoDate(date)) throw new Error(`Not a date: ${date}`)
  return `${GIBS}/${layer}/default/${date}/GoogleMapsCompatible_Level${RECENT_IMAGERY_MAX_ZOOM}/{z}/{y}/{x}.png`
}

export type GibsHlsFrame = ImageryFrame<null>

/** One frame a day, Landsat drawn under Sentinel-2, from the oldest archived day to the newest served. */
export function gibsHlsFrames(today: string): GibsHlsFrame[] {
  const { earliest, latest } = recentImageryRange(today)
  const frames: GibsHlsFrame[] = []
  for (let date = earliest; date <= latest; date = shiftIsoDate(date, 1))
    frames.push({
      id: date,
      date,
      layers: RECENT_IMAGERY_LAYERS.map((layer, index) => ({
        tiles: recentImageryTiles(layer, date),
        tileSize: 256,
        maxZoom: RECENT_IMAGERY_MAX_ZOOM,
        name: layer.startsWith('HLS_L30') ? 'Landsat' : 'Sentinel-2',
        attribution: index === 0 ? RECENT_IMAGERY_ATTRIBUTION : undefined,
      })),
      source: null,
    })
  return frames
}

/** Play shows each day this long before the next, ms: long enough for a day's tiles to land. */
export const GIBS_HLS_PLAYBACK_MS = 1_500

export const GIBS_HLS_FEED: ImageryFeed<null> = {
  id: 'nasa-gibs-hls',
  label: 'NASA daily passes',
  shortLabel: 'NASA',
  frameNoun: { one: 'day', many: 'days' },
  description:
    'Landsat and Sentinel-2 at 30 m, one picture a day for the last eight months. A day shows only the strips flown, cloud included; images arrive about a week after the pass.',
  dateMeaning: 'Landsat and Sentinel-2 pass date',
  loadingText: 'Loading NASA daily passes…',
  retryLabel: 'Retry NASA daily passes',
  period: 'month',
  playbackMs: GIBS_HLS_PLAYBACK_MS,
  placeMaxZoom: RECENT_IMAGERY_MAX_ZOOM,
  // The days are known without asking: GIBS serves every day in its rolling archive.
  listFrames: async ({ today }) => gibsHlsFrames(today),
}

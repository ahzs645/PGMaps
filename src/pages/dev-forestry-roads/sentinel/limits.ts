/**
 * Sentinel-2 imagery limits. `docs/forestry-road-design/sentinel-imagery.md` cites each one in its
 * "Limits and budgets" table: change the guide in the same commit as a constant.
 */

/** Element 84 Earth Search: public STAC search over the AWS Sentinel-2 COGs, no key, CORS open. */
export const SENTINEL_STAC_SEARCH_URL = 'https://earth-search.aws.element84.com/v1/search'
export const SENTINEL_COLLECTION = 'sentinel-2-l2a'

/** Scenes whose whole-tile cloud cover is at or above this percentage are not requested. */
export const SENTINEL_CLOUD_MAX_PERCENT = 60
/** Scenes listed per search, after keeping one tile per date. */
export const SENTINEL_MAX_SCENES = 12
/** Items one search asks for. Neighbouring tiles share dates, so this is more than the list keeps. */
export const SENTINEL_SEARCH_LIMIT = 36
/** "Recent scenes" reaches back this many days. */
export const SENTINEL_RECENT_DAYS = 730
/** The first year the year picker offers. Earth Search's L2A archive is thin before it. */
export const SENTINEL_FIRST_YEAR = 2017

/** Imagery is only requested at neighbourhood/road scale. */
export const SENTINEL_MIN_ZOOM = 12
/** Wait for navigation to stop before changing the requested area. */
export const SENTINEL_VIEW_IDLE_MS = 800
/** Snap outward to this degree grid so small pans reuse the same read. */
export const SENTINEL_VIEW_GRID_DEG = 0.01
/** Minimum time between catalogue requests, including manual retries. */
export const SENTINEL_SEARCH_INTERVAL_MS = 5_000
export const SENTINEL_SEARCH_CACHE_MS = 15 * 60_000
export const SENTINEL_SEARCH_CACHE_ENTRIES = 8
/** Open COG handles include their own byte-block caches; keep their number bounded. */
export const SENTINEL_FILE_CACHE_ENTRIES = 16
/** Maximum simultaneous band reads (including scene ratings). */
export const SENTINEL_READ_CONCURRENCY = 2

/** Margin added round the view bounds before reading, in metres. */
export const SENTINEL_WINDOW_MARGIN_M = 250
/** Terrain wider or taller than this (km, margin included) is refused rather than read. */
export const SENTINEL_MAX_WINDOW_KM = 60
/** The longest side of a read, in pixels. Larger windows read a 20, 40… m overview instead of 10 m. */
export const SENTINEL_MAX_WINDOW_PX = 2048
/** The longest side of the scene-classification read that rates each listed scene's clear share. */
export const SENTINEL_LIST_SCL_PX = 128
/** Scene-classification reads that run at once while a list is rated. */
export const SENTINEL_LIST_CONCURRENCY = 4

/** The default scene is the newest one at least this clear over the window (share of covered pixels). */
export const SENTINEL_MIN_CLEAR_SHARE = 0.8
/** …that also covers at least this share of the window. */
export const SENTINEL_MIN_COVERAGE = 0.95
/** A pixel whose NDVI falls by at least this much between two scenes is drawn as a new clearing. */
export const SENTINEL_CLEARING_NDVI_DROP = 0.2

/** Every network request (search or image read) is abandoned after this long. */
export const SENTINEL_REQUEST_TIMEOUT_MS = 30_000
/** Decoded band windows kept in memory, so switching modes or scenes back does not re-read. */
export const SENTINEL_BAND_CACHE_ENTRIES = 8

/** British Columbia lies in UTM zones 7 to 11 (WGS84 / UTM north, EPSG:32607–32611). */
export const SENTINEL_BC_UTM_ZONES = [7, 11] as const

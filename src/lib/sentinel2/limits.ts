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
/** The read window's width and height over the view's (OpenLayers' `ImageWMS` ratio). */
export const SENTINEL_VIEW_OVERSCAN = 1.5
/** Ask for the next window once the view comes within this share of its size of the window's edge. */
export const SENTINEL_VIEW_EDGE_SHARE = 0.1
/** While the map moves, a new window is asked for at most this often (Leaflet's `updateInterval` is 200). */
export const SENTINEL_VIEW_THROTTLE_MS = 250
/** After the map stops, the view is checked once more after this long. */
export const SENTINEL_VIEW_SETTLE_MS = 100
/** Snap the window outward to this degree grid so nearby views share one read. */
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
/**
 * The longest side of the view (margin included), in pixels, before the read takes a 20, 40… m
 * overview instead of 10 m. The pixel is chosen from the view, not the overscanned window, so the
 * picture is never coarser than the view needs.
 */
export const SENTINEL_MAX_WINDOW_PX = 2048
/**
 * The longest side of one read, in pixels: the overscanned window at the view's pixel. A window past
 * it is cropped about the view's centre (never read coarser), so it still holds the whole view.
 */
export const SENTINEL_MAX_READ_PX = 3_200
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
/**
 * dNBR (earlier NBR minus later) counted as burned or cleared: the floor of "moderate-low severity"
 * in Key & Benson (2006), FIREMON Landscape Assessment, USDA Forest Service RMRS-GTR-164-CD,
 * table LA-2 (p. LA-37): +270 on their ×1000 scale. Their "low severity" class (+100 to +269) is
 * drawn faintly and not counted: the table itself says its thresholds shift by about 100 between
 * scene pairs, so a low-severity change cannot be told from season and moisture.
 */
export const SENTINEL_BURN_DNBR = 0.27
/** Key & Benson's table LA-2 "unburned" upper bound (+99 on their scale): smaller dNBR is drawn clear. */
export const SENTINEL_DNBR_UNBURNED = 0.1
/**
 * An NDMI fall counted as drier ground. A PGMaps screen, not a published threshold: work on mountain
 * pine beetle red attack in BC (Goodwin et al. 2008) tracks NDMI loss, but its cut-offs are local
 * calibrations, and none carries over to another place or sensor.
 */
export const SENTINEL_DRYING_NDMI_DROP = 0.15

/** An area's time series is refused when its box is wider or taller than this (km). */
export const SENTINEL_AREA_MAX_KM = 10
/** Scenes one area series reads: at most one panel list's worth, thinned evenly over time. */
export const SENTINEL_SERIES_MAX_SCENES = SENTINEL_MAX_SCENES
/** A series scene with less of the area clear than this (share of covered pixels) is a gap. */
export const SENTINEL_SERIES_MIN_CLEAR_SHARE = 0.8
/** …or whose tile covers less of the area than this. */
export const SENTINEL_SERIES_MIN_COVERAGE = 0.95
/** Bins in the area histogram, over the index's fixed range. */
export const SENTINEL_HISTOGRAM_BINS = 40

/** Every network request (search or image read) is abandoned after this long. */
export const SENTINEL_REQUEST_TIMEOUT_MS = 30_000
/** Decoded band windows kept in memory, so switching modes or scenes back does not re-read. */
export const SENTINEL_BAND_CACHE_ENTRIES = 8

/** British Columbia lies in UTM zones 7 to 11 (WGS84 / UTM north, EPSG:32607–32611). */
export const SENTINEL_BC_UTM_ZONES = [7, 11] as const

/** Map tiles of a scene (`tiles.ts`) are drawn from this zoom; shallower, a tile would read most of a scene. */
export const SENTINEL_TILE_MIN_ZOOM = 9
/** The deepest tile read: 10 m pixels are about zoom 13 at BC's latitudes; MapLibre stretches beyond. */
export const SENTINEL_TILE_MAX_ZOOM = 14
/** Simultaneous tile reads; a view needs a dozen or two, each one or two byte ranges of a scene's TCI. */
export const SENTINEL_TILE_READ_CONCURRENCY = 6
/** The imagery feed's dates at a place: the search asks for this many items and keeps one a date. */
export const SENTINEL_FEED_SEARCH_LIMIT = 100
export const SENTINEL_FEED_MAX_SCENES = 48

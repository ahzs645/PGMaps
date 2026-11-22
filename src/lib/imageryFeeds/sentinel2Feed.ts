/**
 * Sentinel-2 L2A true colour as an imagery feed: the scenes over the map centre from Element 84's
 * Earth Search (the road designer's search, `src/lib/sentinel2/stac.ts`), one a date, each drawn as
 * map tiles reprojected from its UTM COG through the `pgmaps-s2` protocol (`src/lib/sentinel2/tiles.ts`).
 * 10 m, every few days, cloud included up to `SENTINEL_CLOUD_MAX_PERCENT` of the tile. The frame's
 * date is the acquisition date, so the strip prints it as the capture date. DOM-free.
 */
import {
  SENTINEL_FEED_MAX_SCENES,
  SENTINEL_FEED_SEARCH_LIMIT,
  SENTINEL_RECENT_DAYS,
  SENTINEL_TILE_MAX_ZOOM,
  SENTINEL_TILE_MIN_ZOOM,
} from '@/lib/sentinel2/limits'
import { recentRange, searchSentinelScenes, sentinelCredit, type SentinelScene } from '@/lib/sentinel2/stac'
import { SENTINEL_TILE_PROTOCOL, sentinelTileUrl } from '@/lib/sentinel2/tiles'
import type { ImageryFeed, ImageryFrame, ImageryPlace } from './feed'

/** Half the side of the box searched round the map centre, in degrees: scenes that hold the centre. */
const SEARCH_HALF_DEG = 0.005
/** The centre moves to another list once it leaves a cell this many degrees a side. */
export const SENTINEL_FEED_AREA_DEG = 0.1
export const SENTINEL_PLAYBACK_MS = 1_500

export type Sentinel2Frame = ImageryFrame<SentinelScene>

export function sentinel2Frame(scene: SentinelScene): Sentinel2Frame {
  return {
    id: scene.id,
    date: scene.date,
    layers: [
      {
        tiles: sentinelTileUrl(scene),
        tileSize: 256,
        minZoom: SENTINEL_TILE_MIN_ZOOM,
        maxZoom: SENTINEL_TILE_MAX_ZOOM,
        attribution: `Sentinel-2 L2A via Element 84 Earth Search · ${sentinelCredit([scene.date])}`,
      },
    ],
    source: scene,
  }
}

const cell = (value: number) => Math.floor(value / SENTINEL_FEED_AREA_DEG)

export const SENTINEL2_FEED: ImageryFeed<SentinelScene> = {
  id: 'sentinel-2-l2a',
  label: 'Sentinel-2 scenes',
  shortLabel: 'Sentinel-2',
  frameNoun: { one: 'scene', many: 'scenes' },
  description:
    'Sentinel-2 true colour at 10 m from the last two years, one scene a date over the map centre, from zoom 9. Each date is when the satellite passed; a scene can be partly cloudy.',
  dateMeaning: 'Sentinel-2 acquisition date',
  loadingText: 'Searching Sentinel-2 scenes here…',
  retryLabel: 'Search Sentinel-2 again',
  period: 'month',
  playbackMs: SENTINEL_PLAYBACK_MS,
  placeMaxZoom: SENTINEL_TILE_MAX_ZOOM,
  tileProtocol: SENTINEL_TILE_PROTOCOL,
  async listFramesAt(place: ImageryPlace, context) {
    const box: [number, number, number, number] = [
      place.lon - SEARCH_HALF_DEG,
      place.lat - SEARCH_HALF_DEG,
      place.lon + SEARCH_HALF_DEG,
      place.lat + SEARCH_HALF_DEG,
    ]
    const scenes = await searchSentinelScenes({
      window: box,
      range: recentRange(new Date(`${context.today}T23:59:59Z`), SENTINEL_RECENT_DAYS),
      fetch: context.fetch,
      signal: context.signal,
      limit: SENTINEL_FEED_SEARCH_LIMIT,
      max: SENTINEL_FEED_MAX_SCENES,
    })
    return scenes.reverse().map(sentinel2Frame)
  },
  listAreaKey: (place) => `${cell(place.lon)},${cell(place.lat)}`,
  describes: () => true,
  async captureAt(frame) {
    const scene = frame.source
    return {
      date: scene.date,
      resolutionM: 10,
      accuracyM: null,
      provider: 'Copernicus Sentinel-2 (ESA), via Element 84 Earth Search',
      source: scene.cloudPercent != null ? `${Math.round(scene.cloudPercent)}% cloud over the whole tile` : null,
    }
  },
}

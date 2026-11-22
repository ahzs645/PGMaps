/**
 * Esri World Imagery Wayback as an imagery feed: every archived release of the World Imagery mosaic,
 * the ones that change the picture at a place (Esri's tile map), and what a release captured there
 * (its metadata service). The protocol is `src/lib/wayback.ts`; this only meets `ImageryFeed`.
 * A release dates the mosaic, not the photograph: most releases reuse imagery already there.
 */
import {
  loadWaybackReleases,
  parseWaybackCapture,
  parseWaybackTilemap,
  waybackCaptureUrl,
  waybackCredit,
  waybackLocalChanges,
  waybackTileAt,
  waybackTileKey,
  waybackTilemapUrl,
  WAYBACK_MAX_TILE_ZOOM,
  WAYBACK_SPOT_TIMEOUT_MS,
  type WaybackRelease,
} from '@/lib/wayback'
import type { ImageryFeed, ImageryFeedContext, ImageryFrame } from './feed'

/** Play shows each release this long before the next, ms. */
export const WAYBACK_PLAYBACK_MS = 2_000

export type WaybackFrame = ImageryFrame<WaybackRelease>

async function readJson(context: ImageryFeedContext, url: string): Promise<unknown> {
  const response = await context.fetch(url, {
    signal: AbortSignal.any([context.signal, AbortSignal.timeout(WAYBACK_SPOT_TIMEOUT_MS)]),
  })
  if (!response.ok) throw new Error(`Esri returned HTTP ${response.status}.`)
  return response.json()
}

export function waybackFrame(release: WaybackRelease): WaybackFrame {
  return {
    id: release.id,
    date: release.date,
    // As the satellite basemap (`map-satellite-imagery.tsx`): past z18 rural BC gets Esri's grey placeholder.
    layers: [{ tiles: release.tiles, maxZoom: WAYBACK_MAX_TILE_ZOOM, attribution: waybackCredit(release) }],
    source: release,
  }
}

export const WAYBACK_FEED: ImageryFeed<WaybackRelease> = {
  id: 'esri-wayback',
  label: 'Esri Wayback',
  shortLabel: 'Wayback',
  frameNoun: { one: 'release', many: 'releases' },
  description:
    'Archived releases of Esri World Imagery, sharp but often years apart. A release dates the mosaic; the capture date is read for the map centre.',
  dateMeaning: 'Esri Wayback mosaic release date',
  loadingText: 'Loading Wayback releases…',
  retryLabel: 'Retry Wayback catalog',
  period: 'year',
  playbackMs: WAYBACK_PLAYBACK_MS,
  placeMaxZoom: WAYBACK_MAX_TILE_ZOOM,
  async listFrames(context) {
    return (await loadWaybackReleases(context.signal, context.fetch)).reverse().map(waybackFrame)
  },
  // One tile answers for every point on it.
  placeKey: (place) => waybackTileKey(waybackTileAt(place.lon, place.lat, place.zoom)),
  async framesChangingAt(frames, place, context) {
    const tile = waybackTileAt(place.lon, place.lat, place.zoom)
    const newestFirst = [...frames].reverse()
    const changes = await waybackLocalChanges(
      newestFirst.map((frame) => frame.source),
      async (release) => parseWaybackTilemap(await readJson(context, waybackTilemapUrl(release.id, tile)), release.id),
      context.signal,
    )
    const byId = new Map(frames.map((frame) => [frame.id, frame]))
    return changes.map((release) => byId.get(release.id)!).reverse()
  },
  changesLabel: 'Only releases that change this spot',
  changesHint:
    'Only the releases that brought new imagery to the map centre. A release dates the mosaic, not the photograph; most reuse the imagery already there.',
  describes: (frame) => !!frame.source.metadataUrl,
  async captureAt(frame, place, context) {
    const url = waybackCaptureUrl(frame.source, place.lon, place.lat, place.zoom)
    return url ? parseWaybackCapture(await readJson(context, url)) : null
  },
}

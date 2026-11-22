import { describe, expect, it } from 'vitest'
import recorded from '@/lib/sentinel2/stacSearch.fixture.json'
import { SENTINEL_STAC_SEARCH_URL } from '@/lib/sentinel2/limits'
import { parseSentinelTileUrl } from '@/lib/sentinel2/tiles'
import { checkFrames, type ImageryFeedContext } from './feed'
import { SENTINEL2_FEED } from './sentinel2Feed'

const PLACE = { lon: -122.71, lat: 53.9, zoom: 13 }

function context(bodies: unknown[] = []): ImageryFeedContext {
  return {
    today: '2025-09-15',
    signal: new AbortController().signal,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(SENTINEL_STAC_SEARCH_URL)
      bodies.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify(recorded))
    }) as typeof fetch,
  }
}

describe('SENTINEL2_FEED', () => {
  it('lists the scenes over the map centre, oldest first, each drawn through the pgmaps-s2 tiles', async () => {
    const bodies: unknown[] = []
    const frames = checkFrames(SENTINEL2_FEED, await SENTINEL2_FEED.listFramesAt!(PLACE, context(bodies)))
    expect(frames.length).toBeGreaterThan(1)
    expect(frames.at(-1)?.date).toBe('2025-08-30')
    const tile = parseSentinelTileUrl(
      frames[0].layers[0].tiles.replace('{z}', '13').replace('{x}', '1').replace('{y}', '2'),
    )
    expect(tile?.visualHref).toMatch(/^https:\/\/.*TCI\.tif$/)
    expect(frames[0].layers[0].minZoom).toBe(9)
    const body = bodies[0] as { bbox: number[]; datetime: string }
    expect(body.bbox[0]).toBeLessThan(PLACE.lon)
    expect(body.bbox[2]).toBeGreaterThan(PLACE.lon)
    expect(body.datetime.endsWith('2025-09-15T23:59:59.000Z')).toBe(true)
  })

  it('lists again only in another 0.1° cell', () => {
    const key = SENTINEL2_FEED.listAreaKey!
    expect(key(PLACE)).toBe(key({ ...PLACE, lon: PLACE.lon + 0.005 }))
    expect(key(PLACE)).not.toBe(key({ ...PLACE, lon: PLACE.lon + 0.2 }))
  })

  it('names the acquisition date and the tile’s cloud as what a frame captured', async () => {
    const [frame] = await SENTINEL2_FEED.listFramesAt!(PLACE, context())
    const capture = await SENTINEL2_FEED.captureAt!(frame, PLACE, context())
    expect(capture).toMatchObject({ date: frame.date, resolutionM: 10 })
  })
})

import { describe, expect, it, vi } from 'vitest'
import recorded from './stacSearch.fixture.json'
import { SENTINEL_CLOUD_MAX_PERCENT, SENTINEL_COLLECTION, SENTINEL_STAC_SEARCH_URL } from './limits'
import {
  parseSentinelItem,
  parseSentinelScenes,
  recentRange,
  searchSentinelScenes,
  sentinelCredit,
  sentinelSearchBody,
  SentinelError,
  seasonRange,
  yearRange,
  type LonLatBounds,
} from './stac'

// The demo terrain near Prince George, the bbox the fixture was recorded over.
const DEMO: LonLatBounds = [-122.731, 53.884, -122.689, 53.907]

describe('Sentinel-2 STAC search', () => {
  it('asks Earth Search for L2A scenes over the window, under the cloud limit, newest first', () => {
    const body = sentinelSearchBody(DEMO, yearRange(2024))
    expect(body).toMatchObject({
      collections: [SENTINEL_COLLECTION],
      bbox: DEMO,
      datetime: '2024-01-01T00:00:00Z/2024-12-31T23:59:59Z',
      query: { 'eo:cloud_cover': { lt: SENTINEL_CLOUD_MAX_PERCENT } },
      sortby: [{ field: 'properties.datetime', direction: 'desc' }],
    })
  })

  it("searches a year's leaf-on summer", () => {
    expect(seasonRange(2019)).toEqual({ from: '2019-06-01T00:00:00Z', to: '2019-09-30T23:59:59Z' })
  })

  it('reaches back the recent range from now', () => {
    expect(recentRange(new Date('2026-11-11T00:00:00Z'), 730)).toEqual({
      from: '2024-11-11T00:00:00.000Z',
      to: '2026-11-11T00:00:00.000Z',
    })
  })

  it('parses a recorded response into scenes with dates, cloud, EPSG, COG URLs and band scaling', () => {
    const scenes = parseSentinelScenes(recorded, DEMO, { preferEpsg: 32610 })
    expect(scenes[0]).toEqual({
      id: 'S2B_10UEE_20250830_0_L2A',
      datetime: '2025-08-30T19:29:40.612000Z',
      date: '2025-08-30',
      cloudPercent: expect.closeTo(29.8, 1),
      epsg: 32610,
      bbox: [-123.000291, 53.149869, -121.31968, 54.148095],
      assets: {
        visual: expect.stringMatching(/^https:\/\/sentinel-cogs\.s3\.us-west-2\.amazonaws\.com\/.*\/TCI\.tif$/),
        red: expect.stringMatching(/\/B04\.tif$/),
        nir: expect.stringMatching(/\/B08\.tif$/),
        scl: expect.stringMatching(/\/SCL\.tif$/),
      },
      // Earth Search has already removed the −0.1 offset from these pixels (boa_offset_applied).
      scaling: { red: { scale: 0.0001, offset: 0 }, nir: { scale: 0.0001, offset: 0 } },
    })
    expect(scenes.map((scene) => scene.date)).toEqual([...scenes.map((scene) => scene.date)].sort().reverse())
  })

  it('keeps one scene per date: the recorded response has two tiles on 28 July 2025', () => {
    const items = (recorded.features as Array<{ properties: { datetime: string } }>).filter((f) =>
      f.properties.datetime.startsWith('2025-07-28'),
    )
    expect(items).toHaveLength(2)
    const scenes = parseSentinelScenes(recorded, DEMO, { preferEpsg: 32610 })
    expect(scenes.filter((scene) => scene.date === '2025-07-28')).toHaveLength(1)
    expect(new Set(scenes.map((scene) => scene.date)).size).toBe(scenes.length)
    // Both hold the window, so the less cloudy one wins.
    expect(scenes.find((scene) => scene.date === '2025-07-28')?.id).toBe('S2A_10UEE_20250728_1_L2A')
  })

  it('prefers the tile whose footprint holds the window over a less cloudy one that only clips it', () => {
    const item = (id: string, bbox: number[], cloud: number) => ({
      id,
      bbox,
      properties: { datetime: '2025-08-01T19:00:00Z', 'eo:cloud_cover': cloud, 'proj:epsg': 32610 },
      assets: Object.fromEntries(['visual', 'red', 'nir', 'scl'].map((k) => [k, { href: `https://x/${id}/${k}.tif` }])),
    })
    const scenes = parseSentinelScenes(
      { features: [item('clipped', [-122.7, 53, -121, 54], 1), item('whole', [-123, 53, -121, 54], 40)] },
      DEMO,
    )
    expect(scenes.map((scene) => scene.id)).toEqual(['whole'])
  })

  it('skips items without a UTM CRS or one of the four COGs, and reads proj:code', () => {
    const base = {
      id: 'a',
      properties: { datetime: '2025-08-01T00:00:00Z', 'proj:code': 'EPSG:32611' },
      assets: Object.fromEntries(['visual', 'red', 'nir', 'scl'].map((k) => [k, { href: `https://x/${k}.tif` }])),
    }
    expect(parseSentinelItem(base)?.epsg).toBe(32611)
    expect(
      parseSentinelItem({ ...base, properties: { datetime: '2025-08-01T00:00:00Z', 'proj:epsg': 3005 } }),
    ).toBeNull()
    expect(parseSentinelItem({ ...base, assets: { ...base.assets, scl: { href: 's3://bucket/SCL.jp2' } } })).toBeNull()
    expect(parseSentinelItem(base)?.scaling.red).toEqual({ scale: 1, offset: 0 })
  })

  it('applies the listed BOA offset only when Earth Search has not already removed it from the pixels', () => {
    const item = (applied: boolean | undefined) => ({
      id: 'a',
      properties: {
        datetime: '2025-08-01T00:00:00Z',
        'proj:epsg': 32610,
        ...(applied === undefined ? {} : { 'earthsearch:boa_offset_applied': applied }),
      },
      assets: Object.fromEntries(
        ['visual', 'red', 'nir', 'scl'].map((k) => [
          k,
          { href: `https://x/${k}.tif`, 'raster:bands': [{ scale: 0.0001, offset: -0.1 }] },
        ]),
      ),
    })
    expect(parseSentinelItem(item(true))?.scaling.nir).toEqual({ scale: 0.0001, offset: 0 })
    expect(parseSentinelItem(item(false))?.scaling.nir).toEqual({ scale: 0.0001, offset: -0.1 })
    expect(parseSentinelItem(item(undefined))?.scaling.nir).toEqual({ scale: 0.0001, offset: -0.1 })
  })

  it('posts the search through the injected fetch and returns the parsed scenes', async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => recorded }))
    const scenes = await searchSentinelScenes({ window: DEMO, range: yearRange(2025), fetch })
    expect(fetch).toHaveBeenCalledWith(SENTINEL_STAC_SEARCH_URL, expect.objectContaining({ method: 'POST' }))
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({ bbox: DEMO })
    expect(scenes.length).toBe(8)
  })

  it('states why a search failed instead of returning nothing', async () => {
    const failing = async () => ({ ok: false, status: 503, json: async () => ({}) })
    await expect(searchSentinelScenes({ window: DEMO, range: yearRange(2025), fetch: failing })).rejects.toThrow(
      'The Sentinel-2 scene search failed (HTTP 503).',
    )
    const offline = async () => {
      throw new TypeError('Failed to fetch')
    }
    await expect(searchSentinelScenes({ window: DEMO, range: yearRange(2025), fetch: offline })).rejects.toThrow(
      'could not be reached',
    )
    const hanging = (_: string, init?: RequestInit) =>
      new Promise<never>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
    const error = await searchSentinelScenes({
      window: DEMO,
      range: yearRange(2025),
      fetch: hanging,
      timeoutMs: 5,
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SentinelError)
    expect((error as SentinelError).message).toMatch(/^The Sentinel-2 scene search took longer than/)
  })

  it('credits Copernicus with the years shown', () => {
    expect(sentinelCredit(['2025-08-30'])).toBe('Contains modified Copernicus Sentinel data 2025')
    expect(sentinelCredit(['2025-08-30', '2019-07-02', '2025-07-01'])).toBe(
      'Contains modified Copernicus Sentinel data 2019, 2025',
    )
  })
})

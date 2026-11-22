import { describe, expect, it } from 'vitest'
import { WAYBACK_CATALOG, WAYBACK_TILEMAP } from '../wayback'
import { checkFrames, type ImageryFeedContext } from './feed'
import { WAYBACK_FEED } from './waybackFeed'

const item = (id: string, date: string, metadata = true) => [
  id,
  {
    itemTitle: `World Imagery (Wayback ${date})`,
    itemURL: `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${id}/{level}/{row}/{col}`,
    ...(metadata
      ? {
          metadataLayerUrl: `https://metadata.maptiles.arcgis.com/arcgis/rest/services/World_Imagery_Metadata_${id}/MapServer`,
        }
      : {}),
  },
]
const CATALOG = Object.fromEntries([
  item('30', '2023-04-05'),
  item('10', '2014-02-20', false),
  item('20', '2019-09-18'),
])

/** A fake Esri: the catalog, a tile map where 30 reuses 20's tile and 10 has its own, and one capture record. */
function context(asked: string[] = []): ImageryFeedContext {
  const answer = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)))
  return {
    today: '2026-11-21',
    signal: new AbortController().signal,
    fetch: ((input: RequestInfo | URL) => {
      const url = String(input)
      asked.push(url)
      if (url === WAYBACK_CATALOG) return answer(CATALOG)
      if (url.startsWith(`${WAYBACK_TILEMAP}/30/`)) return answer({ data: [1], select: [20] })
      if (url.startsWith(`${WAYBACK_TILEMAP}/10/`)) return answer({ data: [1] })
      if (url.includes('Metadata_30'))
        return answer({ features: [{ attributes: { SRC_DATE: 20220801, SRC_RES: 0.3 } }] })
      return Promise.resolve(new Response('not found', { status: 404 }))
    }) as typeof fetch,
  }
}

const PLACE = { lon: -122.75, lat: 53.92, zoom: 15 }

describe('WAYBACK_FEED', () => {
  it('lists the releases oldest first, each one Esri layer to zoom 18 with its credit', async () => {
    const frames = checkFrames(WAYBACK_FEED, await WAYBACK_FEED.listFrames!(context()))
    expect(frames.map((frame) => [frame.id, frame.date])).toEqual([
      ['10', '2014-02-20'],
      ['20', '2019-09-18'],
      ['30', '2023-04-05'],
    ])
    expect(frames[0].layers).toHaveLength(1)
    expect(frames[0].layers[0]).toMatchObject({ maxZoom: 18, tiles: expect.stringContaining('/tile/10/{z}/{y}/{x}') })
  })

  it('finds the releases that change the picture at a place, one tile-map request per image', async () => {
    const asked: string[] = []
    const frames = await WAYBACK_FEED.listFrames!(context())
    const changes = await WAYBACK_FEED.framesChangingAt!(frames, PLACE, context(asked))
    expect(changes.map((frame) => frame.id)).toEqual(['10', '20'])
    expect(asked.filter((url) => url.startsWith(WAYBACK_TILEMAP))).toHaveLength(2)
  })

  it('reads what a release captured, and says which releases can tell', async () => {
    const [oldest, , newest] = await WAYBACK_FEED.listFrames!(context())
    expect(WAYBACK_FEED.describes!(oldest)).toBe(false)
    expect(WAYBACK_FEED.describes!(newest)).toBe(true)
    await expect(WAYBACK_FEED.captureAt!(newest, PLACE, context())).resolves.toMatchObject({
      date: '2022-08-01',
      resolutionM: 0.3,
    })
  })

  it('keys a place by the tile under it', () => {
    expect(WAYBACK_FEED.placeKey!(PLACE)).toBe(WAYBACK_FEED.placeKey!({ ...PLACE, lon: PLACE.lon + 0.0001 }))
  })
})

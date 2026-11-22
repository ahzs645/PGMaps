import { describe, expect, it } from 'vitest'
import { formatResolution, shownChange } from './imageryFeeds/feed'
import {
  parseWaybackCapture,
  parseWaybackTilemap,
  waybackCaptureUrl,
  waybackLocalChanges,
  waybackMetadataLayer,
  waybackReleases,
  waybackTileAt,
  waybackTilemapUrl,
  type WaybackRelease,
} from './wayback'

const release = (id: string, date: string): WaybackRelease => ({ id, date, tiles: `https://example/${id}/{z}/{y}/{x}` })

// Newest first, as `loadWaybackReleases` returns them.
const catalog = [
  release('60', '2026-11-18'),
  release('50', '2025-10-23'),
  release('40', '2024-10-10'),
  release('30', '2023-04-05'),
  release('20', '2019-09-18'),
  release('10', '2014-02-20'),
]

describe('waybackLocalChanges', () => {
  it('asks once per distinct image and returns each image’s first release', async () => {
    // 2026 reuses 2025's tile; 2025 is its own; 2024 reuses 2019's; 2019 reuses 2014's.
    const tilemap: Record<string, string> = { '60': '50', '50': '50', '30': '20', '40': '20', '20': '10', '10': '10' }
    const asked: string[] = []
    const changes = await waybackLocalChanges(catalog, async (r) => {
      asked.push(r.id)
      return { exists: true, from: tilemap[r.id] }
    })
    expect(changes.map((r) => r.date)).toEqual(['2025-10-23', '2019-09-18', '2014-02-20'])
    expect(asked).toEqual(['60', '40', '10'])
  })

  it('stops where no older release has a tile', async () => {
    const changes = await waybackLocalChanges(catalog, async (r) => ({ exists: r.id !== '30', from: r.id }))
    expect(changes.map((r) => r.id)).toEqual(['60', '50', '40'])
  })

  it('treats an unknown or newer `select` as the release’s own tile, so the walk always moves on', async () => {
    const changes = await waybackLocalChanges(catalog.slice(0, 3), async (r) => ({
      exists: true,
      from: r.id === '60' ? '999' : r.id === '50' ? '60' : r.id,
    }))
    expect(changes.map((r) => r.id)).toEqual(['60', '50', '40'])
  })

  it('stops when aborted', async () => {
    const controller = new AbortController()
    const walk = waybackLocalChanges(
      catalog,
      async (r) => {
        controller.abort()
        return { exists: true, from: r.id }
      },
      controller.signal,
    )
    await expect(walk).rejects.toThrow()
  })
})

describe('shownChange', () => {
  const changes = [release('10', '2014-02-20'), release('20', '2019-09-18'), release('50', '2025-10-23')]
  it('is the newest change not after the release date', () => {
    expect(shownChange(changes, '2026-11-18')?.id).toBe('50')
    expect(shownChange(changes, '2024-10-10')?.id).toBe('20')
    expect(shownChange(changes, '2019-09-18')?.id).toBe('20')
  })
  it('falls back to the oldest change before the first', () => {
    expect(shownChange(changes, '2010-01-01')?.id).toBe('10')
    expect(shownChange([], '2010-01-01')).toBeUndefined()
  })
})

describe('tilemap and capture', () => {
  it('finds the tile under a point the way Esri numbers it', () => {
    // UNBC, Prince George; checked against Esri's tilemap service on 20 November 2026.
    expect(waybackTileAt(-122.827, 53.8939, 16)).toEqual({ z: 16, x: 10408, y: 21075 })
    expect(waybackTileAt(-122.827, 53.8939, 21).z).toBe(18)
    expect(waybackTilemapUrl('3692', { z: 16, x: 10408, y: 21075 })).toMatch(/\/tilemap\/3692\/16\/21075\/10408$/)
  })

  it('reads a tilemap answer', () => {
    expect(parseWaybackTilemap({ data: [1], select: [20512], valid: true }, '3692')).toEqual({
      exists: true,
      from: '20512',
    })
    expect(parseWaybackTilemap({ data: [1] }, '3692')).toEqual({ exists: true, from: '3692' })
    expect(parseWaybackTilemap({ data: [0] }, '3692').exists).toBe(false)
    expect(() => parseWaybackTilemap('<html>', '1')).toThrow()
  })

  it('picks Esri’s metadata layer for the drawn zoom', () => {
    expect(waybackMetadataLayer(18)).toBe(5)
    expect(waybackMetadataLayer(20)).toBe(5)
    expect(waybackMetadataLayer(14)).toBe(9)
    expect(waybackMetadataLayer(4)).toBe(13)
  })

  it('asks the release’s own metadata service, and nothing when it has none', () => {
    const url = waybackCaptureUrl(
      { ...release('1', '2024-10-10'), metadataUrl: 'https://metadata.maptiles.arcgis.com/x/MapServer' },
      -122.827,
      53.8939,
      16,
    )
    expect(url).toMatch(/^https:\/\/metadata\.maptiles\.arcgis\.com\/x\/MapServer\/7\/query\?/)
    expect(new URL(url!).searchParams.get('geometry')).toBe('-122.827,53.8939')
    expect(waybackCaptureUrl(release('1', '2024-10-10'), 0, 0, 16)).toBeNull()
  })

  it('reads a capture record', () => {
    const record = parseWaybackCapture({
      features: [
        {
          attributes: {
            SRC_DATE: 20230515,
            SRC_DATE2: 1684108800000,
            SRC_RES: 0.075,
            SRC_ACC: 99999,
            SRC_DESC: 'Prince George 2023 Ortho',
            NICE_DESC: 'City of Prince George',
          },
        },
      ],
    })
    expect(record).toEqual({
      date: '2023-05-15',
      resolutionM: 0.075,
      accuracyM: null,
      provider: 'City of Prince George',
      source: 'Prince George 2023 Ortho',
    })
    expect(
      parseWaybackCapture({ features: [{ attributes: { SRC_DATE: null, SRC_DATE2: 1684108800000 } }] })?.date,
    ).toBe('2023-05-15')
    expect(parseWaybackCapture({ features: [] })).toBeNull()
    expect(() => parseWaybackCapture({ error: { message: 'Invalid query' } })).toThrow('Invalid query')
  })

  it('formats resolution', () => {
    expect(formatResolution(0.075)).toBe('7.5 cm')
    expect(formatResolution(0.6)).toBe('60 cm')
    expect(formatResolution(1.2)).toBe('1.2 m')
    expect(formatResolution(15)).toBe('15 m')
  })
})

describe('waybackReleases', () => {
  it('keeps a release’s metadata service only on Esri’s metadata host', () => {
    const [kept, dropped] = waybackReleases({
      1: {
        itemTitle: 'World Imagery (Wayback 2024-10-10)',
        itemURL: 'https://wayback.maptiles.arcgis.com/a/tile/1/{level}/{row}/{col}',
        metadataLayerUrl: 'https://metadata.maptiles.arcgis.com/arcgis/rest/services/M/MapServer/',
      },
      2: {
        itemTitle: 'World Imagery (Wayback 2023-10-10)',
        itemURL: 'https://wayback.maptiles.arcgis.com/a/tile/2/{level}/{row}/{col}',
        metadataLayerUrl: 'https://example.com/MapServer',
      },
    })
    expect(kept.metadataUrl).toBe('https://metadata.maptiles.arcgis.com/arcgis/rest/services/M/MapServer')
    expect(dropped.metadataUrl).toBeUndefined()
  })
})

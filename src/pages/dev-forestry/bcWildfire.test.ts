import { describe, expect, it } from 'vitest'
import { fetchFirePerimeters, fireQueryUrl, parseFirePerimeters } from './bcWildfire'

const polygon = (w: number, s: number, e: number, n: number): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [w, s],
      [e, s],
      [e, n],
      [w, n],
      [w, s],
    ],
  ],
})

describe('BC Wildfire Service perimeters', () => {
  it('asks by a longitude-first CQL box on SHAPE, from a fire year, for four fields', () => {
    const url = new URL(fireQueryUrl('historical', [-123.0, 50.78, -122.8, 50.92], 2005))
    expect(url.pathname).toContain('PROT_HISTORICAL_FIRE_POLYS_SP')
    expect(url.searchParams.get('CQL_FILTER')).toBe(
      "BBOX(SHAPE,-123,50.78,-122.8,50.92,'EPSG:4326') AND FIRE_YEAR >= 2005",
    )
    expect(url.searchParams.get('propertyName')).toBe('FIRE_NUMBER,FIRE_YEAR,FIRE_SIZE_HECTARES,SHAPE')
    expect(url.searchParams.has('bbox')).toBe(false)
    expect(new URL(fireQueryUrl('current', [-123, 50, -122, 51], 2005)).pathname).toContain(
      'PROT_CURRENT_FIRE_POLYS_SP',
    )
  })

  it('keeps polygons with a year, and says when the answer was cut short', () => {
    const parsed = parseFirePerimeters({
      numberMatched: 3,
      features: [
        {
          geometry: polygon(0, 0, 1, 1),
          properties: { FIRE_NUMBER: ' K71649 ', FIRE_YEAR: 2023, FIRE_SIZE_HECTARES: 9565.1 },
        },
        { geometry: polygon(0, 0, 1, 1), properties: { FIRE_NUMBER: 'X', FIRE_YEAR: null } },
        { geometry: { type: 'Point', coordinates: [0, 0] }, properties: { FIRE_YEAR: 2020 } },
      ],
    })
    expect(parsed.fires).toEqual([
      { geometry: polygon(0, 0, 1, 1), year: 2023, fireNumber: 'K71649', sizeHectares: 9565.1 },
    ])
    expect(parsed.truncated).toBe(true)
  })

  it('reads both layers per tile, keeps a fire met twice once, and leaves failed tiles out of the complete ones', async () => {
    const tiles: Array<[number, number, number, number]> = [
      [-123, 50, -122.9, 50.1],
      [-122.9, 50, -122.8, 50.1],
    ]
    const asked: string[] = []
    const fetchImpl = (async (raw: string) => {
      const url = decodeURIComponent(raw.replace(/\+/g, ' '))
      asked.push(url)
      if (url.includes('-122.9,50,-122.8') && url.includes('CURRENT')) return new Response('down', { status: 503 })
      const features = url.includes('HISTORICAL')
        ? [{ geometry: polygon(-123, 50, -122.8, 50.1), properties: { FIRE_NUMBER: 'K1', FIRE_YEAR: 2021 } }]
        : []
      return new Response(JSON.stringify({ features, numberMatched: features.length }))
    }) as typeof fetch
    const result = await fetchFirePerimeters(tiles, 2005, { fetchImpl })
    expect(asked).toHaveLength(4)
    expect(result.fires).toHaveLength(1)
    expect(result.complete).toEqual([tiles[0]])
    expect(result.note).toContain('1 of 2 tiles')
    expect(result.note).toContain('2021')
  })
})

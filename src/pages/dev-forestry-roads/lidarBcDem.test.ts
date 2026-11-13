import { describe, expect, it } from 'vitest'
import { demTileQuery, findLidarBcDem, parseDemTiles, parseLidarBcStatus } from './lidarBcDem'
import type { Coordinate } from './types'

const ring: Coordinate[] = [
  [-121.56, 54.05],
  [-121.51, 54.05],
  [-121.51, 54.09],
  [-121.56, 54.09],
]
// The sheet LidarBC lists under the reference block's roads (index row as returned on 2026-11-12).
const sheet = {
  maptile: '093i003',
  year: 2019,
  spacing: '1 metre',
  oper_name: 'NDMP Floodplains 2019',
  filename: 'bc_093i003_xli1m_utm10_2019.tif',
  s3Url: 'https://nrs.objectstore.gov.bc.ca/gdwuts/093/093i/2019/dem/bc_093i003_xli1m_utm10_2019.tif',
}

describe('LidarBC DEM tiles under an area', () => {
  it('asks each DEM layer for the tiles crossing a closed lon/lat ring', () => {
    const { url, body } = demTileQuery('dem2500', ring)
    expect(url).toMatch(/LiDAR_BC_S3_Public\/FeatureServer\/5\/query$/)
    expect(demTileQuery('dem20000', ring).url).toMatch(/FeatureServer\/6\/query$/)
    const geometry = JSON.parse(body.get('geometry')!)
    expect(geometry.rings[0]).toHaveLength(5)
    expect(geometry.rings[0][0]).toEqual(geometry.rings[0][4])
    expect(body.get('inSR')).toBe('4326')
    expect(body.get('returnGeometry')).toBe('false')
  })

  it('keeps only object-store GeoTIFF links and names the acquisition', () => {
    const tiles = parseDemTiles('dem20000', {
      features: [{ attributes: sheet }, { attributes: { ...sheet, s3Url: 'https://example.com/x.tif' } }],
    })
    expect(tiles).toEqual([
      {
        productId: 'dem20000',
        grid: '1:20,000',
        maptile: '093i003',
        year: 2019,
        project: 'NDMP Floodplains 2019',
        spacing: '1 metre',
        filename: 'bc_093i003_xli1m_utm10_2019.tif',
        url: sheet.s3Url,
        estimatedBytes: 604e6,
      },
    ])
    expect(() => parseDemTiles('dem2500', { error: { message: 'Invalid query' } })).toThrow('LidarBC index: Invalid')
  })

  it('lists 1:2,500 tiles before 1:20,000 sheets and posts both queries', async () => {
    const asked: string[] = []
    const fetcher = (async (url: string) => {
      asked.push(url)
      if (url.includes('LidarBC_Progress'))
        return new Response(
          JSON.stringify({
            features: [
              { attributes: { status_of_availability: 'Planned Acquisition', availability_year: 2024 } },
              { attributes: { status_of_availability: 'Actual Acquisition', availability_year: 2024 } },
              { attributes: { status_of_availability: 'Actual Acquisition', availability_year: 2024 } },
            ],
          }),
        )
      const layer = url.match(/FeatureServer\/(\d)/)![1]
      const features =
        layer === '5'
          ? [{ attributes: { ...sheet, maptile: '093i003_1_1_1', s3Url: sheet.s3Url.replace('.tif', '_a.tif') } }]
          : [{ attributes: sheet }]
      return new Response(JSON.stringify({ features }))
    }) as unknown as typeof fetch
    const found = await findLidarBcDem(ring, fetcher)
    expect(asked).toHaveLength(3)
    expect(found.tiles.map((t) => t.grid)).toEqual(['1:2,500', '1:20,000'])
    expect(found.truncated).toBe(false)
    // Flown before planned, each status once: the reference block's roads read "Actual Acquisition (2024)".
    expect(found.status).toEqual([
      { status: 'Actual Acquisition', year: 2024 },
      { status: 'Planned Acquisition', year: 2024 },
    ])
  })

  it('lists the tiles and reads the status as not read when the status layer fails', async () => {
    const fetcher = (async (url: string) =>
      url.includes('LidarBC_Progress')
        ? new Response('', { status: 500 })
        : new Response(JSON.stringify({ features: [{ attributes: sheet }] }))) as unknown as typeof fetch
    const found = await findLidarBcDem(ring, fetcher)
    expect(found.tiles).toHaveLength(2)
    expect(found.status).toBeNull()
    expect(() => parseLidarBcStatus({ error: { message: 'bad' } })).toThrow('LidarBC status: bad')
  })
})

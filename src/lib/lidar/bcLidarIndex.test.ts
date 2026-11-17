import { describe, expect, it } from 'vitest'
import {
  countUrl,
  coverageUrl,
  estimatedBytes,
  formatBytes,
  LIDAR_BC_PRODUCTS,
  LIDAR_BC_SERVICE,
  parseCount,
  parseYearCounts,
  productById,
  storedFile,
  tilesUrl,
  yearCountsUrl,
} from './bcLidarIndex'

const pointcloud = productById('pointcloud')!
const dsm2500 = productById('dsm2500')!
const dsm10000 = productById('dsm10000')!
const princeGeorge = { west: -122.9, south: 53.8, east: -122.6, north: 54 }
const params = (url: string) => new URL(url).searchParams

describe('BC LiDAR index queries', () => {
  it('maps each product to its feature-service layer', () => {
    expect(Object.fromEntries(LIDAR_BC_PRODUCTS.map((p) => [p.id, p.layer]))).toEqual({
      pointcloud: 4,
      dem2500: 5,
      dem20000: 6,
      dsm2500: 1,
      dsm10000: 2,
      dsm20000: 3,
    })
  })

  it('asks for one view of tiles as WGS84 GeoJSON, longitude first', () => {
    const url = tilesUrl(pointcloud, princeGeorge, 2024)
    expect(url.startsWith(`${LIDAR_BC_SERVICE}/4/query?`)).toBe(true)
    const p = params(url)
    expect(p.get('where')).toBe('year=2024')
    expect(p.get('geometry')).toBe('-122.90000,53.80000,-122.60000,54.00000')
    expect(p.get('geometryType')).toBe('esriGeometryEnvelope')
    expect(p.get('inSR')).toBe('4326')
    expect(p.get('outSR')).toBe('4326')
    expect(p.get('f')).toBe('geojson')
    expect(p.get('outFields')).toContain('s3RptUrl')
  })

  it('counts a view or the whole province, for all years or one', () => {
    expect(params(countUrl(pointcloud, null, null)).get('where')).toBe('1=1')
    expect(params(countUrl(pointcloud, null, null)).has('geometry')).toBe(false)
    expect(params(countUrl(pointcloud, princeGeorge, null)).get('returnCountOnly')).toBe('true')
    // A year is a number; anything else must not reach the where clause.
    expect(params(countUrl(pointcloud, null, 2019.7)).get('where')).toBe('year=2019')
  })

  it('groups counts by year on the service and reads them back sorted', () => {
    const stats = JSON.parse(params(yearCountsUrl(dsm2500)).get('outStatistics')!)
    expect(stats[0]).toMatchObject({ statisticType: 'count', outStatisticFieldName: 'tiles' })
    expect(
      parseYearCounts({
        features: [{ attributes: { year: 2024, tiles: 5 } }, { attributes: { year: 2016, tiles: 2 } }],
      }),
    ).toEqual([
      { year: 2016, tiles: 2 },
      { year: 2024, tiles: 5 },
    ])
    expect(() => parseYearCounts({ error: { message: 'Invalid query' } })).toThrow()
  })

  it('reads a count, and reports the service error instead of zero', () => {
    expect(parseCount({ count: 190 })).toBe(190)
    expect(() => parseCount({ error: { message: 'Invalid query' } })).toThrow('LiDAR index: Invalid query')
  })

  it('simplifies the yearly coverage outlines on the server', () => {
    const p = params(coverageUrl())
    expect(p.get('outFields')).toBe('YEAR_')
    expect(p.get('maxAllowableOffset')).toBe('0.005')
  })
})

describe('stored files', () => {
  const tif = (year: number) => ({ year, s3Url: `https://example.org/x/bc_092b051_1_3_1_${year}_dsm.tif` })

  it('points 2016/2018 1:2,500 and all 1:10,000 surface models at the .laz the bucket holds', () => {
    expect(storedFile(dsm2500, tif(2016))).toMatchObject({ format: 'LAZ', corrected: true })
    expect(storedFile(dsm2500, tif(2018)).url).toMatch(/_dsm\.laz$/)
    expect(storedFile(dsm10000, tif(2017)).url).toMatch(/_dsm\.laz$/)
  })

  it('leaves the listed link alone everywhere else', () => {
    expect(storedFile(dsm2500, tif(2024))).toMatchObject({ format: 'GeoTIFF', corrected: false })
    expect(storedFile(dsm2500, tif(2024)).url).toMatch(/_dsm\.tif$/)
    expect(storedFile(pointcloud, { year: 2016, s3Url: 'https://example.org/a.laz' }).corrected).toBe(false)
    expect(storedFile(pointcloud, { year: 2016, s3Url: null }).url).toBeNull()
  })
})

describe('sizes', () => {
  it('estimates from the measured median and says nothing where none was measured', () => {
    expect(estimatedBytes(pointcloud, 10)).toBe(5.74e9)
    expect(estimatedBytes(dsm10000, 10)).toBeNull()
  })

  it('formats decimal units', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(6.5e6)).toBe('6.5 MB')
    expect(formatBytes(574e6)).toBe('574 MB')
    expect(formatBytes(80.3e12)).toBe('80.3 TB')
  })
})

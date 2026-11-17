import { describe, expect, it } from 'vitest'
import {
  countUrl,
  DETAIL_NOT_STATED,
  detailCountsUrl,
  detailField,
  filterWhere,
  NO_FILTER,
  parseDetailCounts,
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
    const url = tilesUrl(pointcloud, princeGeorge, { year: 2024, detail: null })
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
    expect(params(countUrl(pointcloud, null, NO_FILTER)).get('where')).toBe('1=1')
    expect(params(countUrl(pointcloud, null, NO_FILTER)).has('geometry')).toBe(false)
    expect(params(countUrl(pointcloud, princeGeorge, NO_FILTER)).get('returnCountOnly')).toBe('true')
    // A year is a number; anything else must not reach the where clause.
    expect(params(countUrl(pointcloud, null, { year: 2019.7, detail: null })).get('where')).toBe('year=2019')
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

  it('filters by density on point clouds and by cell size on rasters', () => {
    expect(detailField(pointcloud)).toBe('density')
    expect(detailField(dsm2500)).toBe('spacing')
    expect(filterWhere(pointcloud, { year: 2024, detail: '8' })).toBe('year=2024 AND density=8')
    expect(filterWhere(pointcloud, { year: 2024, detail: '8' }, 'year')).toBe('density=8')
    expect(filterWhere(pointcloud, { year: 2024, detail: '8' }, 'detail')).toBe('year=2024')
    // Text never reaches the where clause as a density, and quotes in a cell size are escaped.
    expect(filterWhere(pointcloud, { year: null, detail: '8 OR 1=1' })).toBe('1=0')
    expect(filterWhere(dsm2500, { year: null, detail: "1 metre' OR '1'='1" })).toBe("spacing='1 metre'' OR ''1''=''1'")
    expect(filterWhere(dsm2500, { year: null, detail: DETAIL_NOT_STATED })).toBe(
      "(spacing IS NULL OR spacing='' OR spacing=' ')",
    )
    expect(params(detailCountsUrl(pointcloud, 'year=2024')).get('groupByFieldsForStatistics')).toBe('density')
    expect(params(detailCountsUrl(dsm2500)).get('where')).toBe('1=1')
  })

  it('reads densities in order and merges blank cell sizes into one row', () => {
    expect(
      parseDetailCounts(pointcloud, {
        features: [
          { attributes: { density: 12, tiles: 3 } },
          { attributes: { density: 8, tiles: 100 } },
          { attributes: { density: 4, tiles: 2 } },
        ],
      }),
    ).toEqual([
      { key: '4', label: '4 pts/m²', tiles: 2 },
      { key: '8', label: '8 pts/m²', tiles: 100 },
      { key: '12', label: '12 pts/m²', tiles: 3 },
    ])
    expect(
      parseDetailCounts(dsm2500, {
        features: [
          { attributes: { spacing: ' ', tiles: 5 } },
          { attributes: { spacing: null, tiles: 1 } },
          { attributes: { spacing: '2 metre', tiles: 7 } },
          { attributes: { spacing: '1 metre', tiles: 9 } },
        ],
      }),
    ).toEqual([
      { key: '1 metre', label: '1 m', tiles: 9 },
      { key: '2 metre', label: '2 m', tiles: 7 },
      { key: DETAIL_NOT_STATED, label: 'Not stated', tiles: 6 },
    ])
    expect(() => parseDetailCounts(pointcloud, { error: { message: 'Invalid query' } })).toThrow()
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

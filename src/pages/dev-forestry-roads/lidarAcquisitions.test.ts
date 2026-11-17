import { describe, expect, it, vi } from 'vitest'
import {
  acquisitionQuery,
  downloadEstimate,
  findLidarAcquisitions,
  groupAcquisitions,
  lidarTiming,
  parseAcquisitionTiles,
  summarizeLidar,
  type LidarAcquisition,
} from './lidarAcquisitions'
import { LIDAR_TEST_BLOCKS, LIDAR_TEST_CATEGORIES } from './lidarTestBlocks'

// Invented tile rows in the index's shape.
const answer = (rows: Record<string, unknown>[]) => ({ features: rows.map((attributes) => ({ attributes })) })
const laz = (date: string, extra: Record<string, unknown> = {}) => ({
  year: Number(date.slice(0, 4)),
  oper_name: 'LidarBC Program',
  filename: `bc_093g058_1_1_4_xyes_8_utm10_${date}_${date}.laz`,
  density: 8,
  ...extra,
})
const sheet = (year: number) => ({
  year,
  oper_name: 'NDMP Floodplains 2019',
  filename: `bc_093g058_xli1m_utm10_${year}.tif`,
})

describe('LidarBC flights over a block', () => {
  it('asks each product layer for one small area and refuses a landscape', () => {
    const { url, body } = acquisitionQuery('pointcloud', [-122.52, 53.72, -122.5, 53.74])
    expect(url).toMatch(/LiDAR_BC_S3_Public\/FeatureServer\/4\/query$/)
    expect(body.get('outFields')).toContain('density')
    expect(acquisitionQuery('dem2500', [-122.52, 53.72, -122.5, 53.74]).body.get('outFields')).not.toContain('density')
    expect(() => acquisitionQuery('dem2500', [-123, 53, -122, 54])).toThrow(/one block at a time/)
  })

  it('reads flight dates from file names, keeps year-only sheets as years, and groups by year', () => {
    const tiles = [
      ...parseAcquisitionTiles('pointcloud', answer([laz('20240714'), laz('20240716')])).tiles,
      ...parseAcquisitionTiles(
        'dem2500',
        answer([{ ...laz('20240714'), filename: 'bc_093g058_1_1_4_xli1m_utm10_20240714_20240714.tif' }]),
      ).tiles,
      ...parseAcquisitionTiles('dem20000', answer([sheet(2019), { year: 'x' }])).tiles,
    ]
    const groups = groupAcquisitions(tiles)
    expect(groups).toEqual([
      {
        year: 2019,
        products: ['dem20000'],
        projects: ['NDMP Floodplains 2019'],
        tiles: 1,
        tilesByProduct: { dem20000: 1 },
        partialLikely: true,
      },
      {
        year: 2024,
        flownFrom: '2024-07-14',
        flownTo: '2024-07-16',
        products: ['pointcloud', 'dem2500'],
        projects: ['LidarBC Program'],
        tiles: 3,
        tilesByProduct: { pointcloud: 2, dem2500: 1 },
        density: 8,
        partialLikely: false,
      },
    ])
    expect(() => parseAcquisitionTiles('dem2500', { error: { message: 'down' } })).toThrow('down')
  })

  it('keeps two projects flown in one year apart, so only the flood survey carries the warning', () => {
    const groups = groupAcquisitions([
      ...parseAcquisitionTiles('dem20000', answer([sheet(2019)])).tiles,
      ...parseAcquisitionTiles('dem20000', answer([{ ...sheet(2019), oper_name: 'VRI 100 Mile House 2019' }])).tiles,
    ])
    expect(groups.map((group) => [group.projects, group.partialLikely])).toEqual([
      [['NDMP Floodplains 2019'], true],
      [['VRI 100 Mile House 2019'], false],
    ])
  })

  it('places each flight against a reported harvest, or a planned one when none is reported', () => {
    const at = (year: number, from?: string, to?: string): LidarAcquisition => ({
      year,
      ...(from ? { flownFrom: from, flownTo: to ?? from } : {}),
      products: ['dem2500'],
      projects: ['LidarBC Program'],
      tiles: 1,
      tilesByProduct: { dem2500: 1 },
      partialLikely: false,
    })
    const harvest = { start: '2021-03-01', end: '2021-09-30' }
    expect(lidarTiming(at(2019), harvest)).toBe('before')
    expect(lidarTiming(at(2024, '2024-07-14'), harvest)).toBe('after')
    // A year-only sheet overlapping the harvest year cannot be placed either side of it.
    expect(lidarTiming(at(2021), harvest)).toBe('during')
    expect(lidarTiming(at(2024, '2024-07-14'), { planned: '2026-10-01' })).toBe('before')
    expect(lidarTiming(at(2024, '2024-07-14'), { planned: '2024-01-01' })).toBe('unknown')
    expect(lidarTiming(at(2024, '2024-07-14'), {})).toBe('unknown')
    expect(summarizeLidar([at(2019), at(2024, '2024-07-14')], harvest)).toMatchObject({ kind: 'before-and-after' })
    expect(summarizeLidar([at(2024, '2024-07-14')], harvest).text).toBe(
      '2024-07-14 LidarBC Program (DEM, DEM about 7 MB to download) after harvest',
    )
    const flood = { ...at(2019), projects: ['NDMP Floodplains 2019'], partialLikely: true }
    expect(summarizeLidar([flood], harvest).text).toContain('may hold data only on the valley floor')
    expect(
      downloadEstimate({
        ...at(2024),
        products: ['pointcloud', 'dem2500'],
        tilesByProduct: { pointcloud: 4, dem2500: 4 },
      }),
    ).toBe('DEM about 26 MB, point cloud about 2.3 GB to download')
    expect(summarizeLidar([], harvest)).toEqual({ kind: 'none', text: 'No LidarBC tile is listed here.' })
  })

  it('queries the three products together and fails whole rather than in part', async () => {
    const fetcher = vi.fn(async (url: string) => {
      const layer = /FeatureServer\/(\d)\//.exec(url)![1]
      return new Response(
        JSON.stringify(answer(layer === '4' ? [laz('20240714')] : layer === '6' ? [sheet(2019)] : [])),
      )
    })
    const found = await findLidarAcquisitions([-122.52, 53.72, -122.5, 53.74], fetcher as unknown as typeof fetch)
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(found.acquisitions.map((acquisition) => acquisition.year)).toEqual([2019, 2024])
    const failing = vi.fn(async () => new Response('', { status: 503 }))
    await expect(
      findLidarAcquisitions([-122.52, 53.72, -122.5, 53.74], failing as unknown as typeof fetch),
    ).rejects.toThrow(/HTTP 503/)
  })
})

describe('LiDAR test blocks', () => {
  it('each block opens one way, has a known category and a unique id', () => {
    expect(new Set(LIDAR_TEST_BLOCKS.map((block) => block.id)).size).toBe(LIDAR_TEST_BLOCKS.length)
    for (const block of LIDAR_TEST_BLOCKS) {
      expect(LIDAR_TEST_CATEGORIES[block.category]).toBeDefined()
      expect(!!block.openingId !== !!block.cutblockSKey).toBe(true)
      expect(block.category === 'planned').toBe(!!block.cutblockSKey)
      expect(block.openingId ?? block.cutblockSKey).toMatch(/^[1-9]\d*$/)
      expect(block.district).toMatch(/^D[A-Z]{2}$/)
    }
    for (const category of Object.keys(LIDAR_TEST_CATEGORIES))
      expect(LIDAR_TEST_BLOCKS.some((block) => block.category === category)).toBe(true)
  })
})

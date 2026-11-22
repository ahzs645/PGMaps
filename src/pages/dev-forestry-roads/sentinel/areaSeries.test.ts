import { describe, expect, it } from 'vitest'
import {
  areaGrid,
  areaStats,
  findDrop,
  rasterizeRings,
  readAreaSeries,
  shortDips,
  seriesPoint,
  thinScenes,
  type SeriesPoint,
} from './areaSeries'
import { SENTINEL_CLEARING_NDVI_DROP, SENTINEL_SERIES_MAX_SCENES } from '@/lib/sentinel2/limits'
import type { SentinelScene } from '@/lib/sentinel2/stac'
import { utm, type RasterReader, type SceneWindow } from '@/lib/sentinel2/window'

const WINDOW: SceneWindow = { epsg: 32610, pixelM: 10, bbox: [0, 0, 50, 50], width: 5, height: 5 }

describe('area mask', () => {
  it('keeps pixels whose centre is inside, leaving holes out', () => {
    const outer = [
      [0, 0],
      [50, 0],
      [50, 50],
      [0, 50],
      [0, 0],
    ]
    const hole = [
      [20, 20],
      [30, 20],
      [30, 30],
      [20, 30],
      [20, 20],
    ]
    const mask = rasterizeRings([outer, hole], WINDOW)
    expect(mask.reduce((sum, v) => sum + v, 0)).toBe(24)
    expect(mask[2 * 5 + 2]).toBe(0)
  })

  it('fills a triangle by pixel centre', () => {
    const mask = rasterizeRings(
      [
        [
          [0, 0],
          [50, 0],
          [0, 50],
        ],
      ],
      WINDOW,
    )
    // Rows from the north: centres at y 45, 35, 25, 15, 5 hold x ≤ 5, 15, 25, 35, 45 (a centre on
    // the edge counts).
    expect(Array.from(mask)).toEqual([1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1])
  })

  it('places an area on the 10 m grid of its zone and refuses one past the size limit', () => {
    const forward = utm(32610).forward
    const inverse = utm(32610).inverse
    const [x, y] = forward([-122.7, 53.9])
    const square = (size: number) => ({
      type: 'Polygon' as const,
      coordinates: [
        [
          [x, y],
          [x + size, y],
          [x + size, y + size],
          [x, y + size],
          [x, y],
        ].map((p) => inverse(p) as number[]),
      ],
    })
    const grid = areaGrid(square(200), 32610)
    for (const value of grid.window.bbox) expect(value % 10).toBe(0)
    // 200 m a side is 400 pixels of 10 m, give or take an edge row and column.
    expect(grid.inside).toBeGreaterThanOrEqual(380)
    expect(grid.inside).toBeLessThanOrEqual(441)
    expect(() => areaGrid(square(12_000), 32610)).toThrow(
      /area spans 12\.0 km; a Sentinel-2 series reads at most 10 km/,
    )
  })
})

describe('area statistics', () => {
  const mask = Uint8Array.from([1, 1, 1, 1, 0])

  it('averages clear pixels only, and separates the tile edge from cloud', () => {
    const values = Float32Array.from([0.8, 0.6, NaN, NaN, 0.1])
    const scl = [4, 4, 9, 0, 4]
    const stats = areaStats(values, scl, mask)
    expect(stats).toMatchObject({ inside: 4, covered: 3, clear: 2 })
    expect(stats.mean).toBeCloseTo(0.7, 5)
    expect(Array.from(stats.values)).toEqual([expect.closeTo(0.8, 5), expect.closeTo(0.6, 5)])
  })

  const scene = { id: 'a', date: '2025-07-01', datetime: '2025-07-01T19:00:00Z' }

  it('turns too little cover or too little clear ground into a gap with its reason, never zero', () => {
    const cloudy = seriesPoint(scene, 'ndvi', areaStats(Float32Array.from([0.8, NaN, NaN, NaN]), [4, 9, 9, 9], mask))
    expect(cloudy.mean).toBeNull()
    expect(cloudy.gap).toEqual({ reason: 'cloud', text: '25% clear' })
    const edge = seriesPoint(scene, 'ndvi', areaStats(Float32Array.from([0.8, 0.8, NaN, NaN]), [4, 4, 0, 0], mask))
    expect(edge.gap).toEqual({ reason: 'cover', text: 'tile covers 50%' })
    const clear = seriesPoint(scene, 'ndvi', areaStats(Float32Array.from([0.8, 0.6, 0.7, 0.7]), [4, 4, 4, 5], mask))
    expect(clear.gap).toBeNull()
    expect(clear.mean).toBeCloseTo(0.7, 5)
    expect(clear.histogram?.binned).toBe(4)
  })
})

const point = (date: string, mean: number | null, gap = false): SeriesPoint => ({
  sceneId: date,
  date,
  datetime: `${date}T19:00:00Z`,
  mean: gap ? null : mean,
  clearShare: gap ? 0.2 : 1,
  coverage: 1,
  gap: gap ? { reason: 'cloud', text: '20% clear' } : null,
  histogram: null,
})

describe('the fall and its bracket', () => {
  it('brackets the fall between consecutive clear scenes, stepping over gaps', () => {
    const drop = findDrop(
      [
        point('2024-07-10', 0.8),
        point('2024-08-01', 0.78),
        point('2024-08-20', null, true),
        point('2024-09-05', 0.35),
        point('2024-09-20', 0.33),
      ],
      SENTINEL_CLEARING_NDVI_DROP,
    )
    expect(drop?.earlier.date).toBe('2024-08-01')
    expect(drop?.later.date).toBe('2024-09-05')
    // Median before (0.79) minus median after (0.34); the pair itself fell 0.43.
    expect(drop?.fall).toBeCloseTo(0.45, 5)
    expect(drop?.step).toBeCloseTo(0.43, 5)
    expect(drop?.label).toBe('first seen between 2024-08-01 and 2024-09-05')
    expect(drop).toMatchObject({ scenesBefore: 2, scenesAfter: 2 })
  })

  it('notes a snow gap and keeps the pair that falls most when two steps pass', () => {
    const drop = findDrop(
      [point('2023-09-01', 0.8), point('2023-09-15', 0.55), point('2024-07-01', 0.55), point('2024-07-20', 0.2)],
      0.2,
    )
    expect(drop?.label).toBe('first seen between 2024-07-01 and 2024-07-20')
    const winter = findDrop([point('2023-09-15', 0.8), point('2024-06-20', 0.3)], 0.2)
    expect(winter?.label).toBe('first seen between 2023-09-15 and 2024-06-20 (snow gap)')
    expect(winter?.scenesAfter).toBe(1)
  })

  it('leaves out a dip the level comes back from: a hazy scene, or a short hazy run', () => {
    const dip = [
      point('2025-08-01', 0.8),
      point('2025-08-10', 0.3),
      point('2025-08-20', 0.79),
      point('2025-09-01', 0.8),
    ]
    expect(findDrop(dip, 0.2)).toBeNull()
    expect(shortDips(dip, 0.2)).toBe(1)
    // The early-September 2025 smoke read at Prince George (live Earth Search, 18 Nov 2026), rounded.
    const smoke = [0.81, 0.79, 0.75, 0.78, 0.82, 0.81, 0.79, 0.77, 0.73, 0.82, 0.38, 0.71, 0.28, 0.62, 0.82, 0.78].map(
      (mean, i) => point(`2025-${String(i + 1).padStart(2, '0')}-01`, mean),
    )
    expect(findDrop(smoke, SENTINEL_CLEARING_NDVI_DROP)).toBeNull()
    expect(shortDips(smoke, SENTINEL_CLEARING_NDVI_DROP)).toBe(2)
  })

  it('finds a burn whose own scene pair falls less than the threshold when the level stays down', () => {
    // NBR over the Lytton Creek fire (2021) read live: pre-fire summer 2020, post-fire summer 2021.
    const before = [0.158, 0.138, 0.108, 0.181, 0.099, 0.129, 0.197, 0.125, 0.087]
    const after = [-0.158, -0.183, -0.193, -0.166, -0.198, -0.147, -0.113]
    const points = [
      ...before.map((mean, i) => point(`2020-09-${String(i + 10)}`, mean)),
      ...after.map((mean, i) => point(`2021-08-${String(i + 10)}`, mean)),
    ]
    const drop = findDrop(points, 0.27)
    expect(drop?.label).toBe('first seen between 2020-09-18 and 2021-08-10 (snow gap)')
    expect(drop?.step).toBeCloseTo(0.245, 5)
    expect(drop?.fall).toBeCloseTo(0.129 + 0.166, 5)
  })

  it('finds nothing below the threshold or with one clear scene', () => {
    expect(findDrop([point('2024-07-01', 0.8), point('2024-07-20', 0.65)], 0.2)).toBeNull()
    expect(findDrop([point('2024-07-01', 0.8), point('2024-07-20', 0.1, true)], 0.2)).toBeNull()
  })

  it('thins a long list evenly, keeping both ends', () => {
    const scenes = Array.from({ length: 30 }, (_, i) => {
      const datetime = `2024-${String(i + 1).padStart(3, '0')}`
      return { id: datetime, datetime }
    })
    const kept = thinScenes([...scenes].reverse(), SENTINEL_SERIES_MAX_SCENES)
    expect(kept).toHaveLength(SENTINEL_SERIES_MAX_SCENES)
    expect(kept[0].datetime).toBe('2024-001')
    expect(kept.at(-1)!.datetime).toBe('2024-030')
    expect(thinScenes(scenes.slice(0, 3), 12)).toHaveLength(3)
  })

  it('keeps the scene the card shows, in place of the nearest spread scene', () => {
    const scenes = Array.from({ length: 30 }, (_, i) => {
      const datetime = `2024-${String(i + 1).padStart(3, '0')}`
      return { id: datetime, datetime }
    })
    const plain = thinScenes(scenes, 12).map((scene) => scene.id)
    expect(plain).not.toContain('2024-002')
    const kept = thinScenes(scenes, 12, ['2024-002', null]).map((scene) => scene.id)
    expect(kept).toHaveLength(12)
    expect(kept).toContain('2024-002')
    expect(kept[0]).toBe('2024-001')
    expect(kept.at(-1)).toBe('2024-030')
    // Only the spread scene nearest the kept one gave way.
    expect(plain.filter((id) => !kept.includes(id))).toHaveLength(1)
  })
})

describe('reading a series', () => {
  const forward = utm(32610).forward
  const inverse = utm(32610).inverse
  const [x0, y0] = forward([-122.7, 53.9]).map((v) => Math.round(v / 20) * 20)
  const block = {
    type: 'Polygon' as const,
    coordinates: [
      [
        [x0 + 2, y0 + 2],
        [x0 + 98, y0 + 2],
        [x0 + 98, y0 + 98],
        [x0 + 2, y0 + 98],
        [x0 + 2, y0 + 2],
      ].map((p) => inverse(p) as number[]),
    ],
  }
  const scale = { scale: 0.0001, offset: 0 }
  const scene = (date: string): SentinelScene => ({
    id: date,
    date,
    datetime: `${date}T19:00:00Z`,
    cloudPercent: 5,
    epsg: 32610,
    bbox: null,
    assets: { visual: `${date}/TCI`, red: `${date}/B04`, nir: `${date}/B08`, scl: `${date}/SCL` },
    scaling: { red: scale, nir: scale },
  })
  // Forest (NDVI 0.8) until a clearing in August 2024 (NDVI 0.2); the June 2024 scene is cloudy and
  // the July 2025 read fails.
  const reader = (reads: string[]): RasterReader => ({
    async read(href, request) {
      reads.push(href)
      const date = href.slice(0, 10)
      if (date === '2025-07-01') throw new Error('network')
      const n = request.width * request.height
      const band = href.slice(11)
      const cleared = date >= '2024-08-15'
      const value =
        band === 'SCL'
          ? date === '2024-06-15'
            ? 9
            : 4
          : band === 'B04'
            ? cleared
              ? 2000
              : 500
            : cleared
              ? 3000
              : 4500
      return { width: request.width, height: request.height, bands: [new Uint16Array(n).fill(value)] }
    },
  })

  it('reads every listed scene, reports gaps with their reason and brackets the clearing', async () => {
    const reads: string[] = []
    const landed: string[] = []
    const points = await readAreaSeries({
      scenes: ['2024-06-15', '2024-07-20', '2024-08-20', '2024-09-10', '2025-07-01'].map(scene),
      geometry: block,
      index: 'ndvi',
      reader: reader(reads),
      onPoint: (p) => landed.push(p.date),
    })
    expect(points.map((p) => p.date)).toEqual(['2024-06-15', '2024-07-20', '2024-08-20', '2024-09-10', '2025-07-01'])
    expect(landed.sort()).toEqual(points.map((p) => p.date))
    expect(points[0].gap?.reason).toBe('cloud')
    expect(points[4].gap?.reason).toBe('read')
    expect(points[1].mean).toBeCloseTo((4500 - 500) / 5000, 5)
    expect(points[2].mean).toBeCloseTo(0.2, 5)
    expect(findDrop(points, SENTINEL_CLEARING_NDVI_DROP)?.label).toBe('first seen between 2024-07-20 and 2024-08-20')
    // Three bands a scene: red and NIR on the 10 m window, the scene classification on its 20 m grid.
    expect(reads.filter((href) => href.startsWith('2024-07-20')).sort()).toEqual([
      '2024-07-20/B04',
      '2024-07-20/B08',
      '2024-07-20/SCL',
    ])
  })

  it('marks a scene without the SWIR band as a gap rather than failing the series', async () => {
    const points = await readAreaSeries({
      scenes: [scene('2024-07-20')],
      geometry: block,
      index: 'nbr',
      reader: reader([]),
    })
    expect(points[0].gap).toMatchObject({ reason: 'bands' })
    expect(points[0].mean).toBeNull()
  })

  it('stops when cancelled, before reading the rest', async () => {
    const controller = new AbortController()
    const reads: string[] = []
    const slow: RasterReader = {
      async read(href, request) {
        reads.push(href)
        controller.abort()
        return reader([]).read(href, request)
      },
    }
    await expect(
      readAreaSeries({
        scenes: ['2024-07-20', '2024-08-20', '2024-09-10', '2024-09-20'].map(scene),
        geometry: block,
        index: 'ndvi',
        reader: slow,
        signal: controller.signal,
        concurrency: 1,
      }),
    ).rejects.toThrow()
    expect(reads.length).toBeLessThanOrEqual(3)
  })
})

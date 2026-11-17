import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { encodeLas, mergePointClouds, readPointCloud, setWhiteboxSources } from './pointCloud'
import { gridSurface } from './pointCloud.worker'
import {
  applyCropMask,
  cropFootprint,
  cropMask,
  describeCrop,
  projectCropChoice,
  validateCrop,
  type PointCloudCrop,
} from './pointCloudCrop'

const wasmDir = dirname(createRequire(import.meta.url).resolve('whitebox-wasm'))

function fnv(text: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16)
}

/**
 * A 120 × 90 m slope rising 0.6 m a metre eastward: ground every metre, a crown return on every
 * third, 12–20 m up. Origin (400000, 5900000), EPSG:26910.
 */
function slope() {
  const x: number[] = [],
    y: number[] = [],
    z: number[] = [],
    c: number[] = []
  for (let i = 0; i < 120; i++)
    for (let j = 0; j < 90; j++) {
      const g = 700 + 0.6 * i - 0.2 * j + 0.3 * Math.sin(i * 0.7 + j * 1.3)
      x.push(400000 + i + 0.25)
      y.push(5900000 + j + 0.5)
      z.push(g)
      c.push(2)
      if ((i + j) % 3 === 0) {
        x.push(400000 + i + 0.6)
        y.push(5900000 + j + 0.1)
        z.push(g + 12 + ((i * 5 + j) % 9))
        c.push(5)
      }
    }
  return {
    x: Float64Array.from(x),
    y: Float64Array.from(y),
    z: Float64Array.from(z),
    classification: Uint8Array.from(c),
  }
}
const cloud = slope()
const bytes = encodeLas({ ...cloud, epsg: 26910, verticalEpsg: 5703 })
const E = 400000,
  N = 5900000

beforeAll(() => setWhiteboxSources({ lidar: readFileSync(join(wasmDir, 'whitebox_wasm_bg.wasm')) }))

describe('point-cloud crop mask', () => {
  it('keeps the points inside a polygon and nothing else', () => {
    const square: Array<[number, number]> = [
      [E + 20, N + 20],
      [E + 60, N + 20],
      [E + 60, N + 50],
      [E + 20, N + 50],
    ]
    const result = cropMask(cloud, { polygons: [square] })
    expect(result.margin).toBe(0)
    expect(result.kept).toBe(result.inside)
    for (let i = 0; i < cloud.x.length; i++) {
      const inside = cloud.x[i] > E + 20 && cloud.x[i] < E + 60 && cloud.y[i] > N + 20 && cloud.y[i] < N + 50
      expect(result.mask[i] === 1).toBe(inside)
    }
    // 40 × 30 ground points plus a third of them again as crowns.
    expect(result.kept).toBe(1200 + cloud.x.filter((_, i) => result.mask[i] && cloud.classification[i] === 5).length)
  })

  it('keeps a corridor round the road and joins it with a polygon', () => {
    const road: Array<[number, number]> = [
      [E, N + 45],
      [E + 120, N + 45],
    ]
    const corridor = cropMask(cloud, { corridor: { points: road, halfWidthM: 10 } })
    for (let i = 0; i < cloud.x.length; i++) expect(corridor.mask[i] === 1).toBe(Math.abs(cloud.y[i] - (N + 45)) <= 10)
    const corner: Array<[number, number]> = [
      [E, N],
      [E + 10, N],
      [E + 10, N + 10],
      [E, N + 10],
    ]
    const both = cropMask(cloud, { corridor: { points: road, halfWidthM: 10 }, polygons: [corner] })
    expect(both.kept).toBe(corridor.kept + cropMask(cloud, { polygons: [corner] }).kept)
  })

  it('keeps upslope ground in the margin, never the ground below the crop', () => {
    // A north–south road strip at x 50–60 m; the ground rises eastward.
    const strip: Array<[number, number]> = [
      [E + 50, N - 1],
      [E + 60, N - 1],
      [E + 60, N + 91],
      [E + 50, N + 91],
    ]
    const plain = cropMask(cloud, { polygons: [strip] })
    const wide = cropMask(cloud, { polygons: [strip], upslopeMarginM: 30 })
    expect(wide.inside).toBe(plain.inside)
    expect(wide.margin).toBeGreaterThan(0)
    expect(wide.kept).toBe(wide.inside + wide.margin)
    let east = 0
    for (let i = 0; i < cloud.x.length; i++) {
      if (wide.mask[i] !== 2) continue
      const dx = cloud.x[i] - E
      // Only uphill (east), within the margin plus one cell's reach of its nearest crop cell.
      expect(dx).toBeGreaterThan(60)
      expect(dx).toBeLessThan(60 + 30 + 10)
      east++
    }
    expect(east).toBe(wide.margin)
    // Nothing west of the strip, which is downhill.
    expect(cloud.x.some((v, i) => v < E + 50 && wide.mask[i])).toBe(false)
  })

  it('is the same mask every time, and the crop drops points in file order', () => {
    const crop: PointCloudCrop = {
      corridor: {
        points: [
          [E + 10, N + 10],
          [E + 100, N + 80],
        ],
        halfWidthM: 8,
      },
      upslopeMarginM: 25,
    }
    const a = cropMask(cloud, crop),
      b = cropMask(cloud, crop)
    expect(a.mask).toEqual(b.mask)
    const kept = applyCropMask(cloud, a.mask, a.kept)
    expect(kept.x.length).toBe(a.kept)
    const first = a.mask.findIndex((m) => m > 0)
    expect(kept.x[0]).toBe(cloud.x[first])
    expect(kept.z[0]).toBe(cloud.z[first])
  })

  it('refuses a crop it could not apply exactly', () => {
    expect(validateCrop(undefined)).toBeNull()
    expect(validateCrop({})).toBeNull()
    expect(() =>
      validateCrop({
        polygons: [
          [
            [0, 0],
            [1, 1],
          ],
        ],
      }),
    ).toThrow(/three corners/)
    expect(() => validateCrop({ corridor: { points: [[0, 0]], halfWidthM: 5 } })).toThrow(/two points/)
    expect(() =>
      validateCrop({
        corridor: {
          points: [
            [0, 0],
            [1, 1],
          ],
          halfWidthM: 5,
        },
        upslopeMarginM: 900,
      }),
    ).toThrow(/upslope margin/)
  })

  it('projects the designer’s WGS84 choice and crops nothing without one', () => {
    const forward = (p: [number, number]) => [p[0] * 10, p[1] * 10] as [number, number]
    expect(projectCropChoice(undefined, [], forward)).toBeUndefined()
    expect(projectCropChoice({ corridorM: 20 }, [[1, 1]], forward)).toBeUndefined()
    const ring: Array<[number, number]> = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ]
    expect(
      projectCropChoice(
        {
          areas: [ring],
          corridorM: 20,
          upslopeMarginM: 50,
        },
        [
          [0, 0],
          [2, 2],
        ],
        forward,
      ),
    ).toEqual({
      polygons: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
        ],
      ],
      corridor: {
        points: [
          [0, 0],
          [20, 20],
        ],
        halfWidthM: 20,
      },
      upslopeMarginM: 50,
    })
  })
})

describe('crop footprint', () => {
  it('outlines the kept cells, holes included', () => {
    // A 30 × 30 m block of points with a 10 × 10 m hole in the middle, at 5 m cells.
    const x: number[] = [],
      y: number[] = []
    for (let i = 0; i < 30; i++)
      for (let j = 0; j < 30; j++)
        if (!(i >= 10 && i < 20 && j >= 10 && j < 20)) {
          x.push(i + 0.5)
          y.push(j + 0.5)
        }
    const footprint = cropFootprint(x, y)
    expect(footprint.cellM).toBe(5)
    expect(footprint.areaM2).toBe(900 - 100)
    expect(footprint.rings).toHaveLength(2)
    const area = (ring: Array<[number, number]>) =>
      ring.slice(1).reduce((s, p, k) => s + (ring[k][0] * p[1] - p[0] * ring[k][1]) / 2, 0)
    const areas = footprint.rings.map(area).sort((a, b) => a - b)
    // The outer ring runs anticlockwise round 30 × 30 m, the hole clockwise round 10 × 10 m.
    expect(areas).toEqual([-100, 900])
    for (const ring of footprint.rings) expect(ring[0]).toEqual(ring[ring.length - 1])
  })

  it('describes what the crop kept and says the tile was still read', () => {
    expect(
      describeCrop({
        total: 2_000_000,
        inside: 300_000,
        margin: 50_000,
        kept: 350_000,
        points: 350_000,
        areaM2: 120_000,
      }),
    ).toBe(
      'Crop kept 350,000 of 2,000,000 decoded points (300,000 inside, 50,000 in the upslope margin) over 12.0 ha. The whole tile was still read.',
    )
  })
})

describe('cropping on import', () => {
  // Grids of this cloud from the code before the crop existed (commit 2a96baec): an import with no
  // crop must give exactly these.
  const BEFORE_CROP: Record<string, [number, string]> = {
    'all/mean': [14400, '1874aafb'],
    'all/tin': [14400, '4560936a'],
    '5000/mean': [3864, 'ca2d1353'],
    '5000/tin': [3864, '9fa30317'],
  }
  it('gives the same grids as before when no crop is set', async () => {
    for (const maxPoints of [undefined, 5000])
      for (const method of ['mean', 'tin'] as const) {
        const read = await readPointCloud(bytes.slice(), maxPoints ? { maxPoints } : {})
        expect(read.crop).toBeUndefined()
        const { grid } = await gridSurface(read, { method, cellM: 1, maxCells: 100_000, gapCells: 3 })
        const hash = fnv(JSON.stringify([grid.origin, grid.cellM, grid.width, grid.height, grid.values]))
        expect([read.count, hash]).toEqual(BEFORE_CROP[`${maxPoints ?? 'all'}/${method}`])
      }
  })

  it('crops before thinning, so the crop keeps density the budget would have spent outside it', async () => {
    const strip: Array<[number, number]> = [
      [E + 50, N - 1],
      [E + 70, N - 1],
      [E + 70, N + 91],
      [E + 50, N + 91],
    ]
    const read = await readPointCloud(bytes.slice(), { maxPoints: 5000, crop: { polygons: [strip] } })
    expect(read.sourceCount).toBe(cloud.x.length)
    expect(read.crop).toMatchObject({ total: cloud.x.length, margin: 0 })
    // 20 × 90 ground points and their crowns fit the budget whole: nothing is thinned.
    expect(read.crop!.kept).toBeLessThanOrEqual(5000)
    expect(read.thinCellM).toBeNull()
    expect(read.count).toBe(read.crop!.kept)
    const { grid } = await gridSurface(read, { method: 'mean', cellM: 1, maxCells: 100_000, gapCells: 3 })
    expect(grid.width).toBe(20)
    expect(grid.height).toBe(90)
    // Merged clouds add their crop counts.
    const merged = mergePointClouds([read, read])
    expect(merged.crop).toEqual({
      total: 2 * read.crop!.total,
      inside: 2 * read.crop!.inside,
      margin: 0,
      kept: 2 * read.crop!.kept,
    })
  })

  it('comes back empty when the crop misses the cloud', async () => {
    const away: Array<[number, number]> = [
      [0, 0],
      [10, 0],
      [10, 10],
    ]
    const read = await readPointCloud(bytes.slice(), { crop: { polygons: [away] } })
    expect(read.count).toBe(0)
    expect(read.crop).toMatchObject({ kept: 0, total: cloud.x.length })
  })
})

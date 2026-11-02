import { describe, expect, it } from 'vitest'
import {
  accepted,
  DEFAULT_OPTIONS,
  groundAccumulator,
  groundAt,
  makeGrid,
  metricsAccumulator,
  slopeRaster,
  type Raster,
  type ReturnPoint,
} from './model'
import { runRestoration } from './run'
import { openPointReader } from './reader'
import { meanHeightPolygons, rasterGeoTiff, rasterStats, restorationManifest, restorationZip, toWgs84 } from './outputs'
import { fromArrayBuffer } from 'geotiff'
import JSZip from 'jszip'
import { restorationLas } from '../../../tests/fixtures/restoration'

const point = (h = 0, classification = 1): ReturnPoint => ({
  x: 0.5,
  y: 0.5,
  z: 100 + h,
  classification,
  first: true,
  withheld: false,
})
const flat: Raster = {
  west: 0,
  north: 2,
  cellM: 1,
  width: 2,
  height: 2,
  values: new Float32Array([100, 100, 100, 100]),
}
const noLaz = async () => {
  throw Error('Uncompressed LAS must not load WASM')
}
const file = (bytes = restorationLas(), name = 'synthetic.las') =>
  Object.assign(new Blob([bytes as Uint8Array<ArrayBuffer>]), { name })
const run = () => runRestoration([file()], DEFAULT_OPTIONS, noLaz)

describe('restoration metric definitions', () => {
  it('uses full cell area and all-return denominator at exact stratum boundaries', () => {
    const grid = { west: 0, north: 2, cellM: 2, width: 1, height: 1 }
    const a = metricsAccumulator(flat, grid, grid)
    for (const h of [0, 0.5, 2, 10, 11]) a.add(point(h, h === 0 ? 2 : 1))
    const r = a.finish()
    expect(r.vegetation.values[0]).toBe(0.75)
    expect(r.canopy.values[0]).toBe(60)
    expect(r.understory.values[0]).toBe(20)
    expect(r.midstory.values[0]).toBe(20)
    expect(r.overstory.values[0]).toBe(20)
    expect(r.ground.values[0]).toBe(0.25)
    expect(r.meanHeight.values[0]).toBeCloseTo(4.7)
  })
  it('distinguishes observed zero, incomplete terrain support and no returns', () => {
    const missing = { ...flat, values: new Float32Array(4).fill(NaN) }
    const a = metricsAccumulator(missing, flat, flat)
    a.add(point(5))
    const r = a.finish()
    expect(r.ground.values[2]).toBe(0)
    expect(r.support.values[2]).toBe(0)
    expect(Number.isNaN(r.vegetation.values[2])).toBe(true)
    expect(Number.isNaN(r.ground.values[0])).toBe(true)
  })
  it('never reports a partial vegetation or first-return cell as complete', () => {
    const terrain = { ...flat, values: new Float32Array([100, 100, 100, NaN]) }
    const grid = { west: 0, north: 2, cellM: 2, width: 1, height: 1 }
    const a = metricsAccumulator(terrain, grid, grid)
    a.add({ ...point(11), x: 0.5, y: 1.5 })
    a.add({ ...point(11), x: 1.5, y: 0.5 })
    const r = a.finish()
    expect(r.support.values[0]).toBe(50)
    expect(Number.isNaN(r.canopy.values[0])).toBe(true)
    expect(Number.isNaN(r.meanHeight.values[0])).toBe(true)
  })
  it('excludes noise and withheld returns but preserves negative normalized heights', () => {
    expect(accepted({ ...point(), withheld: true })).toBe(false)
    expect(accepted(point(4, 7))).toBe(false)
    expect(accepted(point(4, 18))).toBe(false)
    const a = metricsAccumulator(flat, flat, flat)
    a.add(point(-1))
    a.add(point(9, 7))
    expect(a.finish().meanHeight.values[2]).toBe(-1)
    expect(a.counts).toMatchObject({ read: 2, accepted: 1, excluded: 1, normalized: 1 })
  })
  it('averages class 2 ground only and leaves wide gaps missing', () => {
    const grid = makeGrid([0, 0, 20, 20], 1),
      a = groundAccumulator(grid)
    a.add(point(0, 2))
    a.add(point(2, 2))
    a.add(point(99, 1))
    const { terrain, filled } = a.finish()
    expect(groundAt(terrain, 0.5, 0.5)).toBe(101)
    expect(filled).toBe(0)
    expect(Number.isNaN(groundAt(terrain, 15.5, 15.5))).toBe(true)
  })
  it('returns Horn percent slope for an analytic inclined plane', () => {
    const g: Raster = {
      west: 0,
      north: 5,
      cellM: 1,
      width: 5,
      height: 5,
      values: Float32Array.from({ length: 25 }, (_, i) => 0.3 * (i % 5) + 0.4 * Math.floor(i / 5)),
    }
    expect(slopeRaster(g).values[12]).toBeCloseTo(50, 4)
    expect(Number.isNaN(slopeRaster(g).values[0])).toBe(true)
    g.values[11] = NaN
    expect(Number.isNaN(slopeRaster(g).values[12])).toBe(true)
  })
  it('enforces cell budgets without silently coarsening the requested resolution', () => {
    expect(() => makeGrid([0, 0, 100000, 100000], 1)).toThrow(/exceeds/)
    for (const cell of [0, -1, NaN, Infinity]) expect(() => makeGrid([0, 0, 1, 1], cell)).toThrow()
  })
})

describe('complete local-file run and reusable GIS products', () => {
  it.each([true, false])(
    'reads all modern=%s records including first-return and classification flags',
    async (modern) => {
      const reader = await openPointReader(restorationLas({ modern }), noLaz)
      let first = 0,
        ground = 0,
        total = 0
      reader.scan((p) => {
        total++
        first += Number(p.first)
        ground += Number(p.classification === 2)
      })
      reader.dispose()
      expect({ total, first, ground }).toEqual({ total: 80, first: 16, ground: 16 })
    },
  )
  it('generates all products without thinning', async () => {
    const r = await run()
    expect(r.counts).toEqual({ read: 80, accepted: 80, excluded: 0, normalized: 80, ground: 16, filled: 0 })
    expect([...r.rasters.vegetation.values]).toEqual([3, 3, 3, 3])
    expect([...r.rasters.meanHeight.values]).toEqual([11])
    expect([...r.rasters.pemEligible.values]).toEqual([64])
    expect([...r.rasters.pemAbove2.values]).toEqual([32])
    expect([...r.rasters.pemMean.values]).toEqual([10.5])
    expect([...r.rasters.pemCover.values]).toEqual([100])
    expect(restorationManifest(r).method).toBe('ground-cell-mean-bilinear-v1')
  })
  it('merges adjacent tiles by accumulating returns on one aligned grid', async () => {
    const r = await runRestoration([file(), file(restorationLas({ shiftX: 4 }), 'next.las')], DEFAULT_OPTIONS, noLaz)
    expect(r.counts.read).toBe(160)
    expect(r.rasters.ground.width).toBe(4)
    expect([...r.rasters.vegetation.values]).toEqual(new Array(8).fill(3))
  })
  it('round-trips float32 GeoTIFF values, CRS, pixel origin and NoData', async () => {
    const r = await run(),
      image = await (await fromArrayBuffer(rasterGeoTiff(r, 'slope'))).getImage()
    expect(image.getGeoKeys().ProjectedCSTypeGeoKey).toBe(3157)
    expect(image.getGeoKeys().VerticalCSTypeGeoKey).toBeUndefined()
    const terrain = await (await fromArrayBuffer(rasterGeoTiff(r, 'terrain'))).getImage()
    expect(terrain.getGeoKeys().VerticalCSTypeGeoKey).toBe(6647)
    expect(image.getOrigin()).toEqual([512000, 5971004, 0])
    expect(image.getResolution()).toEqual([1, -1, 0])
    expect(Number.isNaN(image.getGDALNoData())).toBe(true)
    const values = await image.readRasters({ interleave: true })
    expect(rasterStats({ ...r.rasters.slope, values: values as Float32Array }).count).toBe(4)
    r.rasters.meanHeight.values[0] = 3.125
    const fractional = await (await fromArrayBuffer(rasterGeoTiff(r, 'meanHeight'))).getImage()
    expect([...(await fractional.readRasters({ interleave: true }))]).toEqual([3.125])
  })
  it('exports all ten rasters and a reproducible manifest in a GIS ZIP', async () => {
    const result = await run(),
      blob = await restorationZip(result),
      zip = await JSZip.loadAsync(await blob.arrayBuffer())
    expect(Object.keys(zip.files)).toHaveLength(18)
    expect(JSON.parse(await zip.file('manifest.json')!.async('string')).counts.read).toBe(80)
  })
  it('writes closed WGS84 mean-height cell polygons and bounds their number', async () => {
    const result = await run(),
      fc = meanHeightPolygons(result),
      ring = fc.features[0].geometry.coordinates[0]
    expect(fc.features[0].properties?.mean_first_height_m).toBe(11)
    expect(ring[0]).toEqual(ring[4])
    expect(ring[0][0]).toBeCloseTo(-122.8, 0)
    const xy = toWgs84(3157, [512000, 5971000])
    expect(xy[1]).toBeGreaterThan(53)
    result.rasters.meanHeight = { ...result.rasters.meanHeight, values: new Float32Array(50_001) }
    expect(() => meanHeightPolygons(result)).toThrow(/50,000/)
  })
  it.each([
    [restorationLas({ epsg: 4326 }), /metre-based/],
    [restorationLas({ ground: false }), /class 2/],
    [restorationLas().subarray(0, 500), /truncated/],
  ])('rejects invalid inputs before producing results', async (bytes, message) => {
    await expect(runRestoration([file(bytes as Uint8Array)], DEFAULT_OPTIONS, noLaz)).rejects.toThrow(message as RegExp)
  })
  it('rejects overlapping tiles, mixed CRS and oversized blobs', async () => {
    await expect(runRestoration([file(), file()], DEFAULT_OPTIONS, noLaz)).rejects.toThrow(/overlap/)
    await expect(
      runRestoration([file(), file(restorationLas({ epsg: 3005, shiftX: 4 }))], DEFAULT_OPTIONS, noLaz),
    ).rejects.toThrow(/same horizontal/)
    const huge = { size: 800 * 1024 ** 2, name: 'huge.laz' } as File
    await expect(runRestoration([huge], DEFAULT_OPTIONS, noLaz)).rejects.toThrow(/768/)
  })
})

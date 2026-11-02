import proj4 from 'proj4'
import { describe, expect, it } from 'vitest'
import { projectionDefinition } from '@/lib/geo/projectedCrs'
import { rasterGeoTiff } from '@/features/lidar-restoration/outputs'
import type { RestorationResult } from '@/features/lidar-restoration/model'
import { restorationLas } from '../../../../tests/fixtures/restoration'
import { checkSession, decode64, exportProject, fileLayer, restoreProject } from './files'
import { inspectLas } from './las'
import { rasterValue } from './raster'
import { vectorData } from './vector'
import { emptySession, type ImportSession, type RasterLayer, type VectorLayer } from './types'

/** A 2 × 2, 1 m restoration result in `epsg`, as main's restoration tool would write it. */
function restoration(epsg: number, west: number, north: number, values = [1, 2, 3, NaN]): RestorationResult {
  const raster = { west, north, cellM: 1, width: 2, height: 2, values: Float32Array.from(values) }
  return { epsg, verticalEpsg: null, rasters: new Proxy({}, { get: () => raster }) } as unknown as RestorationResult
}
const tif = (buffer: ArrayBuffer, name = 'slope.tif') => new File([buffer], name)

/** Minimal little-endian float32 single-strip GeoTIFF with optional geo keys and GDAL_NODATA. */
function float32Tiff({ values, keys, noData }: { values: number[]; keys?: number[] | null; noData?: string }) {
  const u16 = (a: number[]) => new Uint8Array(Uint16Array.from(a).buffer)
  const u32 = (a: number[]) => new Uint8Array(Uint32Array.from(a).buffer)
  const f64 = (a: number[]) => new Uint8Array(Float64Array.from(a).buffer)
  const tags: Array<[number, number, Uint8Array]> = [
    [256, 4, u32([2])],
    [257, 4, u32([2])],
    [258, 3, u16([32])],
    [259, 3, u16([1])],
    [262, 3, u16([1])],
    [273, 4, u32([0])],
    [277, 3, u16([1])],
    [278, 4, u32([2])],
    [279, 4, u32([16])],
    [284, 3, u16([1])],
    [339, 3, u16([3])],
    [33550, 12, f64([1, 1, 0])],
    [33922, 12, f64([0, 0, 0, 512000, 5971004, 0])],
  ]
  if (keys !== null) {
    const k = keys ?? [1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, 3157]
    tags.push([34735, 3, u16([1, 1, 0, k.length / 4, ...k])])
  }
  if (noData !== undefined) tags.push([42113, 2, new TextEncoder().encode(noData + '\0')])
  const size: Record<number, number> = { 2: 1, 3: 2, 4: 4, 12: 8 }
  const align = (n: number) => Math.ceil(n / 8) * 8
  let extra = align(10 + tags.length * 12 + 4),
    pixels = extra
  for (const [, , data] of tags) if (data.length > 4) pixels = align(pixels + data.length)
  const buffer = new ArrayBuffer(pixels + 16),
    view = new DataView(buffer),
    bytes = new Uint8Array(buffer)
  view.setUint16(0, 0x4949, true)
  view.setUint16(2, 42, true)
  view.setUint32(4, 8, true)
  view.setUint16(8, tags.length, true)
  tags.forEach(([tag, type, data], i) => {
    const at = 10 + i * 12
    view.setUint16(at, tag, true)
    view.setUint16(at + 2, type, true)
    view.setUint32(at + 4, data.length / size[type], true)
    if (tag === 273) view.setUint32(at + 8, pixels, true)
    else if (data.length <= 4) bytes.set(data, at + 8)
    else {
      view.setUint32(at + 8, extra, true)
      bytes.set(data, extra)
      extra = align(extra + data.length)
    }
  })
  values.forEach((v, i) => view.setFloat32(pixels + i * 4, v, true))
  return buffer
}

describe('restoration outputs import at the right place', () => {
  // Central meridian of the CRS at x0 (UTM 500,000 m; BC Albers 1,000,000 m), ~54°N.
  const cases: Array<[number, number, number]> = [
    [3005, 1_000_000, -126],
    [2955, 500_000, -117],
    [3156, 500_000, -129],
    [3158, 500_000, -99],
    [26910, 500_000, -123],
    [3157, 500_000, -123],
  ]
  for (const [epsg, west, meridian] of cases)
    it(`EPSG:${epsg}`, async () => {
      const north = epsg === 3005 ? 1_000_000 : 5_985_000
      const layer = (await fileLayer(tif(rasterGeoTiff(restoration(epsg, west, north), 'slope')))) as RasterLayer
      expect(layer.source.crs).toBe('EPSG:' + epsg)
      expect(layer.bounds[0]).toBeCloseTo(meridian, 4)
      expect(layer.bounds[3]).toBeGreaterThan(50)
      expect(layer.bounds[3]).toBeLessThan(57)
      // Cell centres read back the native values.
      const at = (x: number, y: number) => proj4(projectionDefinition(epsg), 'EPSG:4326', [x, y]) as [number, number]
      expect(rasterValue(layer, ...at(west + 0.5, north - 0.5))).toBe(1)
      expect(rasterValue(layer, ...at(west + 1.5, north - 1.5))).toBeNull()
    })
})

describe('GeoTIFF CRS and NoData', () => {
  it('matches GDAL_NODATA against float32 cells', async () => {
    const layer = (await fileLayer(tif(float32Tiff({ values: [1, 2, -9999.9, 4], noData: '-9999.9' })))) as RasterLayer
    expect(layer.valid).toBe(3)
    expect(layer.minimum).toBe(1)
    const [lon, lat] = proj4(projectionDefinition(3157), 'EPSG:4326', [512000.5, 5971002.5])
    expect(rasterValue(layer, lon, lat)).toBeNull()
  })
  it('rejects a GeoTIFF without geo keys cleanly unless a CRS is picked', async () => {
    const bare = float32Tiff({ values: [1, 2, 3, 4], keys: null })
    await expect(fileLayer(tif(bare))).rejects.toThrow(/no embedded EPSG CRS/)
    const picked = await fileLayer(tif(bare), 'EPSG:3157')
    expect(picked.source.crs).toBe('EPSG:3157')
    expect(picked.note).toBeUndefined()
  })
  it('lets an embedded EPSG code win over the picker, and says so', async () => {
    const layer = await fileLayer(tif(float32Tiff({ values: [1, 2, 3, 4] })), 'EPSG:32610')
    expect(layer.source.crs).toBe('EPSG:3157')
    expect(layer.note).toMatch(/embedded EPSG:3157.*EPSG:32610 was ignored/)
    // A user-defined projection (32767) in a projected model is not read as its geographic base CRS.
    const custom = float32Tiff({ values: [1, 2, 3, 4], keys: [1024, 0, 1, 1, 2048, 0, 1, 4326, 3072, 0, 1, 32767] })
    await expect(fileLayer(tif(custom))).rejects.toThrow(/no embedded EPSG CRS/)
  })
  it('lets a declared GeoJSON CRS win, including inside a crowns wrapper', () => {
    const crs = { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::3157' } }
    const collection = {
      type: 'FeatureCollection',
      crs,
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [512000, 5971000] } }],
    }
    const declared = vectorData(collection, 'EPSG:4326')
    expect(declared.crs).toBe('EPSG:3157')
    expect(declared.note).toMatch(/declared EPSG:3157/)
    const wrapped = vectorData({ schema_version: 1, support: {}, crowns: collection })
    expect(wrapped.crs).toBe('EPSG:3157')
    expect(wrapped.bounds[0]).toBeCloseTo(-122.8, 1)
  })
})

describe('LAS/LAZ header inspection', () => {
  it('reads CRS and counts through the shared reader', async () => {
    const las = await inspectLas(new File([new Uint8Array(restorationLas())], 'flat.las'))
    expect(las).toMatchObject({ points: 80, format: 6, compressed: false, copc: false, hasCRS: true, epsg: 3157 })
  })
  it('recognises LAZ marked only by the laszip VLR', async () => {
    // Format byte without compression bits, a laszip VLR and far fewer bytes than 1,000 raw records.
    const bytes = new Uint8Array(227 + 54 + 34 + 10),
      view = new DataView(bytes.buffer)
    bytes.set(new TextEncoder().encode('LASF'))
    bytes[24] = 1
    bytes[25] = 2
    view.setUint16(94, 227, true)
    view.setUint32(96, 227 + 54 + 34, true)
    view.setUint32(100, 1, true)
    bytes[104] = 1
    view.setUint16(105, 28, true)
    view.setUint32(107, 1000, true)
    bytes.set(new TextEncoder().encode('laszip encoded'), 229)
    view.setUint16(245, 22204, true)
    view.setUint16(247, 34, true)
    const laz = await inspectLas(new File([bytes], 'vlr-only.laz'))
    expect(laz).toMatchObject({ compressed: true, points: 1000, hasCRS: false })
  })
})

describe('project save and restore', () => {
  it('decodes large base64 payloads quickly and exactly', () => {
    const size = 45 * 1024 ** 2,
      source = new Uint8Array(size)
    for (let i = 0; i < size; i += 4096) source[i] = i & 255
    const text = Buffer.from(source).toString('base64')
    const started = performance.now()
    const decoded = new Uint8Array(decode64(text))
    // The previous Uint8Array.from(atob(...), mapper) took 5–11 s here; a loop takes well under 1 s.
    expect(performance.now() - started).toBeLessThan(2500)
    expect(decoded.length).toBe(size)
    expect(Buffer.from(decoded).equals(Buffer.from(source))).toBe(true)
    expect(() => decode64('%%%')).toThrow(/invalid base64/)
  }, 30_000)
  it('rejects a layer at add time once the session could no longer be saved', async () => {
    const layer = (bytes: number, name = 'x.geojson'): VectorLayer => ({
      id: name,
      name,
      kind: 'vector',
      visible: true,
      opacity: 1,
      bounds: [0, 0, 1, 1],
      original: new ArrayBuffer(bytes),
      source: { name, bytes, sha256: '0'.repeat(64), crs: 'EPSG:4326' },
      data: { type: 'FeatureCollection', features: [] },
    })
    const session = (...layers: VectorLayer[]): ImportSession => ({ ...emptySession(), layers })
    expect(() => checkSession(session(layer(40 * 1024 ** 2, 'a'), layer(40 * 1024 ** 2, 'b')))).toThrow(
      /96 MiB saved-project limit/,
    )
    // Anything checkSession accepts must export, even with a worst-case name.
    const near = session(layer(70 * 1024 ** 2, '\u0001'.repeat(500)))
    expect(() => checkSession(near)).not.toThrow()
    expect(() => exportProject(near)).not.toThrow()
    await expect(fileLayer(new File([new Uint8Array(72 * 1024 ** 2)], 'big.geojson'))).rejects.toThrow(/71 MiB/)
  }, 60_000)
  it('restores a raster with its CRS, settings and NaN NoData', async () => {
    const layer = await fileLayer(tif(rasterGeoTiff(restoration(2955, 500_000, 5_985_000), 'slope')))
    layer.opacity = 0.35
    layer.visible = false
    const text = exportProject({ layers: [layer], point: null, missingPoints: ['a.laz'] })
    const back = await restoreProject(new File([text], 'p.pgmaps.json'))
    const raster = back.layers[0] as RasterLayer
    expect(raster.source).toEqual(layer.source)
    expect([raster.opacity, raster.visible]).toEqual([0.35, false])
    expect(Array.from(raster.values)).toEqual([1, 2, 3, NaN])
    expect(back.missingPoints).toEqual(['a.laz'])
  })
})

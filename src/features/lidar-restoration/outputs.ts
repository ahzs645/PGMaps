import proj4 from 'proj4'
import { csrsUtmZone, projectionDefinition } from '@/lib/geo/projectedCrs'
import { SCRIP_SOURCE, type Raster, type RestorationResult } from './model'
import { ALL_PRODUCTS as PRODUCTS, type AnalysisProduct as Product } from './products'
import { PEM_STRUCTURE_METHOD } from './pemStructure'

export { csrsUtmZone, projectionDefinition }

export function toWgs84(epsg: number, xy: [number, number]): [number, number] {
  return proj4(projectionDefinition(epsg), 'EPSG:4326', xy) as [number, number]
}
export function rasterCorners(g: Raster, epsg: number): [number, number][] {
  const east = g.west + g.width * g.cellM,
    south = g.north - g.height * g.cellM
  return [
    [g.west, g.north],
    [east, g.north],
    [east, south],
    [g.west, south],
  ].map((xy) => toWgs84(epsg, xy as [number, number]))
}
export function rasterStats(r: Raster) {
  let count = 0,
    min = Infinity,
    max = -Infinity,
    sum = 0
  for (const v of r.values)
    if (Number.isFinite(v)) {
      count++
      min = Math.min(min, v)
      max = Math.max(max, v)
      sum += v
    }
  return {
    count,
    missing: r.values.length - count,
    min: count ? min : null,
    max: count ? max : null,
    mean: count ? sum / count : null,
  }
}
export function rasterGeoTiff(result: RestorationResult, product: Product): ArrayBuffer {
  const r = result.rasters[product]
  // geotiff.js 2.x's writer casts samples to Uint8Array even with SampleFormat=3.
  // Write a standard little-endian, single-strip float32 TIFF to preserve fractional values/NaN.
  const shorts = (a: number[]) => {
    const b = new Uint8Array(a.length * 2),
      v = new DataView(b.buffer)
    a.forEach((x, i) => v.setUint16(i * 2, x, true))
    return b
  }
  const longs = (a: number[]) => {
    const b = new Uint8Array(a.length * 4),
      v = new DataView(b.buffer)
    a.forEach((x, i) => v.setUint32(i * 4, x, true))
    return b
  }
  const doubles = (a: number[]) => {
    const b = new Uint8Array(a.length * 8),
      v = new DataView(b.buffer)
    a.forEach((x, i) => v.setFloat64(i * 8, x, true))
    return b
  }
  const text = (s: string) => new TextEncoder().encode(s + '\0')
  const keys = [1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, result.epsg, 3076, 0, 1, 9001]
  // A relative height or density does not acquire the absolute ground elevation's vertical CRS.
  if (product === 'terrain' && result.verticalEpsg) keys.push(4096, 0, 1, result.verticalEpsg, 4099, 0, 1, 9001)
  const tags: Array<[number, number, Uint8Array]> = [
    [256, 4, longs([r.width])],
    [257, 4, longs([r.height])],
    [258, 3, shorts([32])],
    [259, 3, shorts([1])],
    [262, 3, shorts([1])],
    [270, 2, text(`${PRODUCTS[product].label} (${PRODUCTS[product].unit}). ${PRODUCTS[product].description}`)],
    [273, 4, longs([0])],
    [277, 3, shorts([1])],
    [278, 4, longs([r.height])],
    [279, 4, longs([r.values.byteLength])],
    [284, 3, shorts([1])],
    [339, 3, shorts([3])],
    [33550, 12, doubles([r.cellM, r.cellM, 0])],
    [33922, 12, doubles([0, 0, 0, r.west, r.north, 0])],
    [34735, 3, shorts([1, 1, 0, keys.length / 4, ...keys])],
    [42113, 2, text('nan')],
  ]
  const align = (n: number) => Math.ceil(n / 8) * 8
  let extra = align(8 + 2 + tags.length * 12 + 4)
  for (const [, , bytes] of tags) if (bytes.length > 4) extra = align(extra + bytes.length)
  const pixelOffset = extra,
    buffer = new ArrayBuffer(pixelOffset + r.values.byteLength),
    view = new DataView(buffer),
    bytes = new Uint8Array(buffer)
  view.setUint16(0, 0x4949, true)
  view.setUint16(2, 42, true)
  view.setUint32(4, 8, true)
  view.setUint16(8, tags.length, true)
  extra = align(8 + 2 + tags.length * 12 + 4)
  const sizes: Record<number, number> = { 2: 1, 3: 2, 4: 4, 12: 8 }
  tags.forEach(([tag, type, data], i) => {
    const at = 10 + i * 12
    view.setUint16(at, tag, true)
    view.setUint16(at + 2, type, true)
    view.setUint32(at + 4, data.length / sizes[type], true)
    if (tag === 273) {
      view.setUint32(at + 8, pixelOffset, true)
      return
    }
    if (data.length <= 4) bytes.set(data, at + 8)
    else {
      view.setUint32(at + 8, extra, true)
      bytes.set(data, extra)
      extra = align(extra + data.length)
    }
  })
  for (let i = 0; i < r.values.length; i++) view.setFloat32(pixelOffset + i * 4, r.values[i], true)
  return buffer
}
export function restorationManifest(result: RestorationResult) {
  return {
    schema: 'pgmaps-lidar-restoration-v1',
    method: 'ground-cell-mean-bilinear-v1',
    sourceMethod: SCRIP_SOURCE,
    structuralMethod: PEM_STRUCTURE_METHOD,
    horizontalEpsg: result.epsg,
    verticalEpsg: result.verticalEpsg,
    options: result.options,
    sources: result.sources,
    counts: result.counts,
    limitations: [
      'Screening approximation: ground-cell means with three local gap passes, not lidR ground TIN. No exact R parity claimed.',
      'Noise classes 7/18 and withheld returns are excluded. Height statistics use bilinear terrain and all remaining returns.',
      'Density divides by full cell area, including boundary cells. No returns is NoData; observed zero is zero.',
      'Vegetation metrics require terrain support for every accepted return in a cell. Mean height requires all first returns supported.',
      'Strata are return percentages, not biomass, species, stem counts or field-verified restoration suitability.',
      'Vertical heights must be metres. No vertical datum conversion, ground reclassification, thinning or overlap deduplication is performed.',
    ],
    products: Object.fromEntries(
      Object.entries(result.rasters).map(([id, r]) => [
        id,
        {
          ...PRODUCTS[id as Product],
          west: r.west,
          north: r.north,
          cellM: r.cellM,
          width: r.width,
          height: r.height,
          ...rasterStats(r),
        },
      ]),
    ),
  }
}
/** Cell footprints, not dissolved height classes. Bounded so accidental million-feature exports fail early. */
export function meanHeightPolygons(result: RestorationResult): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  const g = result.rasters.meanHeight
  if (rasterStats(g).count > 50_000)
    throw Error('Mean-height polygons exceed 50,000 cells. Export the GeoTIFF or use a larger mean-height cell size.')
  const features: GeoJSON.Feature<GeoJSON.Polygon>[] = []
  g.values.forEach((v, i) => {
    if (!Number.isFinite(v)) return
    const x = g.west + (i % g.width) * g.cellM,
      y = g.north - Math.floor(i / g.width) * g.cellM
    const ring = [
      [x, y],
      [x, y - g.cellM],
      [x + g.cellM, y - g.cellM],
      [x + g.cellM, y],
      [x, y],
    ].map((xy) => toWgs84(result.epsg, xy as [number, number]))
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: { mean_first_height_m: v, cell_m: g.cellM, source_epsg: result.epsg },
    })
  })
  return { type: 'FeatureCollection', features }
}
export async function restorationZip(result: RestorationResult): Promise<Blob> {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  for (const product of Object.keys(PRODUCTS) as Product[]) zip.file(`${product}.tif`, rasterGeoTiff(result, product))
  zip.file('manifest.json', JSON.stringify(restorationManifest(result), null, 2))
  return zip.generateAsync({ type: 'blob', compression: 'STORE' })
}

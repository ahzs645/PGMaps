import { fromArrayBuffer } from 'geotiff'
import proj4 from 'proj4'
import { definition, geographic } from './coordinates'
import { LIMITS, checkAborted, type RasterLayer } from './types'
/** A real EPSG code from GeoTIFF keys; 32767 means user-defined, which PGMaps cannot interpret. */
const epsgKey = (value: unknown) =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 && value !== 32767 ? value : undefined
export async function rasterData(original: ArrayBuffer, override = 'auto', signal?: AbortSignal) {
  checkAborted(signal)
  const image = await (await fromArrayBuffer(original, signal)).getImage(),
    keys: Record<string, unknown> = image.getGeoKeys() ?? {}
  const width = image.getWidth(),
    height = image.getHeight(),
    matrix = image.getFileDirectory().ModelTransformation
  if (image.getSamplesPerPixel() !== 1)
    throw Error('Import a single-band analysis GeoTIFF. RGB imagery belongs in the basemap.')
  if (!width || !height || width * height > LIMITS.cells)
    throw Error('GeoTIFF exceeds 16 million cells; crop it before importing')
  if (matrix && (matrix[1] !== 0 || matrix[4] !== 0))
    throw Error('Reproject rotated GeoTIFFs to a north-up grid before importing')
  if (keys.GTRasterTypeGeoKey === 2) throw Error('Convert pixel-is-point GeoTIFFs to pixel-is-area before importing')
  // An embedded EPSG code wins over the picker; the picker only fills in files without one.
  // GTModelTypeGeoKey 1 = projected, 2 = geographic. A projected file with a user-defined projection must not
  // fall back to its geographic base CRS, or projected metres would be read as degrees.
  const model = keys.GTModelTypeGeoKey,
    projected = epsgKey(keys.ProjectedCSTypeGeoKey),
    geographicCode = epsgKey(keys.GeographicTypeGeoKey)
  const embedded = model === 1 ? projected : model === 2 ? geographicCode : (projected ?? geographicCode)
  if (embedded === undefined && override === 'auto')
    throw Error('This GeoTIFF has no embedded EPSG CRS. Select its CRS in Layer CRS before importing.')
  const crs = embedded !== undefined ? 'EPSG:' + embedded : override
  const note =
    embedded !== undefined && override !== 'auto' && override !== crs
      ? `Used the embedded ${crs}; the selected ${override} was ignored.`
      : undefined
  definition(crs)
  const resolution = image.getResolution(),
    bounds = image.getBoundingBox()
  if (!resolution.every(Number.isFinite) || resolution[0] <= 0 || resolution[1] >= 0 || !bounds.every(Number.isFinite))
    throw Error('Expected a north-up, georeferenced GeoTIFF')
  const corners = [
    [bounds[0], bounds[3]],
    [bounds[2], bounds[3]],
    [bounds[2], bounds[1]],
    [bounds[0], bounds[1]],
  ].map((p) => geographic(p, crs))
  const geographicBounds: RasterLayer['bounds'] = [
    Math.min(...corners.map((p) => p[0])),
    Math.min(...corners.map((p) => p[1])),
    Math.max(...corners.map((p) => p[0])),
    Math.max(...corners.map((p) => p[1])),
  ]
  if (geographicBounds[2] - geographicBounds[0] > 5 || geographicBounds[3] - geographicBounds[1] > 5)
    throw Error('Crop large-extent rasters before display; this viewer uses an image footprint, not a global warp')
  checkAborted(signal)
  // geotiff.js checks the signal between tiles, so a large decode stops instead of running to completion.
  const raw = await image.readRasters({ samples: [0], interleave: true, signal })
  checkAborted(signal)
  const values = Float64Array.from(raw as ArrayLike<number>),
    declaredNoData = image.getGDALNoData()
  // GDAL_NODATA is decimal text; float32 cells hold its float32 rounding (e.g. -9999.9 → -9999.900390625).
  const noData =
    declaredNoData !== null && image.getSampleFormat(0) === 3 && image.getBitsPerSample(0) === 32
      ? Math.fround(declaredNoData)
      : declaredNoData
  let minimum = Infinity,
    maximum = -Infinity,
    valid = 0
  for (const v of values)
    if (Number.isFinite(v) && v !== noData) {
      minimum = Math.min(minimum, v)
      maximum = Math.max(maximum, v)
      valid++
    }
  if (!valid) throw Error('GeoTIFF contains only NoData cells')
  return {
    kind: 'raster' as const,
    crs,
    width,
    height,
    nativeBounds: bounds as RasterLayer['nativeBounds'],
    resolution: [resolution[0], resolution[1]] as [number, number],
    values,
    noData,
    minimum,
    maximum,
    valid,
    bounds: geographicBounds,
    note,
  }
}
export function rasterValue(layer: RasterLayer, lon: number, lat: number) {
  const xy = proj4('EPSG:4326', definition(layer.source.crs), [lon, lat])
  const col = Math.floor((xy[0] - layer.nativeBounds[0]) / layer.resolution[0]),
    row = Math.floor((xy[1] - layer.nativeBounds[3]) / layer.resolution[1])
  if (col < 0 || row < 0 || col >= layer.width || row >= layer.height) return null
  const value = layer.values[row * layer.width + col]
  return !Number.isFinite(value) || value === layer.noData ? null : value
}
/** Viridis stops for imported rasters; the preview and its legend both read this. */
export const RASTER_RAMP = [
  [68, 1, 84],
  [59, 82, 139],
  [33, 145, 140],
  [94, 201, 98],
  [253, 231, 37],
] as const
export const RASTER_RAMP_CSS = RASTER_RAMP.map(([r, g, b]) => `rgb(${r}, ${g}, ${b})`)
export function rasterColour(value: number, min: number, max: number): [number, number, number, number] {
  const t = Math.max(0, Math.min(1, (value - min) / (max - min || 1)))
  const stops = RASTER_RAMP
  const i = Math.min(3, Math.floor(t * 4)),
    f = t * 4 - i
  return [...stops[i].map((v, j) => Math.round(v + f * (stops[i + 1][j] - v))), 255] as [number, number, number, number]
}
export function rasterPreview(layer: RasterLayer) {
  const scale = Math.min(1, 1024 / Math.max(layer.width, layer.height)),
    width = Math.max(1, Math.round(layer.width * scale)),
    height = Math.max(1, Math.round(layer.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw Error('Raster preview needs Canvas support')
  const image = context.createImageData(width, height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const value =
        layer.values[
          Math.min(layer.height - 1, Math.floor(y / scale)) * layer.width +
            Math.min(layer.width - 1, Math.floor(x / scale))
        ]
      if (Number.isFinite(value) && value !== layer.noData)
        image.data.set(rasterColour(value, layer.minimum, layer.maximum), (y * width + x) * 4)
    }
  context.putImageData(image, 0, 0)
  const b = layer.nativeBounds,
    crs = layer.source.crs
  return {
    url: canvas.toDataURL('image/png'),
    coordinates: [
      [b[0], b[3]],
      [b[2], b[3]],
      [b[2], b[1]],
      [b[0], b[1]],
    ].map((p) => geographic(p, crs).slice(0, 2) as [number, number]),
  }
}

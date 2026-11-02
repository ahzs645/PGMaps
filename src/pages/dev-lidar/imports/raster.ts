import { fromArrayBuffer } from 'geotiff'
import proj4 from 'proj4'
import { definition, geographic } from './coordinates'
import { LIMITS, type RasterLayer } from './types'
export async function rasterData(original: ArrayBuffer, override = 'auto') {
  const image = await (await fromArrayBuffer(original)).getImage(),
    keys = image.getGeoKeys()
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
  const epsg = keys.ProjectedCSTypeGeoKey ?? keys.GeographicTypeGeoKey
  const crs = override === 'auto' ? 'EPSG:' + epsg : override
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
  const raw = await image.readRasters({ samples: [0], interleave: true })
  const values = Float64Array.from(raw as ArrayLike<number>),
    noData = image.getGDALNoData()
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
export function rasterColour(value: number, min: number, max: number): [number, number, number, number] {
  const t = Math.max(0, Math.min(1, (value - min) / (max - min || 1)))
  const stops = [
    [68, 1, 84],
    [59, 82, 139],
    [33, 145, 140],
    [94, 201, 98],
    [253, 231, 37],
  ]
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

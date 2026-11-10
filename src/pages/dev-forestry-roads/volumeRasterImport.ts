/**
 * A volume-per-hectare raster for volume-weighted cable line selection: a single-band, north-up
 * GeoTIFF in a projected CRS PGMaps knows (`roadProjection`), its values in m³/ha. It is sampled at
 * the extraction grid's cell centres, nearest pixel; no-data, negative and implausible values
 * (`MAX_VOLUME_PER_HA`) are missing, never zero. The file stays in this session: it is not saved in
 * the project.
 */
import { MAX_VOLUME_PER_HA } from './cableVolume'
import { MAX_ROAD_RASTER_CELLS, roadProjection } from './terrain'

/** Largest volume raster file read, bytes. */
export const MAX_VOLUME_RASTER_BYTES = 64_000_000

export interface VolumeRaster {
  name: string
  epsg: number
  /** Volume per hectare at a point (lon, lat), m³/ha; NaN off the raster or where it has none. */
  sample: (lon: number, lat: number) => number
}

/** Nearest-pixel sampler over a north-up raster's values (row-major, NaN missing). */
export function rasterSampler(
  r: { origin: [number, number]; pixelSize: [number, number]; width: number; height: number; values: Float32Array },
  forward: (lonLat: [number, number]) => [number, number],
): (lon: number, lat: number) => number {
  return (lon, lat) => {
    const [x, y] = forward([lon, lat])
    // `origin` is the top-left corner of the top-left pixel.
    const col = Math.floor((x - r.origin[0]) / r.pixelSize[0]),
      row = Math.floor((y - r.origin[1]) / r.pixelSize[1])
    if (!(col >= 0 && row >= 0 && col < r.width && row < r.height)) return NaN
    const v = r.values[row * r.width + col]
    return Number.isFinite(v) && v >= 0 && v <= MAX_VOLUME_PER_HA ? v : NaN
  }
}

export async function loadVolumeRaster(file: File): Promise<VolumeRaster> {
  if (file.size > MAX_VOLUME_RASTER_BYTES) throw Error('Crop the volume GeoTIFF first; the file limit is 64 MB.')
  const { fromArrayBuffer } = await import('geotiff')
  const image = await (await fromArrayBuffer(await file.arrayBuffer())).getImage()
  const width = image.getWidth(),
    height = image.getHeight()
  if (width < 1 || height < 1 || width * height > MAX_ROAD_RASTER_CELLS)
    throw Error(`Use a volume GeoTIFF with at most ${MAX_ROAD_RASTER_CELLS.toLocaleString('en-CA')} cells.`)
  if (image.getSamplesPerPixel() !== 1) throw Error('Use a single-band volume GeoTIFF (m³/ha).')
  if (image.fileDirectory.ModelTransformation) throw Error('Reproject a rotated raster to a north-up GeoTIFF first.')
  const keys = image.getGeoKeys()
  const epsg = Number(keys.ProjectedCSTypeGeoKey ?? keys.GeographicTypeGeoKey)
  const projection = roadProjection(epsg)
  const origin = image.getOrigin(),
    size = image.getResolution()
  const tiepoint = image.fileDirectory.ModelTiepoint
  if (tiepoint?.length === 6) {
    origin[0] -= tiepoint[0] * size[0]
    origin[1] -= tiepoint[1] * size[1]
  }
  // A PixelIsPoint raster ties the first pixel's centre; move to its corner.
  if (keys.GTRasterTypeGeoKey === 2) {
    origin[0] -= size[0] / 2
    origin[1] -= size[1] / 2
  }
  const raw = (await image.readRasters({ samples: [0], interleave: true })) as ArrayLike<number>
  const noData = image.getGDALNoData()
  const values = new Float32Array(width * height)
  for (let i = 0; i < values.length; i++) {
    const v = raw[i]
    values[i] = Number.isFinite(v) && (noData === null || v !== noData) ? v : NaN
  }
  return {
    name: file.name.slice(0, 200),
    epsg,
    sample: rasterSampler(
      { origin: [origin[0], origin[1]], pixelSize: [size[0], size[1]], width, height, values },
      (c) => projection.forward([...c]) as [number, number],
    ),
  }
}

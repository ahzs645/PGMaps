import type { GeoTIFF } from 'geotiff'

type GeoTIFFImage = Awaited<ReturnType<GeoTIFF['getImage']>>

export function suitabilityColor(code: number): [number, number, number, number] {
  if (code === 10) return [0, 100, 0, 255]
  if (code === 20) return [30, 144, 255, 255]
  if (code === 30) return [238, 201, 0, 255]
  return [0, 0, 0, 0]
}

export type RasterSample =
  | { status: 'value'; value: number; column: number; row: number }
  | { status: 'outside' | 'nodata' }

/** Sample the numeric cell under a WGS84 point; rendered tile colours are never read. */
export async function sampleCcissRaster(
  image: GeoTIFFImage,
  latitude: number,
  longitude: number,
): Promise<RasterSample> {
  if (image.getGeoKeys().GeographicTypeGeoKey !== 4326) {
    throw new Error('This GeoTIFF must use EPSG:4326 coordinates.')
  }

  const [west, north] = image.getOrigin()
  const [xResolution, yResolution] = image.getResolution()
  if (!Number.isFinite(xResolution) || !Number.isFinite(yResolution) || xResolution <= 0 || yResolution >= 0) {
    throw new Error('This GeoTIFF must be north-up in longitude/latitude coordinates.')
  }

  const column = Math.floor((longitude - west) / xResolution)
  const row = Math.floor((latitude - north) / yResolution)
  if (column < 0 || row < 0 || column >= image.getWidth() || row >= image.getHeight()) {
    return { status: 'outside' }
  }

  const cells = await image.readRasters({ samples: [0], window: [column, row, column + 1, row + 1] })
  const band = cells[0]
  const value = typeof band === 'number' ? band : band?.[0]
  if (value == null || !Number.isFinite(value) || value === image.getGDALNoData()) {
    return { status: 'nodata' }
  }
  return { status: 'value', value, column, row }
}

export function feasibilityClass(code: number): string {
  switch (code) {
    case 10:
      return '1 · High'
    case 20:
      return '2 · Moderate'
    case 30:
      return '3 · Low'
    default:
      return `Unmapped code ${code}`
  }
}

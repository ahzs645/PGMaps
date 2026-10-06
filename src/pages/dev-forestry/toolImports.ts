/** Browser adapters; no requests or uploads. Original assets stay on the user's device. */
import { createId } from './scene'
import { MAX_RASTER_CELLS, parseRasters, rasterProjection } from './localRaster'
import type { LocalRaster } from './types'
import type { FieldRecord } from './assessmentTools'

export async function importFieldImage(
  file: File,
  kind: FieldRecord['kind'],
  viewId: string | null,
): Promise<FieldRecord> {
  if (file.size > 25_000_000) throw new Error('Use an image smaller than 25 MB.')
  let meta: Record<string, unknown> = {}
  try {
    const exifr = await import('exifr')
    meta = (await exifr.parse(file)) ?? {}
  } catch {
    /* Missing EXIF remains unknown; fields can be recorded by the reviewer. */
  }
  const bitmap = await createImageBitmap(file),
    factor = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height)),
    canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * factor)
  canvas.height = Math.round(bitmap.height * factor)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    throw new Error('Image decoding is unavailable.')
  }
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const num = (key: string) =>
    typeof meta[key] === 'number' && Number.isFinite(meta[key]) ? (meta[key] as number) : null
  const date =
    meta.DateTimeOriginal instanceof Date && Number.isFinite(meta.DateTimeOriginal.getTime())
      ? `${meta.DateTimeOriginal.getFullYear()}-${String(meta.DateTimeOriginal.getMonth() + 1).padStart(2, '0')}-${String(meta.DateTimeOriginal.getDate()).padStart(2, '0')}`
      : ''
  const focal35 = num('FocalLengthIn35mmFormat') ?? num('FocalLengthIn35mmFilm')
  return {
    id: createId('field'),
    name: file.name.slice(0, 200),
    viewId,
    kind,
    image: canvas.toDataURL('image/jpeg', 0.82),
    width: canvas.width,
    height: canvas.height,
    captured: date,
    notes: '',
    lng: num('longitude'),
    lat: num('latitude'),
    altitude:
      num('GPSAltitude') === null
        ? null
        : meta.GPSAltitudeRef === 1
          ? -Math.abs(num('GPSAltitude')!)
          : num('GPSAltitude'),
    verticalReference: '',
    bearing: ['T', 'True North'].includes(String(meta.GPSImgDirectionRef)) ? num('GPSImgDirection') : null,
    pitch: 0,
    roll: 0,
    hfov:
      focal35 && focal35 > 0
        ? (2 *
            Math.atan((Math.hypot(36, 24) * canvas.width) / Math.hypot(canvas.width, canvas.height) / (2 * focal35)) *
            180) /
          Math.PI
        : null,
    focalMm: num('FocalLength'),
    focal35Mm: focal35,
    originalName: file.name,
    alignmentChecked: false,
    annotations: [],
  }
}

export async function importLocalRaster(
  file: File,
  kind: LocalRaster['kind'],
  acquired: string,
  verticalReference: string,
): Promise<LocalRaster> {
  if (!verticalReference.trim())
    throw new Error('Record the terrain vertical datum, or confirm canopy heights are metres above ground.')
  if (file.size > 64_000_000) throw new Error('Crop the raster to the assessment area; the file limit is 64 MB.')
  const data = await file.arrayBuffer(),
    { fromArrayBuffer } = await import('geotiff'),
    tiff = await fromArrayBuffer(data),
    image = await tiff.getImage()
  const width = image.getWidth(),
    height = image.getHeight()
  if (width * height > MAX_RASTER_CELLS)
    throw new Error(
      'Crop the GeoTIFF to at most 1,048,576 native cells (for example 1024 × 1024). No automatic resolution reduction is applied.',
    )
  if (image.getSamplesPerPixel() !== 1) throw new Error('Use a single-band terrain elevation or canopy-height GeoTIFF.')
  if (image.fileDirectory.ModelTransformation)
    throw new Error('Reproject a rotated raster to a north-up GeoTIFF before importing.')
  const keys = image.getGeoKeys(),
    epsg = Number(keys.ProjectedCSTypeGeoKey ?? keys.GeographicTypeGeoKey)
  rasterProjection(epsg)
  if (keys.VerticalUnitsGeoKey && keys.VerticalUnitsGeoKey !== 9001)
    throw new Error('Convert vertical values to metres before importing.')
  const origin = image.getOrigin(),
    size = image.getResolution(),
    pixelCentre = keys.GTRasterTypeGeoKey === 2 ? 0 : 0.5
  const rasters = await image.readRasters({ samples: [0], interleave: true }),
    noData = image.getGDALNoData()
  const values = Array.from(rasters as ArrayLike<number>, (v) => (!Number.isFinite(v) || v === noData ? null : v))
  const digest = await crypto.subtle.digest('SHA-256', data),
    sha256 = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  const raster: LocalRaster = {
    id: createId('raster'),
    name: file.name.slice(0, 200),
    kind,
    epsg,
    origin: [origin[0] + size[0] * pixelCentre, origin[1] + size[1] * pixelCentre],
    pixelSize: [size[0], size[1]],
    width,
    height,
    values,
    acquired,
    verticalReference: verticalReference.trim(),
    sha256,
  }
  return parseRasters([raster])[0]
}

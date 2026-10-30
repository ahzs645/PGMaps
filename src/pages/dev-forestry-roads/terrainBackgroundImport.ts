import { roadProjection } from './terrain'
import { parseTerrainBackgrounds, type TerrainBackgroundLayer } from './terrainPreparation'

/** Single-band CHM or RGB(A) north-up GeoTIFF, displayed independently from original ground. */
export async function loadTerrainBackground(
  file: File,
  kind: TerrainBackgroundLayer['kind'],
): Promise<TerrainBackgroundLayer> {
  if (file.size > 64_000_000) throw Error('Background GeoTIFF exceeds 64 MB.')
  const bytes = await file.arrayBuffer(),
    { fromArrayBuffer } = await import('geotiff'),
    tif = await fromArrayBuffer(bytes),
    image = await tif.getImage()
  const width = image.getWidth(),
    height = image.getHeight(),
    keys = image.getGeoKeys(),
    directory = image.fileDirectory
  const epsg = keys.ProjectedCSTypeGeoKey || keys.GeographicTypeGeoKey
  if (!epsg) throw Error('Background needs an explicit horizontal CRS.')
  roadProjection(epsg)
  if (width * height > 1_048_576)
    throw Error('Background exceeds 1,048,576 pixels; crop or resample the image explicitly.')
  if (directory.ModelTransformation) throw Error('Rotated GeoTIFF backgrounds must be resampled to north-up first.')
  const origin = image.getOrigin(),
    size = image.getResolution()
  if (size[0] <= 0 || size[1] >= 0) throw Error('Background must be north-up.')
  const shift = keys.GTRasterTypeGeoKey === 2 ? 0 : 0.5,
    sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('')
  const samples = (await image.readRasters({ interleave: false })) as unknown as Array<ArrayLike<number>>,
    rgba: number[] = new Array(width * height * 4),
    declared = image.getGDALNoData()
  if (kind === 'ortho' && samples.length < 3)
    throw Error('An orthophoto needs at least three RGB bands; use Canopy for a single-band height image.')
  for (let i = 0; i < width * height; i++) {
    if (kind === 'canopy') {
      const z = Number(samples[0][i]),
        known = Number.isFinite(z) && z !== declared
      const t = Math.max(0, Math.min(1, z / 40))
      rgba[i * 4] = Math.round(245 * (1 - t) + 15 * t)
      rgba[i * 4 + 1] = Math.round(245 * (1 - t) + 110 * t)
      rgba[i * 4 + 2] = Math.round(230 * (1 - t) + 50 * t)
      rgba[i * 4 + 3] = known ? 255 : 0
    } else {
      for (let b = 0; b < 3; b++) {
        const value = Number(samples[b][i])
        if (!Number.isFinite(value) || value < 0 || value > 255)
          throw Error('RGB background bands must use byte values 0–255.')
        rgba[i * 4 + b] = value
      }
      rgba[i * 4 + 3] = samples.length >= 4 ? Math.max(0, Math.min(255, Number(samples[3][i]))) : 255
    }
  }
  const layer: TerrainBackgroundLayer = {
    id: `background-${sha256.slice(0, 16)}`,
    name: file.name.slice(0, 200),
    kind,
    epsg,
    origin: [origin[0] + size[0] * shift, origin[1] + size[1] * shift],
    pixelSize: [size[0], size[1]],
    width,
    height,
    rgba,
    sha256,
    visible: true,
    opacity: 0.7,
  }
  return parseTerrainBackgrounds([layer])[0]
}

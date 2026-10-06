/** Raster sampling and validation have no browser or network dependencies. */
import proj4 from 'proj4'
import { mercatorToLngLat, type ElevationSource } from './terrain'
import type { CanopySource } from './canopy'
import type { LocalRaster } from './types'

proj4.defs(
  'EPSG:3005',
  '+proj=aea +lat_1=50 +lat_2=58.5 +lat_0=45 +lon_0=-126 +x_0=1000000 +y_0=0 +datum=NAD83 +units=m +no_defs',
)
export const MAX_RASTER_CELLS = 1_048_576
export function rasterProjection(epsg: number) {
  if (![4326, 3857, 3005].includes(epsg) && !(epsg >= 26907 && epsg <= 26911) && !(epsg >= 32607 && epsg <= 32611))
    throw new Error('Use WGS84, Web Mercator, BC Albers, or NAD83/WGS84 UTM zones 7–11.')
  if (!proj4.defs(`EPSG:${epsg}`))
    proj4.defs(
      `EPSG:${epsg}`,
      `+proj=utm +zone=${epsg % 100} +datum=${epsg < 30000 ? 'NAD83' : 'WGS84'} +units=m +no_defs`,
    )
  return proj4('EPSG:4326', `EPSG:${epsg}`)
}
export function parseRasters(raw: unknown): LocalRaster[] {
  if (raw == null) return []
  if (!Array.isArray(raw) || raw.length > 2) throw new Error('Use one terrain raster and one canopy-height raster.')
  const kinds = new Set<string>()
  return raw.map((value) => {
    const r = value as LocalRaster
    if (
      !r ||
      !['terrain', 'canopy'].includes(r.kind) ||
      kinds.has(r.kind) ||
      !Number.isInteger(r.width) ||
      !Number.isInteger(r.height) ||
      r.width < 2 ||
      r.height < 2 ||
      r.width * r.height > MAX_RASTER_CELLS ||
      !Array.isArray(r.values) ||
      r.values.length !== r.width * r.height ||
      !Array.isArray(r.origin) ||
      !Array.isArray(r.pixelSize) ||
      r.origin.length !== 2 ||
      r.pixelSize.length !== 2 ||
      ![...r.origin, ...r.pixelSize].every(Number.isFinite) ||
      r.pixelSize.some((v) => v === 0) ||
      typeof r.name !== 'string' ||
      typeof r.id !== 'string' ||
      typeof r.verticalReference !== 'string' ||
      !r.verticalReference.trim() ||
      typeof r.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(r.sha256) ||
      r.values.some((v) => v !== null && (!Number.isFinite(v) || (r.kind === 'canopy' && v < 0)))
    )
      throw new Error('Invalid local raster; import a cropped metre-valued GeoTIFF with its vertical reference.')
    rasterProjection(r.epsg)
    kinds.add(r.kind)
    return r
  })
}
export function rasterSampler(r: LocalRaster): ElevationSource & CanopySource {
  const projection = rasterProjection(r.epsg)
  const at = (lng: number, lat: number) => {
    const [x, y] = projection.forward([lng, lat])
    // Origin is the centre of the first pixel; unlike rendered MapLibre DEMs.
    const col = (x - r.origin[0]) / r.pixelSize[0],
      row = (y - r.origin[1]) / r.pixelSize[1]
    if (col < 0 || row < 0 || col > r.width - 1 || row > r.height - 1) return NaN
    const c = Math.min(r.width - 2, Math.floor(col)),
      q = Math.min(r.height - 2, Math.floor(row))
    const values = [
      r.values[q * r.width + c],
      r.values[q * r.width + c + 1],
      r.values[(q + 1) * r.width + c],
      r.values[(q + 1) * r.width + c + 1],
    ]
    if (values.some((v) => v === null || !Number.isFinite(v))) return NaN
    const u = col - c,
      v = row - q
    return values[0]! * (1 - u) * (1 - v) + values[1]! * u * (1 - v) + values[2]! * (1 - u) * v + values[3]! * u * v
  }
  return { elevationAt: at, heightAtMercator: (x, y) => at(...mercatorToLngLat(x, y)) }
}
export function localRasterResolution(r: LocalRaster, lat: number) {
  if (r.epsg === 4326)
    return Math.max(
      Math.abs(r.pixelSize[0]) * 111320 * Math.cos((lat * Math.PI) / 180),
      Math.abs(r.pixelSize[1]) * 110574,
    )
  return Math.max(...r.pixelSize.map(Math.abs)) * (r.epsg === 3857 ? Math.cos((lat * Math.PI) / 180) : 1)
}

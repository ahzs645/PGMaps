import proj4 from 'proj4'
import { METRIC_CRS } from '../sourceGrids'
import type { Bounds } from './types'
export function definition(crs: string) {
  if (crs === 'EPSG:3157') return METRIC_CRS
  const code = Number(crs.replace('EPSG:', ''))
  if (code >= 32601 && code <= 32660) return '+proj=utm +zone=' + (code - 32600) + ' +datum=WGS84 +units=m +no_defs'
  if (code >= 32701 && code <= 32760)
    return '+proj=utm +zone=' + (code - 32700) + ' +south +datum=WGS84 +units=m +no_defs'
  if (crs === 'EPSG:4326' || crs === 'EPSG:3857') return crs
  throw Error('Unsupported CRS ' + crs + '. Select the file’s CRS or reproject to WGS84 / UTM before importing.')
}
export function geographic(position: number[], crs: string): number[] {
  if (position.length < 2 || !position.every(Number.isFinite)) throw Error('Invalid coordinate')
  const xy = proj4(definition(crs), 'EPSG:4326', position.slice(0, 2))
  if (!xy.every(Number.isFinite) || Math.abs(xy[0]) > 180 || Math.abs(xy[1]) > 85)
    throw Error('Coordinates fall outside the map. Check the source CRS.')
  return [...xy, ...position.slice(2)]
}
export function unionBounds(bounds: Bounds[]): Bounds | undefined {
  if (!bounds.length) return undefined
  return [
    Math.min(...bounds.map((b) => b[0])),
    Math.min(...bounds.map((b) => b[1])),
    Math.max(...bounds.map((b) => b[2])),
    Math.max(...bounds.map((b) => b[3])),
  ]
}

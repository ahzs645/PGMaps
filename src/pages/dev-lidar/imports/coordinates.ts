import proj4 from 'proj4'
import { crsDefinition, epsgCode } from '@/lib/geo/projectedCrs'
import type { Bounds } from './types'
export function definition(crs: string) {
  const code = epsgCode(crs),
    resolved = code === null ? null : crsDefinition(code)
  if (!resolved)
    throw Error(
      'Unsupported CRS ' +
        crs +
        '. Select the file’s CRS or reproject to BC Albers, a NAD83/NAD83(CSRS)/WGS84 UTM zone or WGS84 before importing.',
    )
  return resolved
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

/** A map view: its centre and the ground width and height it shows when seen from straight above, in metres. */
export interface MapView {
  center: [number, number]
  width: number
  height: number
}
/** The view as a [minX, minY, maxX, maxY] box in a projected CRS. The box is centred and sized in metres. */
export function projectedViewBox(view: MapView, crs: string): [number, number, number, number] {
  const [x, y] = proj4('EPSG:4326', definition(crs), view.center)
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw Error('The map view falls outside this CRS')
  return [x - view.width / 2, y - view.height / 2, x + view.width / 2, y + view.height / 2]
}

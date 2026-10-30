/** BC Albers ↔ WGS84 for map display and DEM lookups. */
import proj4 from 'proj4'
import type { BBox, MultiPolygonCoords } from './types'

proj4.defs(
  'EPSG:3005',
  '+proj=aea +lat_1=50 +lat_2=58.5 +lat_0=45 +lon_0=-126 +x_0=1000000 +y_0=0 +datum=NAD83 +units=m +no_defs',
)
const albers = proj4('EPSG:3005', 'EPSG:4326')

export const albersToLngLat = (x: number, y: number) => albers.forward([x, y]) as [number, number]

export function multiPolygonToLngLat(geometry: MultiPolygonCoords): GeoJSON.MultiPolygon {
  return {
    type: 'MultiPolygon',
    coordinates: geometry.map((polygon) =>
      polygon.map((ring) =>
        ring.map(([x, y]) => {
          const [lng, lat] = albers.forward([x, y])
          return [Math.round(lng * 1e7) / 1e7, Math.round(lat * 1e7) / 1e7]
        }),
      ),
    ),
  }
}

/** `[minLng, minLat, maxLng, maxLat]` around an Albers box, from its corners and edge midpoints. */
export function albersBoxToLngLat([minX, minY, maxX, maxY]: BBox): [number, number, number, number] {
  const points = [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
    [(minX + maxX) / 2, minY],
    [(minX + maxX) / 2, maxY],
    [minX, (minY + maxY) / 2],
    [maxX, (minY + maxY) / 2],
  ].map(([x, y]) => albers.forward([x, y]))
  return [
    Math.min(...points.map((point) => point[0])),
    Math.min(...points.map((point) => point[1])),
    Math.max(...points.map((point) => point[0])),
    Math.max(...points.map((point) => point[1])),
  ]
}

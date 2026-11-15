/**
 * The two map coordinate systems the ArcGIS Pro map and layout files use: BC Albers (EPSG:3005)
 * for extents inside British Columbia, so a layout's scale is true on the ground, and Web Mercator
 * (EPSG:3857, Pro's wkid 102100) elsewhere. Longitude/latitude are WGS84; NAD83 is taken as equal to
 * it, which is within 2 m in BC. No DOM or network access.
 */
import proj4 from 'proj4'

export type MapWkid = 3005 | 3857

proj4.defs(
  'EPSG:3005',
  '+proj=aea +lat_1=50 +lat_2=58.5 +lat_0=45 +lon_0=-126 +x_0=1000000 +y_0=0 +datum=NAD83 +units=m +no_defs',
)

const converters = {
  3005: proj4('EPSG:4326', 'EPSG:3005'),
  3857: proj4('EPSG:4326', 'EPSG:3857'),
}

/** BC's extent with a margin; an extent wholly inside it is written in BC Albers. */
const BC_BOUNDS = [-140, 47.5, -113.5, 60.5]

export const defaultWkid = (extent?: readonly number[]): MapWkid =>
  extent &&
  extent[0] >= BC_BOUNDS[0] &&
  extent[1] >= BC_BOUNDS[1] &&
  extent[2] <= BC_BOUNDS[2] &&
  extent[3] <= BC_BOUNDS[3]
    ? 3005
    : 3857

/** The CIM spatial reference for a wkid, as Pro writes it. */
export const spatialReference = (wkid: MapWkid) =>
  wkid === 3857 ? { wkid: 102100, latestWkid: 3857 } : { wkid: 3005, latestWkid: 3005 }

/** The wkid a CIM spatial reference names, when it is one of ours. */
export function wkidOf(reference: unknown): MapWkid | null {
  if (!reference || typeof reference !== 'object') return null
  const { wkid, latestWkid } = reference as { wkid?: unknown; latestWkid?: unknown }
  if (wkid === 3005 || latestWkid === 3005) return 3005
  if (wkid === 102100 || wkid === 3857 || latestWkid === 3857 || wkid === 900913) return 3857
  return null
}

export const project = (wkid: MapWkid, lngLat: [number, number]) => converters[wkid].forward(lngLat) as [number, number]
export const unproject = (wkid: MapWkid, xy: [number, number]) => converters[wkid].inverse(xy) as [number, number]

/** A longitude/latitude box as a projected box, from its corners and edge midpoints. */
export function projectBox(wkid: MapWkid, [w, s, e, n]: readonly number[]): [number, number, number, number] {
  const mx = (w + e) / 2,
    my = (s + n) / 2
  const points = [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
    [mx, s],
    [mx, n],
    [w, my],
    [e, my],
  ].map((p) => project(wkid, p as [number, number]))
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

/** A projected box as a longitude/latitude box, from its corners and edge midpoints. */
export function unprojectBox(wkid: MapWkid, [x0, y0, x1, y1]: readonly number[]): [number, number, number, number] {
  const mx = (x0 + x1) / 2,
    my = (y0 + y1) / 2
  const points = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [mx, y0],
    [mx, y1],
    [x0, my],
    [x1, my],
  ].map((p) => unproject(wkid, p as [number, number]))
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

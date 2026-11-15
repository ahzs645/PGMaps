/**
 * The coordinate reference system QGIS projects and layout maps are written in, and conversions of
 * longitude/latitude extents to and from it. Data inside British Columbia gets NAD83 / BC Albers
 * (EPSG:3005): the province's standard equal-area projection, in metres, whose scale error across
 * BC is under 1 %, so a layout's scale bar and stated scale are true on the printed sheet. Web
 * Mercator would print a 1:10,000 sheet at Prince George about 1.7 times too large. Anything outside
 * BC falls back to Web Mercator (EPSG:3857) with its scale read at the centre latitude.
 * No DOM or network access.
 */
import proj4 from 'proj4'
import { BC_ALBERS } from '@/lib/geo/projectedCrs'
import { el, textEl, type XmlElement, type XmlNodeSpec } from '../xml'
import { child, textOf } from '../xml'

export type ProjectCrsId = 'EPSG:3005' | 'EPSG:3857'
export type Extent = [number, number, number, number]

/** EPSG:3005's area of use. */
export const BC_BOUNDS: Extent = [-139.04, 48.25, -114.08, 60.01]

const WEB_MERCATOR =
  '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs'
const DEFINITIONS: Record<ProjectCrsId, string> = { 'EPSG:3005': BC_ALBERS, 'EPSG:3857': WEB_MERCATOR }
const DESCRIPTIONS: Record<ProjectCrsId | 'EPSG:4326', string> = {
  'EPSG:3005': 'NAD83 / BC Albers',
  'EPSG:3857': 'WGS 84 / Pseudo-Mercator',
  'EPSG:4326': 'WGS 84',
}
const WGS84 = '+proj=longlat +datum=WGS84 +no_defs'

const GEOGCS_WGS84 =
  'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]]'
/**
 * OGC WKT of each CRS, from the EPSG registry. QGIS 4 resolves a `<spatialrefsys>` from its WKT and
 * ignores an authority id given alone.
 */
const WKT: Record<ProjectCrsId | 'EPSG:4326', string> = {
  'EPSG:4326': GEOGCS_WGS84,
  'EPSG:3005':
    'PROJCS["NAD83 / BC Albers",GEOGCS["NAD83",DATUM["North_American_Datum_1983",SPHEROID["GRS 1980",6378137,298.257222101,AUTHORITY["EPSG","7019"]],AUTHORITY["EPSG","6269"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4269"]],PROJECTION["Albers_Conic_Equal_Area"],PARAMETER["latitude_of_center",45],PARAMETER["longitude_of_center",-126],PARAMETER["standard_parallel_1",50],PARAMETER["standard_parallel_2",58.5],PARAMETER["false_easting",1000000],PARAMETER["false_northing",0],UNIT["metre",1,AUTHORITY["EPSG","9001"]],AXIS["Easting",EAST],AXIS["Northing",NORTH],AUTHORITY["EPSG","3005"]]',
  'EPSG:3857': `PROJCS["WGS 84 / Pseudo-Mercator",${GEOGCS_WGS84},PROJECTION["Mercator_1SP"],PARAMETER["central_meridian",0],PARAMETER["scale_factor",1],PARAMETER["false_easting",0],PARAMETER["false_northing",0],UNIT["metre",1,AUTHORITY["EPSG","9001"]],AXIS["Easting",EAST],AXIS["Northing",NORTH],AUTHORITY["EPSG","3857"]]`,
}

/** BC Albers when the extent's centre is in BC, else Web Mercator. */
export function projectCrsFor(extent: Extent | undefined): ProjectCrsId {
  if (!extent) return 'EPSG:3005'
  const lon = (extent[0] + extent[2]) / 2,
    lat = (extent[1] + extent[3]) / 2
  return lon >= BC_BOUNDS[0] && lon <= BC_BOUNDS[2] && lat >= BC_BOUNDS[1] && lat <= BC_BOUNDS[3]
    ? 'EPSG:3005'
    : 'EPSG:3857'
}

export const isProjectCrs = (authid: string | null | undefined): authid is ProjectCrsId =>
  authid === 'EPSG:3005' || authid === 'EPSG:3857'

/** Longitude/latitude to the CRS. */
export const toCrs = (crs: ProjectCrsId, lon: number, lat: number): [number, number] =>
  proj4(WGS84, DEFINITIONS[crs], [lon, lat]) as [number, number]
/** The CRS to longitude/latitude. */
export const fromCrs = (crs: ProjectCrsId, x: number, y: number): [number, number] =>
  proj4(DEFINITIONS[crs], WGS84, [x, y]) as [number, number]

/** Bounds in the CRS of a longitude/latitude extent, sampled along its edges since Albers curves them. */
export function projectExtent(crs: ProjectCrsId, extent: Extent): Extent {
  const [w, s, e, n] = extent
  const xs: number[] = [],
    ys: number[] = []
  for (let i = 0; i <= 8; i++) {
    const t = i / 8
    for (const [lon, lat] of [
      [w + (e - w) * t, s],
      [w + (e - w) * t, n],
      [w, s + (n - s) * t],
      [e, s + (n - s) * t],
    ]) {
      const [x, y] = toCrs(crs, lon, lat)
      xs.push(x)
      ys.push(y)
    }
  }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

/** Longitude/latitude bounds of a box in the CRS. */
export function unprojectExtent(crs: ProjectCrsId, box: Extent): Extent {
  const [x0, y0, x1, y1] = box
  const lons: number[] = [],
    lats: number[] = []
  for (let i = 0; i <= 8; i++) {
    const t = i / 8
    for (const [x, y] of [
      [x0 + (x1 - x0) * t, y0],
      [x0 + (x1 - x0) * t, y1],
      [x0, y0 + (y1 - y0) * t],
      [x1, y0 + (y1 - y0) * t],
    ]) {
      const [lon, lat] = fromCrs(crs, x, y)
      lons.push(lon)
      lats.push(lat)
    }
  }
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)]
}

/** Ground metres per CRS unit at a latitude: 1 in Albers, cos(latitude) in Web Mercator. */
export const groundPerUnit = (crs: ProjectCrsId, lat: number) =>
  crs === 'EPSG:3857' ? Math.cos((lat * Math.PI) / 180) : 1

/** A `<spatialrefsys>` QGIS resolves from its authority id. */
export function spatialRefSys(authid: ProjectCrsId | 'EPSG:4326'): XmlNodeSpec {
  const geographic = authid === 'EPSG:4326'
  return el(
    'spatialrefsys',
    { nativeFormat: 'Wkt' },
    textEl('wkt', WKT[authid]),
    textEl('proj4', geographic ? WGS84 : DEFINITIONS[authid]),
    textEl('srid', authid.slice(5)),
    textEl('authid', authid),
    textEl('description', DESCRIPTIONS[authid]),
    textEl('projectionacronym', geographic ? 'longlat' : authid === 'EPSG:3005' ? 'aea' : 'merc'),
    textEl('ellipsoidacronym', geographic || authid === 'EPSG:3857' ? 'EPSG:7030' : 'EPSG:7019'),
    textEl('geographicflag', geographic ? 'true' : 'false'),
  )
}

/** The authority id of the `<spatialrefsys>` under `element`, if any. */
export function authidOf(element: XmlElement | undefined): string | null {
  const srs = element && (child(element, 'spatialrefsys') ?? element)
  const authid = srs ? textOf(child(srs, 'authid')) : ''
  return authid || null
}

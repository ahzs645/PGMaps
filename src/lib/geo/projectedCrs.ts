/**
 * Shared EPSG → proj4 definitions for the metre-based CRSs PGMaps reads from LiDAR, rasters and
 * planning inputs. No network or DOM access.
 */

/** EPSG:1946 NAD83(CSRS)→WGS84(2), coordinate-frame rotations converted to proj4 position-vector signs. */
export const CSRS_TOWGS84 = '+towgs84=-0.991,1.9072,0.5129,0.0257899075194932,0.0096500989602704,0.0116599432323421,0'

/** EPSG:3005 NAD83 / BC Albers, including its 1,000,000 m false easting. */
export const BC_ALBERS =
  '+proj=aea +lat_1=50 +lat_2=58.5 +lat_0=45 +lon_0=-126 +x_0=1000000 +y_0=0 +datum=NAD83 +units=m +no_defs'

/** NAD83(CSRS) / UTM zone N codes are not contiguous: 2955–2957 are 11–13N, 3154–3157 are 7–10N, 3158–3160 are 14–16N. */
export function csrsUtmZone(epsg: number): number | null {
  if (epsg >= 2955 && epsg <= 2957) return epsg - 2944
  if (epsg >= 3154 && epsg <= 3157) return epsg - 3147
  if (epsg >= 3158 && epsg <= 3160) return epsg - 3144
  return null
}

/** proj4 definition of a supported projected CRS in metres, or null. */
export function projectedCrsDefinition(epsg: number): string | null {
  if (!Number.isInteger(epsg)) return null
  if (epsg === 3005) return BC_ALBERS
  const csrs = csrsUtmZone(epsg)
  if (csrs !== null) return `+proj=utm +zone=${csrs} +ellps=GRS80 ${CSRS_TOWGS84} +units=m +no_defs`
  if (epsg >= 26901 && epsg <= 26923) return `+proj=utm +zone=${epsg - 26900} +datum=NAD83 +units=m +no_defs`
  if (epsg >= 32601 && epsg <= 32660) return `+proj=utm +zone=${epsg - 32600} +datum=WGS84 +units=m +no_defs`
  if (epsg >= 32701 && epsg <= 32760) return `+proj=utm +zone=${epsg - 32700} +south +datum=WGS84 +units=m +no_defs`
  return null
}

export const isMetricCrs = (epsg: number) => projectedCrsDefinition(epsg) !== null

/** Like projectedCrsDefinition, but throws for an unsupported code. */
export function projectionDefinition(epsg: number): string {
  const definition = projectedCrsDefinition(epsg)
  if (!definition) throw Error(`Unsupported projected CRS EPSG:${epsg}.`)
  return definition
}

/** Supported projected CRSs plus lon/lat (4326) and Web Mercator (3857), as proj4 definitions. */
export function crsDefinition(epsg: number): string | null {
  if (epsg === 4326 || epsg === 3857) return `EPSG:${epsg}`
  return projectedCrsDefinition(epsg)
}

/** EPSG code from an "EPSG:1234" string, or null. */
export function epsgCode(crs: string): number | null {
  const match = /^EPSG:(\d+)$/i.exec(crs.trim())
  return match ? Number(match[1]) : null
}

export interface CrsOptionGroup {
  label: string
  options: Array<{ value: string; label: string }>
}
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)
const option = (epsg: number, label: string) => ({ value: `EPSG:${epsg}`, label: `EPSG:${epsg} · ${label}` })
/** Every code crsDefinition supports, grouped for a CRS picker. */
export const CRS_OPTION_GROUPS: CrsOptionGroup[] = [
  {
    label: 'British Columbia',
    options: [
      option(3005, 'BC Albers'),
      ...[...range(3154, 3157), ...range(2955, 2957), ...range(3158, 3160)].map((epsg) =>
        option(epsg, `NAD83(CSRS) UTM ${csrsUtmZone(epsg)}N`),
      ),
    ],
  },
  { label: 'NAD83 / UTM', options: range(26901, 26923).map((epsg) => option(epsg, `NAD83 UTM ${epsg - 26900}N`)) },
  {
    label: 'WGS84 / UTM',
    options: [
      ...range(32601, 32660).map((epsg) => option(epsg, `WGS84 UTM ${epsg - 32600}N`)),
      ...range(32701, 32760).map((epsg) => option(epsg, `WGS84 UTM ${epsg - 32700}S`)),
    ],
  },
  { label: 'Global', options: [option(4326, 'lon/lat'), option(3857, 'Web Mercator')] },
]

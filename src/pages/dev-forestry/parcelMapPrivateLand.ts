/**
 * Private land around a landform, live from ParcelMap BC's parcel fabric on DataBC's WFS.
 *
 * The parcels are candidates: the reviewer adds each one as a private-land assessment mask
 * (`kind: 'private'`), which is what the run and the figures read. Nothing here writes a mask.
 * Private ownership comes from `OWNER_TYPE = 'Private'`. As in `bcVegetationInventory.ts`, the box
 * goes in the CQL filter, longitude first, never the latitude-first WFS `bbox` parameter, and
 * `propertyName` stays narrow. `fetch` is passed in, so the module has no network access of its own.
 */
import { polygonAreaMeters, type PolygonGeometry } from './visibility'

export const PARCEL_FABRIC_WFS = 'https://openmaps.gov.bc.ca/geo/pub/wfs'
const TYPE_NAME = 'WHSE_CADASTRE.PMBC_PARCEL_FABRIC_POLY_SVW'
const FIELDS = ['PARCEL_FABRIC_POLY_ID', 'PID_FORMATTED', 'PARCEL_CLASS', 'OWNER_TYPE', 'PLAN_NUMBER', 'SHAPE']

/** Widest box asked for, degrees: a landform's surroundings, not a district. */
export const MAX_PARCEL_QUERY_DEGREES = 0.4
/** Most parcels one answer holds. */
export const MAX_PARCELS = 500

export type PrivateParcel = {
  id: string
  /** Parcel identifier as ParcelMap prints it, when the parcel has one. */
  pid: string | null
  parcelClass: string | null
  plan: string | null
  areaMeters: number
  geometry: PolygonGeometry
}

export function privateParcelQueryUrl(bounds: [number, number, number, number], maxFeatures = MAX_PARCELS): string {
  const [w, s, e, n] = bounds
  if (!(e > w && n > s)) throw new Error('Choose an area to look for private land in.')
  if (e - w > MAX_PARCEL_QUERY_DEGREES || n - s > MAX_PARCEL_QUERY_DEGREES)
    throw new Error('The landform is too large to look up private land around it in one query.')
  const round = (value: number) => Number(value.toFixed(6))
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: TYPE_NAME,
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
    count: String(maxFeatures),
    propertyName: FIELDS.join(','),
    CQL_FILTER: `OWNER_TYPE='Private' AND BBOX(SHAPE,${round(w)},${round(s)},${round(e)},${round(n)},'EPSG:4326')`,
  })
  return `${PARCEL_FABRIC_WFS}?${params.toString()}`
}

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null)

export function parsePrivateParcels(
  payload: unknown,
  maxFeatures = MAX_PARCELS,
): { parcels: PrivateParcel[]; truncated: boolean } {
  const collection = payload as { features?: unknown; numberMatched?: unknown }
  if (!Array.isArray(collection?.features)) return { parcels: [], truncated: false }
  const parcels = collection.features.flatMap((entry, index): PrivateParcel[] => {
    const feature = entry as { id?: unknown; geometry?: PolygonGeometry; properties?: Record<string, unknown> }
    const geometry = feature.geometry
    if (geometry?.type !== 'Polygon' && geometry?.type !== 'MultiPolygon') return []
    const p = feature.properties ?? {}
    if (text(p.OWNER_TYPE)?.toLowerCase() !== 'private') return []
    const areaMeters = polygonAreaMeters(geometry)
    if (!(areaMeters > 0)) return []
    return [
      {
        id: String(p.PARCEL_FABRIC_POLY_ID ?? feature.id ?? `parcel-${index}`),
        pid: text(p.PID_FORMATTED),
        parcelClass: text(p.PARCEL_CLASS),
        plan: text(p.PLAN_NUMBER),
        areaMeters,
        geometry,
      },
    ]
  })
  const matched = typeof collection.numberMatched === 'number' ? collection.numberMatched : null
  return { parcels, truncated: parcels.length >= maxFeatures || (matched !== null && matched > parcels.length) }
}

/** The mask name and source a parcel is added under. */
export function parcelMaskFields(parcel: PrivateParcel): { name: string; source: string } {
  return {
    name: parcel.pid ? `Private land, PID ${parcel.pid}` : `Private land${parcel.plan ? `, plan ${parcel.plan}` : ''}`,
    source: `ParcelMap BC parcel fabric (DataBC WFS), parcel ${parcel.id}${parcel.parcelClass ? `, ${parcel.parcelClass}` : ''}; added by the reviewer`,
  }
}

export async function fetchPrivateParcels(
  bounds: [number, number, number, number],
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<{ parcels: PrivateParcel[]; truncated: boolean }> {
  const response = await fetcher(privateParcelQueryUrl(bounds), { signal })
  if (!response.ok) throw new Error(`ParcelMap BC answered ${response.status}. Try again.`)
  const payload: unknown = await response.json()
  if ((payload as { exceptions?: unknown })?.exceptions) throw new Error('ParcelMap BC refused that query.')
  return parsePrivateParcels(payload)
}

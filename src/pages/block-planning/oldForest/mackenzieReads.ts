/**
 * What the Mackenzie calculation reads that the Prince George one does not: the unit's landscape unit
 * polygons (`RMP_LANDSCAPE_UNIT_SVW`, by `LANDSCAPE_UNIT_PROVID`, each record's name and emphasis
 * option checked against Table 2), and the ground the order does not apply to.
 *
 * The order applies to Crown land in the district "except for lands covered by woodlot licences,
 * research forests or community forests licences that are 600 hectares or smaller" (1.2), and its
 * CFLB leaves out "private land, federal land, municipal land and woodlots licenses" (1.5). So:
 *
 * - **not provincial Crown**, from `F_OWN` by the same codes as the Prince George read (`landBase.ts`);
 * - **woodlots** (W), every one: the CFLB definition names them without a size;
 * - **community forests** (K) whose licence is 600 ha or smaller, measured over all the licence's
 *   active polygons (`FEATURE_AREA_SQM`, DataBC's BC Albers area), wherever they lie. A larger one
 *   stays and is reported. In November 2026 the district's one community forest, K2M, held
 *   26,302 ha, so none left;
 * - **tree farm licences stay**: the order does not name them (TFL 48 reaches the district);
 * - **research forests** are not read: no public layer of them was found.
 *
 * DOM- and network-free: `fetch` is passed in. Each read follows the unit's own shapes.
 */
import type { MultiPolygon, Polygon } from 'geojson'
import type { Shape } from '../plan'
import { keepFields, quote, readAcrossParts, wfsPages, type Fetch, type RawFeature } from '../wfsReads'
import {
  MANAGED_LICENCE_LAYER,
  managedLicenceKind,
  NON_CROWN_FILTER,
  nonCrownOwnership,
  OWNERSHIP_LAYER,
  type ExcludedArea,
} from './landBase'
import type { MackenzieUnit } from './mackenzieUnits'

export const LANDSCAPE_UNIT_LAYER = 'pub:WHSE_LAND_USE_PLANNING.RMP_LANDSCAPE_UNIT_SVW'
const LU_FIELDS = ['OBJECTID', 'LANDSCAPE_UNIT_PROVID', 'LANDSCAPE_UNIT_NAME', 'BIODIVERSITY_EMPHASIS_OPTION'] as const
const LICENCE_FIELDS = ['OBJECTID', 'FOREST_FILE_ID', 'ML_TYPE_CODE', 'FEATURE_AREA_SQM'] as const

/** Section 1.2's size: a community forest of this many hectares or fewer is left out. */
export const MACKENZIE_SMALL_TENURE_HA = 600

export interface MackenzieUnitRead {
  geometry: Shape
  polygons: number
  /** Whether the Objective 2(d) park joined the unit. */
  park: string | null
  source: string
}

/** The unit's landscape unit polygons (and its 2(d) park when `withPark`), joined, each record checked by name. */
export async function readMackenzieUnit({
  unit,
  withPark,
  fetch,
  signal,
  readOn,
  union,
}: {
  unit: MackenzieUnit
  withPark: boolean
  fetch: Fetch
  signal?: AbortSignal
  readOn: string
  /** Joins the polygons (JSTS lives with the calculation, not here). */
  union: (shapes: Shape[]) => Shape
}): Promise<MackenzieUnitRead> {
  const expected = new Map<number, { name: string; beo: string }>(
    unit.landscapeUnits.map((lu) => [lu.provid, { name: lu.name, beo: lu.beo }]),
  )
  const park = withPark ? unit.park : null
  if (park) expected.set(park.provid, { name: park.name, beo: 'NA' })
  const features = await wfsPages({
    fetch,
    signal,
    layer: LANDSCAPE_UNIT_LAYER,
    filter: `LANDSCAPE_UNIT_PROVID IN (${[...expected.keys()].join(',')})`,
    propertyName: [...LU_FIELDS, 'GEOMETRY'].join(','),
    sortBy: 'OBJECTID',
    cap: 500,
  })
  const shapes: Shape[] = []
  const seen = new Set<number>()
  for (const f of features) {
    const p = keepFields(f.properties, LU_FIELDS)
    const provid = Number(p.LANDSCAPE_UNIT_PROVID)
    const want = expected.get(provid)
    if (!want) continue
    if (p.LANDSCAPE_UNIT_NAME !== want.name || p.BIODIVERSITY_EMPHASIS_OPTION !== want.beo)
      throw Error(
        `DataBC’s landscape unit ${provid} is now ${String(p.LANDSCAPE_UNIT_NAME)} (${String(p.BIODIVERSITY_EMPHASIS_OPTION)}), not ${want.name} (${want.beo}); the unit cannot be read safely.`,
      )
    seen.add(provid)
    if (f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon') shapes.push(f.geometry)
  }
  const missing = [...expected.entries()].filter(([id]) => !seen.has(id)).map(([, v]) => v.name)
  if (missing.length) throw Error(`DataBC holds no landscape unit polygons for ${missing.join(', ')}.`)
  const names = [...unit.landscapeUnits.map((lu) => lu.name), ...(park ? [park.name] : [])].join(', ')
  return {
    geometry: union(shapes),
    polygons: features.length,
    park: park ? park.asPrinted : null,
    source: `Landscape units ${names} (DataBC RMP_LANDSCAPE_UNIT_SVW, ${features.length} polygons), read ${readOn}`,
  }
}

/** A community forest the order still applies to (larger than 600 ha), reported beside the result. */
export interface KeptTenure {
  file: string
  areaHa: number
}

const polygonal = (f: RawFeature) => f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon'
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v))

/** Whether section 1.2 leaves a community forest out: its whole licence is 600 ha or smaller. */
export const smallCommunityForest = (licenceHa: number) => licenceHa <= MACKENZIE_SMALL_TENURE_HA

export async function readMackenzieExcluded({
  unit,
  fetch,
  signal,
}: {
  unit: Shape
  fetch: Fetch
  signal?: AbortSignal
}): Promise<{ excluded: ExcludedArea[]; keptCommunityForests: KeptTenure[] }> {
  const read = (layer: string, extra: string, propertyName: string) =>
    readAcrossParts(
      unit,
      (filter) =>
        wfsPages({
          fetch,
          signal,
          layer,
          filter: `${filter} AND ${extra}`,
          propertyName: `${propertyName},GEOMETRY`,
          sortBy: 'OBJECTID',
          cap: 20_000,
        }),
      'GEOMETRY',
      (f) => String(f.properties.OBJECTID ?? f.id),
    )
  const ownership = await read(OWNERSHIP_LAYER, NON_CROWN_FILTER, 'OBJECTID,OWN,OWNERSHIP_DESCRIPTION')
  const licences = await read(
    MANAGED_LICENCE_LAYER,
    "LIFE_CYCLE_STATUS_CODE = 'ACTIVE' AND (FOREST_FILE_ID LIKE 'W%' OR FOREST_FILE_ID LIKE 'K%')",
    LICENCE_FIELDS.join(','),
  )
  const out: ExcludedArea[] = []
  for (const f of ownership) {
    if (!polygonal(f) || !nonCrownOwnership(Number(f.properties.OWN))) continue
    out.push({
      kind: 'non-crown',
      id: `own-${text(f.properties.OBJECTID ?? f.id)}`,
      name: text(f.properties.OWNERSHIP_DESCRIPTION) || `Ownership ${text(f.properties.OWN)}`,
      geometry: f.geometry as Polygon | MultiPolygon,
    })
  }
  // A community forest's size is its whole licence's, every active polygon of it, not the part in the unit.
  const communityFiles = [
    ...new Set(
      licences
        .map((f) => text(keepFields(f.properties, LICENCE_FIELDS).FOREST_FILE_ID))
        .filter((id) => managedLicenceKind(id) === 'community-forest'),
    ),
  ]
  const licenceHa = new Map<string, number>()
  for (const file of communityFiles) {
    const all = await wfsPages({
      fetch,
      signal,
      layer: MANAGED_LICENCE_LAYER,
      filter: `FOREST_FILE_ID = ${quote(file)} AND LIFE_CYCLE_STATUS_CODE = 'ACTIVE'`,
      propertyName: LICENCE_FIELDS.join(','),
      sortBy: 'OBJECTID',
      cap: 5000,
    })
    const m2 = all.reduce((sum, f) => sum + (Number(keepFields(f.properties, LICENCE_FIELDS).FEATURE_AREA_SQM) || 0), 0)
    licenceHa.set(file, m2 / 10_000)
  }
  for (const f of licences) {
    const p = keepFields(f.properties, LICENCE_FIELDS)
    const file = text(p.FOREST_FILE_ID)
    const kind = managedLicenceKind(file)
    if (!polygonal(f) || !kind) continue
    if (kind === 'community-forest' && !smallCommunityForest(licenceHa.get(file) ?? Infinity)) continue
    out.push({
      kind,
      id: `ml-${text(p.OBJECTID ?? f.id)}`,
      name: `${file} ${text(p.ML_TYPE_CODE).replace('_', ' ').toLowerCase()}`.trim(),
      geometry: f.geometry as Polygon | MultiPolygon,
    })
  }
  const keptCommunityForests = communityFiles
    .filter((file) => !smallCommunityForest(licenceHa.get(file) ?? Infinity))
    .map((file) => ({ file, areaHa: licenceHa.get(file) ?? 0 }))
  return { excluded: out, keptCommunityForests }
}

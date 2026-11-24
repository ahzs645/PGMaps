/**
 * The ground the order does not apply to, left out of the CFLB proxy: land that is not provincial
 * Crown, and the three area-based tenures the order excludes (woodlot licences, tree farm licences,
 * community forest agreements). The order applies to Crown land in the TSA and names those three
 * tenures (order p. 2); the policy's CFLB is provincial Crown forest land and leaves out private,
 * federal and municipal land (policy p. 1). docs/forestry-old-forest.md, **Method**, lists what each
 * read keeps and why.
 *
 * - **Not provincial Crown**, from FAIB's ownership layer `WHSE_FOREST_VEGETATION.F_OWN` by its
 *   `OWN` code: 40–49 private and treaty settlement land, 50–59 federal land and First Nation
 *   reserves, 80–89 municipal land and local or regional parks. Every other code (60–69 provincial
 *   designations, 70–79 tenures, 91 unknown, 99 Crown leases) is provincial Crown or read from a
 *   tenure layer below.
 * - **Woodlots and community forests**, from `WHSE_FOREST_TENURE.FTEN_MANAGED_LICENCE_POLY_SVW`,
 *   active records only, told apart by the file's letter: W a woodlot licence, K a community forest
 *   agreement. N, a First Nations woodland licence, is kept: the order does not name it (the tenure
 *   was created in 2011, after the order).
 * - **Tree farm licences**, from `WHSE_ADMIN_BOUNDARIES.FADM_TFL_ALL_SP`, the licences' current
 *   boundaries.
 *
 * DOM- and network-free: `fetch` is passed in. Each read follows the unit's own shapes, as the other
 * reads do.
 */
import type { MultiPolygon, Polygon } from 'geojson'
import type { Shape } from '../plan'
import { OLD_FOREST_EXCLUDED_KINDS } from '../records'
import { readAcrossParts, wfsPages, type Fetch, type RawFeature } from '../wfsReads'

export const OWNERSHIP_LAYER = 'pub:WHSE_FOREST_VEGETATION.F_OWN'
export const MANAGED_LICENCE_LAYER = 'pub:WHSE_FOREST_TENURE.FTEN_MANAGED_LICENCE_POLY_SVW'
export const TFL_LAYER = 'pub:WHSE_ADMIN_BOUNDARIES.FADM_TFL_ALL_SP'

/** In the order of priority a piece of ground is reported under when two sources cover it. */
export const EXCLUDED_KINDS = OLD_FOREST_EXCLUDED_KINDS
export type ExcludedKind = (typeof EXCLUDED_KINDS)[number]

export const EXCLUDED_LABELS: Record<ExcludedKind, string> = {
  'non-crown': 'Private and other land that is not provincial Crown',
  tfl: 'Tree farm licences',
  woodlot: 'Woodlot licences',
  'community-forest': 'Community forest agreements',
}

/** Ground the order does not apply to. */
export interface ExcludedArea {
  kind: ExcludedKind
  id: string
  name: string
  geometry: Polygon | MultiPolygon
}

/** `F_OWN`'s `OWN` codes that are not provincial Crown: private, treaty, federal and municipal land. */
export const NON_CROWN_FILTER = '((OWN >= 40 AND OWN < 60) OR (OWN >= 80 AND OWN < 90))'

/** True when an `F_OWN` code is land that is not provincial Crown. */
export function nonCrownOwnership(own: number): boolean {
  return (own >= 40 && own < 60) || (own >= 80 && own < 90)
}

/** What an FTEN managed licence is, by its file's letter; null for one the order does not exclude. */
export function managedLicenceKind(forestFileId: string): 'woodlot' | 'community-forest' | null {
  const letter = forestFileId.trim().charAt(0).toUpperCase()
  return letter === 'W' ? 'woodlot' : letter === 'K' ? 'community-forest' : null
}

const polygonal = (f: RawFeature) => f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon'
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v))

export async function readExcludedAreas({
  unit,
  fetch,
  signal,
}: {
  unit: Shape
  fetch: Fetch
  signal?: AbortSignal
}): Promise<ExcludedArea[]> {
  const read = (
    layer: string,
    geometryField: string,
    extra: string,
    key: string,
    propertyName?: string,
    byHull = false,
  ) =>
    readAcrossParts(
      unit,
      (filter) =>
        wfsPages({
          fetch,
          signal,
          layer,
          filter: `${filter} AND ${extra}`,
          propertyName: propertyName ? `${propertyName},${geometryField}` : undefined,
          sortBy: 'OBJECTID',
          cap: 20_000,
        }),
      geometryField,
      (f) => String(f.properties[key] ?? f.id),
      byHull,
    )
  const ownership = await read(
    OWNERSHIP_LAYER,
    'GEOMETRY',
    NON_CROWN_FILTER,
    'OBJECTID',
    'OBJECTID,OWN,OWNERSHIP_DESCRIPTION',
  )
  const licences = await read(
    MANAGED_LICENCE_LAYER,
    'GEOMETRY',
    "LIFE_CYCLE_STATUS_CODE = 'ACTIVE' AND (FOREST_FILE_ID LIKE 'W%' OR FOREST_FILE_ID LIKE 'K%')",
    'OBJECTID',
    'OBJECTID,FOREST_FILE_ID,ML_TYPE_CODE,CLIENT_NAME',
  )
  // A TFL is one very detailed polygon: asked by each part's hull (see `readAcrossParts`).
  const tfls = await read(TFL_LAYER, 'SHAPE', "FOREST_FILE_ID LIKE 'TFL%'", 'OBJECTID', 'OBJECTID,FOREST_FILE_ID', true)
  const out: ExcludedArea[] = []
  for (const f of ownership) {
    // The filter already asks for these codes; checked again so a changed service cannot widen it.
    if (!polygonal(f) || !nonCrownOwnership(Number(f.properties.OWN))) continue
    out.push({
      kind: 'non-crown',
      id: `own-${text(f.properties.OBJECTID ?? f.id)}`,
      name: text(f.properties.OWNERSHIP_DESCRIPTION) || `Ownership ${text(f.properties.OWN)}`,
      geometry: f.geometry as Polygon | MultiPolygon,
    })
  }
  for (const f of licences) {
    const kind = managedLicenceKind(text(f.properties.FOREST_FILE_ID))
    if (!polygonal(f) || !kind) continue
    out.push({
      kind,
      id: `ml-${text(f.properties.OBJECTID ?? f.id)}`,
      name: `${text(f.properties.FOREST_FILE_ID)} ${text(f.properties.ML_TYPE_CODE).replace('_', ' ').toLowerCase()}`.trim(),
      geometry: f.geometry as Polygon | MultiPolygon,
    })
  }
  for (const f of tfls) {
    if (!polygonal(f)) continue
    out.push({
      kind: 'tfl',
      id: `tfl-${text(f.properties.OBJECTID ?? f.id)}`,
      name: text(f.properties.FOREST_FILE_ID),
      geometry: f.geometry as Polygon | MultiPolygon,
    })
  }
  return out
}

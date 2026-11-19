/**
 * A layer the reviewer holds and PGMaps cannot read (a RAAD site export, the BC Fisher Habitat
 * Working Group's retention layer, an ESI moose layer, a BCTS export), measured against the block
 * by the row's own rule, so a row that is not public still reads Y, Within or N from data rather
 * than from memory. The file is read once; only its answer is kept, as the reviewer's entry with
 * the file and field it came from. One file fills every row that names one of its fields
 * (`importField`): the fisher layer fills all eleven fisher rows.
 *
 * Features arrive as GeoJSON in longitude and latitude (shpjs reprojects a shapefile through its
 * `.prj`). No DOM or network access.
 */
import { albers, planarFromGeoJson, type PreparedSubject } from './geometry'
import { measureRow, type ReadFeature } from './query'
import { quotedList, type RouteCardEntry } from './results'
import type { RouteCardRow } from './rows'

/**
 * GeoJSON features (a collection, a list, a feature or a geometry) as features in BC Albers metres: from longitude and
 * latitude (`lnglat`, as shpjs and GeoJSON give them) or already in BC Albers (`albers`, as gdal3.js reads a
 * geodatabase for the route card).
 */
export function importedFeatures(input: unknown, coordinates: 'lnglat' | 'albers' = 'lnglat'): ReadFeature[] {
  const project =
    coordinates === 'albers'
      ? (position: [number, number]): [number, number] => [position[0], position[1]]
      : ([lng, lat]: [number, number]) => albers(lng, lat)
  const out: ReadFeature[] = []
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit)
    if (!node || typeof node !== 'object') return
    const value = node as { type?: string; features?: unknown; geometry?: GeoJSON.Geometry; properties?: unknown }
    if (value.type === 'FeatureCollection') return visit(value.features)
    const geometry = value.type === 'Feature' ? value.geometry : (value as GeoJSON.Geometry)
    const shape = planarFromGeoJson(geometry, project)
    if (!shape) return
    const props =
      value.type === 'Feature' && value.properties && typeof value.properties === 'object' ? value.properties : {}
    out.push({ props: props as Record<string, unknown>, shape })
  }
  visit(input)
  return out
}

/** Every attribute the features carry, in the order first seen. */
export function importedFields(features: readonly ReadFeature[]): string[] {
  const fields: string[] = []
  for (const feature of features)
    for (const key of Object.keys(feature.props)) if (!fields.includes(key)) fields.push(key)
  return fields
}

/** The rows a file can fill by itself: those whose `importField` the file carries. */
export function rowsFilledByFields(rows: readonly RouteCardRow[], fields: readonly string[]): RouteCardRow[] {
  const lower = new Set(fields.map((field) => field.toLowerCase()))
  return rows.filter(
    (row) =>
      row.source.kind === 'notPublic' && row.source.importField && lower.has(row.source.importField.toLowerCase()),
  )
}

/** The file's own spelling of a field, matched without regard to case. */
const fileField = (fields: readonly string[], wanted: string) =>
  fields.find((field) => field.toLowerCase() === wanted.toLowerCase()) ?? wanted

/**
 * One row measured against the imported features by the row's search, printing `field`. The
 * answer becomes the reviewer's entry, marked with the file and field it came from.
 */
export function entryFromImport(
  row: RouteCardRow,
  subject: PreparedSubject,
  features: readonly ReadFeature[],
  field: string,
  file: string,
  readOn: string,
  /** Fields the file stores as real numbers: printed as the tool prints them, a whole number with ".0". */
  realFields: ReadonlySet<string> = new Set(),
): RouteCardEntry {
  const name = fileField(importedFields(features), field)
  const real = [...realFields].some((entry) => entry.toLowerCase() === name.toLowerCase())
  if (real)
    features = features.map((feature) => {
      const value = feature.props[name]
      return typeof value === 'number' && Number.isInteger(value)
        ? { ...feature, props: { ...feature.props, [name]: value.toFixed(1) } }
        : feature
    })
  const asRead: RouteCardRow = {
    ...row,
    source: { kind: 'wfs', typeName: 'IMPORTED.FILE', geometryField: 'GEOMETRY', fields: [name] },
    print: [name],
  }
  const finding = measureRow(asRead, subject, features)
  return {
    answer: finding.answer,
    names: finding.answer === 'yes' ? quotedList(finding.names) : '',
    source: `${file}, field ${name}, ${readOn}`,
  }
}

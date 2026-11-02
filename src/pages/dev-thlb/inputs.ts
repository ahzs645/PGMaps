import { bboxOf, toMultiPolygon } from '../dev-avast/geometry'
import { guessField } from '../dev-avast/inputs'
import { areaHa, union } from './geometry'
import type { Fields, InputRole, PolygonInput } from './types'

export const EMPTY_FIELDS: Fields = { id: '', factor: '', year: '', age: '', name: '' }
export function guessFields(role: InputRole, fields: string[]): Fields {
  const guess = (names: string[]) => guessField(fields, names) ?? ''
  return {
    id: guess(['WHA_NUMBER', 'WHA_TAG', 'WHA_ID', 'AREA_ID', 'BLOCK_ID', 'ID', 'NAME']),
    factor: guess(role === 'proxy' ? ['pthlb_fact', 'thlb_fact', 'thlb_factor'] : ['thlb_fact', 'thlb_factor']),
    year: guess(['tsr_report_year', 'tsr_year', 'report_year']),
    age: guess(['PROJ_AGE_1', 'age']),
    name: guess(['TSA_NAME', 'TFL_NAME', 'ADMIN_NAME', 'NAME', 'TSA_NUMBER', 'TFL_NUMBER']),
  }
}

export function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === '') return null
  const number = typeof value === 'number' ? value : Number(String(value))
  return Number.isFinite(number) ? number : null
}

/** GDAL has already reprojected these polygons to EPSG:3005. No simplification. */
export function parsePolygons(
  collection: GeoJSON.FeatureCollection,
  role: InputRole,
  fields: Fields,
  source: string,
): PolygonInput[] {
  return collection.features.map((feature, index) => {
    const properties = feature.properties ?? {}
    const raw = toMultiPolygon(feature.geometry)
    if (!raw.length) throw new Error(`${source}, feature ${index + 1}: expected a polygon.`)
    const geometry = union([raw])
    if (areaHa(geometry) <= 0) throw new Error(`${source}, feature ${index + 1}: polygon has no area.`)
    const factor = finiteNumber(properties[fields.factor])
    const rawFactor = properties[fields.factor]
    if (
      (role === 'official' || role === 'proxy') &&
      ((factor !== null && (factor < 0 || factor > 1)) ||
        (factor === null && rawFactor !== null && rawFactor !== undefined && String(rawFactor).trim() !== ''))
    ) {
      throw new Error(`${source}, feature ${index + 1}: ${fields.factor} must be a fraction from 0 to 1.`)
    }
    const id = String(properties[fields.id] ?? '').trim()
    if (role === 'areas' && !id) throw new Error(`${source}, feature ${index + 1}: choose a non-empty area ID field.`)
    const age = finiteNumber(properties[fields.age])
    return {
      key: `${source}:${feature.id ?? index}`,
      id,
      geometry,
      bbox: bboxOf(geometry),
      // The public Proxy THLB catalogue explicitly defines null as zero.
      factor: role === 'proxy' && factor === null ? 0 : factor,
      year: finiteNumber(properties[fields.year]),
      age: age !== null && age >= 0 ? age : null,
      name: String(properties[fields.name] ?? '').trim(),
      source,
    }
  })
}

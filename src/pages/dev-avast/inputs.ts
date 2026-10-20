/**
 * Candidate and density layers from GeoJSON that GDAL has already reprojected
 * to BC Albers, plus the field guesses the input step starts from. Pure: no
 * DOM or network access.
 */
import { bboxOf, multiPolygonArea, normalise, squareMetresToHa, toMultiPolygon } from './geometry'
import type { Candidate, DensityFeature } from './types'

export type CandidateFields = {
  idField: string
  operatingAreaField: string | null
  areaField: string | null
  sourceTypeField: string | null
}

export type DensityFields = {
  densityField: string
  slopeField: string | null
  operatingAreaField: string | null
}

const ID_GUESSES = ['Candidate_ID', 'CANDIDATE_ID', 'BLOCK_ID', 'Block_ID', 'BlockID', 'CUT_BLOCK_ID', 'CUTBLOCK_ID', 'Blob_ID', 'BLOB_ID', 'BLOCK', 'Block', 'NAME', 'Name']
const OPERATING_AREA_GUESSES = ['Operating_Area', 'OPERATING_AREA', 'OPERATING_', 'OPER_AREA', 'BCTS_OPER', 'OA', 'OpArea']
const AREA_GUESSES = ['Gross_HA', 'GROSS_HA', 'MERCH_AREA', 'Merch_Area', 'MERCH_HA', 'NET_AREA', 'AREA_HA', 'Area_ha', 'HECTARES']
const SOURCE_TYPE_GUESSES = ['Source_Type', 'SOURCE_TYPE', 'SourceType']
const DENSITY_GUESSES = ['CMM_m3ha', 'CMM_M3HA', 'VOL_M3HA', 'Vol_m3ha', 'LiDAR_m3ha', 'VOLUME_M3HA', 'M3HA', 'm3ha']
const SLOPE_GUESSES = ['Avg_Slope', 'AVG_SLOPE', 'SLOPE_PCT', 'Slope_Pct', 'MEAN_SLOPE']

/** The first guess present in `fields`, matched exactly and then case-insensitively. */
export function guessField(fields: string[], guesses: string[]): string | null {
  for (const guess of guesses) if (fields.includes(guess)) return guess
  const lower = new Map(fields.map((field) => [field.toLowerCase(), field]))
  for (const guess of guesses) {
    const hit = lower.get(guess.toLowerCase())
    if (hit) return hit
  }
  return null
}

export function guessCandidateFields(fields: string[]): CandidateFields {
  return {
    // Never fall back to a geometry or row-number column (Shape_Leng, OBJECTID, FID_*): they are unique but mean nothing.
    idField: guessField(fields, ID_GUESSES) ?? fields.find((field) => !/^(shape|objectid|fid)/i.test(field)) ?? fields[0] ?? '',
    operatingAreaField: guessField(fields, OPERATING_AREA_GUESSES),
    areaField: guessField(fields, AREA_GUESSES),
    sourceTypeField: guessField(fields, SOURCE_TYPE_GUESSES),
  }
}

export function guessDensityFields(fields: string[]): DensityFields {
  return {
    densityField: guessField(fields, DENSITY_GUESSES) ?? '',
    slopeField: guessField(fields, SLOPE_GUESSES),
    operatingAreaField: guessField(fields, ['OPERATING_AREA', 'Operating_Area', 'OPERATING_']),
  }
}

const asText = (value: unknown) => (value === null || value === undefined ? '' : String(value).trim())

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''))
  return Number.isFinite(number) ? number : null
}

export function candidatesFromGeoJson(
  collection: GeoJSON.FeatureCollection,
  fields: CandidateFields,
  sourceName: string,
  keyPrefix: string,
): { candidates: Candidate[]; skipped: number } {
  const candidates: Candidate[] = []
  let skipped = 0
  collection.features.forEach((feature, index) => {
    // Self-union repairs bowties and ring order the way Repair Geometry would,
    // so the intersect sees the polygon ArcGIS would.
    const geometry = normalise(toMultiPolygon(feature.geometry))
    if (!geometry.length) {
      skipped += 1
      return
    }
    const properties = feature.properties ?? {}
    const fieldHa = fields.areaField ? asNumber(properties[fields.areaField]) : null
    candidates.push({
      key: `${keyPrefix}:${feature.id ?? index}`,
      id: asText(properties[fields.idField]),
      operatingArea: fields.operatingAreaField ? asText(properties[fields.operatingAreaField]) : '',
      sourceType: fields.sourceTypeField ? asText(properties[fields.sourceTypeField]) : '',
      fieldHa: fieldHa !== null && fieldHa > 0 ? fieldHa : null,
      geometryHa: squareMetresToHa(multiPolygonArea(geometry)),
      geometry,
      bbox: bboxOf(geometry),
      sourceName,
    })
  })
  return { candidates, skipped }
}

export function densityFeaturesFromGeoJson(
  collection: GeoJSON.FeatureCollection,
  fields: DensityFields,
  layerIndex: number,
): { features: DensityFeature[]; nullDensityCount: number } {
  const features: DensityFeature[] = []
  let nullDensityCount = 0
  collection.features.forEach((feature, index) => {
    const geometry = toMultiPolygon(feature.geometry)
    if (!geometry.length) return
    const properties = feature.properties ?? {}
    const density = asNumber(properties[fields.densityField])
    if (density === null) nullDensityCount += 1
    features.push({
      fid: typeof feature.id === 'number' ? feature.id : Number(feature.id ?? index),
      density,
      slopePercent: fields.slopeField ? asNumber(properties[fields.slopeField]) : null,
      operatingArea: fields.operatingAreaField ? asText(properties[fields.operatingAreaField]) : '',
      layerIndex,
      geometry,
      bbox: bboxOf(geometry),
    })
  })
  return { features, nullDensityCount }
}

/** "Dunkley" from "Dunkley_PG.shp" and "Dunkley_Tsn.shp": the shared leading word of the inputs. */
export function guessProjectName(names: string[]): string {
  const stems = names.map((name) => name.replace(/\.[^.]+$/, '').split(/[_\s-]+/)[0]).filter(Boolean)
  return stems[0] ?? 'Project'
}

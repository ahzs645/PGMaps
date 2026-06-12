import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { point } from '@turf/helpers'
import type { StudyAreaRegion } from '@/lib/studyArea'

export type RecipeValueType = string | number | boolean | null

export type MetricRecipeSource =
  | 'healthyplanPg.businessPois'
  | 'healthyplanPg.educationFacilities'
  | 'healthyplanPg.businessLicencesBcGeocoded'
  | 'restaurants'
  | 'census'
  | 'custom'
  /** A dataset uploaded by the user, stored locally in IndexedDB (`user.<datasetId>`). */
  | `user.${string}`

export type MetricRecipeOperation =
  | 'pointCountInPolygon'
  | 'pointDensityInPolygon'
  | 'countWithinCentroidRadius'
  | 'accessWithinCentroidRadius'
  | 'averagePropertyInPolygon'
  | 'censusVariable'
  | 'derivedExpression'

export type MetricRecipeDirection = 'higherIsBetter' | 'higherIsWorse'
export type MetricRecipeFormat = 'count' | 'density' | 'ratio' | 'percent' | 'index'
export type MetricRecipeProxyLevel = 'official' | 'proxy' | 'experimental'
export type MetricRecipeFilterOperator = 'equals' | 'notEquals' | 'in' | 'notIn' | 'exists'
export type CensusMetricOutput = 'count' | 'percent'
export type CensusMetricLevel = 'cd' | 'csd' | 'ct' | 'da' | 'db'

export interface MetricRecipeFilter {
  field: string
  operator: MetricRecipeFilterOperator
  value?: RecipeValueType | RecipeValueType[]
}

export interface MetricRecipe {
  id: string
  label: string
  description?: string
  source: MetricRecipeSource
  operation: MetricRecipeOperation
  filters?: MetricRecipeFilter[]
  radiusMeters?: number
  propertyField?: string
  expression?: string
  direction: MetricRecipeDirection
  format: MetricRecipeFormat
  proxyLevel: MetricRecipeProxyLevel
  sourcePath?: string
  caveats?: string[]
  censusNumerator?: CensusVariableRef
  censusDenominator?: CensusVariableRef
}

export interface CensusVariableRef {
  category: string
  vector: string
  label?: string
}

export interface CensusMetricRecipe {
  id: string
  label: string
  description?: string
  output: CensusMetricOutput
  level: CensusMetricLevel
  numerator: CensusVariableRef[]
  denominator?: CensusVariableRef[]
  direction: MetricRecipeDirection
  format: 'count' | 'percent'
  proxyLevel: MetricRecipeProxyLevel
  caveats?: string[]
}

export interface RecipePointRecord {
  id?: string
  longitude: number
  latitude: number
  properties: Record<string, unknown>
}

export interface ComputedMetricValue {
  regionId: string
  value: number
  matchedFeatureCount: number
}

export interface MetricRecipeValidationResult {
  ok: boolean
  warnings: string[]
  errors: string[]
}

const OPERATION_LABELS: Record<MetricRecipeOperation, string> = {
  pointCountInPolygon: 'count points inside each boundary',
  pointDensityInPolygon: 'count points inside each boundary per km²',
  countWithinCentroidRadius: 'count points within a centroid buffer',
  accessWithinCentroidRadius: 'return 1 when at least one point is within a centroid buffer',
  averagePropertyInPolygon: 'average a point property inside each boundary',
  censusVariable: 'calculate a census variable count or percentage',
  derivedExpression: 'calculate from existing metrics',
}

export const HEALTHYPLAN_PG_STARTER_RECIPES: MetricRecipe[] = [
  {
    id: 'healthyFoodOutletAccess1km',
    label: 'Healthy food outlets within 1 km',
    description: 'Counts OSM/CityPG food outlets classified as healthy-food candidates within 1 km of each boundary centroid.',
    source: 'healthyplanPg.businessPois',
    sourcePath: '/data/healthyplan-pg/business_pois.geojson',
    operation: 'countWithinCentroidRadius',
    radiusMeters: 1000,
    filters: [{ field: 'healthyFoodOutlet', operator: 'equals', value: true }],
    direction: 'higherIsBetter',
    format: 'count',
    proxyLevel: 'experimental',
    caveats: ['OSM/CityPG classification requires QA; current healthy-food outlet count is small.'],
  },
  {
    id: 'retailServiceAccess1km',
    label: 'Retail/services within 1 km',
    description: 'Counts retail/service POIs within 1 km of each boundary centroid.',
    source: 'healthyplanPg.businessPois',
    sourcePath: '/data/healthyplan-pg/business_pois.geojson',
    operation: 'countWithinCentroidRadius',
    radiusMeters: 1000,
    filters: [{ field: 'retailService', operator: 'equals', value: true }],
    direction: 'higherIsBetter',
    format: 'count',
    proxyLevel: 'experimental',
    caveats: ['OSM completeness varies by neighbourhood.'],
  },
  {
    id: 'educationFacilityAccess1km',
    label: 'Education facilities within 1 km',
    description: 'Counts K-12, childcare, and post-secondary facilities within 1 km of each boundary centroid.',
    source: 'healthyplanPg.educationFacilities',
    sourcePath: '/data/healthyplan-pg/education_facilities.geojson',
    operation: 'countWithinCentroidRadius',
    radiusMeters: 1000,
    filters: [{ field: 'category', operator: 'in', value: ['school_k12', 'child_care', 'post_secondary'] }],
    direction: 'higherIsBetter',
    format: 'count',
    proxyLevel: 'official',
  },
  {
    id: 'geocodedBusinessDensity',
    label: 'Geocoded business density',
    description: 'Counts CityPG business licence records geocoded by BC Address Geocoder per km².',
    source: 'healthyplanPg.businessLicencesBcGeocoded',
    sourcePath: '/data/healthyplan-pg/business_licences_bc_geocoded.geojson',
    operation: 'pointDensityInPolygon',
    filters: [{ field: 'locationConfidence', operator: 'in', value: ['high', 'medium'] }],
    direction: 'higherIsBetter',
    format: 'density',
    proxyLevel: 'experimental',
    caveats: ['Address-geocoded points may place multiple businesses at the same building address.'],
  },
  {
    id: 'canopy_gap',
    label: 'Canopy gap',
    description: 'Transforms the existing canopy proxy into an inverse gap metric.',
    source: 'custom',
    operation: 'derivedExpression',
    expression: '1 - canopyProxyRatio',
    direction: 'higherIsWorse',
    format: 'ratio',
    proxyLevel: 'proxy',
    caveats: ['Canopy proxy is derived from local trees and forest/open-space inputs, not remote-sensing canopy.'],
  },
  {
    id: 'shade_vulnerability',
    label: 'Shade vulnerability',
    description: 'Combines shade gap and CIMD composite vulnerability into one interaction term.',
    source: 'custom',
    operation: 'derivedExpression',
    expression: 'shadeGap * cimdComposite',
    direction: 'higherIsWorse',
    format: 'index',
    proxyLevel: 'experimental',
    caveats: ['CIMD is an area-level deprivation index, not a direct population count.'],
  },
]

export function validateMetricRecipe(recipe: MetricRecipe): MetricRecipeValidationResult {
  const warnings: string[] = []
  const errors: string[] = []

  if (!recipe.id.trim()) errors.push('Metric recipe needs an id.')
  if (!recipe.label.trim()) errors.push('Metric recipe needs a label.')
  if (!recipe.direction) errors.push('Metric recipe needs a direction.')
  if (!recipe.operation) errors.push('Metric recipe needs an operation.')

  if (
    (recipe.operation === 'countWithinCentroidRadius' || recipe.operation === 'accessWithinCentroidRadius') &&
    (!Number.isFinite(recipe.radiusMeters) || (recipe.radiusMeters ?? 0) <= 0)
  ) {
    errors.push('Centroid-radius operations need a positive radiusMeters value.')
  }

  if (recipe.operation === 'averagePropertyInPolygon' && !recipe.propertyField) {
    errors.push('Average-property operations need a propertyField.')
  }

  if (recipe.operation === 'censusVariable' && !recipe.censusNumerator) {
    errors.push('Census-variable operations need a numerator variable.')
  }

  if (recipe.operation === 'derivedExpression' && !recipe.expression?.trim()) {
    errors.push('Derived-expression recipes need an expression.')
  }

  if (recipe.proxyLevel === 'experimental') {
    warnings.push('Experimental metrics should include a caveat and be reviewed before policy use.')
  }

  if (recipe.source.includes('business') && !recipe.filters?.length) {
    warnings.push('Business/POI recipes should usually filter categories to avoid mixing unrelated services.')
  }

  return { ok: errors.length === 0, warnings, errors }
}

export function validateCensusMetricRecipe(recipe: CensusMetricRecipe): MetricRecipeValidationResult {
  const warnings: string[] = []
  const errors: string[] = []

  if (!recipe.id.trim()) errors.push('Census metric recipe needs an id.')
  if (!recipe.label.trim()) errors.push('Census metric recipe needs a label.')
  if (!recipe.numerator.length) errors.push('Census metric recipe needs at least one numerator variable.')
  if (recipe.output === 'percent' && !recipe.denominator?.length) {
    errors.push('Percent census metrics need at least one denominator variable.')
  }
  if (recipe.denominator?.length && recipe.numerator.some((ref) => !sameCensusLevel(ref, recipe.denominator?.[0]))) {
    warnings.push('Numerator and denominator variables should be reviewed to confirm they share the same universe.')
  }
  if (recipe.level === 'db') {
    warnings.push('DB-level demographic metrics may require DA-to-DB downscaling and should disclose that assumption.')
  }
  warnings.push('Statistics Canada random rounding/suppression can affect small-area counts and percentages.')

  return { ok: errors.length === 0, warnings, errors }
}

export function censusFormulaPreview(recipe: CensusMetricRecipe): string {
  const numerator = recipe.numerator.map(formatCensusRef).join(' + ')
  if (recipe.output === 'count') return `${recipe.id} = ${numerator}`
  const denominator = recipe.denominator?.map(formatCensusRef).join(' + ') || 'denominator'
  return `${recipe.id} = (${numerator}) / (${denominator})`
}

export function recipeFormulaPreview(recipe: MetricRecipe): string {
  const filters = recipe.filters?.length ? ` where ${recipe.filters.map(formatFilter).join(' and ')}` : ''
  if (recipe.operation === 'derivedExpression') {
    return `${recipe.id} = ${recipe.expression ?? 'expression'}`
  }
  if (recipe.operation === 'censusVariable') {
    const numerator = recipe.censusNumerator ? formatCensusRef(recipe.censusNumerator) : 'census numerator'
    const denominator = recipe.censusDenominator ? ` / ${formatCensusRef(recipe.censusDenominator)}` : ''
    return `${recipe.id} = ${numerator}${denominator}`
  }
  if (recipe.operation === 'pointCountInPolygon') {
    return `${recipe.id} = count(${recipe.source}${filters} inside boundary)`
  }
  if (recipe.operation === 'pointDensityInPolygon') {
    return `${recipe.id} = count(${recipe.source}${filters} inside boundary) / area_km2`
  }
  if (recipe.operation === 'countWithinCentroidRadius') {
    return `${recipe.id} = count(${recipe.source}${filters} within ${recipe.radiusMeters ?? '?'}m of boundary centroid)`
  }
  if (recipe.operation === 'accessWithinCentroidRadius') {
    return `${recipe.id} = count(${recipe.source}${filters} within ${recipe.radiusMeters ?? '?'}m of boundary centroid) > 0 ? 1 : 0`
  }
  return `${recipe.id} = average(${recipe.propertyField ?? 'property'} from ${recipe.source}${filters} inside boundary)`
}

export function recipeOperationDescription(recipe: MetricRecipe): string {
  return OPERATION_LABELS[recipe.operation]
}

function formatFilter(filter: MetricRecipeFilter): string {
  if (filter.operator === 'exists') return `${filter.field} exists`
  if (Array.isArray(filter.value)) return `${filter.field} ${filter.operator} [${filter.value.join(', ')}]`
  return `${filter.field} ${filter.operator} ${String(filter.value)}`
}

function formatCensusRef(ref: CensusVariableRef): string {
  return ref.label ? `${ref.label} [${ref.vector}]` : `${ref.category}:${ref.vector}`
}

function sameCensusLevel(left: CensusVariableRef, right?: CensusVariableRef): boolean {
  if (!right) return true
  return left.category === right.category
}

export function pointRecordFromFeature(feature: GeoJSON.Feature): RecipePointRecord | null {
  if (feature.geometry?.type !== 'Point') return null
  const [longitude, latitude] = feature.geometry.coordinates
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null
  return {
    id: String(feature.id ?? feature.properties?.id ?? ''),
    longitude,
    latitude,
    properties: feature.properties ?? {},
  }
}

export function pointRecordsFromFeatureCollection(collection: GeoJSON.FeatureCollection): RecipePointRecord[] {
  return collection.features.map(pointRecordFromFeature).filter((record): record is RecipePointRecord => Boolean(record))
}

export function filterRecipePoints(records: RecipePointRecord[], filters: MetricRecipeFilter[] = []): RecipePointRecord[] {
  if (!filters.length) return records
  return records.filter((record) => filters.every((filter) => matchesFilter(record.properties, filter)))
}

export function computePointMetricRecipe(
  recipe: MetricRecipe,
  regions: StudyAreaRegion[],
  records: RecipePointRecord[],
): ComputedMetricValue[] {
  const validation = validateMetricRecipe(recipe)
  if (!validation.ok) {
    throw new Error(`Invalid metric recipe ${recipe.id}: ${validation.errors.join(' ')}`)
  }
  if (recipe.operation === 'derivedExpression' || recipe.operation === 'censusVariable') {
    throw new Error('Derived-expression recipes need existing metric rows and are not point operations.')
  }

  const filteredRecords = filterRecipePoints(records, recipe.filters)
  return regions.map((region) => {
    const matched = matchedRecordsForRegion(recipe, region, filteredRecords)
    let value = matched.length
    if (recipe.operation === 'pointDensityInPolygon') {
      value = region.areaKm2 > 0 ? matched.length / region.areaKm2 : 0
    } else if (recipe.operation === 'accessWithinCentroidRadius') {
      value = matched.length > 0 ? 1 : 0
    } else if (recipe.operation === 'averagePropertyInPolygon') {
      value = averageProperty(matched, recipe.propertyField)
    }
    return {
      regionId: region.id,
      value,
      matchedFeatureCount: matched.length,
    }
  })
}

export function computeDerivedExpressionMetric(recipe: MetricRecipe, values: Record<string, number>): number {
  const expression = recipe.expression?.trim()
  if (!expression) return 0
  if (!/^[\w\s.+\-*/()%]+$/.test(expression)) return 0
  const substituted = expression.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (token) => {
    const value = values[token]
    return Number.isFinite(value) ? String(value) : '0'
  })
  if (!/^[\d\s.+\-*/()%]+$/.test(substituted)) return 0
  try {
    const result = Function(`"use strict"; return (${substituted})`)()
    return Number.isFinite(result) ? Number(result) : 0
  } catch {
    return 0
  }
}

function matchesFilter(properties: Record<string, unknown>, filter: MetricRecipeFilter): boolean {
  const candidate = properties[filter.field] as RecipeValueType | undefined
  if (filter.operator === 'exists') return candidate != null && candidate !== ''
  if (filter.operator === 'equals') return candidate === filter.value
  if (filter.operator === 'notEquals') return candidate !== filter.value
  if (filter.operator === 'in') return Array.isArray(filter.value) && filter.value.includes(candidate ?? null)
  if (filter.operator === 'notIn') return Array.isArray(filter.value) && !filter.value.includes(candidate ?? null)
  return false
}

function matchedRecordsForRegion(
  recipe: MetricRecipe,
  region: StudyAreaRegion,
  records: RecipePointRecord[],
): RecipePointRecord[] {
  if (recipe.operation === 'countWithinCentroidRadius' || recipe.operation === 'accessWithinCentroidRadius') {
    const center = featureCentroid(region.feature)
    const radiusKm = (recipe.radiusMeters ?? 0) / 1000
    return records.filter((record) => distanceKm(center, [record.longitude, record.latitude]) <= radiusKm)
  }

  return records.filter((record) => booleanPointInPolygon(point([record.longitude, record.latitude]), region.feature))
}

function averageProperty(records: RecipePointRecord[], propertyField?: string): number {
  if (!propertyField) return 0
  const values = records
    .map((record) => Number(record.properties[propertyField]))
    .filter((value) => Number.isFinite(value))
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function featureCentroid(feature: StudyAreaRegion['feature']): [number, number] {
  const coordinates = feature.geometry.type === 'Polygon' ? feature.geometry.coordinates : feature.geometry.coordinates.flat()
  const ring = coordinates[0] ?? []
  if (!ring.length) return [0, 0]
  const sum = ring.reduce(
    (accumulator, coordinate) => [accumulator[0] + coordinate[0], accumulator[1] + coordinate[1]] as [number, number],
    [0, 0] as [number, number],
  )
  return [sum[0] / ring.length, sum[1] / ring.length]
}

function distanceKm(left: [number, number], right: [number, number]): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180
  const earthRadiusKm = 6371
  const deltaLat = toRadians(right[1] - left[1])
  const deltaLng = toRadians(right[0] - left[0])
  const leftLat = toRadians(left[1])
  const rightLat = toRadians(right[1])
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(leftLat) * Math.cos(rightLat) * Math.sin(deltaLng / 2) ** 2
  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

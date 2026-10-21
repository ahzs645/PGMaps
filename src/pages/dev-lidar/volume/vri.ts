import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson'
import { vegetationQueryUrl } from '../../dev-forestry/bcVegetationInventory'
import { inventoryDensity, pgAuditRatio, parseVriVolumeProperties, type VriVolumeRules } from '@/lib/forestry/vriVolume'

export const VRI_VOLUME_FIELDS = [
  'GEOMETRY',
  'FEATURE_ID',
  'BCLCS_LEVEL_2',
  'REFERENCE_YEAR',
  'INTERPRETATION_DATE',
  'PROJECTED_DATE',
  'BASAL_AREA',
  'VRI_LIVE_STEMS_PER_HA',
  'PROJ_HEIGHT_1',
  'PROJ_AGE_1',
  'CROWN_CLOSURE',
  'SPECIES_CD_1',
  'SPECIES_PCT_1',
  'LIVE_STAND_VOLUME_125',
  'LIVE_STAND_VOLUME_175',
  'LIVE_STAND_VOLUME_225',
  'DEAD_STAND_VOLUME_125',
  'DEAD_STAND_VOLUME_175',
  'DEAD_STAND_VOLUME_225',
  'EARLIEST_NONLOGGING_DIST_TYPE',
  'EARLIEST_NONLOGGING_DIST_DATE',
]
/** Reuse forestry's rank-1 WFS and longitude-first, bounded CQL query. */
export function vriVolumeQueryUrl(bounds: [number, number, number, number]) {
  const url = new URL(vegetationQueryUrl(bounds, { maxFeatures: 500 }))
  url.searchParams.set('propertyName', VRI_VOLUME_FIELDS.join(','))
  return url.href
}
export interface VriPieceProperties {
  id: string
  area_ha: number
  inventory: Record<string, unknown>
  lidar: { cells: number; canopy_percent: number | null; surface_p95_m: number | null }
}
export interface VriVolumeData {
  schema_version: number
  source_sha256: string
  height_sha256: string
  source: {
    publisher: string
    licence: string
    catalogue: string
    dictionary: string
    request_url: string
    retrieved_utc: string
    inventory_sha256: string
    matched: number
    projected_dates: string[]
    main_reference: string
  }
  centre: [number, number]
  bounds: [number, number, number, number]
  coverage: {
    supported_ha: number
    mapped_ha: number
    treed_ha: number
    non_treed_ha: number
    unmapped_ha: number
    overlap_ha: number
  }
  area_method: string
  limitations: string[]
  stands: FeatureCollection<Polygon | MultiPolygon, VriPieceProperties>
}
export function checkVriVolumeData(data: VriVolumeData, source?: string) {
  if (data.schema_version !== 1 || !data.stands.features.length || (source && data.source_sha256 !== source))
    throw Error('VRI volume source mismatch')
  const features = data.stands.features,
    ids = new Set(features.map((f) => f.properties.id))
  if (
    ids.size !== features.length ||
    features.some((f) => !Number.isFinite(f.properties.area_ha) || f.properties.area_ha <= 0)
  )
    throw Error('Invalid VRI pieces')
  const area = features.reduce((sum, f) => sum + f.properties.area_ha, 0)
  if (Math.abs(area - data.coverage.mapped_ha) > 1e-5 || data.coverage.overlap_ha > 1e-5)
    throw Error('VRI coverage does not reconcile')
  return data
}
export function vriRows(data: VriVolumeData, rules: VriVolumeRules) {
  return data.stands.features.map((feature) => {
    const p = parseVriVolumeProperties(feature.properties.inventory),
      result = inventoryDensity(p, rules)
    return {
      feature,
      inventory: p,
      result,
      volume_m3: result.density === null ? null : result.density * feature.properties.area_ha,
      audit_ratio: pgAuditRatio(p.speciesCode),
    }
  })
}
export function vriTotals(rows: ReturnType<typeof vriRows>, retention = 0, recovery = 100) {
  if ([retention, recovery].some((v) => !Number.isFinite(v) || v < 0 || v > 100))
    throw Error('Invalid harvest assumptions')
  let area = 0,
    volume = 0,
    missingArea = 0,
    partialArea = 0,
    audit = 0,
    auditMissingArea = 0
  for (const row of rows) {
    if (row.volume_m3 === null) {
      if (row.inventory.treed) missingArea += row.feature.properties.area_ha
      continue
    }
    area += row.feature.properties.area_ha
    volume += row.volume_m3
    if (!row.result.complete) partialArea += row.feature.properties.area_ha
    if (row.audit_ratio === null) auditMissingArea += row.feature.properties.area_ha
    else audit += row.volume_m3 * row.audit_ratio
  }
  return {
    area_ha: area,
    known_net_m3: area > 0 ? volume : null,
    mean_m3_ha: area > 0 ? volume / area : null,
    missing_treed_ha: missingArea,
    partial_dead_ha: partialArea,
    historical_audit_m3: area > 0 && auditMissingArea === 0 ? audit : null,
    scenario_recovered_m3: area > 0 ? (volume * (1 - retention / 100) * recovery) / 100 : null,
  }
}

import { useMemo } from 'react'
import { useFetchData } from '@/hooks/useFetchData'
import { geometryBounds, type BBox } from '@/lib/geo'
import type { CensusBounds, CensusHierarchyLevel, CensusUnit } from '../types'

interface RawGeoFeature {
  type: 'Feature'
  properties?: Record<string, unknown>
  geometry?: GeoJSON.Geometry | null
}

interface RawGeoResponse {
  type: 'FeatureCollection'
  features?: RawGeoFeature[]
}

const LEVEL_FILES: Record<CensusHierarchyLevel, string> = {
  cd: '/data/census/prince_george_cd.geo.json',
  csd: '/data/census/prince_george_csd.geo.json',
  ct: '/data/census/prince_george_ct.geo.json',
  da: '/data/census/prince_george_da.geo.json',
  db: '/data/census/prince_george_db.geo.json',
}

const EMPTY_UNITS: CensusUnit[] = []

function parseNumber(value: unknown): number | null {
  if (value == null) return null
  const cleaned = String(value).replace(/,/g, '').trim()
  if (!cleaned) return null
  const parsed = Number.parseFloat(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

function parseString(value: unknown): string | null {
  if (value == null) return null
  const text = String(value).trim()
  return text ? text : null
}

function readUnit(feature: RawGeoFeature, fallbackLevel: CensusHierarchyLevel): CensusUnit | null {
  const geometry = feature.geometry
  if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) {
    return null
  }

  const properties = feature.properties || {}
  const id = parseString(properties.id)
  if (!id) return null

  const levelRaw = parseString(properties.level)
  const level = (levelRaw || fallbackLevel) as CensusHierarchyLevel
  const daCount = parseNumber(properties.daCount)
  const dbCount = parseNumber(properties.dbCount)

  return {
    id,
    level,
    name: parseString(properties.name) || `${level.toUpperCase()} ${id}`,
    population: parseNumber(properties.population),
    populationDensity: parseNumber(properties.populationDensity),
    households: parseNumber(properties.households),
    dwellings: parseNumber(properties.dwellings),
    areaSqKm: parseNumber(properties.areaSqKm),
    daCount: Number.isFinite(daCount) ? Math.round(daCount || 0) : 0,
    dbCount: Number.isFinite(dbCount) ? Math.round(dbCount || 0) : 0,
    parentCdId: parseString(properties.parentCdId),
    parentCsdId: parseString(properties.parentCsdId),
    parentCtId: parseString(properties.parentCtId),
    parentDaId: parseString(properties.parentDaId),
    geometry,
  }
}

function computeBounds(units: CensusUnit[]): CensusBounds | null {
  let merged: BBox | null = null

  for (const unit of units) {
    const bounds = geometryBounds(unit.geometry)
    if (!bounds) continue
    merged = merged
      ? [
          Math.min(merged[0], bounds[0]),
          Math.min(merged[1], bounds[1]),
          Math.max(merged[2], bounds[2]),
          Math.max(merged[3], bounds[3]),
        ]
      : bounds
  }

  if (!merged) return null
  return { minLng: merged[0], minLat: merged[1], maxLng: merged[2], maxLat: merged[3] }
}

function getPrimaryBounds(boundsByLevel: Record<CensusHierarchyLevel, CensusBounds | null>): CensusBounds | null {
  return boundsByLevel.csd || boundsByLevel.da || boundsByLevel.ct || boundsByLevel.db || boundsByLevel.cd || null
}

export function readCensusLevel(json: RawGeoResponse, level: CensusHierarchyLevel) {
  const units = (json.features ?? [])
    .map((feature) => readUnit(feature, level))
    .filter((unit): unit is CensusUnit => unit !== null)
    .sort((a, b) => a.id.localeCompare(b.id))
  return { units, bounds: computeBounds(units) }
}

function useCensusLevel(level: CensusHierarchyLevel, enabled: boolean) {
  const { data, loading, error } = useFetchData<RawGeoResponse>(LEVEL_FILES[level], { enabled })
  const parsed = useMemo(
    () => (data ? readCensusLevel(data, level) : { units: EMPTY_UNITS, bounds: null }),
    [data, level],
  )
  return { ...parsed, loading, error }
}

/** Fetch and normalize only the levels needed by this consumer. */
export function useCensusData(levels: readonly CensusHierarchyLevel[], enabled = true) {
  // Fixed hook order; enabling a second level preserves the first level's data.
  const cd = useCensusLevel('cd', enabled && levels.includes('cd'))
  const csd = useCensusLevel('csd', enabled && levels.includes('csd'))
  const ct = useCensusLevel('ct', enabled && levels.includes('ct'))
  const da = useCensusLevel('da', enabled && levels.includes('da'))
  const db = useCensusLevel('db', enabled && levels.includes('db'))
  const unitsByLevel = useMemo(
    () => ({ cd: cd.units, csd: csd.units, ct: ct.units, da: da.units, db: db.units }),
    [cd.units, csd.units, ct.units, da.units, db.units],
  )
  const boundsByLevel = useMemo(
    () => ({ cd: cd.bounds, csd: csd.bounds, ct: ct.bounds, da: da.bounds, db: db.bounds }),
    [cd.bounds, csd.bounds, ct.bounds, da.bounds, db.bounds],
  )
  const bounds = getPrimaryBounds(boundsByLevel)
  const states = [cd, csd, ct, da, db]
  return {
    unitsByLevel,
    boundsByLevel,
    bounds,
    loading: states.some((state) => state.loading),
    error: states.find((state) => state.error)?.error ?? null,
  }
}

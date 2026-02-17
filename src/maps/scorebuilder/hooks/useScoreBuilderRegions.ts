import area from '@turf/area'
import bbox from '@turf/bbox'
import { useEffect, useState } from 'react'
import type {
  BoundaryIndex,
  BoundaryLevel,
  BoundaryRegionRecord,
  BoundarySource,
  CensusBoundaryLevel,
  RegionLevel
} from '@/maps/airquality'
import {
  BOUNDARY_CODE_PROPERTY_BY_LEVEL,
  BOUNDARY_FILE_BY_LEVEL,
  BOUNDARY_INDEX_KEY_BY_LEVEL,
  BOUNDARY_NAME_PROPERTY_BY_LEVEL
} from '../constants'
import type { ScoreBuilderRegion } from '../types'

type RawBoundaryFeature = GeoJSON.Feature<GeoJSON.Geometry | null, Record<string, unknown>>
type BoundaryFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, Record<string, unknown>>

interface BoundaryFeatureCollection {
  type: 'FeatureCollection'
  features: RawBoundaryFeature[]
}

const BOUNDARY_INDEX_PATH = '/data/boundaries/BCMoH/index.json'
const CENSUS_FILE_BY_LEVEL: Record<CensusBoundaryLevel, string> = {
  cd: '/data/census/prince_george_cd.geo.json',
  csd: '/data/census/prince_george_csd.geo.json',
  ct: '/data/census/prince_george_ct.geo.json',
  da: '/data/census/prince_george_da.geo.json'
}

const HEALTH_LEVEL_SET = new Set<BoundaryLevel>(['healthAuthority', 'hsda', 'lha', 'chsa'])
const CENSUS_LEVEL_SET = new Set<CensusBoundaryLevel>(['cd', 'csd', 'ct', 'da'])

let boundaryIndexCache: BoundaryIndex | null = null
const boundaryRegionCache = new Map<string, ScoreBuilderRegion[]>()

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${path}: ${response.status}`)
  }
  return response.json() as Promise<T>
}

function sortRegions(regions: ScoreBuilderRegion[]): ScoreBuilderRegion[] {
  return [...regions].sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code))
}

function mapRecordsByCode(records: BoundaryRegionRecord[]): Map<string, string> {
  const byCode = new Map<string, string>()
  records.forEach((record) => {
    byCode.set(String(record.code), record.name)
  })
  return byCode
}

function isHealthBoundaryLevel(level: RegionLevel): level is BoundaryLevel {
  return HEALTH_LEVEL_SET.has(level as BoundaryLevel)
}

function isCensusBoundaryLevel(level: RegionLevel): level is CensusBoundaryLevel {
  return CENSUS_LEVEL_SET.has(level as CensusBoundaryLevel)
}

function toPolygonFeature(feature: RawBoundaryFeature): BoundaryFeature | null {
  const geometry = feature.geometry
  if (!geometry) return null
  if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') {
    return null
  }

  return {
    type: 'Feature',
    id: feature.id,
    properties: feature.properties ?? {},
    geometry
  }
}

async function loadBoundaryIndex(): Promise<BoundaryIndex> {
  if (boundaryIndexCache) return boundaryIndexCache
  boundaryIndexCache = await fetchJson<BoundaryIndex>(BOUNDARY_INDEX_PATH)
  return boundaryIndexCache
}

async function loadHealthRegions(level: BoundaryLevel): Promise<ScoreBuilderRegion[]> {
  const cacheKey = `bcHealth:${level}`
  const cached = boundaryRegionCache.get(cacheKey)
  if (cached) return cached

  const [index, geometry] = await Promise.all([
    loadBoundaryIndex(),
    fetchJson<BoundaryFeatureCollection>(`/data/boundaries/BCMoH/${BOUNDARY_FILE_BY_LEVEL[level]}`)
  ])

  const records = index[BOUNDARY_INDEX_KEY_BY_LEVEL[level]] ?? []
  const nameByCode = mapRecordsByCode(records)
  const codeKey = BOUNDARY_CODE_PROPERTY_BY_LEVEL[level]
  const nameKey = BOUNDARY_NAME_PROPERTY_BY_LEVEL[level]

  const regions = geometry.features
    .map<ScoreBuilderRegion | null>((rawFeature) => {
      const feature = toPolygonFeature(rawFeature)
      if (!feature) return null

      const properties = (feature.properties ?? {}) as Record<string, unknown>
      const code = String(properties[codeKey] ?? '').trim()
      if (!code) return null

      const nameFromFeature = String(properties[nameKey] ?? '').trim()
      const displayName = nameByCode.get(code) || nameFromFeature || code

      const areaKm2 = area(feature) / 1_000_000
      const bounds = bbox(feature) as [number, number, number, number]

      return {
        id: `bcHealth:${level}:${code}`,
        code,
        name: displayName,
        source: 'bcHealth',
        level,
        feature,
        bounds,
        areaKm2: Number.isFinite(areaKm2) && areaKm2 > 0 ? areaKm2 : 0
      } satisfies ScoreBuilderRegion
    })
    .filter((region): region is ScoreBuilderRegion => region !== null)

  const sortedRegions = sortRegions(regions)
  boundaryRegionCache.set(cacheKey, sortedRegions)
  return sortedRegions
}

async function loadCensusRegions(level: CensusBoundaryLevel): Promise<ScoreBuilderRegion[]> {
  const cacheKey = `census:${level}`
  const cached = boundaryRegionCache.get(cacheKey)
  if (cached) return cached

  const geometry = await fetchJson<BoundaryFeatureCollection>(CENSUS_FILE_BY_LEVEL[level])

  const regions = geometry.features
    .map<ScoreBuilderRegion | null>((rawFeature) => {
      const feature = toPolygonFeature(rawFeature)
      if (!feature) return null

      const properties = (feature.properties ?? {}) as Record<string, unknown>
      const code = String(properties.id ?? properties.code ?? '').trim()
      if (!code) return null

      const displayName = String(properties.name ?? code).trim() || code
      const areaKm2 = area(feature) / 1_000_000
      const bounds = bbox(feature) as [number, number, number, number]

      return {
        id: `census:${level}:${code}`,
        code,
        name: displayName,
        source: 'census',
        level,
        feature,
        bounds,
        areaKm2: Number.isFinite(areaKm2) && areaKm2 > 0 ? areaKm2 : 0
      } satisfies ScoreBuilderRegion
    })
    .filter((region): region is ScoreBuilderRegion => region !== null)

  const sortedRegions = sortRegions(regions)
  boundaryRegionCache.set(cacheKey, sortedRegions)
  return sortedRegions
}

async function loadRegions(source: BoundarySource, level: RegionLevel): Promise<ScoreBuilderRegion[]> {
  if (source === 'bcHealth') {
    if (!isHealthBoundaryLevel(level)) {
      throw new Error(`Invalid health boundary level: ${level}`)
    }

    return loadHealthRegions(level)
  }

  if (!isCensusBoundaryLevel(level)) {
    throw new Error(`Invalid census boundary level: ${level}`)
  }

  return loadCensusRegions(level)
}

export function useScoreBuilderRegions(source: BoundarySource, level: RegionLevel) {
  const [regions, setRegions] = useState<ScoreBuilderRegion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      setLoading(true)
      setError(null)

      try {
        const next = await loadRegions(source, level)
        if (!controller.signal.aborted) {
          setRegions(next)
        }
      } catch (err) {
        if (controller.signal.aborted) return
        setError((err as Error).message || 'Unable to load boundary geometry')
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [source, level])

  return {
    regions,
    loading,
    error
  }
}

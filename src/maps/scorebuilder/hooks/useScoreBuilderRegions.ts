import area from '@turf/area'
import bbox from '@turf/bbox'
import { useEffect, useState } from 'react'
import type { BoundaryIndex, BoundaryLevel, BoundaryRegionRecord } from '@/maps/airquality'
import {
  BOUNDARY_CODE_PROPERTY_BY_LEVEL,
  BOUNDARY_FILE_BY_LEVEL,
  BOUNDARY_INDEX_KEY_BY_LEVEL,
  BOUNDARY_NAME_PROPERTY_BY_LEVEL
} from '../constants'
import type { ScoreBuilderRegion } from '../types'

type BoundaryFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>

interface BoundaryFeatureCollection {
  type: 'FeatureCollection'
  features: BoundaryFeature[]
}

const BOUNDARY_INDEX_PATH = '/data/boundaries/BCMoH/index.json'

let boundaryIndexCache: BoundaryIndex | null = null
const boundaryRegionCache = new Map<BoundaryLevel, ScoreBuilderRegion[]>()

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

async function loadBoundaryIndex(): Promise<BoundaryIndex> {
  if (boundaryIndexCache) return boundaryIndexCache
  boundaryIndexCache = await fetchJson<BoundaryIndex>(BOUNDARY_INDEX_PATH)
  return boundaryIndexCache
}

async function loadRegions(level: BoundaryLevel): Promise<ScoreBuilderRegion[]> {
  const cached = boundaryRegionCache.get(level)
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
    .map((feature) => {
      const properties = (feature.properties ?? {}) as Record<string, unknown>
      const code = String(properties[codeKey] ?? '').trim()
      if (!code) return null

      const displayName = nameByCode.get(code)
        ?? String(properties[nameKey] ?? '').trim()
        ?? code

      const areaKm2 = area(feature) / 1_000_000
      const bounds = bbox(feature) as [number, number, number, number]

      return {
        id: `${level}:${code}`,
        code,
        name: displayName || code,
        level,
        feature,
        bounds,
        areaKm2: Number.isFinite(areaKm2) && areaKm2 > 0 ? areaKm2 : 0
      } satisfies ScoreBuilderRegion
    })
    .filter((region): region is ScoreBuilderRegion => region !== null)

  const sortedRegions = sortRegions(regions)
  boundaryRegionCache.set(level, sortedRegions)
  return sortedRegions
}

export function useScoreBuilderRegions(level: BoundaryLevel) {
  const [regions, setRegions] = useState<ScoreBuilderRegion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      setLoading(true)
      setError(null)

      try {
        const next = await loadRegions(level)
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

    load()

    return () => {
      controller.abort()
    }
  }, [level])

  return {
    regions,
    loading,
    error
  }
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  BoundaryIndex,
  BoundaryLevel,
  BoundaryRegionRecord,
  SelectedBoundaryRegion
} from '../types'

type BoundaryFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>

const BOUNDARY_INDEX_PATH = '/data/boundaries/BCMoH/index.json'

const BOUNDARY_FILE_BY_LEVEL: Record<BoundaryLevel, string> = {
  healthAuthority: 'simplified/health_authorities.json',
  hsda: 'simplified/health_service_delivery_areas.json',
  lha: 'simplified/local_health_areas.json',
  chsa: 'simplified/community_health_service_areas.json'
}

const BOUNDARY_PROPERTY_BY_LEVEL: Record<BoundaryLevel, string> = {
  healthAuthority: 'HLTH_AUTHORITY_CODE',
  hsda: 'HLTH_SERVICE_DLVR_AREA_CODE',
  lha: 'LOCAL_HLTH_AREA_CODE',
  chsa: 'CMNTY_HLTH_SERV_AREA_CODE'
}

const BOUNDARY_INDEX_KEY_BY_LEVEL: Record<BoundaryLevel, keyof BoundaryIndex> = {
  healthAuthority: 'healthAuthorities',
  hsda: 'healthServiceDeliveryAreas',
  lha: 'localHealthAreas',
  chsa: 'communityHealthServiceAreas'
}

const BOUNDARY_LABEL_BY_LEVEL: Record<BoundaryLevel, string> = {
  healthAuthority: 'Health Authority',
  hsda: 'Health Service Delivery Area',
  lha: 'Local Health Area',
  chsa: 'Community Health Service Area'
}

let indexCache: BoundaryIndex | null = null
const geometryCache = new Map<string, BoundaryFeature>()

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${path}: ${response.status}`)
  }
  return response.json() as Promise<T>
}

async function loadBoundaryIndex(): Promise<BoundaryIndex> {
  if (indexCache) return indexCache
  indexCache = await fetchJson<BoundaryIndex>(BOUNDARY_INDEX_PATH)
  return indexCache
}

async function loadBoundaryFeature(level: BoundaryLevel, code: string): Promise<BoundaryFeature> {
  const cacheKey = `${level}:${code}`
  const cached = geometryCache.get(cacheKey)
  if (cached) return cached

  const filename = BOUNDARY_FILE_BY_LEVEL[level]
  const propertyName = BOUNDARY_PROPERTY_BY_LEVEL[level]

  const file = await fetchJson<GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>>(
    `/data/boundaries/BCMoH/${filename}`
  )

  const feature = file.features.find((item) => {
    const value = (item.properties as Record<string, unknown> | null)?.[propertyName]
    return String(value ?? '') === String(code)
  })

  if (!feature) {
    throw new Error(`Boundary not found for ${BOUNDARY_LABEL_BY_LEVEL[level]} ${code}`)
  }

  geometryCache.set(cacheKey, feature)
  return feature
}

function sortRegions(regions: BoundaryRegionRecord[]): BoundaryRegionRecord[] {
  return [...regions].sort((a, b) => a.name.localeCompare(b.name))
}

export function getBoundaryLevelLabel(level: BoundaryLevel): string {
  return BOUNDARY_LABEL_BY_LEVEL[level]
}

export function useBoundaryData() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [index, setIndex] = useState<BoundaryIndex | null>(null)
  const [selectedRegion, setSelectedRegion] = useState<SelectedBoundaryRegion | null>(null)
  const [selectedRegionFeature, setSelectedRegionFeature] = useState<BoundaryFeature | null>(null)

  const loadIndex = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await loadBoundaryIndex()
      setIndex(data)
    } catch (err) {
      setError((err as Error).message || 'Unable to load boundaries')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadIndex()
  }, [loadIndex])

  const clearSelection = useCallback(() => {
    setSelectedRegion(null)
    setSelectedRegionFeature(null)
  }, [])

  const selectRegion = useCallback(
    async (level: BoundaryLevel, code: string | null) => {
      if (!code) {
        clearSelection()
        return
      }

      const normalizedCode = String(code)
      setLoading(true)
      setError(null)
      try {
        const data = index ?? (await loadBoundaryIndex())
        if (!index) {
          setIndex(data)
        }

        const regions = data[BOUNDARY_INDEX_KEY_BY_LEVEL[level]] ?? []
        const selected = regions.find((region) => String(region.code) === normalizedCode)
        const feature = await loadBoundaryFeature(level, normalizedCode)

        setSelectedRegionFeature(feature)
        setSelectedRegion({
          source: 'bcHealth',
          level,
          code: normalizedCode,
          name: selected?.name ?? normalizedCode,
          levelLabel: BOUNDARY_LABEL_BY_LEVEL[level]
        })
      } catch (err) {
        setError((err as Error).message || 'Unable to load selected region')
      } finally {
        setLoading(false)
      }
    },
    [clearSelection, index]
  )

  const regionsByLevel = useMemo(() => {
    return {
      healthAuthority: sortRegions(index?.healthAuthorities ?? []),
      hsda: sortRegions(index?.healthServiceDeliveryAreas ?? []),
      lha: sortRegions(index?.localHealthAreas ?? []),
      chsa: sortRegions(index?.communityHealthServiceAreas ?? [])
    } satisfies Record<BoundaryLevel, BoundaryRegionRecord[]>
  }, [index])

  return {
    loading,
    error,
    index,
    regionsByLevel,
    selectedRegion,
    selectedRegionFeature,
    selectRegion,
    clearSelection,
    loadIndex
  }
}

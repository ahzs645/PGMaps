import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  BoundaryRegionRecord,
  CensusBoundaryLevel,
  SelectedBoundaryRegion
} from '../types'

type CensusBoundaryFeature = GeoJSON.Feature<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  BoundaryRegionRecord & {
    level?: string
    parentCdId?: string
    parentCsdId?: string
    parentCtId?: string
    parentDaId?: string
  }
>

const CENSUS_FILES: Record<CensusBoundaryLevel, string> = {
  cd: '/data/census/prince_george_cd.geo.json',
  csd: '/data/census/prince_george_csd.geo.json',
  ct: '/data/census/prince_george_ct.geo.json',
  da: '/data/census/prince_george_da.geo.json'
}

const LEVEL_LABELS: Record<CensusBoundaryLevel, string> = {
  cd: 'Census Division',
  csd: 'Census Subdivision',
  ct: 'Census Tract',
  da: 'Dissemination Area'
}

type LevelFeatureMap = Record<CensusBoundaryLevel, CensusBoundaryFeature[]>

const EMPTY_LEVEL_FEATURE_MAP: LevelFeatureMap = {
  cd: [],
  csd: [],
  ct: [],
  da: []
}

let levelFeatureCache: LevelFeatureMap | null = null
const featureByKeyCache = new Map<string, CensusBoundaryFeature>()

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${path}: ${response.status}`)
  }
  return response.json() as Promise<T>
}

async function loadLevelFeatures(level: CensusBoundaryLevel): Promise<CensusBoundaryFeature[]> {
  if (levelFeatureCache?.[level]?.length) return levelFeatureCache[level]

  const file = await fetchJson<GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>>(CENSUS_FILES[level])
  const features = file.features.map((feature) => {
    const props = (feature.properties ?? {}) as BoundaryRegionRecord
    const normalized: CensusBoundaryFeature = {
      type: 'Feature',
      geometry: feature.geometry,
      properties: {
        ...props,
        code: String(props.id ?? props.code ?? ''),
        id: String(props.id ?? props.code ?? ''),
        name: String(props.name ?? props.id ?? props.code ?? ''),
        level
      }
    }
    return normalized
  })

  if (!levelFeatureCache) {
    levelFeatureCache = {
      ...EMPTY_LEVEL_FEATURE_MAP
    }
  }
  levelFeatureCache[level] = features

  features.forEach((feature) => {
    const code = String(feature.properties.code)
    featureByKeyCache.set(`${level}:${code}`, feature)
  })

  return features
}

async function loadAllLevels(): Promise<LevelFeatureMap> {
  await Promise.all((Object.keys(CENSUS_FILES) as CensusBoundaryLevel[]).map((level) => loadLevelFeatures(level)))
  return levelFeatureCache ?? { ...EMPTY_LEVEL_FEATURE_MAP }
}

function sortRegions(regions: BoundaryRegionRecord[]): BoundaryRegionRecord[] {
  return [...regions].sort((a, b) => a.name.localeCompare(b.name))
}

export function useCensusBoundaryData() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [regionsByLevel, setRegionsByLevel] = useState<Record<CensusBoundaryLevel, BoundaryRegionRecord[]>>({
    cd: [],
    csd: [],
    ct: [],
    da: []
  })
  const [selectedRegion, setSelectedRegion] = useState<SelectedBoundaryRegion | null>(null)
  const [selectedRegionFeature, setSelectedRegionFeature] = useState<CensusBoundaryFeature | null>(null)

  const loadIndex = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const loaded = await loadAllLevels()
      setRegionsByLevel({
        cd: sortRegions(loaded.cd.map((feature) => feature.properties)),
        csd: sortRegions(loaded.csd.map((feature) => feature.properties)),
        ct: sortRegions(loaded.ct.map((feature) => feature.properties)),
        da: sortRegions(loaded.da.map((feature) => feature.properties))
      })
    } catch (err) {
      setError((err as Error).message || 'Unable to load census boundaries')
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

  const selectRegion = useCallback(async (level: CensusBoundaryLevel, code: string | null) => {
    if (!code) {
      clearSelection()
      return
    }

    const normalizedCode = String(code)
    setLoading(true)
    setError(null)
    try {
      if (!levelFeatureCache) {
        await loadAllLevels()
      }

      const feature = featureByKeyCache.get(`${level}:${normalizedCode}`)
      if (!feature) {
        throw new Error(`Boundary not found for ${LEVEL_LABELS[level]} ${normalizedCode}`)
      }

      setSelectedRegionFeature(feature)
      setSelectedRegion({
        source: 'census',
        level,
        code: normalizedCode,
        name: feature.properties.name,
        levelLabel: LEVEL_LABELS[level]
      })
    } catch (err) {
      setError((err as Error).message || 'Unable to load selected census boundary')
    } finally {
      setLoading(false)
    }
  }, [clearSelection])

  const getFeaturesForLevel = useCallback(async (level: CensusBoundaryLevel): Promise<CensusBoundaryFeature[]> => {
    setLoading(true)
    setError(null)
    try {
      return await loadLevelFeatures(level)
    } catch (err) {
      setError((err as Error).message || 'Unable to load census boundaries')
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  const levelOptions = useMemo(() => ([
    { value: 'cd', label: LEVEL_LABELS.cd },
    { value: 'csd', label: LEVEL_LABELS.csd },
    { value: 'ct', label: LEVEL_LABELS.ct },
    { value: 'da', label: LEVEL_LABELS.da }
  ]), [])

  return {
    loading,
    error,
    regionsByLevel,
    selectedRegion,
    selectedRegionFeature,
    levelOptions,
    getFeaturesForLevel,
    selectRegion,
    clearSelection,
    loadIndex
  }
}

import { useMemo, useState } from 'react'
import { useFetchData } from '@/hooks/useFetchData'
import { useCensusCatalog } from '@/maps/census/hooks/useCensusCatalog'
import { useCensusVariableData, getVariableValues } from '@/maps/census/hooks/useCensusVariableData'
import { COLOR_SCALES } from '@/components/ui/map-styles'
import type { CensusCategory, CensusVariable } from '@/maps/census/types'

const DA_GEOMETRY_URL = '/data/census/prince_george_da.geo.json'

// Curated socioeconomic categories
const SOCIOECONOMIC_CATEGORY_IDS = [
  'population_dwellings',
  'income_100',
  'income_25',
  'education',
  'work',
  'indigenous_identity',
  'visible_minority_ethnic_origin',
  'citizenship_immigration',
  'mobility',
]

export interface CensusOverlayState {
  geometry: GeoJSON.FeatureCollection | null
  categories: CensusCategory[]
  selectedCategoryId: string | null
  selectedVariableId: string | null
  variables: CensusVariable[]
  enrichedGeojson: GeoJSON.FeatureCollection | null
  fillColorExpression: unknown[] | string
  legendMin: number
  legendMax: number
  loading: boolean
  error: string | null
  setCategoryId: (id: string) => void
  setVariableId: (id: string) => void
}

export function useCensusOverlay(): CensusOverlayState {
  const { catalog, loading: catalogLoading, error: catalogError } = useCensusCatalog()

  // useFetchData's module-level cache replaces the local geometryCache.
  const { data: geometry, loading: geoLoading, error: geoError } =
    useFetchData<GeoJSON.FeatureCollection>(DA_GEOMETRY_URL)
  const [selectedCategoryId, setCategoryId] = useState<string | null>(null)
  const [selectedVariableId, setVariableId] = useState<string | null>(null)

  // Filter to socioeconomic categories
  const categories = useMemo(() => {
    if (!catalog) return []
    return catalog.categories.filter((c) => SOCIOECONOMIC_CATEGORY_IDS.includes(c.id))
  }, [catalog])

  // null means "no explicit choice yet" and resolves to the first option, so
  // the selection needs no initialization effect once the catalog loads.
  const effectiveCategoryId = selectedCategoryId ?? categories[0]?.id ?? null

  // Get variables for selected category
  const variables = useMemo(() => {
    if (!effectiveCategoryId || !catalog) return []
    const cat = catalog.categories.find((c) => c.id === effectiveCategoryId)
    return cat?.variables.filter((v) => v.type === 'Total' || v.type === '') ?? []
  }, [catalog, effectiveCategoryId])

  // A variable the current category does not offer falls back the same way.
  const effectiveVariableId =
    selectedVariableId && variables.some((v) => v.id === selectedVariableId)
      ? selectedVariableId
      : variables[0]?.id ?? null

  // Load variable data
  const { data: variableData, loading: varLoading } = useCensusVariableData('da', effectiveCategoryId)

  // Build enriched GeoJSON with variable values
  const { enrichedGeojson, fillColorExpression, legendMin, legendMax } = useMemo(() => {
    if (!geometry || !variableData || !effectiveVariableId) {
      return { enrichedGeojson: null, fillColorExpression: '#475569', legendMin: 0, legendMax: 0 }
    }

    const valueMap = getVariableValues(variableData, effectiveVariableId)
    let min = Infinity
    let max = -Infinity

    const features = geometry.features.map((feature) => {
      const geoUid = String(feature.properties?.GeoUID ?? feature.properties?.id ?? '')
      const value = valueMap.get(geoUid) ?? null
      if (value != null && Number.isFinite(value)) {
        if (value < min) min = value
        if (value > max) max = value
      }
      return {
        ...feature,
        properties: { ...feature.properties, _value: value },
      }
    })

    if (!Number.isFinite(min)) min = 0
    if (!Number.isFinite(max)) max = 0

    const enriched: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features }

    // Build step expression for choropleth
    const scale = COLOR_SCALES.purple
    const range = max - min
    if (range <= 0) {
      return { enrichedGeojson: enriched, fillColorExpression: scale[2], legendMin: min, legendMax: max }
    }

    const steps: (string | number | string[])[] = ['step', ['get', '_value']]
    steps.push(scale[0]) // default (below first stop)
    for (let i = 1; i < scale.length; i++) {
      steps.push(min + (range * i) / scale.length)
      steps.push(scale[i])
    }

    const expr = [
      'case',
      ['==', ['get', '_value'], null], '#475569',
      steps,
    ]

    return { enrichedGeojson: enriched, fillColorExpression: expr, legendMin: min, legendMax: max }
  }, [geometry, variableData, effectiveVariableId])

  const loading = catalogLoading || geoLoading || varLoading
  const error = catalogError || geoError

  return {
    geometry,
    categories,
    selectedCategoryId: effectiveCategoryId,
    selectedVariableId: effectiveVariableId,
    variables,
    enrichedGeojson,
    fillColorExpression,
    legendMin,
    legendMax,
    loading,
    error,
    setCategoryId,
    setVariableId,
  }
}

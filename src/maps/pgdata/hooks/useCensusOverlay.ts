import { useEffect, useMemo, useState } from 'react'
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

let geometryCache: GeoJSON.FeatureCollection | null = null

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

  const [geometry, setGeometry] = useState<GeoJSON.FeatureCollection | null>(geometryCache)
  const [geoLoading, setGeoLoading] = useState(!geometryCache)
  const [geoError, setGeoError] = useState<string | null>(null)
  const [selectedCategoryId, setCategoryId] = useState<string | null>(null)
  const [selectedVariableId, setVariableId] = useState<string | null>(null)

  // Load DA geometry
  useEffect(() => {
    if (geometryCache) return
    const controller = new AbortController()

    async function load() {
      try {
        const res = await fetch(DA_GEOMETRY_URL, { signal: controller.signal })
        if (!res.ok) throw new Error(`Failed to load DA geometry: ${res.status}`)
        const data = await res.json() as GeoJSON.FeatureCollection
        geometryCache = data
        setGeometry(data)
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setGeoError((err as Error).message)
      } finally {
        setGeoLoading(false)
      }
    }

    load()
    return () => controller.abort()
  }, [])

  // Filter to socioeconomic categories
  const categories = useMemo(() => {
    if (!catalog) return []
    return catalog.categories.filter((c) => SOCIOECONOMIC_CATEGORY_IDS.includes(c.id))
  }, [catalog])

  // Auto-select first category if none selected
  useEffect(() => {
    if (!selectedCategoryId && categories.length > 0) {
      setCategoryId(categories[0].id)
    }
  }, [categories, selectedCategoryId])

  // Get variables for selected category
  const variables = useMemo(() => {
    if (!selectedCategoryId || !catalog) return []
    const cat = catalog.categories.find((c) => c.id === selectedCategoryId)
    return cat?.variables.filter((v) => v.type === 'Total' || v.type === '') ?? []
  }, [catalog, selectedCategoryId])

  // Auto-select first variable
  useEffect(() => {
    if (variables.length > 0 && (!selectedVariableId || !variables.some((v) => v.id === selectedVariableId))) {
      setVariableId(variables[0].id)
    }
  }, [variables, selectedVariableId])

  // Load variable data
  const { data: variableData, loading: varLoading } = useCensusVariableData('da', selectedCategoryId)

  // Build enriched GeoJSON with variable values
  const { enrichedGeojson, fillColorExpression, legendMin, legendMax } = useMemo(() => {
    if (!geometry || !variableData || !selectedVariableId) {
      return { enrichedGeojson: null, fillColorExpression: '#475569', legendMin: 0, legendMax: 0 }
    }

    const valueMap = getVariableValues(variableData, selectedVariableId)
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
  }, [geometry, variableData, selectedVariableId])

  const loading = catalogLoading || geoLoading || varLoading
  const error = catalogError || geoError

  return {
    geometry,
    categories,
    selectedCategoryId,
    selectedVariableId,
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

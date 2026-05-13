import { useEffect, useState } from 'react'
import type { CanueVariableSelection } from './canueV2'

const CANUE_V2_AGGREGATES_BASE_URL = 'https://data.map.ahmad.sh/canue/aggregates-v2'

type BoundaryGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon
type BoundaryCollection = GeoJSON.FeatureCollection<BoundaryGeometry>

export interface CanueAggregateRow {
  boundaryId: string
  boundaryName: string
  values: Record<string, number>
  counts?: Record<string, number>
  min?: Record<string, number>
  max?: Record<string, number>
}

interface CanueAggregateFile {
  source: string
  level: string
  family: string
  year: number
  validBoundaryCount: number
  rows: CanueAggregateRow[]
}

export interface CanueV2AggregateResult {
  data: BoundaryCollection
  loading: boolean
  error: string | null
  minValue: number | null
  maxValue: number | null
  validBoundaryCount: number
  matchedFeatureCount: number
  decodedFeatureCount: number
  tileCount: number
  zoom: number | null
  capped: boolean
  url: string | null
  aggregateRows: CanueAggregateRow[]
}

const EMPTY_RESULT: CanueV2AggregateResult = {
  data: { type: 'FeatureCollection', features: [] },
  loading: false,
  error: null,
  minValue: null,
  maxValue: null,
  validBoundaryCount: 0,
  matchedFeatureCount: 0,
  decodedFeatureCount: 0,
  tileCount: 0,
  zoom: null,
  capped: false,
  url: null,
  aggregateRows: [],
}

function aggregateUrl(source: string, level: string, selection: CanueVariableSelection) {
  return `${CANUE_V2_AGGREGATES_BASE_URL}/${source}/${level}/${selection.family}_${selection.year}_aggregate.json`
}

export function useCanueV2AggregateData({
  source,
  level,
  selection,
  boundaries,
  idField,
  nameField,
  enabled,
}: {
  source: string
  level: string
  selection: CanueVariableSelection | null
  boundaries: BoundaryCollection | null
  idField: string
  nameField: string
  enabled: boolean
}): CanueV2AggregateResult {
  const [result, setResult] = useState<CanueV2AggregateResult>(EMPTY_RESULT)

  useEffect(() => {
    if (!enabled || !selection || !boundaries?.features.length) {
      setResult(EMPTY_RESULT)
      return
    }

    const controller = new AbortController()
    const activeSelection = selection
    const activeBoundaries = boundaries
    const url = aggregateUrl(source, level, activeSelection)

    async function load() {
      setResult((current) => ({ ...current, loading: true, error: null, url }))
      try {
        const response = await fetch(url, { signal: controller.signal })
        if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`)
        const aggregate = await response.json() as CanueAggregateFile
        const rowByBoundaryId = new Map(aggregate.rows.map((row) => [String(row.boundaryId), row]))
        let minValue: number | null = null
        let maxValue: number | null = null
        let validBoundaryCount = 0
        let matchedFeatureCount = 0

        const features = activeBoundaries.features.filter((feature) => feature.geometry).map((feature, index) => {
          const id = String(feature.properties?.[idField] ?? feature.properties?.boundaryId ?? feature.id ?? index)
          const row = rowByBoundaryId.get(id)
          const value = row?.values?.[activeSelection.property] ?? null
          if (Number.isFinite(value)) {
            validBoundaryCount += 1
            matchedFeatureCount += row?.counts?.[activeSelection.property] ?? 0
            const numericValue = Number(value)
            minValue = minValue == null ? numericValue : Math.min(minValue, numericValue)
            maxValue = maxValue == null ? numericValue : Math.max(maxValue, numericValue)
          }

          return {
            ...feature,
            id,
            properties: {
              ...feature.properties,
              boundaryId: id,
              boundaryName: row?.boundaryName ?? String(feature.properties?.[nameField] ?? feature.properties?.name ?? feature.id ?? index),
              datasetId: activeSelection.dataset,
              datasetLabel: activeSelection.dataset,
              family: activeSelection.family,
              year: activeSelection.year,
              sourceMode: 'r2-aggregate',
              rowCount: row?.counts?.[activeSelection.property] ?? 0,
              [activeSelection.property]: value,
              [`${activeSelection.property}_count`]: row?.counts?.[activeSelection.property] ?? 0,
              [`${activeSelection.property}_min`]: row?.min?.[activeSelection.property] ?? null,
              [`${activeSelection.property}_max`]: row?.max?.[activeSelection.property] ?? null,
            },
          }
        })

        setResult({
          data: { type: 'FeatureCollection', features },
          loading: false,
          error: null,
          minValue,
          maxValue,
          validBoundaryCount,
          matchedFeatureCount,
          decodedFeatureCount: matchedFeatureCount,
          tileCount: 0,
          zoom: null,
          capped: false,
          url,
          aggregateRows: aggregate.rows,
        })
      } catch (error) {
        if ((error as Error).name === 'AbortError') return
        setResult({ ...EMPTY_RESULT, error: (error as Error).message || 'Unable to load CANUE aggregate', url })
      }
    }

    void load()
    return () => controller.abort()
  }, [boundaries, enabled, idField, level, nameField, selection, source])

  return result
}

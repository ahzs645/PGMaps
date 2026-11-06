import { useEffect, useMemo, useState } from 'react'
import { collectTimelineValues, resolveBoundaryTimelineScale, type CanueColorScale } from './canue/timelineScale'
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
  property: string | null
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
  property: null,
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

export interface CanueV2AggregatePrefetchResult {
  loading: boolean
  loaded: number
  total: number
  error: string | null
  /** The whole timeline's colour scale; null until every period has settled. */
  scale: CanueColorScale | null
}

const aggregateCache = new Map<string, Promise<CanueAggregateFile>>()

function aggregateFolderUrl(source: string, level: string) {
  return `${CANUE_V2_AGGREGATES_BASE_URL}/${source}/${level}/`
}

function aggregateUrl(source: string, level: string, selection: CanueVariableSelection) {
  return `${aggregateFolderUrl(source, level)}${selection.family}_${selection.year}_aggregate.json`
}

function loadAggregate(url: string): Promise<CanueAggregateFile> {
  const cached = aggregateCache.get(url)
  if (cached) return cached

  const request = fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`)
      return response.json() as Promise<CanueAggregateFile>
    })
    .catch((error) => {
      aggregateCache.delete(url)
      throw error
    })

  aggregateCache.set(url, request)
  return request
}

function uniqueAggregateUrls(source: string, level: string, selections: CanueVariableSelection[]) {
  return Array.from(new Set(selections.map((selection) => aggregateUrl(source, level, selection))))
}

export function useCanueV2AggregatePrefetch({
  source,
  level,
  selections,
  enabled,
}: {
  source: string
  level: string
  selections: CanueVariableSelection[]
  enabled: boolean
}): CanueV2AggregatePrefetchResult {
  const urls = useMemo(
    () => (enabled ? uniqueAggregateUrls(source, level, selections) : []),
    [enabled, level, selections, source],
  )
  const [result, setResult] = useState<CanueV2AggregatePrefetchResult & { urls: string[] | null }>({
    loading: false,
    loaded: 0,
    total: 0,
    error: null,
    scale: null,
    urls: null,
  })

  useEffect(() => {
    if (!urls.length) {
      setResult({ loading: false, loaded: 0, total: 0, error: null, scale: null, urls })
      return
    }

    let cancelled = false
    setResult({ loading: true, loaded: 0, total: urls.length, error: null, scale: null, urls })

    async function prefetch() {
      let loaded = 0
      let firstError: string | null = null
      const files = new Map<string, CanueAggregateFile>()

      await Promise.all(
        urls.map(async (url) => {
          try {
            files.set(url, await loadAggregate(url))
          } catch (error) {
            firstError ??= (error as Error).message || 'Unable to preload CANUE timeline data'
          }
          loaded += 1
          if (!cancelled && loaded < urls.length) {
            setResult({ loading: true, loaded, total: urls.length, error: firstError, scale: null, urls })
          }
        }),
      )
      if (cancelled) return

      // Waiting for every period keeps the scale from shifting under the map
      // as files land; a failed period just contributes no values to it.
      const values = collectTimelineValues(
        selections,
        (selection) => files.get(aggregateUrl(source, level, selection))?.rows ?? null,
      )
      setResult({
        loading: false,
        loaded,
        total: urls.length,
        error: firstError,
        scale: resolveBoundaryTimelineScale(values),
        urls,
      })
    }

    void prefetch()
    return () => {
      cancelled = true
    }
  }, [level, selections, source, urls])

  // A result from before a boundary level or variable change has the old scale.
  return result.urls === urls
    ? result
    : { loading: urls.length > 0, loaded: 0, total: urls.length, error: null, scale: null }
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

  const inactive = !enabled || !selection || !boundaries?.features.length

  useEffect(() => {
    if (!enabled || !selection || !boundaries?.features.length) return

    const controller = new AbortController()
    const activeSelection = selection
    const activeBoundaries = boundaries
    const url = aggregateUrl(source, level, activeSelection)
    let cancelled = false

    async function load() {
      // The last result bridges a new period, but not a new boundary level: its
      // ids belong to other shapes, which would draw empty with nothing loading.
      setResult((current) =>
        current.url?.startsWith(aggregateFolderUrl(source, level))
          ? { ...current, loading: true, error: null, url }
          : { ...EMPTY_RESULT, loading: true, url },
      )
      try {
        const aggregate = await loadAggregate(url)
        if (cancelled) return
        const rowByBoundaryId = new Map(aggregate.rows.map((row) => [String(row.boundaryId), row]))
        let minValue: number | null = null
        let maxValue: number | null = null
        let validBoundaryCount = 0
        let matchedFeatureCount = 0

        const features = activeBoundaries.features
          .filter((feature) => feature.geometry)
          .map((feature, index) => {
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
                boundaryName:
                  row?.boundaryName ??
                  String(feature.properties?.[nameField] ?? feature.properties?.name ?? feature.id ?? index),
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
          property: activeSelection.property,
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
        if (cancelled) return
        setResult({ ...EMPTY_RESULT, error: (error as Error).message || 'Unable to load CANUE aggregate', url })
      }
    }

    void load()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [boundaries, enabled, idField, level, nameField, selection, source])

  return inactive ? EMPTY_RESULT : result
}

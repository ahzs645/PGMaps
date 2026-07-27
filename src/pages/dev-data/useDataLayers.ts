import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEV_DATA_LAYER_BY_ID,
  EMPTY_COLLECTION,
  FEATURE_ID_KEY,
  type DataFeature,
  type DataFeatureCollection,
  type DataLayerId,
} from './data'

export type LayerStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface LayerState {
  status: LayerStatus
  collection: DataFeatureCollection
  error?: string
}

const IDLE_STATE: LayerState = { status: 'idle', collection: EMPTY_COLLECTION }
const LOADING_STATE: LayerState = { status: 'loading', collection: EMPTY_COLLECTION }

/**
 * Fetches City of PG GeoJSON snapshots on demand and caches them for the session.
 * The two large layers are several megabytes, so nothing is fetched until its
 * layer is switched on.
 *
 * Only settled outcomes go in state; "loading" is derived from an enabled layer
 * having no entry yet, which avoids a synchronous setState inside the effect.
 */
export function useDataLayers(enabledLayers: DataLayerId[]) {
  const [states, setStates] = useState<Record<string, LayerState>>({})
  const requested = useRef(new Set<DataLayerId>())
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    for (const layerId of enabledLayers) {
      if (requested.current.has(layerId)) continue
      const definition = DEV_DATA_LAYER_BY_ID.get(layerId)
      if (!definition) continue
      requested.current.add(layerId)

      fetch(definition.path)
        .then(async (response) => {
          if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
          return (await response.json()) as GeoJSON.FeatureCollection
        })
        .then((collection) => {
          if (!mounted.current) return
          const features: DataFeature[] = (collection.features ?? []).map((feature, index) => ({
            ...feature,
            properties: {
              ...(feature.properties ?? {}),
              [FEATURE_ID_KEY]: `${layerId}:${index}`,
            },
          })) as DataFeature[]
          setStates((current) => ({
            ...current,
            [layerId]: { status: 'ready', collection: { type: 'FeatureCollection', features } },
          }))
        })
        .catch((error: unknown) => {
          if (!mounted.current) return
          // Allow a retry on the next enable.
          requested.current.delete(layerId)
          setStates((current) => ({
            ...current,
            [layerId]: {
              status: 'error',
              collection: EMPTY_COLLECTION,
              error: error instanceof Error ? error.message : 'Failed to load',
            },
          }))
        })
    }
  }, [enabledLayers])

  const enabledKey = enabledLayers.join('|')
  const getLayer = useCallback((layerId: DataLayerId): LayerState => {
    const settled = states[layerId]
    if (settled) return settled
    return enabledKey.split('|').includes(layerId) ? LOADING_STATE : IDLE_STATE
  }, [enabledKey, states])

  return { getLayer }
}

export type ViewportBounds = [number, number, number, number]

/** Keeps a stable array identity while the enabled set is unchanged. */
export function useStableLayerList(enabled: Record<DataLayerId, boolean>): DataLayerId[] {
  const key = (Object.keys(enabled) as DataLayerId[]).filter((id) => enabled[id]).join('|')
  return useMemo(() => (key ? (key.split('|') as DataLayerId[]) : []), [key])
}

export function featureInBounds(feature: DataFeature, bounds: ViewportBounds): boolean {
  const [west, south, east, north] = bounds
  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity

  const walk = (coords: unknown): void => {
    if (!Array.isArray(coords)) return
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      const [lng, lat] = coords as [number, number]
      if (lng < minLng) minLng = lng
      if (lng > maxLng) maxLng = lng
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
      return
    }
    for (const entry of coords) walk(entry)
  }

  walk((feature.geometry as { coordinates?: unknown }).coordinates)
  if (minLng === Infinity) return false
  // Bounding-box overlap: good enough for a "visible in viewport" filter.
  return maxLng >= west && minLng <= east && maxLat >= south && minLat <= north
}

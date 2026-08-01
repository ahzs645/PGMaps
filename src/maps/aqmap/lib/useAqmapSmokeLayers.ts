import { useEffect, useMemo, useState } from 'react'
import {
  SMOKE_FALLBACK_DATA,
  SMOKE_LAYERS,
  type SmokeFeatureCollection,
  type SmokeLayerDefinition,
  type SmokeLayerKey,
} from './smokeLayers'
const LIVE_SMOKE_ENDPOINTS: Record<SmokeLayerKey, string> = {
  modelledSmoke: '/data/smoke/modelled/geojson',
  visibleSmoke: '/data/smoke/visible/geojson',
}

const STATIC_SMOKE_ENDPOINTS: Record<SmokeLayerKey, string> = {
  modelledSmoke: '/data/smoke/modelled.json',
  visibleSmoke: '/data/smoke/visible.json',
}

const FAILED_SMOKE_MESSAGE = 'Unable to load live AQMap smoke data; using bundled sample data.'

interface UseAqmapSmokeLayersResult {
  layers: SmokeLayerDefinition[]
  loading: boolean
  error: string | null
}

function isFeatureCollection(value: unknown): value is SmokeFeatureCollection {
  return !!value
    && typeof value === 'object'
    && (value as { type?: unknown }).type === 'FeatureCollection'
    && Array.isArray((value as { features?: unknown }).features)
}

function extractFeatureCollection(value: unknown): SmokeFeatureCollection | null {
  if (isFeatureCollection(value)) return value
  if (value && typeof value === 'object' && 'data' in value) {
    return isFeatureCollection((value as { data?: unknown }).data) ? (value as { data: SmokeFeatureCollection }).data : null
  }
  return null
}

async function loadSmokeLayerData(url: string, signal: AbortSignal): Promise<SmokeFeatureCollection | null> {
  try {
    const response = await fetch(url, { signal })
    if (!response.ok) return null
    const payload = await response.json()
    return extractFeatureCollection(payload)
  } catch {
    return null
  }
}

export function useAqmapSmokeLayers(): UseAqmapSmokeLayersResult {
  const [layers, setLayers] = useState<SmokeLayerDefinition[]>(SMOKE_LAYERS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      const primaryEndpoints = import.meta.env.DEV ? LIVE_SMOKE_ENDPOINTS : STATIC_SMOKE_ENDPOINTS
      const primaryResults = await Promise.all(
        (Object.entries(primaryEndpoints) as Array<[SmokeLayerKey, string]>)
          .map(async ([key, endpoint]) => [key, await loadSmokeLayerData(endpoint, controller.signal)] as const),
      )
      if (cancelled) return

      // The Vite dev adapter provides live smoke endpoints. If either one is
      // unavailable, use the same public snapshots deployed in production.
      const results = import.meta.env.DEV
        ? await Promise.all(primaryResults.map(async ([key, result]) => [
            key,
            result ?? await loadSmokeLayerData(STATIC_SMOKE_ENDPOINTS[key], controller.signal),
          ] as const))
        : primaryResults
      if (cancelled) return

      const next = SMOKE_LAYERS.map((layer) => {
        const result = results.find(([key]) => key === layer.key)?.[1]
        return {
          ...layer,
          data: result ?? SMOKE_FALLBACK_DATA[layer.key],
        }
      })
      const hasFallback = next.some((layer) => !results.find(([key]) => key === layer.key)?.[1])
      setLayers(next)
      setError(hasFallback ? FAILED_SMOKE_MESSAGE : null)
      setLoading(false)
    }

    void load()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  return useMemo(() => ({
    layers,
    loading,
    error,
  }), [error, layers, loading])
}

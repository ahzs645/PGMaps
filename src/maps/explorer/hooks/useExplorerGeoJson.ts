import { useEffect, useState } from 'react'

interface ExplorerGeoJsonState<G extends GeoJSON.Geometry, P> {
  features: GeoJSON.Feature<G, P>[]
  loading: boolean
  error: string | null
}

export function useExplorerGeoJson<G extends GeoJSON.Geometry, P = Record<string, unknown>>(
  path: string,
  enabled = true,
): ExplorerGeoJsonState<G, P> {
  const [state, setState] = useState<ExplorerGeoJsonState<G, P>>({ features: [], loading: enabled, error: null })

  useEffect(() => {
    if (!enabled) {
      setState({ features: [], loading: false, error: null })
      return
    }
    const controller = new AbortController()
    setState((current) => ({ ...current, loading: true, error: null }))
    fetch(path, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Failed to fetch ${path}: ${response.status}`)
        const data = (await response.json()) as GeoJSON.FeatureCollection<G, P>
        if (!controller.signal.aborted) {
          setState({ features: data.features ?? [], loading: false, error: null })
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const message = error instanceof Error ? error.message : 'Failed to load GeoJSON'
        setState({ features: [], loading: false, error: message })
      })
    return () => controller.abort()
  }, [path, enabled])

  return state
}

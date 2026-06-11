import { useFetchData } from '@/hooks/useFetchData'

interface ExplorerGeoJsonState<G extends GeoJSON.Geometry, P> {
  features: GeoJSON.Feature<G, P>[]
  loading: boolean
  error: string | null
}

const NO_FEATURES: never[] = []

/**
 * Load a GeoJSON FeatureCollection and expose its feature array. Built on the
 * shared useFetchData module-level cache, so multi-MB files (transit routes,
 * ICBC crashes) are fetched once per session instead of on every mount.
 */
export function useExplorerGeoJson<G extends GeoJSON.Geometry, P = Record<string, unknown>>(
  path: string,
  enabled = true,
): ExplorerGeoJsonState<G, P> {
  const { data, loading, error } = useFetchData<GeoJSON.Feature<G, P>[]>(path, {
    enabled,
    transform: (json) => (json as GeoJSON.FeatureCollection<G, P>).features ?? [],
  })
  return { features: data ?? NO_FEATURES, loading, error }
}

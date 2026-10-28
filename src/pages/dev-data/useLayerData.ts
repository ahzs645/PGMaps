import { useCallback, useEffect, useRef, useState } from 'react'
import { IDLE_LAYER, LOADING_LAYER, prepareLayer, type LoadedLayer } from './layerData'
import type { DataLayer } from './model'

/**
 * Loads catalogue snapshots on demand and keeps uploaded layers, caching both for
 * the session. Large snapshots are several megabytes, so a catalogue layer is
 * fetched only once something needs it (shown, in the table, or open in its panel).
 *
 * Only settled outcomes go in state; "loading" is derived from a wanted layer
 * having no entry yet, which avoids a synchronous setState inside the effect.
 */
export function useLayerData(layers: readonly DataLayer[], wantedIds: ReadonlySet<string>) {
  const [loaded, setLoaded] = useState<Record<string, LoadedLayer>>({})
  const requested = useRef(new Set<string>())
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    for (const layer of layers) {
      if (layer.source.kind !== 'catalog' || !wantedIds.has(layer.id) || requested.current.has(layer.id)) continue
      requested.current.add(layer.id)
      fetch(layer.source.entry.path)
        .then(async (response) => {
          if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
          return (await response.json()) as GeoJSON.FeatureCollection
        })
        .then((collection) => {
          if (!mounted.current) return
          setLoaded((current) => ({ ...current, [layer.id]: prepareLayer(layer, collection) }))
        })
        .catch((error: unknown) => {
          if (!mounted.current) return
          // Allow a retry the next time the layer is wanted.
          requested.current.delete(layer.id)
          setLoaded((current) => ({
            ...current,
            [layer.id]: {
              ...IDLE_LAYER,
              status: 'error',
              error: error instanceof Error ? error.message : 'Failed to load',
            },
          }))
        })
    }
  }, [layers, wantedIds])

  /** Stores an uploaded file's features under its layer. */
  const register = useCallback((layer: DataLayer, collection: GeoJSON.FeatureCollection) => {
    requested.current.add(layer.id)
    setLoaded((current) => ({ ...current, [layer.id]: prepareLayer(layer, collection) }))
  }, [])

  const getLayer = useCallback(
    (layerId: string): LoadedLayer => loaded[layerId] ?? (wantedIds.has(layerId) ? LOADING_LAYER : IDLE_LAYER),
    [loaded, wantedIds],
  )

  return { getLayer, register }
}

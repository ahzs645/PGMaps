import type MapLibreGL from 'maplibre-gl'

/**
 * Reconcile HTML markers after source/view changes, on the next loaded frame.
 * MapLibre already projects attached markers as the camera moves; unrelated
 * repaints (hover, other layers, animations) need no source scan.
 */
export function observeMarkerSource(map: MapLibreGL.Map, sourceId: string, reconcile: () => void): () => void {
  let dirty = true
  const invalidate = () => {
    dirty = true
  }
  const sourceChanged = (event: MapLibreGL.MapSourceDataEvent) => {
    if (event.sourceId === sourceId) invalidate()
  }
  const flush = () => {
    if (!dirty || !map.getSource(sourceId) || !map.isSourceLoaded(sourceId)) return
    dirty = false
    reconcile()
  }

  map.on('move', invalidate)
  map.on('resize', invalidate)
  map.on('sourcedata', sourceChanged)
  map.on('render', flush)
  flush()

  return () => {
    map.off('move', invalidate)
    map.off('resize', invalidate)
    map.off('sourcedata', sourceChanged)
    map.off('render', flush)
  }
}

export function sameMarkerPosition(a: readonly number[], b: readonly number[]): boolean {
  return a[0] === b[0] && a[1] === b[1]
}

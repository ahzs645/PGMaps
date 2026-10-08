import type MapLibreGL from 'maplibre-gl'

const groupsByMap = new WeakMap<MapLibreGL.Map, Map<string, { order: number; layers: string[] }>>()

/** Preserve authored draw order even when independent sources arrive out of order. */
export function registerMapLayerOrder(map: MapLibreGL.Map, layers: string[], order?: number) {
  if (order === undefined) return () => {}
  let groups = groupsByMap.get(map)
  if (!groups) {
    groups = new Map()
    groupsByMap.set(map, groups)
  }
  const key = layers[0]
  groups.set(key, { order, layers })
  for (const group of [...groups.values()].sort((a, b) => a.order - b.order)) {
    for (const id of group.layers) if (map.getLayer(id)) map.moveLayer(id)
  }
  return () => {
    groups.delete(key)
  }
}

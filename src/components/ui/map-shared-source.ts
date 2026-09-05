import type MapLibreGL from 'maplibre-gl'

const sources = new WeakMap<
  MapLibreGL.Map,
  Map<string, { owners: number; data?: GeoJSON.FeatureCollection | string }>
>()

/** A map-local source lease. Layers release their own paint before releasing it. */
export function retainGeoJsonSource(map: MapLibreGL.Map, id: string, promoteId?: string) {
  let registry = sources.get(map)
  if (!registry) {
    registry = new Map()
    sources.set(map, registry)
  }
  let entry = registry.get(id)
  if (!entry || !map.getSource(id)) {
    entry = { owners: 0 }
    registry.set(id, entry)
    if (!map.getSource(id))
      map.addSource(id, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        ...(promoteId ? { promoteId } : {}),
      })
  }
  entry.owners++
}

export function updateGeoJsonSource(map: MapLibreGL.Map, id: string, data: GeoJSON.FeatureCollection | string) {
  const entry = sources.get(map)?.get(id)
  if (!entry || entry.data === data) return
  const source = map.getSource(id) as MapLibreGL.GeoJSONSource | undefined
  if (source) {
    source.setData(data)
    entry.data = data
  }
}

export function releaseGeoJsonSource(map: MapLibreGL.Map, id: string) {
  const registry = sources.get(map)
  const entry = registry?.get(id)
  if (!entry || --entry.owners > 0) return
  registry!.delete(id)
  if (map.getSource(id)) map.removeSource(id)
}

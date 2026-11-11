import { useEffect, useId, useMemo } from 'react'
import type { GeoJSONSource } from 'maplibre-gl'
import { useMap } from '@/components/ui/map'
import { viewerConeFeatures, type MapViewer } from '@/lib/geo/viewerCone'

export type { MapViewer } from '@/lib/geo/viewerCone'

/**
 * Where a viewer in another view stands and what it looks at, on a plan map: a translucent wedge
 * (`fovDegrees` wide, `lengthMeters` long) and a dot at the eye. Both are one GeoJSON source, so a
 * moving viewer costs one `setData` per change and the wedge and dot land on the same frame. It sits
 * above the map's other layers and takes no clicks. `viewer={null}` hides it.
 */
export function MapViewerCone({
  viewer,
  lengthMeters = 2000,
  color = '#e11d48',
}: {
  viewer: MapViewer | null
  lengthMeters?: number
  color?: string
}) {
  const { map, isLoaded } = useMap()
  const uid = useId().replace(/:/g, '')
  const ids = useMemo(
    () => ({ source: `viewer-cone-${uid}`, fill: `viewer-cone-fill-${uid}`, eye: `viewer-cone-eye-${uid}` }),
    [uid],
  )
  const data = useMemo(() => viewerConeFeatures(viewer, lengthMeters), [viewer, lengthMeters])

  useEffect(() => {
    if (!map || !isLoaded) return
    map.addSource(ids.source, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({
      id: ids.fill,
      type: 'fill',
      source: ids.source,
      filter: ['==', ['get', 'kind'], 'cone'],
      paint: { 'fill-color': color, 'fill-opacity': 0.18, 'fill-outline-color': color },
    })
    map.addLayer({
      id: ids.eye,
      type: 'circle',
      source: ids.source,
      filter: ['==', ['get', 'kind'], 'eye'],
      paint: {
        'circle-color': color,
        'circle-radius': 6,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    })
    return () => {
      try {
        if (!map.getStyle()) return
        if (map.getLayer(ids.eye)) map.removeLayer(ids.eye)
        if (map.getLayer(ids.fill)) map.removeLayer(ids.fill)
        if (map.getSource(ids.source)) map.removeSource(ids.source)
      } catch {
        // The map was removed first.
      }
    }
  }, [map, isLoaded, ids, color])

  useEffect(() => {
    if (!map || !isLoaded) return
    ;(map.getSource(ids.source) as GeoJSONSource | undefined)?.setData(data)
    // Layers mounted since (a newly shown overlay) would otherwise draw over the viewer.
    const layers = map.getStyle()?.layers ?? []
    if (layers[layers.length - 1]?.id !== ids.eye && map.getLayer(ids.fill)) {
      map.moveLayer(ids.fill)
      map.moveLayer(ids.eye)
    }
  }, [map, isLoaded, ids, data])

  return null
}

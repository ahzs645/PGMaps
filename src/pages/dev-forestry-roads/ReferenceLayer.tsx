import { useEffect, useMemo } from 'react'
import type { GeoJSONSource } from 'maplibre-gl'
import { MapMarker, MarkerContent, useMap } from '@/components/ui/map'
import { referenceGeoJson, type ReferenceFeature } from './referenceFeatures'

const SOURCE = 'road-reference'
const LAYERS = ['road-reference-fill', 'road-reference-casing', 'road-reference-line', 'road-reference-point'] as const
/** Point names drawn on the plan; beyond this the dots stay and the sidebar list names them. */
export const MAX_REFERENCE_LABELS = 80

/**
 * Draws the project's reference features: grey dashed linework with a light casing so it reads on
 * hillshade and basemap alike, and each point as a ringed dot with its name beside it. Display only.
 */
export function ReferenceLayer({
  features,
  visible,
  selectedId,
}: {
  features: readonly ReferenceFeature[]
  visible: boolean
  selectedId?: string | null
}) {
  const { map, isLoaded } = useMap()
  const data = useMemo(() => referenceGeoJson(features), [features])
  useEffect(() => {
    if (!map || !isLoaded) return
    const existing = map.getSource(SOURCE) as GeoJSONSource | undefined
    if (existing) existing.setData(data)
    else map.addSource(SOURCE, { type: 'geojson', data })
    const add = (layer: Parameters<typeof map.addLayer>[0]) => {
      if (!map.getLayer(layer.id)) map.addLayer(layer)
    }
    add({
      id: 'road-reference-fill',
      type: 'fill',
      source: SOURCE,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': '#334155', 'fill-opacity': 0.06 },
    })
    add({
      id: 'road-reference-casing',
      type: 'line',
      source: SOURCE,
      filter: ['!=', ['geometry-type'], 'Point'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': 4, 'line-opacity': 0.75 },
    })
    add({
      id: 'road-reference-line',
      type: 'line',
      source: SOURCE,
      filter: ['!=', ['geometry-type'], 'Point'],
      layout: { 'line-join': 'round' },
      paint: { 'line-color': '#334155', 'line-width': 1.75, 'line-dasharray': [4, 2.5] },
    })
    add({
      id: 'road-reference-point',
      type: 'circle',
      source: SOURCE,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 6,
        'circle-color': '#f59e0b',
        'circle-stroke-color': '#0f172a',
        'circle-stroke-width': 2,
      },
    })
  }, [map, isLoaded, data])
  useEffect(() => {
    if (!map || !isLoaded) return
    for (const id of LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
    if (map.getLayer('road-reference-line'))
      map.setPaintProperty('road-reference-line', 'line-width', [
        'case',
        ['==', ['get', 'id'], selectedId ?? ''],
        3.5,
        1.75,
      ])
    if (map.getLayer('road-reference-point'))
      map.setPaintProperty('road-reference-point', 'circle-radius', [
        'case',
        ['==', ['get', 'id'], selectedId ?? ''],
        9,
        6,
      ])
  }, [map, isLoaded, visible, selectedId, data])
  if (!visible) return null
  return (
    <>
      {features
        .filter((feature) => feature.geometry.type === 'Point')
        .slice(0, MAX_REFERENCE_LABELS)
        .map((feature) => {
          const [longitude, latitude] = (feature.geometry as GeoJSON.Point).coordinates
          return (
            <MapMarker key={feature.id} longitude={longitude} latitude={latitude}>
              <MarkerContent>
                <span
                  className="pointer-events-none block translate-x-[calc(50%+10px)] whitespace-nowrap rounded-sm bg-background/90 px-1 text-2xs font-medium leading-4 text-foreground shadow-sm"
                  data-reference-point={feature.id}
                >
                  {feature.name}
                </span>
              </MarkerContent>
            </MapMarker>
          )
        })}
    </>
  )
}

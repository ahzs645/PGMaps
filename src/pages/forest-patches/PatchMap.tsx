import { useEffect, useRef } from 'react'
import type { FeatureCollection, Position } from 'geojson'
import type { MapMouseEvent, StyleSpecification } from 'maplibre-gl'
import { Map, useMap } from '@/components/ui/map'
import { MapFillLayer, MapLineLayer, MapCircleLayer } from '@/components/ui/map-layers'
import type { Project, Footprint } from './project'

const offline: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dce5df' } }],
}
const fallback = { light: offline, dark: offline }
function Interactions({ draw, add, fit }: { draw: boolean; add: (p: Position) => void; fit: Project }) {
  const { map, isLoaded } = useMap()
  const fitted = useRef<Project | null>(null)
  useEffect(() => {
    if (!map || !isLoaded || draw || fitted.current === fit || !fit.features.length) return
    fitted.current = fit
    let west = Infinity,
      south = Infinity,
      east = -Infinity,
      north = -Infinity
    for (const { geometry: g } of fit.features) {
      const parts = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
      for (const poly of parts)
        for (const [x, y] of poly[0]) {
          west = Math.min(west, x)
          east = Math.max(east, x)
          south = Math.min(south, y)
          north = Math.max(north, y)
        }
    }
    map.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding: 50, maxZoom: 15, duration: 0 },
    )
  }, [map, isLoaded, fit, draw])
  useEffect(() => {
    if (!map || !draw) return
    const click = (e: MapMouseEvent) => add([e.lngLat.lng, e.lngLat.lat])
    map.getCanvas().style.cursor = 'crosshair'
    map.on('click', click)
    return () => {
      map.off('click', click)
      map.getCanvas().style.cursor = ''
    }
  }, [map, draw, add])
  return null
}
export function PatchMap({
  inputs,
  patches,
  selected,
  zones,
  vertices,
  add,
  fit,
}: {
  selected?: Footprint
  zones?: FeatureCollection
  inputs: FeatureCollection
  patches: FeatureCollection
  vertices: Position[] | null
  add: (p: Position) => void
  fit: Project
}) {
  const points: FeatureCollection = {
    type: 'FeatureCollection',
    features: (vertices ?? []).map((coordinates) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates },
    })),
  }
  const lines: FeatureCollection = {
    type: 'FeatureCollection',
    features:
      vertices && vertices.length >= 2
        ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: vertices } }]
        : [],
  }
  return (
    <div aria-label="Patch drawing map" className="relative h-[360px] overflow-hidden rounded-lg border md:h-[480px]">
      <Map center={[-122.766, 53.99]} zoom={13} fallbackStyles={fallback} styleTimeoutMs={2500}>
        <MapFillLayer
          data={patches}
          sourceKey="derived-patches"
          fillColor="#68a984"
          fillOpacity={0.45}
          lineColor="#226944"
          lineWidth={3}
        />
        <MapFillLayer
          data={inputs}
          sourceKey="disturbance-footprints"
          fillColor="#b85e20"
          fillOpacity={0.23}
          lineColor="#92400e"
          lineWidth={1}
        />
        {zones && (
          <MapFillLayer
            data={zones}
            sourceKey="riparian-zones"
            fillColor="#0d86b0"
            fillOpacity={0.32}
            lineColor="#0b6388"
          />
        )}
        {selected && (
          <MapFillLayer
            data={{ type: 'FeatureCollection', features: [selected] }}
            sourceKey="selected-block"
            fillColor="#de9339"
            fillOpacity={0.14}
            lineColor="#663b09"
            lineWidth={3}
          />
        )}
        <MapLineLayer data={lines} color="#1d4ed8" width={3} />
        <MapCircleLayer data={points} color="#1d4ed8" radius={5} />
        <Interactions draw={vertices !== null} add={add} fit={fit} />
      </Map>
    </div>
  )
}

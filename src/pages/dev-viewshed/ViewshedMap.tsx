import { useEffect } from 'react'
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl'
import { Map, MapControls, MapMarker, MarkerContent, MapScaleBar, useMap } from '@/components/ui/map'
import { TerrainSupport } from '../dev-forestry/TerrainSupport'
import { metersPerDegree, type GeoPoint } from '../dev-forestry/visibility'
import type { ViewshedResult } from './analysis'

type Props = {
  observer: GeoPoint
  onObserver: (point: GeoPoint) => void
  result: ViewshedResult | null
  terrain: boolean
  onReady: (map: MapLibreMap | null) => void
  recenter: number
}
function Scene({ observer, onObserver, result, terrain, onReady, recenter }: Props) {
  const { map, isLoaded } = useMap()
  useEffect(() => { onReady(map); return () => onReady(null) }, [map, onReady])
  useEffect(() => {
    if (!map || !isLoaded) return
    const click = (event: MapMouseEvent) => {
      if ((event.originalEvent.target as Element)?.closest('.maplibregl-marker')) return
      onObserver({ lng: event.lngLat.lng, lat: event.lngLat.lat })
    }
    map.on('click', click)
    return () => { map.off('click', click) }
  }, [map, isLoaded, onObserver])
  useEffect(() => {
    if (!map || !isLoaded) return
    map.easeTo({ center: [observer.lng, observer.lat], zoom: 11, duration: 0 })
    // Preset changes recenter the map; dragging must not fight the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, isLoaded, recenter])
  useEffect(() => {
    if (!map || !isLoaded || !result) return
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = result.layout.size
    const context = canvas.getContext('2d')
    if (!context) return
    const data = context.createImageData(canvas.width, canvas.height)
    data.data.set(result.pixels)
    context.putImageData(data, 0, 0)
    const [west, south, east, north] = result.layout.bounds
    map.addSource('viewshed-coverage', {
      type: 'image', url: canvas.toDataURL('image/png'),
      coordinates: [[west, north], [east, north], [east, south], [west, south]],
    })
    map.addLayer({
      id: 'viewshed-coverage', type: 'raster', source: 'viewshed-coverage',
      paint: { 'raster-opacity': 0.85, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 },
    }, map.getStyle().layers.find((layer) => layer.type === 'symbol')?.id)
    return () => {
      if (map.getLayer('viewshed-coverage')) map.removeLayer('viewshed-coverage')
      if (map.getSource('viewshed-coverage')) map.removeSource('viewshed-coverage')
    }
  }, [map, isLoaded, result])
  return <>
    <TerrainSupport terrain={terrain} />
    <MapMarker longitude={observer.lng} latitude={observer.lat} draggable
      onDrag={onObserver} onDragEnd={onObserver}>
      <MarkerContent><button type="button" aria-label="Move viewshed observer"
        title="Drag the observer, or use arrow keys to move 100 m"
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
          event.preventDefault()
          const scale = metersPerDegree(observer.lat)
          onObserver({ lng: observer.lng + (event.key === 'ArrowRight' ? 100 : event.key === 'ArrowLeft' ? -100 : 0) / scale.lng,
            lat: observer.lat + (event.key === 'ArrowUp' ? 100 : event.key === 'ArrowDown' ? -100 : 0) / scale.lat })
        }}
        className="flex h-11 w-11 cursor-grab touch-none items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-primary active:cursor-grabbing">
        <span className="pointer-events-none block h-6 w-6 rounded-full border-4 border-white bg-sky-600 shadow-lg" />
      </button></MarkerContent>
    </MapMarker>
    <MapScaleBar position="bottom-left" />
  </>
}
export function ViewshedMap(props: Props) {
  return <Map center={[-122.7497, 53.9171]} zoom={11} maxPitch={70}
    controls={<MapControls showCompass showFullscreen />}>
    <Scene {...props} />
  </Map>
}

import { useEffect, useCallback } from 'react'
import { Map, MapMarker, MarkerContent, useMap } from '@/components/ui/map'
import { MAP_STYLES, PG_CENTER } from '@/components/ui/map-styles'
// @ts-expect-error - turf types issue with package exports
import * as turf from '@turf/turf'
import type maplibregl from 'maplibre-gl'
import type { SourceLocation } from '../../types'

interface RouletteLocationPickerProps {
  sourceLocation: SourceLocation | null
  maxDistance: number
  onLocationSelected: (location: SourceLocation) => void
}

const ZOOM = 11

export function RouletteLocationPicker({
  sourceLocation,
  maxDistance,
  onLocationSelected
}: RouletteLocationPickerProps) {
  const handleMapClick = useCallback((e: maplibregl.MapMouseEvent) => {
    onLocationSelected({
      lat: e.lngLat.lat,
      lng: e.lngLat.lng
    })
  }, [onLocationSelected])

  return (
    <div className="h-40 w-full cursor-crosshair overflow-hidden rounded-lg border border-input">
      <Map
        center={sourceLocation ? [sourceLocation.lng, sourceLocation.lat] : PG_CENTER}
        zoom={sourceLocation ? 12 : ZOOM}
        styles={MAP_STYLES}
      >
        <MapClickHandler onMapClick={handleMapClick} />
        <RadiusCircle sourceLocation={sourceLocation} maxDistance={maxDistance} />

        {sourceLocation && (
          <MapMarker
            longitude={sourceLocation.lng}
            latitude={sourceLocation.lat}
          >
            <MarkerContent>
              <div className="w-4 h-4 bg-red-500 rounded-full border-2 border-white shadow-lg" />
            </MarkerContent>
          </MapMarker>
        )}
      </Map>
    </div>
  )
}

function MapClickHandler({ onMapClick }: { onMapClick: (e: maplibregl.MapMouseEvent) => void }) {
  const { map, isLoaded } = useMap()

  useEffect(() => {
    if (!map || !isLoaded) return

    map.on('click', onMapClick)
    return () => {
      map.off('click', onMapClick)
    }
  }, [map, isLoaded, onMapClick])

  return null
}

function RadiusCircle({
  sourceLocation,
  maxDistance
}: {
  sourceLocation: SourceLocation | null
  maxDistance: number
}) {
  const { map, isLoaded } = useMap()
  const sourceId = 'radius-circle'
  const fillLayerId = 'radius-circle-fill'
  const strokeLayerId = 'radius-circle-stroke'

  useEffect(() => {
    if (!map || !isLoaded) return

    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: []
        }
      })

      map.addLayer({
        id: fillLayerId,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': '#3b82f6',
          'fill-opacity': 0.15
        }
      })

      map.addLayer({
        id: strokeLayerId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': '#3b82f6',
          'line-width': 2,
          'line-opacity': 0.6
        }
      })
    }

    const source = map.getSource(sourceId) as maplibregl.GeoJSONSource
    if (source) {
      if (sourceLocation) {
        const circleGeoJSON = turf.circle(
          [sourceLocation.lng, sourceLocation.lat],
          maxDistance,
          { units: 'kilometers', steps: 64 }
        )
        source.setData(circleGeoJSON)

        const bounds = turf.bbox(circleGeoJSON) as [number, number, number, number]
        map.fitBounds(bounds, { padding: 20, maxZoom: 14 })
      } else {
        source.setData({
          type: 'FeatureCollection',
          features: []
        })
      }
    }

    return () => {
      try {
        if (map.getLayer(fillLayerId)) map.removeLayer(fillLayerId)
        if (map.getLayer(strokeLayerId)) map.removeLayer(strokeLayerId)
        if (map.getSource(sourceId)) map.removeSource(sourceId)
      } catch {
        // Ignore errors during cleanup
      }
    }
  }, [map, isLoaded, sourceLocation, maxDistance])

  return null
}

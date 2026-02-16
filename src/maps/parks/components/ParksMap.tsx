import { useEffect, useId, useMemo, useRef } from 'react'
import {
  Map as PgMap,
  MapControls,
  MapMarker,
  MarkerContent,
  useMap,
  type MapRef,
} from '@/components/ui/map'
import { getClassificationColor, getTrailColor } from '../constants'
import type { Park, Trail, ParkAmenity, ActiveLayer } from '../types'

interface ParksMapProps {
  parks: Park[]
  trails: Trail[]
  amenities: ParkAmenity[]
  activeLayers: ActiveLayer[]
  selectedPark: Park | null
  selectedTrail: Trail | null
  onParkClick: (park: Park) => void
  onTrailClick: (trail: Trail) => void
}

const CENTER: [number, number] = [-122.764593, 53.909784]
const ZOOM = 12

const LIGHT_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
const DARK_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

function ParkPolygonsLayer({
  parks,
  selectedPark,
  visible,
  onParkClick,
}: {
  parks: Park[]
  selectedPark: Park | null
  visible: boolean
  onParkClick: (park: Park) => void
}) {
  const { map, isLoaded } = useMap()
  const id = useId().replace(/:/g, '')
  const sourceId = `parks-source-${id}`
  const fillLayerId = `parks-fill-${id}`
  const lineLayerId = `parks-line-${id}`
  const selectedFillLayerId = `parks-selected-fill-${id}`
  const parksByIdRef = useRef(new globalThis.Map<number, Park>())

  const geojson = useMemo<GeoJSON.FeatureCollection>(() => {
    const parksById = new globalThis.Map<number, Park>()
    const features = parks.map((park) => {
      parksById.set(park.id, park)
      return {
        type: 'Feature' as const,
        id: park.id,
        properties: {
          id: park.id,
          name: park.name,
          classification: park.classification || 'Unknown',
          color: getClassificationColor(park.classification),
        },
        geometry: park.geometry,
      }
    })
    parksByIdRef.current = parksById
    return { type: 'FeatureCollection', features }
  }, [parks])

  useEffect(() => {
    if (!isLoaded || !map) return

    map.addSource(sourceId, { type: 'geojson', data: geojson })

    map.addLayer({
      id: fillLayerId,
      type: 'fill',
      source: sourceId,
      paint: {
        'fill-color': ['get', 'color'],
        'fill-opacity': 0.25,
      },
    })

    map.addLayer({
      id: lineLayerId,
      type: 'line',
      source: sourceId,
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 1.5,
        'line-opacity': 0.7,
      },
    })

    map.addLayer({
      id: selectedFillLayerId,
      type: 'fill',
      source: sourceId,
      paint: {
        'fill-color': ['get', 'color'],
        'fill-opacity': 0.5,
      },
      filter: ['==', ['get', 'id'], -1],
    })

    const handleClick = (e: maplibregl.MapLayerMouseEvent) => {
      const feature = e.features?.[0]
      if (!feature) return
      const parkId = feature.properties?.id
      const park = parksByIdRef.current.get(parkId)
      if (park) onParkClick(park)
    }

    map.on('click', fillLayerId, handleClick)
    map.on('mouseenter', fillLayerId, () => {
      if (map.getCanvas()) map.getCanvas().style.cursor = 'pointer'
    })
    map.on('mouseleave', fillLayerId, () => {
      if (map.getCanvas()) map.getCanvas().style.cursor = ''
    })

    return () => {
      try {
        map.off('click', fillLayerId, handleClick)
        if (map.getLayer(selectedFillLayerId)) map.removeLayer(selectedFillLayerId)
        if (map.getLayer(lineLayerId)) map.removeLayer(lineLayerId)
        if (map.getLayer(fillLayerId)) map.removeLayer(fillLayerId)
        if (map.getSource(sourceId)) map.removeSource(sourceId)
      } catch {
        // ignore
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, map])

  // Update data
  useEffect(() => {
    if (!isLoaded || !map) return
    const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined
    if (source) source.setData(geojson)
  }, [isLoaded, map, geojson, sourceId])

  // Toggle visibility
  useEffect(() => {
    if (!isLoaded || !map) return
    const vis = visible ? 'visible' : 'none'
    for (const layerId of [fillLayerId, lineLayerId, selectedFillLayerId]) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', vis)
      }
    }
  }, [isLoaded, map, visible, fillLayerId, lineLayerId, selectedFillLayerId])

  // Highlight selected park
  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer(selectedFillLayerId)) return
    if (selectedPark) {
      map.setFilter(selectedFillLayerId, ['==', ['get', 'id'], selectedPark.id])
    } else {
      map.setFilter(selectedFillLayerId, ['==', ['get', 'id'], -1])
    }
  }, [isLoaded, map, selectedPark, selectedFillLayerId])

  return null
}

function TrailLinesLayer({
  trails,
  selectedTrail,
  visible,
  onTrailClick,
}: {
  trails: Trail[]
  selectedTrail: Trail | null
  visible: boolean
  onTrailClick: (trail: Trail) => void
}) {
  const { map, isLoaded } = useMap()
  const id = useId().replace(/:/g, '')
  const sourceId = `trails-source-${id}`
  const layerId = `trails-layer-${id}`
  const selectedLayerId = `trails-selected-${id}`
  const trailsByIdRef = useRef(new globalThis.Map<number, Trail>())

  const geojson = useMemo<GeoJSON.FeatureCollection>(() => {
    const trailsById = new globalThis.Map<number, Trail>()
    const features = trails.map((trail) => {
      trailsById.set(trail.id, trail)
      return {
        type: 'Feature' as const,
        id: trail.id,
        properties: {
          id: trail.id,
          name: trail.name,
          userClass: trail.userClass || 'Unknown',
          color: getTrailColor(trail.userClass),
        },
        geometry: {
          type: 'LineString' as const,
          coordinates: trail.coordinates,
        },
      }
    })
    trailsByIdRef.current = trailsById
    return { type: 'FeatureCollection', features }
  }, [trails])

  useEffect(() => {
    if (!isLoaded || !map) return

    map.addSource(sourceId, { type: 'geojson', data: geojson })

    map.addLayer({
      id: layerId,
      type: 'line',
      source: sourceId,
      layout: { 'line-join': 'round', 'line-cap': 'butt' },
      paint: {
        'line-color': '#ef4444',
        'line-width': 3,
        'line-opacity': 0.8,
        'line-dasharray': [2, 1.5],
      },
    })

    map.addLayer({
      id: selectedLayerId,
      type: 'line',
      source: sourceId,
      layout: { 'line-join': 'round', 'line-cap': 'butt' },
      paint: {
        'line-color': '#ef4444',
        'line-width': 5,
        'line-opacity': 1,
        'line-dasharray': [2, 1.5],
      },
      filter: ['==', ['get', 'id'], -1],
    })

    const handleClick = (e: maplibregl.MapLayerMouseEvent) => {
      const feature = e.features?.[0]
      if (!feature) return
      const trailId = feature.properties?.id
      const trail = trailsByIdRef.current.get(trailId)
      if (trail) onTrailClick(trail)
    }

    map.on('click', layerId, handleClick)
    map.on('mouseenter', layerId, () => {
      if (map.getCanvas()) map.getCanvas().style.cursor = 'pointer'
    })
    map.on('mouseleave', layerId, () => {
      if (map.getCanvas()) map.getCanvas().style.cursor = ''
    })

    return () => {
      try {
        map.off('click', layerId, handleClick)
        if (map.getLayer(selectedLayerId)) map.removeLayer(selectedLayerId)
        if (map.getLayer(layerId)) map.removeLayer(layerId)
        if (map.getSource(sourceId)) map.removeSource(sourceId)
      } catch {
        // ignore
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, map])

  useEffect(() => {
    if (!isLoaded || !map) return
    const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined
    if (source) source.setData(geojson)
  }, [isLoaded, map, geojson, sourceId])

  useEffect(() => {
    if (!isLoaded || !map) return
    const vis = visible ? 'visible' : 'none'
    for (const lid of [layerId, selectedLayerId]) {
      if (map.getLayer(lid)) {
        map.setLayoutProperty(lid, 'visibility', vis)
      }
    }
  }, [isLoaded, map, visible, layerId, selectedLayerId])

  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer(selectedLayerId)) return
    if (selectedTrail) {
      map.setFilter(selectedLayerId, ['==', ['get', 'id'], selectedTrail.id])
    } else {
      map.setFilter(selectedLayerId, ['==', ['get', 'id'], -1])
    }
  }, [isLoaded, map, selectedTrail, selectedLayerId])

  return null
}

export function ParksMap({
  parks,
  trails,
  amenities,
  activeLayers,
  selectedPark,
  selectedTrail,
  onParkClick,
  onTrailClick,
}: ParksMapProps) {
  const mapRef = useRef<MapRef>(null)

  const showParks = activeLayers.includes('parks')
  const showTrails = activeLayers.includes('trails')
  const showAmenities = activeLayers.includes('amenities')

  // Fly to selected park
  useEffect(() => {
    if (!selectedPark || !mapRef.current) return
    mapRef.current.flyTo({
      center: [selectedPark.longitude, selectedPark.latitude],
      zoom: 15,
      duration: 800,
    })
  }, [selectedPark])

  // Fly to selected trail
  useEffect(() => {
    if (!selectedTrail || !mapRef.current || selectedTrail.coordinates.length === 0) return
    const midIdx = Math.floor(selectedTrail.coordinates.length / 2)
    const [lng, lat] = selectedTrail.coordinates[midIdx]
    mapRef.current.flyTo({
      center: [lng, lat],
      zoom: 15,
      duration: 800,
    })
  }, [selectedTrail])

  const visibleAmenities = useMemo(() => {
    if (!showAmenities) return []
    return amenities.slice(0, 300)
  }, [amenities, showAmenities])

  return (
    <div className="h-full w-full">
      <PgMap
        ref={mapRef}
        center={CENTER}
        zoom={ZOOM}
        styles={{ light: LIGHT_STYLE, dark: DARK_STYLE }}
      >
        <MapControls position="top-right" showZoom showCompass />

        <ParkPolygonsLayer
          parks={parks}
          selectedPark={selectedPark}
          visible={showParks}
          onParkClick={onParkClick}
        />

        <TrailLinesLayer
          trails={trails}
          selectedTrail={selectedTrail}
          visible={showTrails}
          onTrailClick={onTrailClick}
        />

        {visibleAmenities.map((amenity) => (
          <MapMarker
            key={amenity.id}
            longitude={amenity.longitude}
            latitude={amenity.latitude}
          >
            <MarkerContent>
              <div className="h-2.5 w-2.5 rounded-full border border-white bg-amber-500 shadow-sm" />
            </MarkerContent>
          </MapMarker>
        ))}
      </PgMap>
    </div>
  )
}

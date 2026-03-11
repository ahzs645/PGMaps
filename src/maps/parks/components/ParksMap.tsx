import { useEffect, useMemo, useRef } from 'react'
import {
  Map as PgMap,
  MapControls,
  MapMarker,
  MarkerContent,
  type MapRef,
} from '@/components/ui/map'
import { MapFillLayer, MapLineLayer } from '@/components/ui/map-layers'
import { MAP_STYLES, PG_CENTER } from '@/components/ui/map-styles'
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

const ZOOM = 12

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
  const parksByIdRef = useRef(new globalThis.Map<number, Park>())
  const trailsByIdRef = useRef(new globalThis.Map<number, Trail>())

  const showParks = activeLayers.includes('parks')
  const showTrails = activeLayers.includes('trails')
  const showAmenities = activeLayers.includes('amenities')

  const parkGeojson = useMemo<GeoJSON.FeatureCollection>(() => {
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

  const trailGeojson = useMemo<GeoJSON.FeatureCollection>(() => {
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
        center={PG_CENTER}
        zoom={ZOOM}
        styles={MAP_STYLES}
      >
        <MapControls position="top-right" showZoom showCompass />

        <MapFillLayer
          data={parkGeojson}
          fillColor={['get', 'color']}
          fillOpacity={0.25}
          lineColor={['get', 'color']}
          lineWidth={1.5}
          lineOpacity={0.7}
          selectedId={selectedPark?.id ?? null}
          selectionStyle="fill"
          selectionFillOpacity={0.5}
          visible={showParks}
          onFeatureClick={(id) => {
            const park = parksByIdRef.current.get(Number(id))
            if (park) onParkClick(park)
          }}
        />

        <MapLineLayer
          data={trailGeojson}
          color="#ef4444"
          width={3}
          opacity={0.8}
          dashArray={[2, 1.5]}
          lineCap="butt"
          selectedId={selectedTrail?.id ?? null}
          selectionColor="#ef4444"
          selectionWidth={5}
          visible={showTrails}
          onFeatureClick={(id) => {
            const trail = trailsByIdRef.current.get(Number(id))
            if (trail) onTrailClick(trail)
          }}
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

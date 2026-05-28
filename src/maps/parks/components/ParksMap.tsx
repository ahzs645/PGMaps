import { useEffect, useMemo, useRef } from 'react'
import MapLibreGL from 'maplibre-gl'
import {
  MapClusterLayer,
  MapMarker,
  MarkerContent,
  useMap,
} from '@/components/ui/map'
import { MapFillLayer, MapLineLayer } from '@/components/ui/map-layers'
import { SharedMap } from '@/components/ui/persistent-map'
import { MAP_STYLES } from '@/components/ui/map-styles'
import { getClassificationColor, getTrailColor } from '../constants'
import type { Park, Trail, ParkAmenity, ActiveLayer, CityPgOverlayData } from '../types'

function extendBounds(
  bounds: MapLibreGL.LngLatBounds,
  coordinates: GeoJSON.Position[] | GeoJSON.Position[][] | GeoJSON.Position[][][],
) {
  for (const item of coordinates) {
    if (typeof item[0] === 'number' && typeof item[1] === 'number') {
      bounds.extend(item as [number, number])
    } else {
      extendBounds(bounds, item as GeoJSON.Position[] | GeoJSON.Position[][] | GeoJSON.Position[][][])
    }
  }
}

function getParkBounds(park: Park) {
  const bounds = new MapLibreGL.LngLatBounds()
  extendBounds(bounds, park.geometry.coordinates)
  return bounds
}

function getTrailBounds(trail: Trail) {
  const bounds = new MapLibreGL.LngLatBounds()
  trail.coordinates.forEach((coordinate) => bounds.extend(coordinate))
  return bounds
}

interface ParksMapProps {
  parks: Park[]
  trails: Trail[]
  amenities: ParkAmenity[]
  cityOverlays: CityPgOverlayData
  activeLayers: ActiveLayer[]
  selectedPark: Park | null
  selectedTrail: Trail | null
  selectionFocusKey: number
  loading?: boolean
  onParkClick: (park: Park) => void
  onTrailClick: (trail: Trail) => void
}

export function ParksMap({
  parks,
  trails,
  amenities,
  cityOverlays,
  activeLayers,
  selectedPark,
  selectedTrail,
  selectionFocusKey,
  loading = false,
  onParkClick,
  onTrailClick,
}: ParksMapProps) {
  const { map } = useMap()
  const parksByIdRef = useRef(new globalThis.Map<number, Park>())
  const trailsByIdRef = useRef(new globalThis.Map<number, Trail>())

  const showParks = activeLayers.includes('parks')
  const showTrails = activeLayers.includes('trails')
  const showAmenities = activeLayers.includes('amenities')
  const showParkAssets = activeLayers.includes('parkAssets')
  const showMobility = activeLayers.includes('mobility')
  const showEcology = activeLayers.includes('ecology')
  const showCommunity = activeLayers.includes('community')
  const showServices = activeLayers.includes('services')
  const showPlanning = activeLayers.includes('planning')

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

  // Fit selected park
  useEffect(() => {
    if (!selectedPark || !map) return
    const bounds = getParkBounds(selectedPark)
    if (bounds.isEmpty()) {
      map.flyTo({
        center: [selectedPark.longitude, selectedPark.latitude],
        zoom: 15,
        duration: 800,
      })
      return
    }
    map.fitBounds(bounds, {
      padding: { top: 96, right: 96, bottom: 96, left: 96 },
      maxZoom: 16,
      duration: 800,
    })
  }, [map, selectedPark, selectionFocusKey])

  // Fit selected trail
  useEffect(() => {
    if (!selectedTrail || !map || selectedTrail.coordinates.length === 0) return
    const bounds = getTrailBounds(selectedTrail)
    map.fitBounds(bounds, {
      padding: { top: 96, right: 96, bottom: 96, left: 96 },
      maxZoom: 16,
      duration: 800,
    })
  }, [map, selectedTrail, selectionFocusKey])

  const visibleAmenities = useMemo(() => {
    if (!showAmenities) return []
    return amenities.slice(0, 300)
  }, [amenities, showAmenities])

  return (
    <div className="h-full w-full">
      <SharedMap styles={MAP_STYLES} loading={loading} loadingLabel="Loading parks and trails data">
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
          color={['get', 'color']}
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

        {showEcology && (
          <MapFillLayer
            data={cityOverlays.ecologyAreas}
            fillColor={['get', 'color']}
            fillOpacity={0.16}
            lineColor={['get', 'color']}
            lineWidth={0.8}
            lineOpacity={0.55}
            visible
          />
        )}

        {showCommunity && (
          <>
            <MapFillLayer
              data={cityOverlays.communityAreas}
              fillColor="#6366f1"
              fillOpacity={0.04}
              lineColor="#6366f1"
              lineWidth={1.2}
              lineOpacity={0.8}
              visible
            />
            <MapFillLayer
              data={cityOverlays.civicAreas}
              fillColor="#0ea5e9"
              fillOpacity={0.35}
              lineColor="#0369a1"
              lineWidth={0.8}
              lineOpacity={0.6}
              visible
            />
          </>
        )}

        {showServices && (
          <>
            <MapLineLayer
              data={cityOverlays.serviceLines}
              color="#38bdf8"
              width={2}
              opacity={0.55}
              visible
            />
            <MapFillLayer
              data={cityOverlays.serviceAreas}
              fillColor={['get', 'color']}
              fillOpacity={0.12}
              lineColor={['get', 'color']}
              lineWidth={1}
              lineOpacity={0.55}
              visible
            />
          </>
        )}

        {showPlanning && (
          <>
            <MapLineLayer
              data={cityOverlays.planningLines}
              color="#f97316"
              width={2.8}
              opacity={0.78}
              dashArray={[2, 1.4]}
              visible
            />
            <MapFillLayer
              data={cityOverlays.planningAreas}
              fillColor={['get', 'color']}
              fillOpacity={0.18}
              lineColor={['get', 'color']}
              lineWidth={1}
              lineOpacity={0.65}
              visible
            />
            <MapClusterLayer
              data={cityOverlays.planningPoints}
              pointColor="#f97316"
              clusterColors={['#fdba74', '#fb923c', '#ea580c']}
              clusterThresholds={[20, 80]}
            />
          </>
        )}

        {showParkAssets && (
          <>
            <MapFillLayer
              data={cityOverlays.parkAreas}
              fillColor={['get', 'color']}
              fillOpacity={0.3}
              lineColor={['get', 'color']}
              lineWidth={0.9}
              lineOpacity={0.55}
              visible
            />
            <MapLineLayer
              data={cityOverlays.parkLines}
              color={['get', 'color']}
              width={2.4}
              opacity={0.75}
              visible
            />
            <MapClusterLayer
              data={cityOverlays.parkAssets}
              pointColor="#16a34a"
              clusterColors={['#86efac', '#22c55e', '#15803d']}
              clusterThresholds={[80, 400]}
            />
          </>
        )}

        {showMobility && (
          <>
            <MapLineLayer
              data={cityOverlays.mobilityLines}
              color={['get', 'color']}
              width={2.4}
              opacity={0.78}
              visible
            />
            <MapClusterLayer
              data={cityOverlays.mobilityPoints}
              pointColor="#ef4444"
              clusterColors={['#fca5a5', '#ef4444', '#b91c1c']}
              clusterThresholds={[20, 100]}
            />
          </>
        )}

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
      </SharedMap>
    </div>
  )
}

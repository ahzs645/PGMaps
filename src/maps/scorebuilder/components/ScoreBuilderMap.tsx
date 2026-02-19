import { useEffect, useMemo, useRef } from 'react'
import {
  Map as PgMap,
  MapClusterLayer,
  MapControls,
  type MapRef
} from '@/components/ui/map'
import { ChoroplethLayer } from '@/components/ui/map-choropleth-layer'
import {
  MAP_STYLES,
  PG_CENTER,
  PG_DEFAULT_ZOOM,
  FIT_BOUNDS_PADDING,
  FIT_BOUNDS_DURATION,
} from '@/components/ui/map-constants'
import type { AirMonitor } from '@/maps/airquality'
import type { ScoredBoundaryRegion } from '../types'

interface ScoreBuilderMapProps {
  regions: ScoredBoundaryRegion[]
  selectedRegionId: string | null
  monitors: AirMonitor[]
  showPoints: boolean
  onRegionClick: (regionId: string) => void
}

export function ScoreBuilderMap({
  regions,
  selectedRegionId,
  monitors,
  showPoints,
  onRegionClick
}: ScoreBuilderMapProps) {
  const mapRef = useRef<MapRef>(null)

  const featureCollection = useMemo<GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, GeoJSON.GeoJsonProperties>>(() => {
    return {
      type: 'FeatureCollection',
      features: regions.map((entry) => ({
        type: 'Feature',
        geometry: entry.region.feature.geometry,
        properties: {
          id: entry.region.id,
          code: entry.region.code,
          name: entry.region.name,
          score: entry.score,
          color: entry.scoreColor,
          monitorCount: entry.counts.monitorCount,
          density: entry.metrics.overallDensity
        }
      }))
    }
  }, [regions])

  const points = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point, GeoJSON.GeoJsonProperties>>(() => {
    return {
      type: 'FeatureCollection',
      features: monitors.map((monitor) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [monitor.longitude, monitor.latitude]
        },
        properties: {
          id: monitor.id,
          network: monitor.network,
          name: monitor.name
        }
      }))
    }
  }, [monitors])

  const selectedRegion = useMemo(() => {
    if (!selectedRegionId) return null
    return regions.find((entry) => entry.region.id === selectedRegionId)?.region || null
  }, [regions, selectedRegionId])

  useEffect(() => {
    if (!selectedRegion || !mapRef.current) return

    mapRef.current.fitBounds(
      [
        [selectedRegion.bounds[0], selectedRegion.bounds[1]],
        [selectedRegion.bounds[2], selectedRegion.bounds[3]]
      ],
      {
        padding: FIT_BOUNDS_PADDING,
        duration: FIT_BOUNDS_DURATION,
        maxZoom: 10
      }
    )
  }, [selectedRegion])

  return (
    <div className="h-full w-full">
      <PgMap
        ref={mapRef}
        center={PG_CENTER}
        zoom={PG_DEFAULT_ZOOM}
        styles={{ light: MAP_STYLES.light, dark: MAP_STYLES.dark }}
      >
        <MapControls position="top-right" showZoom showCompass />

        <ChoroplethLayer
          data={featureCollection}
          selectedFeatureId={selectedRegionId}
          onFeatureClick={onRegionClick}
        />

        {showPoints && points.features.length > 0 && (
          <MapClusterLayer
            data={points}
            clusterRadius={40}
            clusterThresholds={[40, 180]}
            clusterColors={['#38bdf8', '#22c55e', '#f59e0b']}
            pointColor="#0ea5e9"
          />
        )}
      </PgMap>
    </div>
  )
}

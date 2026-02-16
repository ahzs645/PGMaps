import { useEffect, useId, useMemo, useRef } from 'react'
import {
  Map as PgMap,
  MapClusterLayer,
  MapControls,
  useMap,
  type MapRef
} from '@/components/ui/map'
import type { AirMonitor } from '@/maps/airquality'
import type { ScoredBoundaryRegion } from '../types'

interface ScoreBuilderMapProps {
  regions: ScoredBoundaryRegion[]
  selectedRegionId: string | null
  monitors: AirMonitor[]
  showPoints: boolean
  onRegionClick: (regionId: string) => void
}

interface ChoroplethLayerProps {
  data: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, GeoJSON.GeoJsonProperties>
  selectedRegionId: string | null
  onRegionClick: (regionId: string) => void
}

const CENTER: [number, number] = [-122.764593, 53.909784]
const ZOOM = 12
const LIGHT_STYLE = 'https://tiles.openfreemap.org/styles/bright'
const DARK_STYLE = 'https://tiles.openfreemap.org/styles/dark'

function ScoreChoroplethLayer({ data, selectedRegionId, onRegionClick }: ChoroplethLayerProps) {
  const { map, isLoaded } = useMap()
  const uid = useId().replace(/:/g, '')
  const sourceId = `score-builder-source-${uid}`
  const fillLayerId = `score-builder-fill-${uid}`
  const lineLayerId = `score-builder-line-${uid}`
  const selectedLayerId = `score-builder-selected-${uid}`

  useEffect(() => {
    if (!isLoaded || !map) return

    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: 'geojson',
        data
      } as never)
    }

    if (!map.getLayer(fillLayerId)) {
      map.addLayer({
        id: fillLayerId,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': ['coalesce', ['get', 'scoreColor'], '#475569'],
          'fill-opacity': 0.72
        }
      } as never)
    }

    if (!map.getLayer(lineLayerId)) {
      map.addLayer({
        id: lineLayerId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': '#0f172a',
          'line-width': 0.7,
          'line-opacity': 0.45
        }
      } as never)
    }

    if (!map.getLayer(selectedLayerId)) {
      map.addLayer({
        id: selectedLayerId,
        type: 'line',
        source: sourceId,
        filter: ['==', ['get', 'id'], ''],
        paint: {
          'line-color': '#38bdf8',
          'line-width': 2.8,
          'line-opacity': 1
        }
      } as never)
    }

    const handleClick = (event: unknown) => {
      const e = event as { features?: Array<{ properties?: { id?: string } }> }
      const id = e.features?.[0]?.properties?.id
      if (id) {
        onRegionClick(id)
      }
    }

    const handleMouseEnter = () => {
      map.getCanvas().style.cursor = 'pointer'
    }

    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = ''
    }

    map.on('click', fillLayerId, handleClick as never)
    map.on('mouseenter', fillLayerId, handleMouseEnter)
    map.on('mouseleave', fillLayerId, handleMouseLeave)

    return () => {
      try {
        map.off('click', fillLayerId, handleClick as never)
        map.off('mouseenter', fillLayerId, handleMouseEnter)
        map.off('mouseleave', fillLayerId, handleMouseLeave)

        if (!map.getStyle()) return
        if (map.getLayer(selectedLayerId)) map.removeLayer(selectedLayerId)
        if (map.getLayer(lineLayerId)) map.removeLayer(lineLayerId)
        if (map.getLayer(fillLayerId)) map.removeLayer(fillLayerId)
        if (map.getSource(sourceId)) map.removeSource(sourceId)
      } catch {
        // Map already destroyed during unmount.
      }
    }
  }, [data, fillLayerId, isLoaded, lineLayerId, map, onRegionClick, selectedLayerId, sourceId])

  useEffect(() => {
    if (!isLoaded || !map) return
    const source = map.getSource(sourceId) as { setData?: (nextData: unknown) => void } | undefined
    source?.setData?.(data)
  }, [data, isLoaded, map, sourceId])

  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer(selectedLayerId)) return
    map.setFilter(selectedLayerId, ['==', ['get', 'id'], selectedRegionId || ''])
  }, [isLoaded, map, selectedLayerId, selectedRegionId])

  return null
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
          scoreColor: entry.scoreColor,
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
        padding: 80,
        duration: 500,
        maxZoom: 10
      }
    )
  }, [selectedRegion])

  return (
    <div className="h-full w-full">
      <PgMap
        ref={mapRef}
        center={CENTER}
        zoom={ZOOM}
        styles={{ light: LIGHT_STYLE, dark: DARK_STYLE }}
      >
        <MapControls position="top-right" showZoom showCompass />

        <ScoreChoroplethLayer
          data={featureCollection}
          selectedRegionId={selectedRegionId}
          onRegionClick={onRegionClick}
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

import { useEffect, useMemo, useRef } from 'react'
import { Map as PgMap, MapControls, type MapRef } from '@/components/ui/map'
import { ChoroplethLayer } from '@/components/ui/map-choropleth-layer'
import {
  MAP_STYLES,
  PG_CENTER,
  FIT_BOUNDS_PADDING,
  FIT_BOUNDS_DURATION,
} from '@/components/ui/map-constants'
import type { CensusBounds, CensusMetricKey, CensusUnit } from '../types'

interface CensusMapProps {
  units: CensusUnit[]
  selectedMetric: CensusMetricKey
  selectedUnitId: string | null
  bounds: CensusBounds | null
  onUnitClick: (id: string) => void
}

const ZOOM = 10

function getChoroplethColor(value: number | null, min: number, max: number): string {
  if (value == null || !Number.isFinite(value)) return '#475569'
  if (max <= min) return '#f59e0b'

  const t = Math.max(0, Math.min(1, (value - min) / (max - min)))
  if (t <= 0.2) return '#fef3c7'
  if (t <= 0.4) return '#fde68a'
  if (t <= 0.6) return '#fbbf24'
  if (t <= 0.8) return '#f59e0b'
  return '#b45309'
}

export function CensusMap({
  units,
  selectedMetric,
  selectedUnitId,
  bounds,
  onUnitClick
}: CensusMapProps) {
  const mapRef = useRef<MapRef>(null)
  const lastBoundsKeyRef = useRef<string | null>(null)

  const metricValues = useMemo(() => {
    return units
      .map((unit) => unit[selectedMetric])
      .filter((value): value is number => value != null && Number.isFinite(value))
  }, [selectedMetric, units])

  const metricRange = useMemo(() => {
    if (!metricValues.length) return { min: 0, max: 1 }
    return {
      min: Math.min(...metricValues),
      max: Math.max(...metricValues)
    }
  }, [metricValues])

  const featureCollection = useMemo<GeoJSON.FeatureCollection<GeoJSON.Geometry, GeoJSON.GeoJsonProperties>>(() => {
    return {
      type: 'FeatureCollection',
      features: units.map((unit) => {
        const value = unit[selectedMetric] ?? null
        return {
          type: 'Feature',
          geometry: unit.geometry,
          properties: {
            id: unit.id,
            metricValue: value,
            color: getChoroplethColor(value, metricRange.min, metricRange.max)
          }
        }
      })
    }
  }, [metricRange.max, metricRange.min, selectedMetric, units])

  const selectedFeatures = useMemo(() => {
    if (!selectedUnitId) return []
    return units.filter((unit) => unit.id === selectedUnitId)
  }, [selectedUnitId, units])

  const boundsKey = useMemo(() => {
    if (!bounds) return null
    return [bounds.minLng, bounds.minLat, bounds.maxLng, bounds.maxLat].join('|')
  }, [bounds])

  useEffect(() => {
    if (!bounds || !boundsKey || !mapRef.current) return
    if (lastBoundsKeyRef.current === boundsKey) return

    mapRef.current.fitBounds(
      [
        [bounds.minLng, bounds.minLat],
        [bounds.maxLng, bounds.maxLat]
      ],
      {
        padding: 32,
        duration: FIT_BOUNDS_DURATION
      }
    )
    lastBoundsKeyRef.current = boundsKey
  }, [bounds, boundsKey])

  useEffect(() => {
    if (!selectedFeatures.length || !mapRef.current) return

    let minLng = Infinity
    let minLat = Infinity
    let maxLng = -Infinity
    let maxLat = -Infinity

    const scanRing = (ring: number[][]) => {
      ring.forEach(([lng, lat]) => {
        if (lng < minLng) minLng = lng
        if (lng > maxLng) maxLng = lng
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
      })
    }

    selectedFeatures.forEach((area) => {
      if (area.geometry.type === 'Polygon') {
        area.geometry.coordinates.forEach((ring) => scanRing(ring))
      } else {
        area.geometry.coordinates.forEach((polygon) => {
          polygon.forEach((ring) => scanRing(ring))
        })
      }
    })

    if (Number.isFinite(minLng) && Number.isFinite(minLat) && Number.isFinite(maxLng) && Number.isFinite(maxLat)) {
      mapRef.current.fitBounds(
        [
          [minLng, minLat],
          [maxLng, maxLat]
        ],
        {
          padding: FIT_BOUNDS_PADDING,
          duration: FIT_BOUNDS_DURATION
        }
      )
    }
  }, [selectedFeatures])

  return (
    <div className="h-full w-full">
      <PgMap
        ref={mapRef}
        center={PG_CENTER}
        zoom={ZOOM}
        styles={{ light: MAP_STYLES.light, dark: MAP_STYLES.dark }}
      >
        <MapControls position="top-right" showZoom showCompass />
        <ChoroplethLayer
          data={featureCollection}
          selectedFeatureId={selectedUnitId}
          onFeatureClick={onUnitClick}
        />
      </PgMap>
    </div>
  )
}

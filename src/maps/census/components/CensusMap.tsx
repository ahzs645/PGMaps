import { useEffect, useMemo, useRef } from 'react'
import { Map as PgMap, MapControls, type MapRef } from '@/components/ui/map'
import { MapFillLayer } from '@/components/ui/map-layers'
import { MAP_STYLES, PG_CENTER, getChoroplethColor } from '@/components/ui/map-styles'
import type { CensusBounds, CensusMetricKey, CensusUnit } from '../types'

interface CensusMapProps {
  units: CensusUnit[]
  selectedMetric: CensusMetricKey
  selectedUnitId: string | null
  bounds: CensusBounds | null
  onUnitClick: (id: string) => void
  variableValuesByGeoUid?: Map<string, number | null> | null
  loading?: boolean
}

const ZOOM = 10

export function CensusMap({
  units,
  selectedMetric,
  selectedUnitId,
  bounds,
  onUnitClick,
  variableValuesByGeoUid,
  loading = false
}: CensusMapProps) {
  const mapRef = useRef<MapRef>(null)
  const lastBoundsKeyRef = useRef<string | null>(null)

  // When variable data is available, use it for coloring; otherwise fall back to built-in metrics
  const useVariable = variableValuesByGeoUid != null && variableValuesByGeoUid.size > 0

  const metricValues = useMemo(() => {
    if (useVariable) {
      const values: number[] = []
      for (const val of variableValuesByGeoUid!.values()) {
        if (val != null && Number.isFinite(val)) values.push(val)
      }
      return values
    }
    return units
      .map((unit) => unit[selectedMetric])
      .filter((value): value is number => value != null && Number.isFinite(value))
  }, [selectedMetric, units, useVariable, variableValuesByGeoUid])

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
        const value = useVariable
          ? (variableValuesByGeoUid!.get(unit.id) ?? null)
          : (unit[selectedMetric] ?? null)
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
  }, [metricRange.max, metricRange.min, selectedMetric, units, useVariable, variableValuesByGeoUid])

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
        duration: 700
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
          padding: 80,
          duration: 500
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
        styles={MAP_STYLES}
        loading={loading}
      >
        <MapControls position="top-right" mobilePosition="bottom-right" showZoom showCompass />
        <MapFillLayer
          data={featureCollection}
          fillColor={['coalesce', ['get', 'color'], '#475569']}
          fillOpacity={0.72}
          lineColor="#0f172a"
          lineWidth={0.6}
          lineOpacity={0.55}
          selectedId={selectedUnitId}
          onFeatureClick={onUnitClick}
        />
      </PgMap>
    </div>
  )
}

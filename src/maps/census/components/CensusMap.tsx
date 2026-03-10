import { useEffect, useId, useMemo, useRef } from 'react'
import { Map as PgMap, MapControls, useMap, type MapRef } from '@/components/ui/map'
import type { CensusBounds, CensusMetricKey, CensusUnit } from '../types'

interface CensusMapProps {
  units: CensusUnit[]
  selectedMetric: CensusMetricKey
  selectedUnitId: string | null
  bounds: CensusBounds | null
  onUnitClick: (id: string) => void
  variableValuesByGeoUid?: Map<string, number | null> | null
}

interface ChoroplethLayerProps {
  data: GeoJSON.FeatureCollection<GeoJSON.Geometry, GeoJSON.GeoJsonProperties>
  selectedUnitId: string | null
  onUnitClick: (id: string) => void
}

const CENTER: [number, number] = [-122.764593, 53.909784]
const ZOOM = 10
const LIGHT_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
const DARK_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

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

function CensusChoroplethLayer({ data, selectedUnitId, onUnitClick }: ChoroplethLayerProps) {
  const { map, isLoaded } = useMap()
  const uid = useId().replace(/:/g, '')
  const sourceId = `census-source-${uid}`
  const fillLayerId = `census-fill-${uid}`
  const lineLayerId = `census-line-${uid}`
  const selectedLayerId = `census-selected-${uid}`

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
          'fill-color': ['coalesce', ['get', 'color'], '#475569'],
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
          'line-width': 0.6,
          'line-opacity': 0.55
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
      if (id) onUnitClick(id)
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
        // Map already destroyed during unmount
      }
    }
  }, [data, fillLayerId, isLoaded, lineLayerId, map, onUnitClick, selectedLayerId, sourceId])

  useEffect(() => {
    if (!isLoaded || !map) return
    const source = map.getSource(sourceId) as { setData?: (nextData: unknown) => void } | undefined
    source?.setData?.(data)
  }, [data, isLoaded, map, sourceId])

  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer(selectedLayerId)) return
    map.setFilter(selectedLayerId, ['==', ['get', 'id'], selectedUnitId || ''])
  }, [isLoaded, map, selectedLayerId, selectedUnitId])

  return null
}

export function CensusMap({
  units,
  selectedMetric,
  selectedUnitId,
  bounds,
  onUnitClick,
  variableValuesByGeoUid
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
        center={CENTER}
        zoom={ZOOM}
        styles={{ light: LIGHT_STYLE, dark: DARK_STYLE }}
      >
        <MapControls position="top-right" showZoom showCompass />
        <CensusChoroplethLayer
          data={featureCollection}
          selectedUnitId={selectedUnitId}
          onUnitClick={onUnitClick}
        />
      </PgMap>
    </div>
  )
}

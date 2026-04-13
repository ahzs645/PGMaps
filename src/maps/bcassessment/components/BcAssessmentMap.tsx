import { useEffect, useMemo, useRef } from 'react'
import {
  Map as PgMap,
  MapControls,
  type MapRef,
} from '@/components/ui/map'
import { MapFillLayer, MapLineLayer } from '@/components/ui/map-layers'
import { MAP_STYLES, PG_CENTER } from '@/components/ui/map-styles'
import {
  getValueColor,
  VALUE_STOPS,
  YEAR_STOPS,
} from '../constants'
import type { Property, ColorMetric } from '../types'

interface BcAssessmentMapProps {
  properties: Property[]
  colorMetric: ColorMetric
  selectedProperty: Property | null
  boundaryData: GeoJSON.FeatureCollection | null
  onPropertyClick: (property: Property) => void
}

const ZOOM = 12

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

export function BcAssessmentMap({
  properties,
  colorMetric,
  selectedProperty,
  boundaryData,
  onPropertyClick,
}: BcAssessmentMapProps) {
  const mapRef = useRef<MapRef>(null)
  const propsById = useRef(new globalThis.Map<string, Property>())

  const geojson = useMemo<GeoJSON.FeatureCollection>(() => {
    const byId = new globalThis.Map<string, Property>()
    const features = properties.map((prop, idx) => {
      byId.set(prop.id, prop)

      let color: string
      if (colorMetric === 'yearBuilt') {
        color = prop.yearBuilt ? getValueColor(prop.yearBuilt, YEAR_STOPS) : '#d4d4d4'
      } else {
        const value = prop[colorMetric]
        color = typeof value === 'number' ? getValueColor(value, VALUE_STOPS) : '#d4d4d4'
      }

      return {
        type: 'Feature' as const,
        id: idx,
        properties: {
          id: prop.id,
          idx,
          color,
        },
        geometry: prop.geometry,
      }
    })
    propsById.current = byId
    return { type: 'FeatureCollection', features }
  }, [properties, colorMetric])

  // Build a numeric index -> property lookup for click handling
  const indexToProperty = useRef(new globalThis.Map<number, Property>())
  useEffect(() => {
    const map = new globalThis.Map<number, Property>()
    properties.forEach((prop, idx) => {
      map.set(idx, prop)
    })
    indexToProperty.current = map
  }, [properties])

  // Fly to selected property
  useEffect(() => {
    if (!selectedProperty || !mapRef.current) return
    mapRef.current.flyTo({
      center: [selectedProperty.longitude, selectedProperty.latitude],
      zoom: 16,
      duration: 800,
    })
  }, [selectedProperty])

  // Find selected feature index
  const selectedIdx = useMemo(() => {
    if (!selectedProperty) return null
    const idx = properties.findIndex((p) => p.id === selectedProperty.id)
    return idx >= 0 ? idx : null
  }, [properties, selectedProperty])

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
          data={geojson}
          fillColor={['get', 'color']}
          fillOpacity={0.65}
          lineColor={['get', 'color']}
          lineWidth={0.5}
          lineOpacity={0.4}
          idProperty="idx"
          selectedId={selectedIdx}
          selectionStyle="fill"
          selectionFillOpacity={0.9}
          onFeatureClick={(id) => {
            const prop = indexToProperty.current.get(Number(id))
            if (prop) onPropertyClick(prop)
          }}
        />

        {/* Census boundary overlay */}
        <MapLineLayer
          data={boundaryData ?? EMPTY_FC}
          color="#f97316"
          width={2.5}
          opacity={0.85}
          visible={!!boundaryData}
        />
      </PgMap>
    </div>
  )
}

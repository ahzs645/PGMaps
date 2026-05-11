import { useEffect, useMemo, useRef } from 'react'
import { Map as PgMap, MapControls, type MapRef } from '@/components/ui/map'
import { MapFillLayer } from '@/components/ui/map-layers'
import { MAP_STYLES } from '@/components/ui/map-styles'
import { DROUGHT_BC_CENTER } from '../constants'
import type { DroughtFeatureCollection } from '../types'

interface DroughtMapProps {
  data: DroughtFeatureCollection
  selectedId: string | null
  onFeatureClick: (id: string) => void
}

const DROUGHT_FILL_COLOR = ['coalesce', ['get', 'droughtColor'], '#8a8f98']
const DROUGHT_LINE_COLOR = ['case', ['==', ['get', 'droughtLevel'], null], '#4b5563', '#263238']

export function DroughtMap({ data, selectedId, onFeatureClick }: DroughtMapProps) {
  const mapRef = useRef<MapRef>(null)
  const featureCount = data.features.length

  useEffect(() => {
    const map = mapRef.current
    if (!map || featureCount === 0) return
    map.fitBounds(
      [
        [-139.2, 48.2],
        [-113.8, 60.1],
      ],
      { padding: 36, duration: 0 },
    )
  }, [featureCount])

  const mapData = useMemo(() => ({
    ...data,
    features: data.features.map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        id: String(feature.id ?? feature.properties.sourceObjectId),
      },
    })),
  }), [data])

  return (
    <PgMap ref={mapRef} center={DROUGHT_BC_CENTER} zoom={4.3} styles={MAP_STYLES}>
      <MapControls position="top-right" showZoom showCompass />
      <MapFillLayer
        data={mapData}
        fillColor={DROUGHT_FILL_COLOR}
        fillOpacity={0.82}
        lineColor={DROUGHT_LINE_COLOR}
        lineOpacity={0.48}
        lineWidth={0.7}
        idProperty="id"
        selectedId={selectedId}
        selectionColor="#111827"
        selectionWidth={2.5}
        onFeatureClick={onFeatureClick}
      />
    </PgMap>
  )
}

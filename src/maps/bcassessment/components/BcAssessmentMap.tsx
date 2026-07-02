import { useEffect, useMemo, useRef } from 'react'
import {
  Map as PgMap,
  MapControls,
  type MapRef,
} from '@/components/ui/map'
import { MapFillLayer } from '@/components/ui/map-layers'
import { MAP_STYLES, PG_CENTER, PG_DEFAULT_ZOOM } from '@/components/ui/map-styles'
import {
  getValueColor,
  getInterpolatedValueColor,
  VALUE_STOPS,
  YEAR_STOPS,
  formatCurrency,
} from '../constants'
import type { Property, ColorMetric, BoundaryAggregate, BoundaryLevel } from '../types'

type ColorScaleMode = 'stepped' | 'continuous'

interface BcAssessmentMapProps {
  properties: Property[]
  colorMetric: ColorMetric
  selectedProperty: Property | null
  selectedBoundaryId: string | null
  boundaryLevel: BoundaryLevel
  boundaryData: GeoJSON.FeatureCollection | null
  boundaryAggregates: Map<string, BoundaryAggregate>
  colorScaleMode?: ColorScaleMode
  onPropertyClick: (property: Property) => void
  onBoundaryClick: (boundaryId: string) => void
  loading?: boolean
}

const ZOOM = PG_DEFAULT_ZOOM

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

function getAggregateValue(agg: BoundaryAggregate, metric: ColorMetric): number | null {
  switch (metric) {
    case 'totalAssessed': return agg.avgAssessed
    case 'totalLand': return agg.avgLand
    case 'totalBuilding': return agg.avgBuilding
    case 'yearBuilt': return agg.avgYearBuilt
  }
}

function getBoundaryLineStyle(level: BoundaryLevel): { lineWidth: number; selectionWidth: number } {
  switch (level) {
    case 'db':
      return { lineWidth: 0.45, selectionWidth: 1.6 }
    case 'da':
      return { lineWidth: 0.9, selectionWidth: 2.4 }
    case 'ct':
      return { lineWidth: 1.8, selectionWidth: 3.2 }
    default:
      return { lineWidth: 2.5, selectionWidth: 4 }
  }
}

export function BcAssessmentMap({
  properties,
  colorMetric,
  selectedProperty,
  selectedBoundaryId,
  boundaryLevel,
  boundaryData,
  boundaryAggregates,
  colorScaleMode = 'stepped',
  onPropertyClick,
  onBoundaryClick,
  loading = false,
}: BcAssessmentMapProps) {
  const mapRef = useRef<MapRef>(null)

  const showBoundaries = !!boundaryData && boundaryAggregates.size > 0

  const geojson = useMemo<GeoJSON.FeatureCollection>(() => {
    const getColor = colorScaleMode === 'continuous' ? getInterpolatedValueColor : getValueColor
    const features = properties.map((prop, idx) => {
      let color: string
      if (colorMetric === 'yearBuilt') {
        color = prop.yearBuilt ? getColor(prop.yearBuilt, YEAR_STOPS) : '#d4d4d4'
      } else {
        const value = prop[colorMetric]
        color = typeof value === 'number' ? getColor(value, VALUE_STOPS) : '#d4d4d4'
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
    return { type: 'FeatureCollection', features }
  }, [properties, colorMetric, colorScaleMode])

  // Build a numeric index -> property lookup for click handling
  const indexToProperty = useRef(new globalThis.Map<number, Property>())
  useEffect(() => {
    const map = new globalThis.Map<number, Property>()
    properties.forEach((prop, idx) => {
      map.set(idx, prop)
    })
    indexToProperty.current = map
  }, [properties])

  // Build boundary choropleth GeoJSON — color each boundary by its aggregate value
  const boundaryGeojson = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!boundaryData || boundaryAggregates.size === 0) return EMPTY_FC

    const stops = colorMetric === 'yearBuilt' ? YEAR_STOPS : VALUE_STOPS
    const getColor = colorScaleMode === 'continuous' ? getInterpolatedValueColor : getValueColor
    const features = boundaryData.features.map((feat, idx) => {
      const bid = String(feat.properties?.id ?? '')
      const agg = boundaryAggregates.get(bid)
      let color = '#d4d4d4'
      let label = ''

      if (agg) {
        const val = getAggregateValue(agg, colorMetric)
        if (val != null) {
          color = getColor(val, stops)
          label = colorMetric === 'yearBuilt' ? String(val) : formatCurrency(val)
        }
      }

      return {
        type: 'Feature' as const,
        id: idx,
        properties: {
          id: bid,
          idx,
          color,
          label,
          count: agg?.count ?? 0,
        },
        geometry: feat.geometry,
      }
    })

    return { type: 'FeatureCollection', features }
  }, [boundaryData, boundaryAggregates, colorMetric, colorScaleMode])

  // Fly to selected property
  useEffect(() => {
    if (!selectedProperty || !mapRef.current) return
    mapRef.current.flyTo({
      center: [selectedProperty.longitude, selectedProperty.latitude],
      zoom: 16,
      duration: 800,
    })
  }, [selectedProperty])

  // Find selected feature index (parcels)
  const selectedIdx = useMemo(() => {
    if (!selectedProperty) return null
    const idx = properties.findIndex((p) => p.id === selectedProperty.id)
    return idx >= 0 ? idx : null
  }, [properties, selectedProperty])

  const boundaryLineStyle = getBoundaryLineStyle(boundaryLevel)

  return (
    <div className="h-full w-full">
      <PgMap
        ref={mapRef}
        center={PG_CENTER}
        zoom={ZOOM}
        styles={MAP_STYLES}
        loading={loading}
      >
        <MapControls
          position="top-right"
          mobilePosition="bottom-right"
          showZoom
          showCompass
        />

        {/* Property parcels — hidden when boundary overlay is active */}
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
          visible={!showBoundaries}
          onFeatureClick={(id) => {
            const prop = indexToProperty.current.get(Number(id))
            if (prop) onPropertyClick(prop)
          }}
        />

        {/* Census boundary choropleth */}
        <MapFillLayer
          key={`assessment-boundaries-${boundaryLevel}`}
          data={boundaryGeojson}
          fillColor={['get', 'color']}
          fillOpacity={0.6}
          lineColor="#f97316"
          lineWidth={boundaryLineStyle.lineWidth}
          lineOpacity={0.9}
          idProperty="id"
          selectedId={selectedBoundaryId}
          selectionStyle="line"
          selectionColor="#ffffff"
          selectionWidth={boundaryLineStyle.selectionWidth}
          visible={showBoundaries}
          onFeatureClick={onBoundaryClick}
        />
      </PgMap>
    </div>
  )
}

import { useMemo } from 'react'
import { MapClusterLayer, MapMarker, MapPopup, MarkerContent } from '@/components/ui/map'
import { MapFillLayer, MapHeatmapLayer } from '@/components/ui/map-layers'
import { MOBILE_FEATURE_CARD_MEDIA_QUERY } from '@/components/ui/mobile-feature-card'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { WATER_POINT_CATEGORIES, WATER_POINT_COLORS } from './constants'
import { getWaterPointCategory, hexToRgba } from './utils'
import { MobileWaterFacilityFeatureCard, WaterFacilityPopupCard } from './WaterFacilityCards'
import type { WaterFacilityFeatureProperties } from './types'
import type { WaterState } from './useWaterData'

export function WaterLayer({ water }: { water: WaterState }) {
  const isMobileViewport = useMediaQuery(MOBILE_FEATURE_CARD_MEDIA_QUERY)
  const pointCollections = useMemo(() => (
    WATER_POINT_CATEGORIES
      .filter((category) => water.visiblePointCategories.includes(category))
      .map((category) => {
        const features = water.facilityPointData.features.filter((feature) => feature.properties.category === category)
        return [category, { type: 'FeatureCollection' as const, features }] as const
      })
      .filter(([, collection]) => collection.features.length > 0)
  ), [water.facilityPointData, water.visiblePointCategories])

  const boundaryFillColor = useMemo(() => ([
    'interpolate',
    ['linear'],
    ['coalesce', ['to-number', ['get', 'metricValue']], 0],
    0,
    '#e0f2fe',
    water.boundaryMaxValue * 0.5,
    '#38bdf8',
    water.boundaryMaxValue,
    '#0369a1',
  ]), [water.boundaryMaxValue])

  return (
    <>
      {water.showBoundaries && water.boundaryData.features.length > 0 && (
        <MapFillLayer
          key={`water-boundaries-${water.boundaryMetric}-${water.boundaryMaxValue}`}
          data={water.boundaryData}
          fillColor={boundaryFillColor}
          fillOpacity={0.22}
          lineColor="#0284c7"
          lineWidth={0.8}
          lineOpacity={0.55}
          idProperty="boundaryId"
          selectedId={water.selectedBoundaryId}
          selectionColor="#0f172a"
          selectionWidth={2}
          onFeatureClick={(id) => water.setSelectedBoundaryId(water.selectedBoundaryId === id ? null : id)}
          visible
        />
      )}
      {water.showHeatmap && (
        <MapHeatmapLayer
          data={water.heatmapData}
          weight={['interpolate', ['linear'], ['coalesce', ['get', 'weight'], 1], 1, 0.2, 50, 1]}
          intensityStops={[
            [8, 0.6],
            [11, 1.1],
            [14, 1.7],
          ]}
          radiusStops={[
            [8, 14],
            [11, 26],
            [14, 42],
          ]}
          opacity={[
            [8, 0.45],
            [14, 0.72],
          ]}
          colorRamp="air"
        />
      )}
      {water.showPoints && pointCollections.map(([category, collection]) => {
        const color = WATER_POINT_COLORS[category]
        const clusterColors: [string, string, string] = [
          hexToRgba(color, 0.65),
          hexToRgba(color, 0.8),
          color,
        ]

        return (
          <MapClusterLayer<WaterFacilityFeatureProperties>
            key={category}
            data={collection}
            pointColor={color}
            clusterColors={clusterColors}
            clusterThresholds={[40, 150]}
            onPointClick={(feature) => {
              const id = feature.properties?.id
              if (id) water.setSelectedFacilityId(water.selectedFacilityId === id ? null : id)
            }}
          />
        )
      })}
      {water.selectedFacility?.latitude != null && water.selectedFacility.longitude != null && (
        <>
          <MapMarker
            longitude={water.selectedFacility.longitude}
            latitude={water.selectedFacility.latitude}
            onClick={() => water.setSelectedFacilityId(null)}
          >
            <MarkerContent>
              <div
                className="h-5 w-5 rounded-full border-2 border-white shadow-lg ring-2 ring-sky-500 ring-offset-2"
                style={{ backgroundColor: WATER_POINT_COLORS[getWaterPointCategory(water.selectedFacility, water.layerMode)] }}
              />
            </MarkerContent>
          </MapMarker>
          {!isMobileViewport && (
            <MapPopup
              key={water.selectedFacility.id}
              longitude={water.selectedFacility.longitude}
              latitude={water.selectedFacility.latitude}
              closeButton
              onClose={() => water.setSelectedFacilityId(null)}
              className="max-w-xs"
            >
              <WaterFacilityPopupCard
                facility={water.selectedFacility}
                onOpenReport={() => water.setShowSelectedFacilityReport(true)}
              />
            </MapPopup>
          )}
          {isMobileViewport && (
            <MobileWaterFacilityFeatureCard
              facility={water.selectedFacility}
              onClose={() => water.setSelectedFacilityId(null)}
              onOpenReport={() => water.setShowSelectedFacilityReport(true)}
            />
          )}
        </>
      )}
    </>
  )
}

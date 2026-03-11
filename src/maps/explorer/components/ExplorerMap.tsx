import { useEffect, useMemo, useRef } from 'react'
import {
  Map as PgMap,
  MapClusterLayer,
  MapControls,
  MapMarker,
  MarkerContent,
  type MapRef
} from '@/components/ui/map'
import { MapFillLayer, MapLineLayer } from '@/components/ui/map-layers'
import { MAP_STYLES, PG_CENTER } from '@/components/ui/map-styles'
import type {
  ExplorerItem,
  ExplorerLineCollection,
  ExplorerPointCollection,
  ExplorerPolygonCollection
} from '../types'

interface ExplorerMapProps {
  pointCollections: ExplorerPointCollection[]
  lineCollections: ExplorerLineCollection[]
  polygonCollections: ExplorerPolygonCollection[]
  selectedItem: ExplorerItem | null
  onItemSelect: (itemId: string) => void
}

const ZOOM = 12

export function ExplorerMap({
  pointCollections,
  lineCollections,
  polygonCollections,
  selectedItem,
  onItemSelect
}: ExplorerMapProps) {
  const mapRef = useRef<MapRef>(null)

  const selectedItemId = selectedItem?.id || null
  const selectedPointCoordinates = useMemo<[number, number] | null>(() => {
    if (!selectedItem || selectedItem.geometry.type !== 'Point') return null
    return selectedItem.geometry.coordinates as [number, number]
  }, [selectedItem])

  useEffect(() => {
    if (!selectedItem || !mapRef.current) return

    mapRef.current.fitBounds(
      [
        [selectedItem.bounds.minLng, selectedItem.bounds.minLat],
        [selectedItem.bounds.maxLng, selectedItem.bounds.maxLat]
      ],
      { padding: 90, duration: 500, maxZoom: 14 }
    )
  }, [selectedItem])

  return (
    <div className="h-full w-full">
      <PgMap
        ref={mapRef}
        center={PG_CENTER}
        zoom={ZOOM}
        styles={MAP_STYLES}
      >
        <MapControls position="top-right" showZoom showCompass />

        {polygonCollections.map((collection) => (
          <MapFillLayer
            key={collection.datasetId}
            data={collection.data}
            fillColor={collection.color}
            fillOpacity={0.28}
            lineColor={collection.color}
            lineWidth={1.1}
            lineOpacity={0.8}
            idProperty="itemId"
            selectedId={selectedItemId}
            visible={collection.visible}
            onFeatureClick={onItemSelect}
          />
        ))}

        {lineCollections.map((collection) => (
          <MapLineLayer
            key={collection.datasetId}
            data={collection.data}
            color={collection.color}
            width={2.2}
            opacity={0.75}
            idProperty="itemId"
            selectedId={selectedItemId}
            visible={collection.visible}
            onFeatureClick={onItemSelect}
          />
        ))}

        {pointCollections
          .filter((collection) => collection.visible)
          .map((collection) => (
            <MapClusterLayer
              key={collection.datasetId}
              data={collection.data}
              clusterRadius={42}
              clusterThresholds={[50, 180]}
              clusterColors={['#38bdf8', '#22c55e', '#f59e0b']}
              pointColor={collection.color}
              onPointClick={(feature) => {
                const itemId = feature.properties?.itemId
                if (typeof itemId === 'string' && itemId) {
                  onItemSelect(itemId)
                }
              }}
            />
          ))}

        {selectedPointCoordinates && (
          <MapMarker longitude={selectedPointCoordinates[0]} latitude={selectedPointCoordinates[1]}>
            <MarkerContent>
              <div className="h-5 w-5 rounded-full border-2 border-white bg-cyan-500 shadow-lg ring-4 ring-cyan-300/60" />
            </MarkerContent>
          </MapMarker>
        )}
      </PgMap>
    </div>
  )
}

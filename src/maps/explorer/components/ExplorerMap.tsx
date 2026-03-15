import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { cn } from '@/lib/utils'
import type {
  ExplorerItem,
  ExplorerLineCollection,
  ExplorerPointCollection,
  ExplorerPolygonCollection,
  SpatialFilter
} from '../types'

interface ExplorerMapProps {
  pointCollections: ExplorerPointCollection[]
  lineCollections: ExplorerLineCollection[]
  polygonCollections: ExplorerPolygonCollection[]
  selectedItem: ExplorerItem | null
  onItemSelect: (itemId: string) => void
  spatialFilter: SpatialFilter | null
  onSpatialFilterChange: (filter: SpatialFilter | null) => void
}

const ZOOM = 12

export function ExplorerMap({
  pointCollections,
  lineCollections,
  polygonCollections,
  selectedItem,
  onItemSelect,
  spatialFilter,
  onSpatialFilterChange
}: ExplorerMapProps) {
  const mapRef = useRef<MapRef>(null)
  const [drawMode, setDrawMode] = useState(false)
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null)
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

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

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!drawMode) return
    e.preventDefault()
    const rect = overlayRef.current?.getBoundingClientRect()
    if (!rect) return
    setDrawStart({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    setDrawCurrent({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }, [drawMode])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!drawMode || !drawStart) return
    e.preventDefault()
    const rect = overlayRef.current?.getBoundingClientRect()
    if (!rect) return
    setDrawCurrent({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }, [drawMode, drawStart])

  const handleMouseUp = useCallback(() => {
    if (!drawMode || !drawStart || !drawCurrent || !mapRef.current) {
      setDrawStart(null)
      setDrawCurrent(null)
      return
    }

    const map = mapRef.current
    const sw = map.unproject([Math.min(drawStart.x, drawCurrent.x), Math.max(drawStart.y, drawCurrent.y)])
    const ne = map.unproject([Math.max(drawStart.x, drawCurrent.x), Math.min(drawStart.y, drawCurrent.y)])

    if (sw && ne && Math.abs(drawStart.x - drawCurrent.x) > 10 && Math.abs(drawStart.y - drawCurrent.y) > 10) {
      onSpatialFilterChange({
        minLng: sw.lng, minLat: sw.lat,
        maxLng: ne.lng, maxLat: ne.lat
      })
    }

    setDrawStart(null)
    setDrawCurrent(null)
    setDrawMode(false)
  }, [drawMode, drawStart, drawCurrent, onSpatialFilterChange])

  const drawRect = useMemo(() => {
    if (!drawStart || !drawCurrent) return null
    return {
      left: Math.min(drawStart.x, drawCurrent.x),
      top: Math.min(drawStart.y, drawCurrent.y),
      width: Math.abs(drawCurrent.x - drawStart.x),
      height: Math.abs(drawCurrent.y - drawStart.y)
    }
  }, [drawStart, drawCurrent])

  return (
    <div className="h-full w-full relative">
      <PgMap ref={mapRef} center={PG_CENTER} zoom={ZOOM} styles={MAP_STYLES}>
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
                if (typeof itemId === 'string' && itemId) onItemSelect(itemId)
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

      {/* Draw overlay for spatial filtering */}
      {drawMode && (
        <div
          ref={overlayRef}
          className="absolute inset-0 z-20 cursor-crosshair"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {drawRect && (
            <div
              className="absolute border-2 border-cyan-500 bg-cyan-500/15"
              style={{
                left: drawRect.left,
                top: drawRect.top,
                width: drawRect.width,
                height: drawRect.height
              }}
            />
          )}
        </div>
      )}

      {/* Spatial filter controls */}
      <div className="absolute top-4 left-4 z-10 flex gap-2">
        <button
          onClick={() => {
            if (drawMode) {
              setDrawMode(false)
              setDrawStart(null)
              setDrawCurrent(null)
            } else {
              setDrawMode(true)
            }
          }}
          className={cn(
            'rounded-lg border px-3 py-2 text-xs font-medium shadow-lg backdrop-blur transition-colors',
            drawMode
              ? 'border-cyan-500 bg-cyan-500 text-white'
              : 'border-border bg-background/95 text-foreground hover:bg-accent'
          )}
        >
          {drawMode ? 'Drawing...' : 'Draw Area'}
        </button>
        {spatialFilter && (
          <button
            onClick={() => onSpatialFilterChange(null)}
            className="rounded-lg border border-border bg-background/95 px-3 py-2 text-xs font-medium text-muted-foreground shadow-lg backdrop-blur hover:text-foreground"
          >
            Clear Filter
          </button>
        )}
      </div>
    </div>
  )
}

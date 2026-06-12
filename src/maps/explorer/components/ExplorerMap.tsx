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
  onMapRightClick?: (lng: number, lat: number) => void
  heatmapLayer?: React.ReactNode
  loading?: boolean
}

const ZOOM = 12

export function ExplorerMap({
  pointCollections,
  lineCollections,
  polygonCollections,
  selectedItem,
  onItemSelect,
  spatialFilter,
  onSpatialFilterChange,
  onMapRightClick,
  heatmapLayer,
  loading = false
}: ExplorerMapProps) {
  const mapRef = useRef<MapRef>(null)
  const [drawMode, setDrawMode] = useState(false)
  const [reportMode, setReportMode] = useState(false)
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null)
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  const selectedItemId = selectedItem?.id || null

  // With many datasets stacked the default full-opacity styling turns the map
  // into solid blobs, so density scales the circles and fills down.
  const visiblePointCount = pointCollections.filter((collection) => collection.visible).length
  const visiblePolygonCount = polygonCollections.filter((collection) => collection.visible).length
  const densePoints = visiblePointCount > 2
  const densePolygons = visiblePolygonCount > 1
  const clusterSizes = useMemo<[number, number, number]>(
    () => (densePoints ? [13, 19, 26] : [20, 30, 40]),
    [densePoints],
  )
  const selectedPointCoordinates = useMemo<[number, number] | null>(() => {
    if (!selectedItem || selectedItem.geometry.type !== 'Point') return null
    return selectedItem.geometry.coordinates as [number, number]
  }, [selectedItem])

  // Right-click handler for Neighborhood Report
  useEffect(() => {
    const map = mapRef.current
    if (!map || !onMapRightClick) return
    const handler = (e: { lngLat: { lng: number; lat: number }; preventDefault: () => void }) => {
      e.preventDefault()
      onMapRightClick(e.lngLat.lng, e.lngLat.lat)
    }
    map.on('contextmenu', handler)
    return () => { map.off('contextmenu', handler) }
  }, [onMapRightClick])

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

  const handleReportClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!reportMode || !mapRef.current || !onMapRightClick) return
    const rect = overlayRef.current?.getBoundingClientRect()
    if (!rect) return
    const point = mapRef.current.unproject([e.clientX - rect.left, e.clientY - rect.top])
    onMapRightClick(point.lng, point.lat)
    setReportMode(false)
  }, [onMapRightClick, reportMode])

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
      <PgMap ref={mapRef} center={PG_CENTER} zoom={ZOOM} styles={MAP_STYLES} loading={loading}>
        <MapControls
          position="top-right"
          mobilePosition="bottom-right"
          showZoom
          showCompass
        />

        {heatmapLayer}

        {polygonCollections.map((collection) => (
          <MapFillLayer
            key={collection.datasetId}
            data={collection.data}
            fillColor={collection.color}
            fillOpacity={densePolygons ? 0.14 : 0.28}
            lineColor={collection.color}
            lineWidth={densePolygons ? 0.8 : 1.1}
            lineOpacity={densePolygons ? 0.55 : 0.8}
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
              clusterColors={[collection.color, collection.color, collection.color]}
              clusterSizes={clusterSizes}
              circleOpacity={densePoints ? 0.78 : 1}
              circleStrokeWidth={1.5}
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
      {(drawMode || reportMode) && (
        <div
          ref={overlayRef}
          className="absolute inset-0 z-20 cursor-crosshair"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onClick={handleReportClick}
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
      <div className="absolute left-2 top-[calc(env(safe-area-inset-top)+3.75rem)] z-10 flex max-w-[calc(100%-4.5rem)] flex-wrap gap-1.5 sm:left-4 sm:max-w-[calc(100%-5rem)] sm:gap-2 md:top-4 md:max-w-none">
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
            'rounded-lg border px-2.5 py-2 text-xs font-medium shadow-lg backdrop-blur transition-colors sm:px-3',
            drawMode
              ? 'border-cyan-500 bg-cyan-500 text-white'
              : 'border-border bg-background/95 text-foreground hover:bg-accent'
          )}
        >
          {drawMode ? 'Drawing...' : 'Draw Area'}
        </button>
        <button
          onClick={() => {
            setReportMode((current) => !current)
            setDrawMode(false)
            setDrawStart(null)
            setDrawCurrent(null)
          }}
          className={cn(
            'rounded-lg border px-2.5 py-2 text-xs font-medium shadow-lg backdrop-blur transition-colors sm:px-3',
            reportMode
              ? 'border-emerald-500 bg-emerald-500 text-white'
              : 'border-border bg-background/95 text-foreground hover:bg-accent'
          )}
        >
          {reportMode ? 'Tap map...' : 'Report Point'}
        </button>
        {spatialFilter && (
          <button
            onClick={() => onSpatialFilterChange(null)}
            className="rounded-lg border border-border bg-background/95 px-2.5 py-2 text-xs font-medium text-muted-foreground shadow-lg backdrop-blur hover:text-foreground sm:px-3"
          >
            Clear Filter
          </button>
        )}
      </div>
    </div>
  )
}

import { useCallback, useMemo, useState } from 'react'
import { Map, MapControls, MapMarker, MapPopup, MarkerContent } from '@/components/ui/map'
import { MapFillLayer, MapLineLayer } from '@/components/ui/map-layers'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { cn } from '@/lib/utils'
import { CENTER, neighbourhoodFeatures, parkFeatures, routeFeatures } from './dev-interact/data'
import { DesktopFeaturePopup } from './dev-interact/DesktopFeaturePopup'
import { FeatureTablePanel } from './dev-interact/FeatureTablePanel'
import { MobileFeatureInspector } from './dev-interact/FeatureInspector'
import { featureBounds, filterCollection, measurementCanClose, measurementStats, relatedFeaturesAtPoint } from './dev-interact/geo'
import { CollapseInspectorOnMapDrag, MapClickCapture, ZoomToFeature } from './dev-interact/MapBehaviors'
import { MeasurementOverlay } from './dev-interact/MeasurementOverlay'
import { MobileMapToolbar } from './dev-interact/MobileMapToolbar'
import { measurementLine, measurementPolygon, measurementPreviewLine } from './dev-interact/measurement'
import { DevInteractSidebar } from './dev-interact/Sidebar'
import type { FeatureAction, InteractFeature, InteractFeatureProperties, LayerId, MeasurementMapAction, MeasurementMode } from './dev-interact/types'

function DevInteract() {
  const [showSidebar, setShowSidebar] = useState(true)
  const [visibleLayers, setVisibleLayers] = useState<Record<LayerId, boolean>>({
    parks: true,
    routes: true,
    neighbourhoods: true,
  })
  const [selectedFeature, setSelectedFeature] = useState<InteractFeature | null>(null)
  const [selectedFeatures, setSelectedFeatures] = useState<InteractFeature[]>([])
  const [selectedFeatureIndex, setSelectedFeatureIndex] = useState(0)
  const [selectedLngLat, setSelectedLngLat] = useState<[number, number] | null>(null)
  const [mobileInspectorCollapsed, setMobileInspectorCollapsed] = useState(false)
  const [openInEnabled, setOpenInEnabled] = useState(true)
  const [hiddenFeatureIds, setHiddenFeatureIds] = useState<Set<string>>(() => new Set())
  const [isolatedFeatureId, setIsolatedFeatureId] = useState<string | null>(null)
  const [tableLayer, setTableLayer] = useState<LayerId | null>(null)
  const [zoomFeature, setZoomFeature] = useState<{ feature: InteractFeature; nonce: number } | null>(null)
  const [measurementMode, setMeasurementMode] = useState<MeasurementMode>('idle')
  const [measurementPoints, setMeasurementPoints] = useState<[number, number][]>([])
  const [redoMeasurementPoints, setRedoMeasurementPoints] = useState<[number, number][]>([])
  const [measurementCursor, setMeasurementCursor] = useState<[number, number] | null>(null)

  const measurementPolygonData = useMemo(() => measurementPolygon(measurementPoints), [measurementPoints])
  const measurementLineData = useMemo(() => measurementLine(measurementPoints, measurementMode), [measurementMode, measurementPoints])
  const measurementPreviewLineData = useMemo(
    () => measurementPreviewLine(measurementPoints, measurementCursor, measurementMode),
    [measurementCursor, measurementMode, measurementPoints],
  )
  const currentMeasurementStats = useMemo(
    () => measurementStats(measurementPoints, measurementMode === 'complete'),
    [measurementMode, measurementPoints],
  )

  const filteredNeighbourhoodFeatures = useMemo(
    () => filterCollection(neighbourhoodFeatures, hiddenFeatureIds, isolatedFeatureId),
    [hiddenFeatureIds, isolatedFeatureId],
  )
  const filteredParkFeatures = useMemo(
    () => filterCollection(parkFeatures, hiddenFeatureIds, isolatedFeatureId),
    [hiddenFeatureIds, isolatedFeatureId],
  )
  const filteredRouteFeatures = useMemo(
    () => filterCollection(routeFeatures, hiddenFeatureIds, isolatedFeatureId),
    [hiddenFeatureIds, isolatedFeatureId],
  )

  const clearSelection = useCallback(() => {
    setSelectedFeature(null)
    setSelectedFeatures([])
    setSelectedFeatureIndex(0)
    setSelectedLngLat(null)
    setMobileInspectorCollapsed(false)
  }, [])

  const setSelection = useCallback((feature: InteractFeature, point: [number, number]) => {
    const features = relatedFeaturesAtPoint(point, feature)
    setSelectedFeature(feature)
    setSelectedFeatures(features)
    setSelectedFeatureIndex(0)
    setSelectedLngLat(point)
    setMobileInspectorCollapsed(false)
  }, [])

  const selectPolygon = useCallback((id: string, collection: GeoJSON.FeatureCollection<GeoJSON.Polygon, InteractFeatureProperties>) => {
    const feature = collection.features.find((candidate) => candidate.properties.id === id) ?? null
    if (feature) {
      const bounds = featureBounds(feature)
      setSelection(feature, [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2])
    } else {
      clearSelection()
    }
  }, [clearSelection, setSelection])

  const selectRoute = useCallback((id: string) => {
    const feature = routeFeatures.features.find((candidate) => candidate.properties.id === id) ?? null
    if (feature) {
      const coordinates = feature.geometry.coordinates
      setSelection(feature, coordinates[Math.floor(coordinates.length / 2)] as [number, number])
    } else {
      clearSelection()
    }
  }, [clearSelection, setSelection])

  const toggleLayer = useCallback((layer: LayerId) => {
    setVisibleLayers((current) => ({ ...current, [layer]: !current[layer] }))
  }, [])

  const startMeasurement = useCallback(() => {
    clearSelection()
    setMeasurementMode('drawing')
    setMeasurementPoints([])
    setRedoMeasurementPoints([])
  }, [clearSelection])

  const clearMeasurement = useCallback(() => {
    setMeasurementMode('idle')
    setMeasurementPoints([])
    setRedoMeasurementPoints([])
    setMeasurementCursor(null)
  }, [])

  const finishMeasurement = useCallback(() => {
    setMeasurementMode((current) => (current === 'drawing' && measurementCanClose(measurementPoints) ? 'complete' : current))
    setRedoMeasurementPoints([])
    setMeasurementCursor(null)
  }, [measurementPoints])

  const addMeasurementPoint = useCallback((point: [number, number]) => {
    setMeasurementPoints((current) => [...current, point])
    setRedoMeasurementPoints([])
  }, [])

  const undoMeasurementPoint = useCallback(() => {
    setMeasurementPoints((current) => {
      if (current.length === 0) return current
      const next = current.slice(0, -1)
      const removed = current[current.length - 1]
      setRedoMeasurementPoints((redo) => [removed, ...redo])
      return next
    })
  }, [])

  const redoMeasurementPoint = useCallback(() => {
    setRedoMeasurementPoints((current) => {
      if (current.length === 0) return current
      const [restored, ...nextRedo] = current
      setMeasurementPoints((points) => [...points, restored])
      return nextRedo
    })
  }, [])

  const handleMeasurementMapAction = useCallback((action: MeasurementMapAction) => {
    if (action.type === 'close') {
      setMeasurementMode((current) => (current === 'drawing' && measurementCanClose(measurementPoints) ? 'complete' : current))
      setRedoMeasurementPoints([])
      setMeasurementCursor(null)
      return
    }

    addMeasurementPoint(action.point)
  }, [addMeasurementPoint, measurementPoints])

  const handleFeatureAction = useCallback((action: FeatureAction, feature: InteractFeature) => {
    if (action === 'hide') {
      setHiddenFeatureIds((current) => new Set(current).add(feature.properties.id))
      clearSelection()
      return
    }
    if (action === 'zoom') {
      setZoomFeature({ feature, nonce: Date.now() })
      return
    }
    if (action === 'show-only') {
      setIsolatedFeatureId(feature.properties.id)
      setHiddenFeatureIds(new Set())
      return
    }
    if (action === 'show-others') {
      setIsolatedFeatureId(null)
      setHiddenFeatureIds((current) => {
        if (!current.has(feature.properties.id)) return current
        const next = new Set(current)
        next.delete(feature.properties.id)
        return next
      })
      return
    }
    setTableLayer(feature.properties.layer)
  }, [clearSelection])

  const sidebar = (
    <DevInteractSidebar
      className="h-full w-full border-0 shadow-none md:w-[320px] md:border-r md:shadow-xl"
      visibleLayers={visibleLayers}
      measurementMode={measurementMode}
      measurementStats={currentMeasurementStats}
      measurementPointCount={measurementPoints.length}
      onToggleLayer={toggleLayer}
      onStartMeasurement={startMeasurement}
      onOpenTable={() => setTableLayer('parks')}
      onFinishMeasurement={finishMeasurement}
      onClearMeasurement={clearMeasurement}
      openInEnabled={openInEnabled}
      onOpenInEnabledChange={setOpenInEnabled}
    />
  )

  return (
    <MapSectionLayout
      showDesktopSidebar={showSidebar}
      onToggleDesktopSidebar={() => setShowSidebar((current) => !current)}
      desktopSidebarWidth={320}
      mobileInitialSheetState="collapsed"
      mobilePeek={(
        <div className="min-w-0 text-left">
          <div className="truncate text-xs font-semibold text-foreground">Interactive map controls</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {measurementMode === 'drawing' ? `${measurementPoints.length} measurement points` : 'Legend, actions, and popup cards'}
          </div>
        </div>
      )}
      sidebar={sidebar}
    >
      <div className="relative h-full">
        <Map center={CENTER} zoom={11.1}>
          <MapControls position="top-right" className="hidden md:flex" />
          <MobileMapToolbar
            visibleLayers={visibleLayers}
            onToggleLayer={toggleLayer}
            onStartMeasurement={startMeasurement}
            onOpenTable={() => setTableLayer('parks')}
          />
          <MapClickCapture
            measurementMode={measurementMode}
            measurementPoints={measurementPoints}
            onMeasurementAction={handleMeasurementMapAction}
            onMeasurementCursor={setMeasurementCursor}
          />
          {zoomFeature && <ZoomToFeature feature={zoomFeature.feature} nonce={zoomFeature.nonce} />}
          <CollapseInspectorOnMapDrag
            enabled={measurementMode !== 'drawing' && Boolean(selectedFeature)}
            onCollapse={() => setMobileInspectorCollapsed(true)}
          />

          <MapFillLayer
            data={filteredNeighbourhoodFeatures}
            fillColor="#8b5cf6"
            fillOpacity={0.12}
            lineColor="#6d28d9"
            lineWidth={1}
            idProperty="id"
            selectedId={selectedFeature?.properties.layer === 'neighbourhoods' ? selectedFeature.properties.id : null}
            visible={visibleLayers.neighbourhoods}
            onFeatureClick={measurementMode === 'drawing' ? undefined : (id) => selectPolygon(id, neighbourhoodFeatures)}
          />
          <MapFillLayer
            data={filteredParkFeatures}
            fillColor="#22c55e"
            fillOpacity={0.32}
            lineColor="#15803d"
            lineWidth={1.3}
            idProperty="id"
            selectedId={selectedFeature?.properties.layer === 'parks' ? selectedFeature.properties.id : null}
            visible={visibleLayers.parks}
            onFeatureClick={measurementMode === 'drawing' ? undefined : (id) => selectPolygon(id, parkFeatures)}
          />
          <MapLineLayer
            data={filteredRouteFeatures}
            color="#0ea5e9"
            width={4}
            opacity={0.82}
            idProperty="id"
            selectedId={selectedFeature?.properties.layer === 'routes' ? selectedFeature.properties.id : null}
            visible={visibleLayers.routes}
            onFeatureClick={measurementMode === 'drawing' ? undefined : selectRoute}
          />

          <MapFillLayer data={measurementPolygonData} fillColor="#f97316" fillOpacity={0.18} lineColor="#ea580c" lineWidth={2} visible={measurementPoints.length >= 3} />
          <MapLineLayer data={measurementLineData} color="#ea580c" width={2.5} opacity={1} dashArray={measurementMode === 'drawing' ? [2, 1.3] : undefined} visible={measurementPoints.length > 1} />
          <MapLineLayer data={measurementPreviewLineData} color="#ea580c" width={2} opacity={0.72} dashArray={[1.2, 1.2]} visible={measurementMode === 'drawing' && measurementPoints.length > 0} />

          {measurementPoints.map((point, index) => (
            <MapMarker
              key={`${point[0]}:${point[1]}:${index}`}
              longitude={point[0]}
              latitude={point[1]}
              onClick={(event) => {
                if (measurementMode !== 'drawing' || index !== 0 || !measurementCanClose(measurementPoints)) return
                event.preventDefault()
                event.stopPropagation()
                finishMeasurement()
              }}
            >
              <MarkerContent>
                <button
                  type="button"
                  className={cn(
                    'flex size-5 items-center justify-center rounded-full border-2 border-white bg-orange-500 text-[10px] font-semibold text-white shadow-lg transition-transform',
                    measurementMode === 'drawing' && index === 0 && measurementCanClose(measurementPoints) && 'size-6 cursor-pointer ring-4 ring-orange-500/20 hover:scale-110',
                  )}
                  onClick={(event) => {
                    if (measurementMode !== 'drawing' || index !== 0 || !measurementCanClose(measurementPoints)) return
                    event.stopPropagation()
                    finishMeasurement()
                  }}
                  aria-label={index === 0 && measurementCanClose(measurementPoints) ? 'Close polygon' : `Measurement point ${index + 1}`}
                >
                  {index + 1}
                </button>
              </MarkerContent>
            </MapMarker>
          ))}

          {measurementMode !== 'drawing' && selectedFeature && selectedLngLat && (
            <MapPopup longitude={selectedLngLat[0]} latitude={selectedLngLat[1]} onClose={clearSelection} closeButton={false} className="hidden md:block">
              <DesktopFeaturePopup
                feature={selectedFeatures[selectedFeatureIndex] ?? selectedFeature}
                count={selectedFeatures.length}
                index={selectedFeatureIndex}
                onPrevious={() => setSelectedFeatureIndex((current) => {
                  const next = current <= 0 ? Math.max(0, selectedFeatures.length - 1) : current - 1
                  setSelectedFeature(selectedFeatures[next] ?? selectedFeature)
                  return next
                })}
                onNext={() => setSelectedFeatureIndex((current) => {
                  const next = selectedFeatures.length === 0 ? 0 : (current + 1) % selectedFeatures.length
                  setSelectedFeature(selectedFeatures[next] ?? selectedFeature)
                  return next
                })}
                onClose={clearSelection}
              />
            </MapPopup>
          )}

          <MeasurementOverlay
            measurementMode={measurementMode}
            measurementStats={currentMeasurementStats}
            measurementPoints={measurementPoints}
            canUndo={measurementPoints.length > 0}
            canRedo={redoMeasurementPoints.length > 0}
            onAddPoint={addMeasurementPoint}
            onUndo={undoMeasurementPoint}
            onRedo={redoMeasurementPoint}
            onClearMeasurement={clearMeasurement}
            onFinishMeasurement={finishMeasurement}
          />
        </Map>

        {measurementMode !== 'drawing' && selectedFeature && (
          <MobileFeatureInspector
            key={selectedFeature.properties.id}
            feature={selectedFeature}
            openInPoint={selectedLngLat}
            openInEnabled={openInEnabled}
            collapsed={mobileInspectorCollapsed}
            onFeatureAction={(action) => handleFeatureAction(action, selectedFeature)}
            onExpand={() => setMobileInspectorCollapsed(false)}
            onClose={clearSelection}
          />
        )}

        {tableLayer && (
          <FeatureTablePanel
            layer={tableLayer}
            onLayerChange={setTableLayer}
            hiddenFeatureIds={hiddenFeatureIds}
            isolatedFeatureId={isolatedFeatureId}
            onClose={() => setTableLayer(null)}
            onSelect={(feature) => {
              const bounds = featureBounds(feature)
              setSelection(feature, [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2])
            }}
          />
        )}

      </div>
    </MapSectionLayout>
  )
}

export default DevInteract

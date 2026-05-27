import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Map, MapControls, MapMarker, MapPopup, MarkerContent } from '@/components/ui/map'
import { MapFillLayer, MapLineLayer } from '@/components/ui/map-layers'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { cn } from '@/lib/utils'
import { CENTER, YEAR_FILTER_DOMAIN, neighbourhoodFeatures, parkFeatures, routeFeatures } from './dev-interact/data'
import { DesktopFeaturePopup } from './dev-interact/DesktopFeaturePopup'
import { FeatureTablePanel } from './dev-interact/FeatureTablePanel'
import { MobileFeatureInspector } from './dev-interact/FeatureInspector'
import { circleMeasurementStats, featureBounds, featureMatchesYearRange, filterCollection, layerLabel, measurementCanClose, measurementStats, relatedFeaturesAtPoint } from './dev-interact/geo'
import { CollapseInspectorOnMapDrag, DismissSelectionOnMapClick, MapClickCapture, ZoomToFeature } from './dev-interact/MapBehaviors'
import { MapSearchSheet } from './dev-interact/MapSearchSheet'
import { MeasurementOverlay } from './dev-interact/MeasurementOverlay'
import { measurementCircle, measurementLine, measurementPolygon, measurementPreviewLine } from './dev-interact/measurement'
import { Scale } from './dev-interact/Scale'
import { DevInteractSidebar } from './dev-interact/Sidebar'
import type { FeatureAction, InteractFeature, InteractFeatureProperties, LayerId, MeasurementMapAction, MeasurementMode, MeasurementShape, ScalePosition, YearRange } from './dev-interact/types'

type MobileSheetState = 'collapsed' | 'half' | 'full'
type MobilePanelMode = 'controls' | 'controlsDocked' | 'featureExpanded' | 'featureCollapsed' | 'controlsOverFeatureExpanded' | 'controlsOverFeatureCollapsed'

interface MobilePanelState {
  mode: MobilePanelMode
  snapTo?: MobileSheetState
  snapKey: number
}

type MobilePanelAction =
  | { type: 'reset' }
  | { type: 'selectFeature' }
  | { type: 'dismissFeatureToControlsDock' }
  | { type: 'bringFeatureToFront' }
  | { type: 'expandFeature' }
  | { type: 'collapseFeature' }
  | { type: 'dockFeatureBehindControls' }
  | { type: 'dockControls' }
  | { type: 'syncControlsSheet'; sheetState: MobileSheetState }

const MOBILE_FEATURE_SHEET_VISIBLE_HEIGHT = 420
const MOBILE_FEATURE_COLLAPSED_VISIBLE_HEIGHT = 98
const MOBILE_CONTROLS_DOCKED_VISIBLE_HEIGHT = 56
const FEATURE_SELECT_DISMISS_SUPPRESS_MS = 150
const MAP_DRAG_DISMISS_SUPPRESS_MS = 650
const MOBILE_MEDIA_QUERY = '(max-width: 767px)'

const initialMobilePanelState: MobilePanelState = {
  mode: 'controls',
  snapKey: 0,
}

function bumpSnap(state: MobilePanelState, mode: MobilePanelMode, snapTo?: MobileSheetState): MobilePanelState {
  return { mode, snapTo, snapKey: state.snapKey + 1 }
}

function mobilePanelReducer(state: MobilePanelState, action: MobilePanelAction): MobilePanelState {
  switch (action.type) {
    case 'reset':
      return initialMobilePanelState
    case 'selectFeature':
      return { mode: 'featureExpanded', snapKey: state.snapKey }
    case 'dismissFeatureToControlsDock':
    case 'dockControls':
      return bumpSnap(state, 'controlsDocked', 'collapsed')
    case 'bringFeatureToFront':
      return bumpSnap(
        state,
        state.mode === 'controlsOverFeatureCollapsed' ? 'featureCollapsed' : 'featureExpanded',
        state.mode === 'controlsOverFeatureCollapsed' ? 'collapsed' : undefined,
      )
    case 'expandFeature':
      return { mode: 'featureExpanded', snapKey: state.snapKey }
    case 'collapseFeature':
      return bumpSnap(state, 'featureCollapsed', 'collapsed')
    case 'dockFeatureBehindControls':
      return bumpSnap(
        state,
        state.mode === 'featureCollapsed' || state.mode === 'controlsOverFeatureCollapsed'
          ? 'controlsOverFeatureCollapsed'
          : 'controlsOverFeatureExpanded',
      )
    case 'syncControlsSheet':
      if (state.mode !== 'controls' && state.mode !== 'controlsDocked') return state
      if (state.snapTo && action.sheetState !== state.snapTo) return state
      return {
        mode: action.sheetState === 'collapsed' ? 'controlsDocked' : 'controls',
        snapKey: state.snapKey,
      }
    default:
      return state
  }
}

function useIsMobileViewport() {
  const [isMobile, setIsMobile] = useState(() => (
    typeof window === 'undefined' ? false : window.matchMedia(MOBILE_MEDIA_QUERY).matches
  ))

  useEffect(() => {
    const media = window.matchMedia(MOBILE_MEDIA_QUERY)
    const update = () => setIsMobile(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return isMobile
}

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
  const [mobilePanel, dispatchMobilePanel] = useReducer(mobilePanelReducer, initialMobilePanelState)
  const [openInEnabled, setOpenInEnabled] = useState(true)
  const [scaleVisible, setScaleVisible] = useState(true)
  const [scalePosition, setScalePosition] = useState<ScalePosition>('bottom-center')
  const [hiddenFeatureIds, setHiddenFeatureIds] = useState<Set<string>>(() => new Set())
  const [isolatedFeatureId, setIsolatedFeatureId] = useState<string | null>(null)
  const [tableLayer, setTableLayer] = useState<LayerId | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchMounted, setSearchMounted] = useState(false)
  const [zoomFeature, setZoomFeature] = useState<{ feature: InteractFeature; nonce: number } | null>(null)
  const [yearRange, setYearRange] = useState<YearRange>(YEAR_FILTER_DOMAIN)
  const [measurementMode, setMeasurementMode] = useState<MeasurementMode>('idle')
  const [measurementShape, setMeasurementShape] = useState<MeasurementShape>('polygon')
  const [measurementPoints, setMeasurementPoints] = useState<[number, number][]>([])
  const [redoMeasurementPoints, setRedoMeasurementPoints] = useState<[number, number][]>([])
  const [measurementCursor, setMeasurementCursor] = useState<[number, number] | null>(null)
  const isMobileViewport = useIsMobileViewport()
  const skipNextMapDismiss = useRef(false)
  const skipMapDismissUntil = useRef(0)

  const mobileInspectorCollapsed = mobilePanel.mode === 'featureCollapsed' || mobilePanel.mode === 'controlsOverFeatureCollapsed'
  const mobileControlsExpanded = mobilePanel.mode === 'controlsOverFeatureExpanded' || mobilePanel.mode === 'controlsOverFeatureCollapsed'
  const mobileControlsDocked = mobilePanel.mode === 'controlsDocked'
  const mobileFeatureExpandedInFront = selectedFeature && !mobileInspectorCollapsed && !mobileControlsExpanded
  const mobileSnapVisibleHeight = selectedFeature
    ? (!mobileInspectorCollapsed || mobileControlsExpanded ? MOBILE_FEATURE_SHEET_VISIBLE_HEIGHT : MOBILE_FEATURE_COLLAPSED_VISIBLE_HEIGHT)
    : mobileControlsDocked ? MOBILE_CONTROLS_DOCKED_VISIBLE_HEIGHT : undefined

  const measurementPolygonData = useMemo(() => measurementPolygon(measurementPoints), [measurementPoints])
  const measurementLineData = useMemo(() => measurementLine(measurementPoints, measurementMode), [measurementMode, measurementPoints])
  const measurementPreviewLineData = useMemo(
    () => measurementPreviewLine(measurementPoints, measurementCursor, measurementMode),
    [measurementCursor, measurementMode, measurementPoints],
  )
  const circleEdge = measurementShape === 'circle' ? measurementPoints[1] ?? (measurementMode === 'drawing' ? measurementCursor : null) : null
  const measurementCircleData = useMemo(
    () => measurementCircle(measurementShape === 'circle' ? measurementPoints[0] ?? null : null, circleEdge),
    [circleEdge, measurementPoints, measurementShape],
  )
  const currentMeasurementStats = useMemo(
    () => (measurementShape === 'circle'
      ? circleMeasurementStats(measurementPoints[0] ?? null, measurementPoints[1] ?? measurementCursor)
      : measurementStats(measurementPoints, measurementMode === 'complete')),
    [measurementCursor, measurementMode, measurementPoints, measurementShape],
  )

  const filteredNeighbourhoodFeatures = useMemo(
    () => filterCollection(neighbourhoodFeatures, hiddenFeatureIds, isolatedFeatureId, yearRange),
    [hiddenFeatureIds, isolatedFeatureId, yearRange],
  )
  const filteredParkFeatures = useMemo(
    () => filterCollection(parkFeatures, hiddenFeatureIds, isolatedFeatureId, yearRange),
    [hiddenFeatureIds, isolatedFeatureId, yearRange],
  )
  const filteredRouteFeatures = useMemo(
    () => filterCollection(routeFeatures, hiddenFeatureIds, isolatedFeatureId, yearRange),
    [hiddenFeatureIds, isolatedFeatureId, yearRange],
  )

  const clearSelection = useCallback(() => {
    setSelectedFeature(null)
    setSelectedFeatures([])
    setSelectedFeatureIndex(0)
    setSelectedLngLat(null)
    dispatchMobilePanel({ type: 'reset' })
  }, [])

  const bringMobileInspectorToFront = useCallback(() => {
    dispatchMobilePanel({ type: 'bringFeatureToFront' })
  }, [])

  const dismissMobileSelection = useCallback(() => {
    setSelectedFeature(null)
    setSelectedFeatures([])
    setSelectedFeatureIndex(0)
    setSelectedLngLat(null)
    dispatchMobilePanel({ type: 'dismissFeatureToControlsDock' })
  }, [])

  const setSelection = useCallback((feature: InteractFeature, point: [number, number]) => {
    skipNextMapDismiss.current = true
    skipMapDismissUntil.current = Date.now() + FEATURE_SELECT_DISMISS_SUPPRESS_MS
    const features = relatedFeaturesAtPoint(point, feature, (candidate) => featureMatchesYearRange(candidate, yearRange))
    setSelectedFeature(feature)
    setSelectedFeatures(features)
    setSelectedFeatureIndex(0)
    setSelectedLngLat(point)
    dispatchMobilePanel({ type: 'selectFeature' })
  }, [yearRange])

  useEffect(() => {
    const openSearch = () => {
      setSearchMounted(true)
      setSearchOpen(true)
    }
    window.addEventListener('pgmaps:open-map-search', openSearch)
    return () => window.removeEventListener('pgmaps:open-map-search', openSearch)
  }, [])

  useEffect(() => {
    const hidden = measurementMode !== 'idle'
    window.dispatchEvent(new CustomEvent('pgmaps:mobile-toolbar-visibility', { detail: { hidden } }))
    return () => {
      if (hidden) {
        window.dispatchEvent(new CustomEvent('pgmaps:mobile-toolbar-visibility', { detail: { hidden: false } }))
      }
    }
  }, [measurementMode])

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

  const suppressNextMapDismiss = useCallback((durationMs: number) => {
    skipNextMapDismiss.current = true
    skipMapDismissUntil.current = Date.now() + durationMs
  }, [])

  const shouldSuppressMapDismiss = useCallback(() => {
    const now = Date.now()
    if (now < skipMapDismissUntil.current) {
      if (skipNextMapDismiss.current) {
        skipNextMapDismiss.current = false
      }
      return true
    }
    if (!skipNextMapDismiss.current) return false
    skipNextMapDismiss.current = false
    return false
  }, [])

  const dismissSelectionForViewport = useCallback(() => {
    if (searchOpen) {
      setSearchOpen(false)
      return
    }
    if (selectedFeature) {
      if (isMobileViewport) {
        dismissMobileSelection()
        return
      }
      clearSelection()
      return
    }
    dispatchMobilePanel({ type: 'dockControls' })
  }, [clearSelection, dismissMobileSelection, isMobileViewport, searchOpen, selectedFeature])

  const handleMobileFeatureClickOrSelect = useCallback((select: () => void) => {
    if (selectedFeature && isMobileViewport) {
      dismissMobileSelection()
      return
    }
    select()
  }, [dismissMobileSelection, isMobileViewport, selectedFeature])

  const selectFeature = useCallback((feature: InteractFeature) => {
    if (feature.geometry.type === 'LineString') {
      const coordinates = feature.geometry.coordinates
      setSelection(feature, coordinates[Math.floor(coordinates.length / 2)] as [number, number])
      setZoomFeature({ feature, nonce: Date.now() })
      return
    }

    const bounds = featureBounds(feature)
    setSelection(feature, [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2])
    setZoomFeature({ feature, nonce: Date.now() })
  }, [setSelection])

  const toggleLayer = useCallback((layer: LayerId) => {
    setVisibleLayers((current) => ({ ...current, [layer]: !current[layer] }))
  }, [])

  const isolateLayer = useCallback((layer: LayerId) => {
    setVisibleLayers((current) => {
      const layers = Object.keys(current) as LayerId[]
      const alreadyIsolated = current[layer] && layers.every((id) => id === layer || !current[id])
      return Object.fromEntries(
        layers.map((id) => [id, alreadyIsolated ? true : id === layer]),
      ) as Record<LayerId, boolean>
    })
  }, [])

  const startMeasurement = useCallback(() => {
    clearSelection()
    setMeasurementShape('polygon')
    setMeasurementMode('drawing')
    setMeasurementPoints([])
    setRedoMeasurementPoints([])
    setMeasurementCursor(null)
  }, [clearSelection])

  const startCircleMeasurement = useCallback(() => {
    clearSelection()
    setMeasurementShape('circle')
    setMeasurementMode('drawing')
    setMeasurementPoints([])
    setRedoMeasurementPoints([])
    setMeasurementCursor(null)
  }, [clearSelection])

  const clearMeasurement = useCallback(() => {
    setMeasurementMode('idle')
    setMeasurementShape('polygon')
    setMeasurementPoints([])
    setRedoMeasurementPoints([])
    setMeasurementCursor(null)
  }, [])

  const finishMeasurement = useCallback(() => {
    setMeasurementMode((current) => {
      if (current !== 'drawing') return current
      return measurementShape === 'circle' ? (measurementPoints.length >= 2 ? 'complete' : current) : (measurementCanClose(measurementPoints) ? 'complete' : current)
    })
    setRedoMeasurementPoints([])
    setMeasurementCursor(null)
  }, [measurementPoints, measurementShape])

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
    setMeasurementMode((current) => (current === 'complete' ? 'drawing' : current))
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
      setMeasurementMode((current) => {
        if (current !== 'drawing') return current
        return measurementShape === 'circle' ? (measurementPoints.length >= 2 ? 'complete' : current) : (measurementCanClose(measurementPoints) ? 'complete' : current)
      })
      setRedoMeasurementPoints([])
      setMeasurementCursor(null)
      return
    }

    if (measurementShape === 'circle') {
      setMeasurementPoints((current) => {
        if (current.length === 0) {
          setRedoMeasurementPoints([])
          return [action.point]
        }
        setMeasurementMode('complete')
        setMeasurementCursor(null)
        setRedoMeasurementPoints([])
        return [current[0], action.point]
      })
      return
    }

    addMeasurementPoint(action.point)
  }, [addMeasurementPoint, measurementPoints, measurementShape])

  const setCircleRadiusPoint = useCallback((point: [number, number]) => {
    if (measurementShape !== 'circle') return
    setMeasurementPoints((current) => {
      if (current.length === 0) return current
      return [current[0], point]
    })
    setMeasurementMode('complete')
    setMeasurementCursor(null)
    setRedoMeasurementPoints([])
  }, [measurementShape])

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
      onIsolateLayer={isolateLayer}
      yearRange={yearRange}
      onYearRangeChange={(range) => {
        clearSelection()
        setYearRange(range)
      }}
      onOpenSearch={() => {
        setSearchMounted(true)
        setSearchOpen(true)
      }}
      onStartMeasurement={startMeasurement}
      onStartCircleMeasurement={startCircleMeasurement}
      onOpenTable={() => setTableLayer('parks')}
      onFinishMeasurement={finishMeasurement}
      onClearMeasurement={clearMeasurement}
      openInEnabled={openInEnabled}
      onOpenInEnabledChange={setOpenInEnabled}
      scaleVisible={scaleVisible}
      onScaleVisibleChange={setScaleVisible}
      scalePosition={scalePosition}
      onScalePositionChange={setScalePosition}
    />
  )

  return (
    <MapSectionLayout
      showDesktopSidebar={showSidebar}
      onToggleDesktopSidebar={() => setShowSidebar((current) => !current)}
      desktopSidebarWidth={320}
      mobileInitialSheetState="collapsed"
      suppressMobileSheet={measurementMode !== 'idle'}
      showMobilePeek={Boolean(selectedFeature && mobileControlsExpanded)}
      mobilePeek={(
        mobileFeatureExpandedInFront ? (
          <div className="h-8" aria-hidden="true" />
        ) : (
          <button
            type="button"
            className="min-w-0 text-left"
            data-map-mobile-sheet-peek-action="true"
            aria-label={selectedFeature && mobileControlsExpanded ? 'Show selected feature card' : 'Interactive map controls'}
            onClick={selectedFeature && mobileControlsExpanded ? (event) => {
              event.stopPropagation()
              bringMobileInspectorToFront()
            } : undefined}
            onTouchStart={selectedFeature && mobileControlsExpanded ? (event) => event.stopPropagation() : undefined}
            onPointerDown={selectedFeature && mobileControlsExpanded ? (event) => event.stopPropagation() : undefined}
            onMouseDown={selectedFeature && mobileControlsExpanded ? (event) => event.stopPropagation() : undefined}
          >
            <span className="block truncate text-xs font-semibold text-foreground">
              {selectedFeature && mobileControlsExpanded ? selectedFeature.properties.name : 'Interactive map controls'}
            </span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {selectedFeature && mobileControlsExpanded
                ? layerLabel(selectedFeature.properties.layer)
                : measurementMode === 'drawing' ? `${measurementPoints.length} measurement points` : 'Legend, actions, and popup cards'}
            </span>
          </button>
        )
      )}
      mobileSnapVisibleHeight={mobileSnapVisibleHeight}
      mobileSnapTo={mobilePanel.snapTo}
      mobileSnapKey={mobilePanel.snapKey}
      mobileSheetInteractive={!selectedFeature || mobileControlsExpanded}
      mobileScrimEnabled={false}
      onMobileSheetStateChange={(sheetState) => dispatchMobilePanel({ type: 'syncControlsSheet', sheetState })}
      sidebar={sidebar}
    >
      <div className="relative h-full">
        <Map center={CENTER} zoom={11.1} attributionControl={false}>
          <MapControls position="top-right" className="top-16 md:top-2" />
          <MapClickCapture
            measurementMode={measurementMode}
            measurementShape={measurementShape}
            measurementPoints={measurementPoints}
            onMeasurementAction={handleMeasurementMapAction}
            onMeasurementCursor={setMeasurementCursor}
          />
          {zoomFeature && <ZoomToFeature feature={zoomFeature.feature} nonce={zoomFeature.nonce} />}
          <CollapseInspectorOnMapDrag
            enabled={measurementMode !== 'drawing'}
            onCollapse={() => {
              suppressNextMapDismiss(MAP_DRAG_DISMISS_SUPPRESS_MS)
              dispatchMobilePanel({ type: 'collapseFeature' })
            }}
          />
          <DismissSelectionOnMapClick
            enabled={measurementMode !== 'drawing'}
            shouldSkip={shouldSuppressMapDismiss}
            onDismiss={dismissSelectionForViewport}
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
            onFeatureClick={measurementMode === 'drawing' ? undefined : (id) => handleMobileFeatureClickOrSelect(() => selectPolygon(id, neighbourhoodFeatures))}
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
            onFeatureClick={measurementMode === 'drawing' ? undefined : (id) => handleMobileFeatureClickOrSelect(() => selectPolygon(id, parkFeatures))}
          />
          <MapLineLayer
            data={filteredRouteFeatures}
            color="#0ea5e9"
            width={4}
            opacity={0.82}
            idProperty="id"
            selectedId={selectedFeature?.properties.layer === 'routes' ? selectedFeature.properties.id : null}
            visible={visibleLayers.routes}
            onFeatureClick={measurementMode === 'drawing' ? undefined : (id) => handleMobileFeatureClickOrSelect(() => selectRoute(id))}
          />

          <MapFillLayer data={measurementPolygonData} fillColor="#f97316" fillOpacity={0.18} lineColor="#ea580c" lineWidth={2} visible={measurementShape === 'polygon' && measurementPoints.length >= 3} />
          <MapLineLayer data={measurementLineData} color="#ea580c" width={2.5} opacity={1} dashArray={measurementMode === 'drawing' ? [2, 1.3] : undefined} visible={measurementShape === 'polygon' && measurementPoints.length > 1} />
          <MapLineLayer data={measurementPreviewLineData} color="#ea580c" width={2} opacity={0.72} dashArray={[1.2, 1.2]} visible={measurementShape === 'polygon' && measurementMode === 'drawing' && measurementPoints.length > 0} />
          <MapFillLayer data={measurementCircleData} fillColor="#ffffff" fillOpacity={0.04} lineColor="#ffffff" lineWidth={0} visible={measurementShape === 'circle' && measurementCircleData.features.length > 0} />

          {measurementShape === 'polygon' && measurementPoints.map((point, index) => (
            <MapMarker
              key={`${point[0]}:${point[1]}:${index}`}
              longitude={point[0]}
              latitude={point[1]}
              onClick={(event) => {
                if (measurementShape !== 'polygon' || measurementMode !== 'drawing' || index !== 0 || !measurementCanClose(measurementPoints)) return
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
                    measurementShape === 'polygon' && measurementMode === 'drawing' && index === 0 && measurementCanClose(measurementPoints) && 'size-6 cursor-pointer ring-4 ring-orange-500/20 hover:scale-110',
                  )}
                  onClick={(event) => {
                    if (measurementShape !== 'polygon' || measurementMode !== 'drawing' || index !== 0 || !measurementCanClose(measurementPoints)) return
                    event.stopPropagation()
                    finishMeasurement()
                  }}
                  aria-label={measurementShape === 'polygon' && index === 0 && measurementCanClose(measurementPoints) ? 'Close polygon' : `Measurement point ${index + 1}`}
                >
                  {index + 1}
                </button>
              </MarkerContent>
            </MapMarker>
          ))}

          {measurementMode !== 'drawing' && selectedFeature && selectedLngLat && (
            <MapPopup longitude={selectedLngLat[0]} latitude={selectedLngLat[1]} onClose={clearSelection} closeButton={false} className="hidden border-0 bg-transparent p-0 shadow-none md:block">
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
            measurementShape={measurementShape}
            measurementStats={currentMeasurementStats}
            measurementPoints={measurementPoints}
            measurementCursor={measurementCursor}
            canUndo={measurementPoints.length > 0}
            canRedo={redoMeasurementPoints.length > 0}
            onAddPoint={(point) => handleMeasurementMapAction({ type: 'add', point })}
            onPreviewPoint={setMeasurementCursor}
            onSetCircleRadiusPoint={setCircleRadiusPoint}
            onUndo={undoMeasurementPoint}
            onRedo={redoMeasurementPoint}
            onClearMeasurement={clearMeasurement}
            onFinishMeasurement={finishMeasurement}
          />
          {scaleVisible && <Scale position={scalePosition} />}
        </Map>

        {measurementMode !== 'drawing' && selectedFeature && (
          <MobileFeatureInspector
            key={selectedFeature.properties.id}
            feature={selectedFeatures[selectedFeatureIndex] ?? selectedFeature}
            openInPoint={selectedLngLat}
            openInEnabled={openInEnabled}
            collapsed={mobileInspectorCollapsed}
            controlsInFront={mobileControlsExpanded}
            onFeatureAction={(action) => handleFeatureAction(action, selectedFeatures[selectedFeatureIndex] ?? selectedFeature)}
            onExpand={() => dispatchMobilePanel({ type: 'expandFeature' })}
            onCollapse={() => dispatchMobilePanel({ type: 'collapseFeature' })}
            onDock={() => dispatchMobilePanel({ type: 'dockFeatureBehindControls' })}
            onClose={clearSelection}
          />
        )}

        {tableLayer && (
          <FeatureTablePanel
            layer={tableLayer}
            onLayerChange={setTableLayer}
            hiddenFeatureIds={hiddenFeatureIds}
            isolatedFeatureId={isolatedFeatureId}
            yearRange={yearRange}
            onClose={() => setTableLayer(null)}
            onSelect={(feature) => {
              const bounds = featureBounds(feature)
              setSelection(feature, [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2])
            }}
          />
        )}

        {(searchOpen || searchMounted) && (
          <MapSearchSheet
            open={searchOpen}
            hiddenFeatureIds={hiddenFeatureIds}
            isolatedFeatureId={isolatedFeatureId}
            yearRange={yearRange}
            onClose={() => setSearchOpen(false)}
            onExited={() => setSearchMounted(false)}
            onSelect={selectFeature}
          />
        )}

      </div>
    </MapSectionLayout>
  )
}

export default DevInteract

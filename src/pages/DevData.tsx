import { useObserveMapViewport } from '@/components/ui/map-viewport'
import { useCallback, useMemo, useReducer, useRef, useState } from 'react'
import type * as MapLibreGL from 'maplibre-gl'
import { X } from 'lucide-react'
import { Map, MapControls } from '@/components/ui/map'
import { FileDropTarget } from '@/components/ui/file-drop-target'
import { InlineAlert } from '@/components/ui/map-panels'
import { MapSwipe } from '@/components/ui/map-swipe'
import { ResponsiveFeatureDetail } from '@/components/ui/mobile-feature-card'
import { MAP_SIDEBAR_CLASS, MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { MapTableBridge, useMapTable, useMapTableState, type MapTableSource } from '@/components/map/useMapTable'
import {
  GEO_FILE_FORMATS,
  GeoFileImportError,
  parseGeoJsonText,
  readGeoFile,
  type ImportedCollection,
} from '@/lib/geoFileImport'
import { AddDataDialog } from './dev-data/AddDataDialog'
import type { CatalogEntry } from './dev-data/catalog'
import { DataMapLayers } from './dev-data/DataMapLayers'
import { dataLayerTableSource } from './dev-data/layerTableSource'
import { FeatureCard, FeaturePopup, type SelectedFeature } from './dev-data/FeaturePopup'
import { layerFromCatalog, layerFromUpload, initialWorkspace } from './dev-data/layerFactory'
import {
  effectiveStyle,
  featureCenter,
  featureTitle,
  featuresBounds,
  filteredCollection,
  type DataFeature,
  type ViewportBounds,
} from './dev-data/layerData'
import { FitToBounds, MapInstance, MirrorCamera, PointerTracker, ViewportTracker } from './dev-data/MapBehaviors'
import { swipePair, workspaceReducer, type DataLayer } from './dev-data/model'
import { DevDataSidebar } from './dev-data/Sidebar'
import { useLayerData } from './dev-data/useLayerData'

const DEV_DATA_CENTER: [number, number] = [-122.7497, 53.9171]
const DEV_DATA_ZOOM = 11.1

function firstVisibleId(layers: readonly DataLayer[]): string | undefined {
  return (layers.find((layer) => layer.visible) ?? layers[0])?.id
}

function DevData() {
  const [state, dispatch] = useReducer(workspaceReducer, undefined, initialWorkspace)
  const tableState = useMapTableState()
  const tableLayerId = tableState.activeId
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null)
  const [bounds, setBounds] = useState<ViewportBounds | null>(null)
  const [selected, setSelected] = useState<SelectedFeature | null>(null)
  const [fit, setFit] = useState<{ bounds: ViewportBounds | null; nonce: number }>({ bounds: null, nonce: 0 })
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [importBusy, setImportBusy] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [leftMap, setLeftMap] = useState<MapLibreGL.Map | null>(null)
  const lastPointer = useRef<[number, number] | null>(null)
  const uploadCount = useRef(0)
  // Survives the map remounting when a swipe starts or stops.
  const camera = useRef<{ center: [number, number]; zoom: number }>({ center: DEV_DATA_CENTER, zoom: DEV_DATA_ZOOM })

  const layerById = useMemo(() => new globalThis.Map(state.layers.map((layer) => [layer.id, layer])), [state.layers])
  const tableLayer = tableLayerId ? layerById.get(tableLayerId) : undefined
  const activeLayer = activeLayerId ? layerById.get(activeLayerId) : undefined

  const wantedIds = useMemo(() => {
    const ids = new Set(state.layers.filter((layer) => layer.visible).map((layer) => layer.id))
    if (tableLayer) ids.add(tableLayer.id)
    if (activeLayer) ids.add(activeLayer.id)
    return ids
  }, [activeLayer, state.layers, tableLayer])
  const { getLayer, register } = useLayerData(state.layers, wantedIds)

  const selectedLayer = selected ? layerById.get(selected.layerId) : undefined
  const shownSelection = selected && selectedLayer?.visible ? selected : null
  const selectedId = shownSelection ? shownSelection.feature.properties.__devDataId : null

  const handleMapReady = useCallback((map: MapLibreGL.Map | null) => {
    setLeftMap(map)
  }, [])
  useObserveMapViewport(
    leftMap,
    ({ zoom }) => {
      if (!leftMap) return
      const center = leftMap.getCenter()
      camera.current = { center: [center.lng, center.lat], zoom }
    },
    { events: ['moveend'], initial: 'none' },
  )
  const handlePointer = useCallback((lngLat: [number, number]) => {
    lastPointer.current = lngLat
  }, [])

  const tableSources = useMemo<MapTableSource[]>(
    () => state.layers.map((layer) => dataLayerTableSource(layer, getLayer(layer.id))),
    [getLayer, state.layers],
  )
  const table = useMapTable({
    sources: tableSources,
    state: tableState,
    defaultSourceId: firstVisibleId(state.layers),
    selectedRowId: selectedId,
    onSelectRow: (feature: DataFeature, source) => {
      dispatch({ type: 'setVisible', id: source.id, visible: true })
      setSelected((current) => ({
        feature,
        layerId: source.id,
        anchor: featureCenter(feature) ?? DEV_DATA_CENTER,
        nonce: (current?.nonce ?? 0) + 1,
      }))
    },
  })
  const { open: openTableSource, follow: followTable } = table

  const openTable = useCallback(
    (layerId: string) => {
      dispatch({ type: 'setVisible', id: layerId, visible: true })
      openTableSource(layerId)
    },
    [openTableSource],
  )

  const handleFeatureClick = useCallback(
    (layerId: string, featureId: string) => {
      const index = Number(featureId.slice(featureId.lastIndexOf(':') + 1))
      const feature = getLayer(layerId).collection.features[index]
      if (!feature) return
      setSelected((current) => ({
        feature,
        layerId,
        anchor: lastPointer.current ?? featureCenter(feature) ?? DEV_DATA_CENTER,
        nonce: (current?.nonce ?? 0) + 1,
      }))
      followTable(layerId)
    },
    [followTable, getLayer],
  )

  const zoomToLayer = useCallback(
    (layerId: string) => {
      const layer = layerById.get(layerId)
      const loaded = getLayer(layerId)
      if (!layer || loaded.status !== 'ready') return
      const box = featuresBounds(filteredCollection(loaded.collection, layer, effectiveStyle(layer, loaded)).features)
      if (box) setFit((current) => ({ bounds: box, nonce: current.nonce + 1 }))
    },
    [getLayer, layerById],
  )

  const addCatalogLayer = useCallback((entry: CatalogEntry) => {
    dispatch({ type: 'add', layer: layerFromCatalog(entry, true) })
  }, [])

  const addImported = useCallback(
    (fileName: string, imported: ImportedCollection) => {
      uploadCount.current += 1
      const layer: DataLayer = layerFromUpload(`upload-${uploadCount.current}`, fileName, imported)
      register(layer, imported.collection)
      dispatch({ type: 'add', layer })
      const box = featuresBounds(imported.collection.features as DataFeature[])
      if (box) setFit((current) => ({ bounds: box, nonce: current.nonce + 1 }))
    },
    [register],
  )

  const handleFiles = useCallback(
    async (files: File[]) => {
      setImportBusy(true)
      setImportError(null)
      const failures: string[] = []
      for (const file of files) {
        try {
          addImported(file.name, await readGeoFile(file))
        } catch (error) {
          failures.push(
            error instanceof GeoFileImportError ? `${file.name}: ${error.message}` : `${file.name} could not be read.`,
          )
        }
      }
      setImportBusy(false)
      if (failures.length > 0) setImportError(failures.join(' '))
      else setLibraryOpen(false)
    },
    [addImported],
  )

  const handleUrl = useCallback(
    async (url: string) => {
      setImportBusy(true)
      setImportError(null)
      try {
        const response = await fetch(url)
        if (!response.ok) throw new GeoFileImportError(`The server answered ${response.status} ${response.statusText}.`)
        const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'Linked layer')
        addImported(name, { name: name.replace(/\.[^.]+$/, ''), ...parseGeoJsonText(await response.text()) })
        setLibraryOpen(false)
      } catch (error) {
        setImportError(
          error instanceof GeoFileImportError
            ? error.message
            : 'The URL could not be fetched. It must serve GeoJSON and allow requests from this site (CORS).',
        )
      } finally {
        setImportBusy(false)
      }
    },
    [addImported],
  )

  const addedIds = useMemo(() => new Set(state.layers.map((layer) => layer.id)), [state.layers])
  const pair = swipePair(state)

  const selectedSummary = useMemo(() => {
    if (!shownSelection || !selectedLayer) return null
    return {
      title: featureTitle(shownSelection.feature, selectedLayer, getLayer(selectedLayer.id).attributes),
      subtitle: selectedLayer.label,
    }
  }, [getLayer, selectedLayer, shownSelection])

  const sidebar = (
    <DevDataSidebar
      className={MAP_SIDEBAR_CLASS}
      state={state}
      getLayer={getLayer}
      activeLayerId={activeLayer?.id ?? null}
      tableLayerId={tableLayer?.id ?? null}
      bounds={bounds}
      onAction={dispatch}
      onOpenLayer={setActiveLayerId}
      onCloseLayer={() => setActiveLayerId(null)}
      onOpenTable={openTable}
      onZoomToLayer={zoomToLayer}
      onAddData={() => {
        setImportError(null)
        setLibraryOpen(true)
      }}
    />
  )

  const mainMap = (
    <Map
      center={camera.current.center}
      zoom={camera.current.zoom}
      attributionControl={false}
      deferResize={table.deferResize}
      controls={<MapControls position="top-right" className="top-16 md:top-2" />}
    >
      <ViewportTracker onChange={setBounds} />
      <PointerTracker onPointer={handlePointer} />
      <MapInstance onReady={handleMapReady} />
      <MapTableBridge table={table} />
      <FitToBounds bounds={fit.bounds} nonce={fit.nonce} />
      <DataMapLayers
        layers={pair ? state.layers.filter((layer) => layer.id !== pair.right.id) : state.layers}
        getLayer={getLayer}
        selectedFeatureId={selectedId}
        onFeatureClick={handleFeatureClick}
      />
      {shownSelection && selectedLayer && (
        <ResponsiveFeatureDetail
          popup={
            <FeaturePopup
              selected={shownSelection}
              layer={selectedLayer}
              loaded={getLayer(selectedLayer.id)}
              onClose={() => setSelected(null)}
              onShowInTable={() => openTable(selectedLayer.id)}
            />
          }
        />
      )}
    </Map>
  )

  return (
    <MapSectionLayout
      desktopSidebarWidth={340}
      mobileInitialSheetState="collapsed"
      showMobilePeek={Boolean(selectedSummary)}
      mobilePeek={
        selectedSummary ? (
          <div className="min-w-0 text-left">
            <span className="block truncate text-xs font-semibold text-foreground">{selectedSummary.title}</span>
            <span className="block truncate text-xs text-muted-foreground">{selectedSummary.subtitle}</span>
          </div>
        ) : undefined
      }
      sidebar={sidebar}
      table={table}
    >
      <FileDropTarget className="h-full" onFiles={handleFiles} hint={GEO_FILE_FORMATS}>
        {pair ? (
          <MapSwipe
            testId="dev-data-swipe"
            leftLabel={pair.left.label}
            rightLabel={pair.right.label}
            left={mainMap}
            right={
              <Map
                center={camera.current.center}
                zoom={camera.current.zoom}
                interactive={false}
                attributionControl={false}
                controls={null}
                showLoadingOverlay={false}
              >
                <MirrorCamera source={leftMap} />
                <DataMapLayers
                  layers={state.layers.filter((layer) => layer.id !== pair.left.id)}
                  getLayer={getLayer}
                  selectedFeatureId={null}
                  interactive={false}
                />
              </Map>
            }
          />
        ) : (
          mainMap
        )}

        {pair && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-between px-3 text-xs font-semibold">
            <span className="rounded bg-background/90 px-2 py-1 shadow-sm">{pair.left.label}</span>
            <span className="rounded bg-background/90 px-2 py-1 shadow-sm">{pair.right.label}</span>
          </div>
        )}

        {importError && !libraryOpen && (
          <div className="absolute inset-x-2 bottom-2 z-30 mx-auto max-w-md md:bottom-4">
            <div className="relative rounded-md bg-background shadow-lg">
              <InlineAlert tone="error" title="Could not add that file">
                {importError}
              </InlineAlert>
              <button
                type="button"
                className="absolute right-1 top-1 rounded p-1 text-muted-foreground hover:bg-muted"
                aria-label="Dismiss"
                onClick={() => setImportError(null)}
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
        )}
      </FileDropTarget>

      {shownSelection && selectedLayer && (
        <ResponsiveFeatureDetail
          card={
            <FeatureCard
              selected={shownSelection}
              layer={selectedLayer}
              loaded={getLayer(selectedLayer.id)}
              onClose={() => setSelected(null)}
            />
          }
        />
      )}

      <AddDataDialog
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        addedIds={addedIds}
        busy={importBusy}
        error={importError}
        onAddCatalog={addCatalogLayer}
        onFiles={handleFiles}
        onUrl={handleUrl}
      />
    </MapSectionLayout>
  )
}

export default DevData

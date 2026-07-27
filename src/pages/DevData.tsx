import { useCallback, useMemo, useState } from 'react'
import { Map, MapControls } from '@/components/ui/map'
import { MapFillLayer, MapLineLayer } from '@/components/ui/map-layers'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { DEFAULT_TABLE_PANE_HEIGHT, MapTableButton } from '@/components/map/MapFeatureTable'
import {
  DEV_DATA_CENTER,
  DEV_DATA_INITIAL_LAYERS,
  DEV_DATA_LAYERS,
  DEV_DATA_LAYER_BY_ID,
  DEV_DATA_ZOOM,
  FEATURE_ID_KEY,
  featureCenter,
  featureLabel,
  type DataFeature,
  type DataLayerId,
} from './dev-data/data'
import { DataTablePanel } from './dev-data/DataTablePanel'
import { FlyToCenter, ViewportTracker } from './dev-data/MapBehaviors'
import { DevDataSidebar } from './dev-data/Sidebar'
import { useDataLayers, useStableLayerList, type ViewportBounds } from './dev-data/useDataLayers'

const initialEnabled = Object.fromEntries(
  DEV_DATA_LAYERS.map((layer) => [layer.id, DEV_DATA_INITIAL_LAYERS.includes(layer.id)]),
) as Record<DataLayerId, boolean>

function DevData() {
  const [showSidebar, setShowSidebar] = useState(true)
  const [enabledLayers, setEnabledLayers] = useState<Record<DataLayerId, boolean>>(initialEnabled)
  const [tableLayer, setTableLayer] = useState<DataLayerId | null>(null)
  const [showOnlyInView, setShowOnlyInView] = useState(false)
  const [viewModeToggle, setViewModeToggle] = useState(true)
  const [tableHeight, setTableHeight] = useState(DEFAULT_TABLE_PANE_HEIGHT)
  const [bounds, setBounds] = useState<ViewportBounds | null>(null)
  const [selected, setSelected] = useState<{ feature: DataFeature; center: [number, number] | null; nonce: number } | null>(null)

  const layerList = useStableLayerList(enabledLayers)
  const { getLayer } = useDataLayers(layerList)

  const toggleLayer = useCallback((layerId: DataLayerId) => {
    setEnabledLayers((current) => ({ ...current, [layerId]: !current[layerId] }))
  }, [])

  /** Opening a layer in the table also switches it on, so its rows can load. */
  const openTable = useCallback((layerId: DataLayerId) => {
    setEnabledLayers((current) => (current[layerId] ? current : { ...current, [layerId]: true }))
    setTableLayer(layerId)
  }, [])

  const handleSelectRow = useCallback((feature: DataFeature) => {
    setSelected((current) => ({
      feature,
      center: featureCenter(feature),
      nonce: (current?.nonce ?? 0) + 1,
    }))
  }, [])

  const handleFeatureClick = useCallback((layerId: DataLayerId, featureId: string) => {
    const feature = getLayer(layerId).collection.features.find(
      (candidate) => candidate.properties[FEATURE_ID_KEY] === featureId,
    )
    if (!feature) return
    setTableLayer(layerId)
    setSelected((current) => ({ feature, center: null, nonce: current?.nonce ?? 0 }))
  }, [getLayer])

  const selectedId = selected ? selected.feature.properties[FEATURE_ID_KEY] : null
  const selectedLayerId = selectedId ? (selectedId.split(':')[0] as DataLayerId) : null

  const sidebar = (
    <DevDataSidebar
      enabledLayers={enabledLayers}
      tableLayer={tableLayer}
      getLayer={getLayer}
      viewModeToggle={viewModeToggle}
      onViewModeToggleChange={setViewModeToggle}
      onToggleLayer={toggleLayer}
      onOpenTable={openTable}
    />
  )

  const selectedSummary = useMemo(() => {
    if (!selected || !selectedLayerId) return null
    const definition = DEV_DATA_LAYER_BY_ID.get(selectedLayerId)
    if (!definition) return null
    return { title: featureLabel(selected.feature, definition), subtitle: definition.label }
  }, [selected, selectedLayerId])

  return (
    <MapSectionLayout
      showDesktopSidebar={showSidebar}
      onToggleDesktopSidebar={() => setShowSidebar((current) => !current)}
      desktopSidebarWidth={330}
      mobileInitialSheetState="collapsed"
      showMobilePeek={Boolean(selectedSummary)}
      mobilePeek={selectedSummary ? (
        <div className="min-w-0 text-left">
          <span className="block truncate text-xs font-semibold text-foreground">{selectedSummary.title}</span>
          <span className="block truncate text-xs text-muted-foreground">{selectedSummary.subtitle}</span>
        </div>
      ) : undefined}
      sidebar={sidebar}
      bottomPaneHeight={tableLayer ? tableHeight : 0}
      bottomPane={tableLayer ? (
        <DataTablePanel
          layerId={tableLayer}
          state={getLayer(tableLayer)}
          bounds={bounds}
          showOnlyInView={showOnlyInView}
          selectedFeatureId={selectedLayerId === tableLayer ? selectedId : null}
          height={tableHeight}
          onHeightChange={setTableHeight}
          viewModeToggle={viewModeToggle}
          onShowOnlyInViewChange={setShowOnlyInView}
          onLayerChange={openTable}
          onClose={() => setTableLayer(null)}
          onSelect={handleSelectRow}
        />
      ) : undefined}
    >
      <div className="relative h-full">
        <Map center={DEV_DATA_CENTER} zoom={DEV_DATA_ZOOM} attributionControl={false}>
          <MapControls position="top-right" className="top-16 md:top-2" />
          <ViewportTracker onChange={setBounds} />
          {selected && <FlyToCenter center={selected.center} nonce={selected.nonce} />}

          {DEV_DATA_LAYERS.map((layer) => {
            const state = getLayer(layer.id)
            const visible = enabledLayers[layer.id] && state.status === 'ready'
            const selectedForLayer = selectedLayerId === layer.id ? selectedId : null

            if (layer.shape === 'line') {
              return (
                <MapLineLayer
                  key={layer.id}
                  data={state.collection}
                  color={layer.color}
                  width={3}
                  opacity={0.85}
                  idProperty={FEATURE_ID_KEY}
                  selectedId={selectedForLayer}
                  visible={visible}
                  onFeatureClick={(id) => handleFeatureClick(layer.id, id)}
                />
              )
            }

            return (
              <MapFillLayer
                key={layer.id}
                data={state.collection}
                fillColor={layer.color}
                fillOpacity={0.22}
                lineColor={layer.color}
                lineWidth={1.2}
                idProperty={FEATURE_ID_KEY}
                selectedId={selectedForLayer}
                visible={visible}
                onFeatureClick={(id) => handleFeatureClick(layer.id, id)}
              />
            )
          })}
        </Map>

        {/* Felt-style icon-only table control, pinned over the map. */}
        {!tableLayer && (
          <div className="absolute left-2 top-16 z-20 md:top-2">
            <MapTableButton iconOnly label="Open table" onClick={() => openTable(tableLayer ?? 'community-boundaries')} />
          </div>
        )}

      </div>
    </MapSectionLayout>
  )
}

export default DevData

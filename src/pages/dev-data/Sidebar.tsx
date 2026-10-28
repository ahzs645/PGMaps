import { Layers, Plus } from 'lucide-react'
import { MapSidebarShell, SidebarSection } from '@/components/ui/map-panels'
import { CATALOG_SOURCE } from './catalog'
import { LayerDetail } from './LayerDetail'
import type { LoadedLayer, ViewportBounds } from './layerData'
import { LayerPanel } from './LayerPanel'
import type { WorkspaceAction, WorkspaceState } from './model'

/**
 * Felt's left panel: the layer list (which is the legend) and "Add data"; picking
 * a layer swaps the list for that layer's style and insights panel.
 */
export function DevDataSidebar({
  className,
  state,
  getLayer,
  activeLayerId,
  tableLayerId,
  bounds,
  onAction,
  onOpenLayer,
  onCloseLayer,
  onOpenTable,
  onZoomToLayer,
  onAddData,
}: {
  className?: string
  state: WorkspaceState
  getLayer: (id: string) => LoadedLayer
  activeLayerId: string | null
  tableLayerId: string | null
  bounds: ViewportBounds | null
  onAction: (action: WorkspaceAction) => void
  onOpenLayer: (id: string) => void
  onCloseLayer: () => void
  onOpenTable: (id: string) => void
  onZoomToLayer: (id: string) => void
  onAddData: () => void
}) {
  const activeLayer = activeLayerId ? state.layers.find((layer) => layer.id === activeLayerId) : undefined

  return (
    <MapSidebarShell
      className={className}
      title="City data"
      subtitle="City of Prince George open data"
      icon={Layers}
      iconClassName="border bg-muted text-foreground"
      titleClassName="text-base"
      scrollClassName="pb-[calc(env(safe-area-inset-bottom)+2rem)] md:pb-0"
      actions={
        <button
          type="button"
          onClick={onAddData}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 touch:py-2.5"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          Add data
        </button>
      }
    >
      {activeLayer ? (
        <LayerDetail
          key={activeLayer.id}
          layer={activeLayer}
          loaded={getLayer(activeLayer.id)}
          bounds={bounds}
          onAction={onAction}
          onBack={onCloseLayer}
        />
      ) : (
        <>
          <LayerPanel
            state={state}
            getLayer={getLayer}
            tableLayerId={tableLayerId}
            activeLayerId={activeLayerId}
            onAction={onAction}
            onOpenLayer={onOpenLayer}
            onOpenTable={onOpenTable}
            onZoomToLayer={onZoomToLayer}
            onAddData={onAddData}
          />
          <SidebarSection className="border-b-0">
            <p className="text-xs leading-5 text-muted-foreground">
              Snapshots from the {CATALOG_SOURCE}, synced through bcdatamapper. Click a layer for its style and
              insights; drop a file on the map to add your own.
            </p>
          </SidebarSection>
        </>
      )}
    </MapSidebarShell>
  )
}

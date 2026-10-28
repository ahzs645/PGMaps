import { Columns2, Eye, Layers, ListChecks, Paintbrush, Plus, Table2, Trash2, ZoomIn } from 'lucide-react'
import { ActionMenu } from '@/components/ui/action-menu'
import { LayerListItem, LayerSwatch } from '@/components/ui/layer-list-item'
import { InlineAlert, SidebarSection } from '@/components/ui/map-panels'
import { TextButton } from '@/components/ui/text-button'
import { formatDate, formatNumber } from '@/lib/format'
import { primaryColor } from '@/lib/layerStyle'
import { effectiveStyle, type LoadedLayer } from './layerData'
import { LayerLegend } from './LayerLegend'
import {
  GROUP_MODE_LABELS,
  orderedGroups,
  swipePair,
  type DataLayer,
  type GroupMode,
  type WorkspaceAction,
  type WorkspaceState,
} from './model'

const GROUP_MODE_ICONS: Record<GroupMode, typeof Layers> = { all: ListChecks, one: Eye, swipe: Columns2 }

/** "62 rows · Snapshot 17 Jun 2026" — Felt's line of facts under a layer name. */
export function layerFacts(layer: DataLayer, loaded: LoadedLayer): string {
  const shownRows = loaded.status === 'ready' ? loaded.collection.features.length : undefined
  if (layer.source.kind === 'upload') {
    return `${formatNumber(shownRows ?? layer.source.rowCount)} rows · Uploaded ${layer.source.fileName}`
  }
  const rows = formatNumber(shownRows ?? layer.source.entry.rowCount)
  const date = layer.source.entry.snapshotDate
  return date ? `${rows} rows · Snapshot ${formatDate(`${date}T12:00:00`)}` : `${rows} rows`
}

/**
 * The layer list, which is also the legend: groups of layers, each with its
 * legend rows underneath while it is shown, a visibility toggle and a menu.
 */
export function LayerPanel({
  state,
  getLayer,
  tableLayerId,
  activeLayerId,
  onAction,
  onOpenLayer,
  onOpenTable,
  onZoomToLayer,
  onAddData,
}: {
  state: WorkspaceState
  getLayer: (id: string) => LoadedLayer
  tableLayerId: string | null
  activeLayerId: string | null
  onAction: (action: WorkspaceAction) => void
  onOpenLayer: (id: string) => void
  onOpenTable: (id: string) => void
  onZoomToLayer: (id: string) => void
  onAddData: () => void
}) {
  const groups = orderedGroups(state)
  const swipe = swipePair(state)

  if (groups.length === 0) {
    return (
      <SidebarSection>
        <InlineAlert title="No layers yet">
          Add a City of Prince George layer from the library, or drop a file on the map.
        </InlineAlert>
        <TextButton className="mt-2" onClick={onAddData}>
          Add data
        </TextButton>
      </SidebarSection>
    )
  }

  return (
    <>
      {groups.map((group) => {
        const ModeIcon = GROUP_MODE_ICONS[group.mode]
        const shownCount = group.layers.filter((layer) => layer.visible).length
        return (
          <SidebarSection
            key={group.id}
            title={group.id}
            headingLevel={3}
            actions={
              <ActionMenu
                label={`${group.id} group options`}
                trigger={<ModeIcon className="size-4" aria-hidden="true" />}
                triggerClassName="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground touch:size-10"
                items={[
                  { type: 'label', id: 'mode-label', label: 'Show layers' },
                  ...(Object.keys(GROUP_MODE_LABELS) as GroupMode[]).map((mode) => ({
                    id: mode,
                    label: GROUP_MODE_LABELS[mode],
                    checked: group.mode === mode,
                    radio: true,
                    disabled: mode === 'swipe' && group.layers.length < 2,
                    onSelect: () => onAction({ type: 'setGroupMode', group: group.id, mode }),
                  })),
                ]}
              />
            }
          >
            {group.mode === 'swipe' && (
              <p className="mb-1.5 px-2 text-xs text-muted-foreground">
                {swipe?.group === group.id
                  ? `Drag the divider on the map to compare ${swipe.left.label} (left) with ${swipe.right.label} (right).`
                  : shownCount < 2
                    ? 'Show two layers in this group to compare them with a slider.'
                    : 'Another group is already being swiped.'}
              </p>
            )}
            <div className="space-y-0.5">
              {group.layers.map((layer) => {
                const loaded = getLayer(layer.id)
                const style = effectiveStyle(layer, loaded)
                const shownRows = layer.filter ? ' · Filtered' : ''
                return (
                  <LayerListItem
                    key={layer.id}
                    title={layer.label}
                    subtitle={`${layerFacts(layer, loaded)}${shownRows}`}
                    status={loaded.status === 'loading' ? 'loading' : loaded.status === 'error' ? 'error' : 'ready'}
                    statusLabel={loaded.status === 'error' ? `Failed to load: ${loaded.error}` : undefined}
                    swatch={<LayerSwatch color={primaryColor(style)} shape={layer.geometry} dimmed={!layer.visible} />}
                    visible={layer.visible}
                    selected={activeLayerId === layer.id}
                    onVisibleChange={(visible) => onAction({ type: 'setVisible', id: layer.id, visible })}
                    onOpen={() => onOpenLayer(layer.id)}
                    openLabel={`Style and explore ${layer.label}`}
                    actions={
                      <ActionMenu
                        label={`${layer.label} options`}
                        items={[
                          {
                            id: 'style',
                            label: 'Style and insights',
                            icon: <Paintbrush className="size-4" />,
                            onSelect: () => onOpenLayer(layer.id),
                          },
                          {
                            id: 'zoom',
                            label: 'Zoom to layer',
                            icon: <ZoomIn className="size-4" />,
                            disabled: loaded.status !== 'ready',
                            onSelect: () => onZoomToLayer(layer.id),
                          },
                          {
                            id: 'table',
                            label: tableLayerId === layer.id ? 'Showing in table' : 'Open table',
                            icon: <Table2 className="size-4" />,
                            onSelect: () => onOpenTable(layer.id),
                          },
                          { type: 'separator', id: 'sep' },
                          {
                            id: 'legend',
                            label: 'Show in legend',
                            checked: layer.showInLegend,
                            onSelect: () =>
                              onAction({ type: 'setShowInLegend', id: layer.id, show: !layer.showInLegend }),
                          },
                          layer.filter && {
                            id: 'clear',
                            label: 'Clear filter',
                            icon: <Plus className="size-4 rotate-45" />,
                            onSelect: () => onAction({ type: 'setFilter', id: layer.id, filter: null }),
                          },
                          {
                            id: 'remove',
                            label: 'Remove from map',
                            icon: <Trash2 className="size-4" />,
                            tone: 'danger',
                            onSelect: () => onAction({ type: 'remove', id: layer.id }),
                          },
                        ]}
                      />
                    }
                  >
                    {layer.showInLegend && loaded.status === 'ready' && (
                      <LayerLegend
                        layer={layer}
                        style={style}
                        attributes={loaded.attributes}
                        collection={loaded.collection}
                        onToggleCategory={(column, value, allValues) =>
                          onAction({ type: 'toggleCategory', id: layer.id, column, value, allValues })
                        }
                      />
                    )}
                  </LayerListItem>
                )
              })}
            </div>
          </SidebarSection>
        )
      })}
    </>
  )
}

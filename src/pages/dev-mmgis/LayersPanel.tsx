import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Paintbrush, Plus, Table2, Trash2, ZoomIn } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ActionMenu } from '@/components/ui/action-menu'
import { LayerSwatch } from '@/components/ui/layer-list-item'
import { SidebarSection } from '@/components/ui/map-panels'
import { primaryColor } from '@/lib/layerStyle'
import { LayerDetail } from '../dev-data/LayerDetail'
import { LayerLegend } from '../dev-data/LayerLegend'
import { effectiveStyle, type LoadedLayer, type ViewportBounds } from '../dev-data/layerData'
import { moveLayer, updateLayers, uid, type Mission } from './model'

export function LayersPanel({
  mission,
  change,
  getLayer,
  detail,
  onDetail,
  onAdd,
  onTable,
  onZoom,
  bounds,
}: {
  mission: Mission
  change: (fn: (m: Mission) => Mission) => void
  getLayer: (id: string) => LoadedLayer
  detail: string | null
  onDetail: (id: string | null) => void
  onAdd: () => void
  onTable: (id: string) => void
  onZoom: (id: string) => void
  bounds: ViewportBounds | null
}) {
  const active = mission.layers.find((l) => l.id === detail)
  if (active)
    return (
      <>
        <LayerDetail
          layer={active}
          loaded={getLayer(active.id)}
          bounds={bounds}
          onAction={(a) => change((m) => updateLayers(m, a))}
          onBack={() => onDetail(null)}
        />
        <SidebarSection title="Layer settings">
          <label className="mm-field">
            Layer name
            <input
              key={active.id}
              defaultValue={active.label}
              onBlur={(e) =>
                change((m) => ({
                  ...m,
                  layers: m.layers.map((l) =>
                    l.id === active.id ? { ...l, label: e.target.value.trim().slice(0, 200) || l.label } : l,
                  ),
                }))
              }
            />
          </label>
          <label className="mm-field">
            Layer group
            <input
              key={`${active.id}-group`}
              defaultValue={active.group}
              onBlur={(e) =>
                change((m) => ({
                  ...m,
                  layers: m.layers.map((l) =>
                    l.id === active.id ? { ...l, group: e.target.value.trim().slice(0, 200) || 'Your layers' } : l,
                  ),
                }))
              }
            />
          </label>
          <label className="mm-field">
            Time field
            <select
              value={active.timeProperty}
              onChange={(e) =>
                change((m) => ({
                  ...m,
                  layers: m.layers.map((l) => (l.id === active.id ? { ...l, timeProperty: e.target.value } : l)),
                }))
              }
            >
              <option value="">Not time-enabled</option>
              {getLayer(active.id)
                .attributes.filter((a) => !a.system)
                .map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.label}
                  </option>
                ))}
            </select>
          </label>
          <p className="mm-help">
            Dates are interpreted as UTC; numeric timestamps must be milliseconds since the Unix epoch. Features with
            missing or invalid dates are excluded while time filtering is on.
          </p>
        </SidebarSection>
      </>
    )
  return (
    <>
      <SidebarSection
        title="Mission layers"
        actions={
          <Button size="sm" variant="outline" onClick={onAdd}>
            <Plus size={14} />
            Add data
          </Button>
        }
      >
        <p className="mm-help">
          Layers draw from bottom to top in this list. Select a layer to change its style, opacity and filters.
        </p>
        {mission.layers.some((l) => l.group === 'Example mission') && (
          <p className="mm-help">Example mission layers are illustrative, not measured observations.</p>
        )}
        <div className="mm-group-controls">
          {[...new Set(mission.layers.map((l) => l.group))].map((group) => (
            <label className="mm-check" key={group}>
              <input
                type="checkbox"
                checked={mission.layers.filter((l) => l.group === group).every((l) => l.visible)}
                onChange={(e) =>
                  change((m) => ({
                    ...m,
                    layers: m.layers.map((l) => (l.group === group ? { ...l, visible: e.target.checked } : l)),
                  }))
                }
              />
              {group}
            </label>
          ))}
        </div>
      </SidebarSection>
      {mission.layers.map((l, i) => {
        const loaded = getLayer(l.id),
          style = effectiveStyle(l, loaded)
        return (
          <SidebarSection key={l.id} className="mm-layer">
            <div className="mm-layer-heading">
              <LayerSwatch color={primaryColor(style)} shape={l.geometry} />
              <button className="mm-layer-name" onClick={() => onDetail(l.id)}>
                {l.label}
              </button>
              <button
                aria-label={`${l.visible ? 'Hide' : 'Show'} ${l.label}`}
                onClick={() => change((m) => updateLayers(m, { type: 'setVisible', id: l.id, visible: !l.visible }))}
              >
                {l.visible ? <Eye size={15} /> : <EyeOff size={15} />}
              </button>
              <ActionMenu
                label={`${l.label} options`}
                items={[
                  {
                    id: 'style',
                    label: 'Style and filters',
                    icon: <Paintbrush size={14} />,
                    onSelect: () => onDetail(l.id),
                  },
                  { id: 'table', label: 'Open table', icon: <Table2 size={14} />, onSelect: () => onTable(l.id) },
                  { id: 'zoom', label: 'Zoom to layer', icon: <ZoomIn size={14} />, onSelect: () => onZoom(l.id) },
                  {
                    id: 'up',
                    label: 'Move toward top',
                    icon: <ArrowDown size={14} />,
                    disabled: i === mission.layers.length - 1,
                    onSelect: () => change((m) => moveLayer(m, l.id, 1)),
                  },
                  {
                    id: 'down',
                    label: 'Move toward bottom',
                    icon: <ArrowUp size={14} />,
                    disabled: i === 0,
                    onSelect: () => change((m) => moveLayer(m, l.id, -1)),
                  },
                  {
                    id: 'copy',
                    label: 'Make editable copy',
                    icon: <Copy size={14} />,
                    onSelect: () =>
                      change((m) => ({
                        ...m,
                        layers: [...m.layers, { ...l, id: uid(), label: `${l.label} copy`, editable: true }],
                      })),
                  },
                  {
                    id: 'remove',
                    label: 'Remove layer',
                    icon: <Trash2 size={14} />,
                    tone: 'danger',
                    onSelect: () => change((m) => ({ ...m, layers: m.layers.filter((v) => v.id !== l.id) })),
                  },
                ]}
              />
            </div>
            <p className="mm-layer-meta">
              {l.group} · {loaded.collection.features.length.toLocaleString()} /{' '}
              {l.data.features.length.toLocaleString()} features{l.timeProperty ? ' · temporal' : ''}
              {l.editable ? ' · editable' : ''}
            </p>
            {l.visible && (
              <LayerLegend
                layer={l}
                style={style}
                attributes={loaded.attributes}
                collection={loaded.collection}
                onToggleCategory={(column, value, allValues) =>
                  change((m) => updateLayers(m, { type: 'toggleCategory', id: l.id, column, value, allValues }))
                }
              />
            )}
          </SidebarSection>
        )
      })}
      {!mission.layers.length && (
        <SidebarSection>
          <p className="mm-help">Add a file or open the example mission to begin.</p>
        </SidebarSection>
      )}
    </>
  )
}

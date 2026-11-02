import { Circle, MapPin, Pentagon, Ruler, Undo2, Waypoints } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SidebarSection } from '@/components/ui/map-panels'
import { StatGroup } from '@/components/ui/stat-group'
import { measurement, type Coordinate, type Tool } from './model'
import { bearingDegrees, haversineMeters } from '../dev-forestry/visibility'

export function ToolsPanel({
  tool,
  onTool,
  points,
  pointer,
  onPoints,
  name,
  onName,
  onFinish,
  onSave,
}: {
  tool: Tool
  onTool: (v: Tool) => void
  points: Coordinate[]
  pointer: Coordinate | null
  onPoints: (v: Coordinate[]) => void
  name: string
  onName: (v: string) => void
  onFinish: () => void
  onSave: () => void
}) {
  const stats = measurement(points, tool === 'polygon')
  const last = points.at(-1)
  const preview =
    last && pointer && ['line', 'polygon', 'measure'].includes(tool)
      ? {
          length: haversineMeters({ lng: last[0], lat: last[1] }, { lng: pointer[0], lat: pointer[1] }),
          bearing: bearingDegrees({ lng: last[0], lat: last[1] }, { lng: pointer[0], lat: pointer[1] }),
        }
      : null
  return (
    <>
      <SidebarSection title="Draw & measure">
        <div className="mm-tool-grid">
          {(
            [
              ['point', 'Point', MapPin],
              ['line', 'Line', Waypoints],
              ['polygon', 'Polygon', Pentagon],
              ['measure', 'Measure', Ruler],
            ] as const
          ).map(([id, label, Icon]) => (
            <button key={id} aria-pressed={tool === id} onClick={() => onTool(id)}>
              <Icon size={18} />
              {label}
            </button>
          ))}
        </div>
        <p className="mm-help">
          Click the map to place vertices. Double-click or choose Finish to complete a line or polygon. Escape returns
          to inspection. Drag a saved feature’s handles to edit it.
        </p>
        <label className="mm-field">
          Feature name
          <input
            value={name}
            onChange={(e) => onName(e.target.value)}
            placeholder="e.g. Sampling zone"
            maxLength={200}
          />
        </label>
        <StatGroup
          variant="tiles"
          size="sm"
          columns={2}
          items={[
            { label: 'Vertices', value: String(points.length) },
            { label: 'Length', value: `${(stats.length / 1000).toFixed(3)} km` },
            ...(stats.area === null ? [] : [{ label: 'Area', value: `${(stats.area / 10000).toFixed(2)} ha` }]),
          ]}
        />
        {preview && (
          <div className="mm-readout" aria-label="Live measurement">
            <span>Current segment {preview.length.toFixed(1)} m</span>
            <span>{preview.bearing.toFixed(1)}° from north</span>
          </div>
        )}
        <div className="mm-button-row">
          <Button size="sm" disabled={points.length < (tool === 'polygon' ? 3 : 2)} onClick={onFinish}>
            Finish {tool === 'measure' ? 'measurement' : 'drawing'}
          </Button>
          <Button size="sm" variant="outline" disabled={!points.length} onClick={() => onPoints(points.slice(0, -1))}>
            <Undo2 size={14} />
            Undo vertex
          </Button>
        </div>
        <div className="mm-button-row">
          <Button size="sm" variant="outline" disabled={points.length < 2} onClick={onSave}>
            <Circle size={14} />
            Save path as layer
          </Button>
          <Button size="sm" variant="outline" disabled={!points.length} onClick={() => onPoints([])}>
            Clear draft
          </Button>
        </div>
      </SidebarSection>
      <SidebarSection title="Editing history">
        <p className="mm-help">
          The toolbar undo/redo restores mission edits, including added or removed layers and moved vertices. The last
          20 edits are kept for this session. Draft vertices have their own undo button.
        </p>
      </SidebarSection>
    </>
  )
}

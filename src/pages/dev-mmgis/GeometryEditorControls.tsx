import { useState } from 'react'
import type { Geometry } from 'geojson'
import { Button } from '@/components/ui/button'
import {
  geometryHandles,
  insertVertex,
  MAX_EDITABLE_VERTICES,
  removeVertex,
  tooManyVerticesMessage,
  vertexCount,
} from './geometryEditing'
import { StyledSelect } from '@/components/ui/styled-select'
export function GeometryEditorControls({
  geometry,
  onChange,
}: {
  geometry: Geometry
  onChange: (g: Geometry) => void
}) {
  const count = vertexCount(geometry)
  if (count > MAX_EDITABLE_VERTICES)
    return (
      <p className="mm-help" role="status">
        {tooManyVerticesMessage(count)}
      </p>
    )
  return <VertexControls geometry={geometry} onChange={onChange} />
}
function VertexControls({ geometry, onChange }: { geometry: Geometry; onChange: (g: Geometry) => void }) {
  const [index, setIndex] = useState(0),
    handles = geometryHandles(geometry)
  const current = handles.vertices[Math.min(index, handles.vertices.length - 1)]
  const edge = handles.edges.find((e) => JSON.stringify(e.after) === JSON.stringify(current?.address))
  return (
    <div>
      <label className="mm-field">
        Selected vertex
        <StyledSelect
          value={Math.min(index, handles.vertices.length - 1)}
          onChange={(e) => setIndex(Number(e.target.value))}
        >
          {handles.vertices.map((v, i) => (
            <option key={i} value={i}>
              {i + 1} · {v.point[1].toFixed(5)}, {v.point[0].toFixed(5)}
            </option>
          ))}
        </StyledSelect>
      </label>
      <div className="mm-button-row">
        <Button
          size="sm"
          variant="outline"
          disabled={!edge}
          onClick={() => edge && onChange(insertVertex(geometry, edge.after))}
        >
          Insert midpoint after vertex
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!current?.removable}
          onClick={() => current && onChange(removeVertex(geometry, current.address))}
        >
          Remove selected vertex
        </Button>
      </div>
      <p className="mm-help">
        All rings and geometry parts are editable. Drag handles or use arrow keys; Delete removes a vertex when its
        geometry remains valid.
      </p>
    </div>
  )
}

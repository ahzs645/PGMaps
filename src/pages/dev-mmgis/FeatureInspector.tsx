import { useState } from 'react'
import { Pencil, Table2, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SidebarSection } from '@/components/ui/map-panels'
import { CopyButton } from '@/components/ui/copy-button'
import { featureTitle, type DataFeature, type LoadedLayer } from '../dev-data/layerData'
import type { MissionLayer } from './model'
import type { Geometry } from 'geojson'
import { PropertyTree } from './PropertyTree'
import { GeometryEditorControls } from './GeometryEditorControls'

export function FeatureInspector({
  feature,
  layer,
  loaded,
  onClose,
  onTable,
  onProperties,
  onDelete,
  editing,
  onEditing,
  onGeometry,
  onLocate,
  onHide,
  candidateIndex = 0,
  candidateCount = 1,
  onCandidate,
}: {
  feature: DataFeature
  layer: MissionLayer
  loaded: LoadedLayer
  onClose: () => void
  onTable: () => void
  onProperties: (properties: Record<string, unknown>) => void
  onDelete: () => void
  editing: boolean
  onEditing: (value: boolean) => void
  onGeometry: (geometry: Geometry) => void
  onLocate: () => void
  onHide: () => void
  candidateIndex?: number
  candidateCount?: number
  onCandidate: (offset: number) => void
}) {
  const [properties, setProperties] = useState(
    JSON.stringify(
      Object.fromEntries(Object.entries(feature.properties).filter(([k]) => !k.startsWith('__'))),
      null,
      2,
    ),
  )
  const [error, setError] = useState('')
  return (
    <SidebarSection
      title="Selected feature"
      actions={
        <button aria-label="Close feature" onClick={onClose}>
          <X size={15} />
        </button>
      }
    >
      <h3 className="text-sm font-semibold">{featureTitle(feature, layer, loaded.attributes)}</h3>
      <p className="mm-help">{layer.label}</p>
      {candidateCount > 1 && (
        <div className="mm-button-row" role="group" aria-label="Intersecting features">
          <Button size="sm" variant="outline" onClick={() => onCandidate(-1)}>
            Previous feature
          </Button>
          <span role="status">
            Feature {candidateIndex + 1} of {candidateCount}
          </span>
          <Button size="sm" variant="outline" onClick={() => onCandidate(1)}>
            Next feature
          </Button>
        </div>
      )}
      <div className="mm-button-row">
        <Button size="sm" variant="outline" onClick={onLocate}>
          Locate feature
        </Button>
        <Button size="sm" variant="outline" onClick={onHide}>
          Hide feature
        </Button>
        <CopyButton
          className="rounded-md border px-3 py-1 text-xs"
          text={JSON.stringify(
            {
              ...feature,
              properties: Object.fromEntries(Object.entries(feature.properties).filter(([k]) => !k.startsWith('__'))),
            },
            null,
            2,
          )}
        >
          Copy feature GeoJSON
        </CopyButton>
      </div>
      <PropertyTree properties={feature.properties} />
      <Button size="sm" variant="outline" onClick={onTable}>
        <Table2 size={14} />
        Open attribute table
      </Button>
      {layer.editable && (
        <>
          <label className="mm-check">
            <input type="checkbox" checked={editing} onChange={(e) => onEditing(e.target.checked)} />
            Edit geometry · drag vertex handles
          </label>
          {editing && <GeometryEditorControls geometry={feature.geometry} onChange={onGeometry} />}
          <label className="mm-field">
            Feature properties (JSON)
            <textarea rows={7} value={properties} onChange={(e) => setProperties(e.target.value)} />
          </label>
          {error && (
            <p className="mm-error" role="alert">
              {error}
            </p>
          )}
          <div className="mm-button-row">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                try {
                  const value = JSON.parse(properties)
                  if (!value || typeof value !== 'object' || Array.isArray(value))
                    throw new Error('Properties must be a JSON object.')
                  onProperties(value)
                  setError('')
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Invalid properties')
                }
              }}
            >
              <Pencil size={14} />
              Save properties
            </Button>
            <Button size="sm" variant="outline" onClick={onDelete}>
              <Trash2 size={14} />
              Delete feature
            </Button>
          </div>
        </>
      )}
    </SidebarSection>
  )
}

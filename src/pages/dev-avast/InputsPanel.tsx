import { NativeSelect } from '@/components/ui/form-field'
import { useState, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FileDropField } from '@/components/ui/file-drop-field'
import { InlineAlert, SidebarSection } from '@/components/ui/map-panels'
import type { SourceFile } from './gdal'
import type { InputEntry, InputRole } from './useAvastInputs'

export const FIELD_CLASS =
  'mt-1 w-full min-w-0 rounded-md border border-border bg-background px-2 py-1.5 text-sm touch:py-2'
const LABEL_CLASS = 'block min-w-0 text-xs font-medium text-muted-foreground'

const ROLE_COPY: Record<InputRole, { title: string; hint: string; folder: string }> = {
  candidates: {
    title: 'Candidate blocks',
    hint: 'Proposed blocks or planning blobs: a shapefile (all its parts), zipped shapefile, GeoPackage, GeoJSON, KML or a .gdb folder. Add several to assess them together.',
    folder: 'Add folder',
  },
  avast: {
    title: 'AVAST TimberAnalysis_Base',
    hint: 'The AVAST File Geodatabase folder (e.g. PG_Avast_June30_2026.gdb). Add the TSA geodatabases your blocks fall in; where two overlap, the one listed first wins.',
    folder: 'Add .gdb folder',
  },
  lidar: {
    title: 'LiDAR volume (optional)',
    hint: 'A polygon layer with LiDAR-supported volume in m³/ha. Blocks it covers use LiDAR directly; it can also derive the LiDAR adjustment factor (Part 2).',
    folder: 'Add .gdb folder',
  },
}

const ACCEPT = '.shp,.shx,.dbf,.prj,.cpg,.zip,.geojson,.json,.gpkg,.kml,.fgb'

function FieldSelect({
  label,
  value,
  fields,
  onChange,
  optional,
  required,
}: {
  label: string
  value: string | null
  fields: string[]
  onChange: (value: string | null) => void
  optional?: string
  required?: boolean
}) {
  return (
    <label className={LABEL_CLASS}>
      {label}
      {required && <span className="text-red-600"> *</span>}
      <NativeSelect
        className={FIELD_CLASS}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value || null)}
      >
        {!required && <option value="">{optional ?? '— none —'}</option>}
        {required && !value && <option value="">Choose a field…</option>}
        {fields.map((field) => (
          <option key={field} value={field}>
            {field}
          </option>
        ))}
      </NativeSelect>
    </label>
  )
}

function EntryCard({
  entry,
  onRemove,
  onLayer,
  onUpdate,
}: {
  entry: InputEntry
  onRemove: () => void
  onLayer: (layer: string) => void
  onUpdate: (patch: Partial<InputEntry>) => void
}) {
  const layer = entry.layers.find((item) => item.name === entry.layer)
  const fields = layer?.fields.map((field) => field.name) ?? []
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3" data-avast-input={entry.role}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium" title={entry.dataset.relativePath}>
            {entry.dataset.label}
          </p>
          <p className="text-xs text-muted-foreground">
            {entry.dataset.kind === 'gdb'
              ? `File Geodatabase${entry.dataset.innerPath ? ` in ${entry.dataset.relativePath.split('/').pop()}` : ''}`
              : entry.dataset.kind === 'shapefile'
                ? 'Shapefile'
                : entry.dataset.kind === 'zip'
                  ? 'Zip'
                  : 'File'}
            {layer && ` · ${layer.featureCount.toLocaleString('en-CA')} features`}
            {layer?.crs && ` · ${layer.crs}`}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          aria-label={`Remove ${entry.dataset.label}`}
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      {entry.status === 'reading' && (
        <InlineAlert loading className="mt-2">
          Reading layers…
        </InlineAlert>
      )}
      {entry.status === 'error' && (
        <InlineAlert tone="error" className="mt-2">
          {entry.error}
        </InlineAlert>
      )}
      {entry.status === 'ready' && (
        <div className="mt-2 grid grid-cols-1 gap-2">
          {entry.layers.length > 1 && (
            <label className={LABEL_CLASS}>
              Layer
              <NativeSelect
                className={FIELD_CLASS}
                value={entry.layer}
                onChange={(event) => onLayer(event.target.value)}
              >
                {entry.layers.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name} ({item.featureCount.toLocaleString('en-CA')})
                  </option>
                ))}
              </NativeSelect>
            </label>
          )}
          {layer && !layer.epsg && (
            <InlineAlert tone="warning">
              No coordinate system found; the layer is read as BC Albers (EPSG:3005).
            </InlineAlert>
          )}
          {entry.role === 'candidates' ? (
            <div className="grid grid-cols-2 gap-2">
              <FieldSelect
                label="Block ID"
                required
                value={entry.candidateFields.idField || null}
                fields={fields}
                onChange={(value) => onUpdate({ candidateFields: { ...entry.candidateFields, idField: value ?? '' } })}
              />
              <FieldSelect
                label="Operating area"
                value={entry.candidateFields.operatingAreaField}
                fields={fields}
                optional="From AVAST"
                onChange={(value) =>
                  onUpdate({ candidateFields: { ...entry.candidateFields, operatingAreaField: value } })
                }
              />
              <FieldSelect
                label="Merch / gross area (ha)"
                value={entry.candidateFields.areaField}
                fields={fields}
                optional="Polygon area"
                onChange={(value) => onUpdate({ candidateFields: { ...entry.candidateFields, areaField: value } })}
              />
              <FieldSelect
                label="Source type"
                value={entry.candidateFields.sourceTypeField}
                fields={fields}
                optional="Use the setting"
                onChange={(value) =>
                  onUpdate({ candidateFields: { ...entry.candidateFields, sourceTypeField: value } })
                }
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <FieldSelect
                label="Volume density (m³/ha)"
                required
                value={entry.densityFields.densityField || null}
                fields={fields}
                onChange={(value) => onUpdate({ densityFields: { ...entry.densityFields, densityField: value ?? '' } })}
              />
              {entry.role === 'avast' && (
                <>
                  <FieldSelect
                    label="Average slope (%)"
                    value={entry.densityFields.slopeField}
                    fields={fields}
                    onChange={(value) => onUpdate({ densityFields: { ...entry.densityFields, slopeField: value } })}
                  />
                  <FieldSelect
                    label="Operating area"
                    value={entry.densityFields.operatingAreaField}
                    fields={fields}
                    onChange={(value) =>
                      onUpdate({ densityFields: { ...entry.densityFields, operatingAreaField: value } })
                    }
                  />
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function RoleSection({
  role,
  entries,
  onAdd,
  onRemove,
  onLayer,
  onUpdate,
  footer,
}: {
  role: InputRole
  entries: InputEntry[]
  onAdd: (role: InputRole, files: SourceFile[]) => Promise<number>
  onRemove: (id: string) => void
  onLayer: (id: string, layer: string) => void
  onUpdate: (id: string, patch: Partial<InputEntry>) => void
  footer?: ReactNode
}) {
  const [notice, setNotice] = useState<string | null>(null)
  const copy = ROLE_COPY[role]
  const add = async (files: SourceFile[]) => {
    setNotice(null)
    const count = await onAdd(role, files)
    if (!count)
      setNotice(
        'Nothing readable there. Pick every part of a shapefile (.shp, .dbf, .shx, .prj), a zip, or a .gdb folder.',
      )
  }
  return (
    <SidebarSection title={copy.title} className="space-y-3">
      <p className="text-xs leading-5 text-muted-foreground">{copy.hint}</p>
      <FileDropField
        label={copy.title}
        accept={ACCEPT}
        folderLabel={copy.folder}
        onFiles={add}
        dropProps={{ 'data-avast-drop': role }}
        inputProps={{ 'data-avast-files': role }}
        folderInputProps={{ 'data-avast-folder': role }}
      />
      {notice && <InlineAlert tone="warning">{notice}</InlineAlert>}
      {entries.map((entry) => (
        <EntryCard
          key={entry.dataset.id}
          entry={entry}
          onRemove={() => onRemove(entry.dataset.id)}
          onLayer={(layer) => onLayer(entry.dataset.id, layer)}
          onUpdate={(patch) => onUpdate(entry.dataset.id, patch)}
        />
      ))}
      {footer}
    </SidebarSection>
  )
}

export function InputsPanel({
  entries,
  onAdd,
  onRemove,
  onLayer,
  onUpdate,
  candidateSummary,
}: {
  entries: InputEntry[]
  onAdd: (role: InputRole, files: SourceFile[]) => Promise<number>
  onRemove: (id: string) => void
  onLayer: (id: string, layer: string) => void
  onUpdate: (id: string, patch: Partial<InputEntry>) => void
  candidateSummary: ReactNode
}) {
  const props = { onAdd, onRemove, onLayer, onUpdate }
  return (
    <>
      <RoleSection
        role="candidates"
        entries={entries.filter((entry) => entry.role === 'candidates')}
        footer={candidateSummary}
        {...props}
      />
      <RoleSection role="avast" entries={entries.filter((entry) => entry.role === 'avast')} {...props} />
      <RoleSection role="lidar" entries={entries.filter((entry) => entry.role === 'lidar')} {...props} />
      <p className="px-4 pb-4 text-xs leading-5 text-muted-foreground">
        Everything stays in this browser: files are read in place, never uploaded.
      </p>
    </>
  )
}

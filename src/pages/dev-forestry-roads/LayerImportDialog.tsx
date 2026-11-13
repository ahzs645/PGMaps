import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { PanelDialog } from '@/components/ui/dialog-shell'
import { InlineAlert } from '@/components/ui/map-panels'
import { StyledSelect } from '@/components/ui/styled-select'
import { CutblockBufferField } from './CutblockBufferField'
import type { CutblockBuffer } from './cutblockBuffers'
import {
  LAYER_IMPORT_LABELS,
  layerImportOptions,
  suggestedLayerRole,
  type LayerImportChoice,
  type LayerImportRole,
} from './referenceImport'
import type { SpatialFile } from './spatialImport'

const roleHelp: Record<LayerImportRole, string> = {
  reference: 'Shows this layer on the plan.',
  'proposed-road': 'Keeps the proposed lines together; the option above also loads their road profiles.',
  'planned-block': 'Adds the polygons to Planned cutblocks for access planning.',
  terrain:
    'Replaces the project terrain with a surface built from the sheet’s labelled contours. You will be asked for the vertical datum.',
}

export function LayerImportDialog({
  files,
  buffers,
  portalContainer,
  onCancel,
  onImport,
}: {
  files: readonly SpatialFile[]
  buffers?: readonly CutblockBuffer[]
  portalContainer: HTMLElement | null
  onCancel: () => void
  onImport: (choices: LayerImportChoice[], options: { prepareDem: boolean; loadRoads: boolean }) => void
}) {
  const [choices, setChoices] = useState<LayerImportChoice[]>(() =>
    files.map((file) => {
      const buffer = layerImportOptions(file).includes('planned-block')
        ? buffers?.find(({ layer }) => layer === file.fileName)
        : undefined
      return { file, role: buffer ? 'planned-block' : suggestedLayerRole(file), buffer }
    }),
  )
  const [error, setError] = useState('')
  const [included, setIncluded] = useState(() => files.map((file) => file.selected ?? file.pdf?.selected ?? true))
  const [prepareDem, setPrepareDem] = useState(true)
  const [loadRoads, setLoadRoads] = useState(true)
  const commit = () => {
    try {
      const selected = choices.filter((_, i) => included[i])
      if (!selected.length) throw Error('Choose at least one layer to import.')
      if (selected.filter((choice) => choice.role === 'terrain').length > 1)
        throw Error('Choose one terrain: a project has a single terrain surface.')
      onImport(selected, { prepareDem, loadRoads })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not import the layers.')
    }
  }
  return (
    <PanelDialog
      title="Import layers"
      subtitle="Choose the layers to include and how to use them."
      size="md"
      portalContainer={portalContainer}
      onClose={onCancel}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={commit}>
            Import layers
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {files.some((file) => file.pdf || file.notices?.length) && (
          <div className="space-y-2 text-xs">
            {files.some((file) => file.pdf) && (
              <>
                <p>
                  Recognized: {files.find((file) => file.pdf)!.pdf!.source.profile}. PDF reading runs on this computer.
                </p>
                <p>
                  Map sheets are image references. Recovered drawings keep their source page and layer. Check a drawing
                  before choosing it as a design input. Class layers provide point queries and block summaries; JPEG
                  matches remain uncertain estimates. Use original GIS layers when supplied.
                </p>
              </>
            )}
            <details>
              <summary>Source import notes</summary>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                {[...new Set(files.flatMap((file) => file.notices ?? []))].map((note) => (
                  <li key={note} className="break-words">
                    {note}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={loadRoads} onChange={(e) => setLoadRoads(e.target.checked)} />
          Load proposed roads into the road switcher and profile
        </label>
        <p className="text-xs text-muted-foreground">
          Reference layers start hidden. Planned blocks and loaded roads are shown.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={prepareDem} onChange={(e) => setPrepareDem(e.target.checked)} />
          Prepare 1 m DEM download boxes after import
        </label>
        {error && <InlineAlert tone="error">{error}</InlineAlert>}
        {choices.map(({ file, role, buffer }, index) => (
          <div
            key={file.fileName}
            className="grid gap-2 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_11rem] sm:items-start"
          >
            <div className="min-w-0">
              <label className="flex items-start gap-2 break-words text-sm font-medium">
                <input
                  type="checkbox"
                  aria-label={`Include ${file.fileName}`}
                  checked={included[index]}
                  onChange={(event) => {
                    setIncluded((previous) => previous.map((value, i) => (i === index ? event.target.checked : value)))
                    setError('')
                  }}
                />
                {file.fileName}
              </label>
              <p className="text-xs text-muted-foreground">
                {file.collection.features.length} {file.collection.features.length === 1 ? 'feature' : 'features'} ·{' '}
                {file.crs}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{roleHelp[role]}</p>
              {file.pdf && <p className="mt-1 text-xs text-muted-foreground">{file.pdf.note}</p>}
            </div>
            <StyledSelect
              value={role}
              aria-label={`Import role for ${file.fileName}`}
              disabled={!included[index] || layerImportOptions(file).length === 1}
              onChange={(event) => {
                const role = event.target.value as LayerImportRole
                setChoices((previous) =>
                  previous.map((choice, i) => {
                    if (i === index) return { file, role, buffer: role === 'planned-block' ? choice.buffer : undefined }
                    if (
                      role !== 'reference' &&
                      choice.buffer &&
                      'source' in choice.buffer &&
                      choice.buffer.source === file.fileName
                    )
                      return { ...choice, buffer: undefined }
                    return choice
                  }),
                )
                setError('')
              }}
            >
              {layerImportOptions(file).map((option) => (
                <option key={option} value={option}>
                  {LAYER_IMPORT_LABELS[option]}
                </option>
              ))}
            </StyledSelect>
            {role === 'planned-block' && (
              <div className="sm:col-start-2">
                <CutblockBufferField
                  layer={file.fileName}
                  setting={buffer}
                  sources={choices.flatMap((choice) =>
                    choice.file !== file &&
                    choice.role === 'reference' &&
                    layerImportOptions(choice.file).includes('planned-block') &&
                    !choices.some(
                      ({ buffer: other }) =>
                        other &&
                        'source' in other &&
                        other.source === choice.file.fileName &&
                        other.layer !== file.fileName,
                    )
                      ? [{ key: choice.file.fileName, name: choice.file.fileName.split('/').at(-1)! }]
                      : [],
                  )}
                  onChange={(buffer) =>
                    setChoices((previous) =>
                      previous.map((choice, i) => (i === index ? { ...choice, buffer } : choice)),
                    )
                  }
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </PanelDialog>
  )
}

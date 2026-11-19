import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { PanelDialog } from '@/components/ui/dialog-shell'
import { InlineAlert } from '@/components/ui/map-panels'
import { StyledSelect } from '@/components/ui/styled-select'
import { CutblockBufferField } from './CutblockBufferField'
import type { CutblockBuffer } from './cutblockBuffers'
import {
  groupNotes,
  LAYER_IMPORT_LABELS,
  layerImportOptions,
  linePartCount,
  suggestedLayerRole,
  type LayerImportChoice,
  type LayerImportRole,
} from './referenceImport'
import type { SpatialFile } from './spatialImport'

/** What each import option does, as {@link LayerImportDialog} passes it on. */
export interface LayerImportOptions {
  prepareDem: boolean
  loadRoads: boolean
  /** Widen a contour terrain to the roads and blocks, taking the ground past the contours from the regional DEM. */
  fillBeyondContours: boolean
  /** Read the ground between a contour terrain's contours from the hillshade sheet in the same import. */
  refineWithHillshade: boolean
  /**
   * The datum a contour terrain takes without asking, as the terrain records it: the company profile's
   * assumption, when the person keeps it. Absent, the datum is asked.
   */
  verticalReference?: string
}

/** How an assumed datum is recorded on the terrain: the choice, and that the sheet did not print it. */
export const assumedDatumReference = (reference: string) => `${reference}; assumed, the sheet prints no datum`

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
  onImport: (choices: LayerImportChoice[], options: LayerImportOptions) => void
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
  // A terrain chosen here is the import's ground: the 1 m DEM boxes start off unless asked for.
  const terrainIncluded = choices.some((choice, i) => included[i] && choice.role === 'terrain')
  const [prepareDemChoice, setPrepareDem] = useState<boolean | null>(null)
  const prepareDem = prepareDemChoice ?? !terrainIncluded
  const [loadRoads, setLoadRoads] = useState(true)
  const [fillBeyondContours, setFillBeyondContours] = useState(true)
  // Off unless asked for: it is an estimate between contours, and takes about a minute.
  const [refineWithHillshade, setRefineWithHillshade] = useState(false)
  const hillshade = files.find((file) => file.pdf?.imageMosaic?.kind === 'hillshade')
  // Sheets whose contours can become the terrain: offered first, with the choices that go with them.
  const contourRows = files.flatMap((file, index) => (file.pdf?.contourSurface ? [{ file, index }] : []))
  const contourTerrainOn = contourRows.some(({ index }) => included[index])
  // The included sheet's assumed datum, used unless the person unticks it.
  const assumed = contourRows.find(({ index }) => included[index])?.file.pdf?.assumedVerticalDatum
  const [useAssumedDatum, setUseAssumedDatum] = useState(true)
  const include = (index: number, on: boolean) => {
    setIncluded((previous) => previous.map((value, i) => (i === index ? on : value)))
    setError('')
  }
  const commit = () => {
    try {
      const selected = choices.filter((_, i) => included[i])
      if (!selected.length) throw Error('Choose at least one layer to import.')
      if (selected.filter((choice) => choice.role === 'terrain').length > 1)
        throw Error('Choose one terrain: a project has a single terrain surface.')
      onImport(selected, {
        prepareDem,
        loadRoads,
        fillBeyondContours,
        refineWithHillshade: refineWithHillshade && !!hillshade,
        ...(assumed && useAssumedDatum ? { verticalReference: assumedDatumReference(assumed.reference) } : {}),
      })
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
                {groupNotes(files.flatMap((file) => file.notices ?? [])).map((note) => (
                  <li key={note} className="break-words">
                    {note}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        )}
        {contourRows.length > 0 && (
          <fieldset
            className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3"
            data-testid="import-elevation"
          >
            <legend className="px-1 text-sm font-semibold">Elevation found</legend>
            <p className="text-xs text-muted-foreground">
              {contourRows.length === 1 ? 'This sheet has' : 'These sheets have'} labelled contours that can become the
              project terrain{hillshade ? ', and a hillshade that can add the ground between them' : ''}.
            </p>
            {contourRows.map(({ file, index }) => (
              <div key={file.fileName}>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={included[index]}
                    onChange={(event) => include(index, event.target.checked)}
                  />
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    Use the contours of {file.pdf!.source.file.split('/').at(-1)} as the terrain (replaces the current
                    terrain)
                  </span>
                </label>
                <p className="ml-6 text-xs text-muted-foreground">{file.pdf!.note}</p>
              </div>
            ))}
            {contourTerrainOn &&
              (assumed ? (
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={useAssumedDatum}
                    onChange={(event) => setUseAssumedDatum(event.target.checked)}
                  />
                  <span className="min-w-0">
                    Heights in metres, vertical datum {assumed.reference.replace(/; metres$/, '')} (assumed)
                    <span className="block text-xs text-muted-foreground">
                      {assumed.basis} Untick to choose the datum yourself.
                    </span>
                  </span>
                </label>
              ) : (
                <p className="text-xs text-muted-foreground">You will be asked for the vertical datum.</p>
              ))}
            {contourTerrainOn && hillshade && (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={refineWithHillshade}
                  onChange={(event) => setRefineWithHillshade(event.target.checked)}
                />
                <span className="min-w-0">
                  Read the ground between the contours from the hillshade in{' '}
                  <span className="[overflow-wrap:anywhere]">{hillshade.pdf!.source.file.split('/').at(-1)}</span>
                  <span className="block text-xs text-muted-foreground">
                    The contours keep the heights; the hillshade adds the gullies and benches between them, within one
                    contour interval. An estimate, not a survey; takes about a minute.
                  </span>
                </span>
              </label>
            )}
            {contourTerrainOn && (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={fillBeyondContours}
                  onChange={(event) => setFillBeyondContours(event.target.checked)}
                />
                <span className="min-w-0">
                  Fill past the contours from the regional DEM
                  <span className="block text-xs text-muted-foreground">
                    About 22 m, so roads and blocks off the sheet have ground. The two are not shifted to meet.
                  </span>
                </span>
              </label>
            )}
          </fieldset>
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
                  onChange={(event) => include(index, event.target.checked)}
                />
                {/* A path has no spaces to break at: let it wrap anywhere rather than run under the select. */}
                <span className="min-w-0 [overflow-wrap:anywhere]">{file.fileName}</span>
              </label>
              <p className="text-xs text-muted-foreground">
                {file.collection.features.length} {file.collection.features.length === 1 ? 'feature' : 'features'} ·{' '}
                {file.crs}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {role === 'proposed-road' && linePartCount(file) > 1
                  ? `${linePartCount(file)} separate lines: each loads as its own road, named “(part n)”.`
                  : roleHelp[role]}
              </p>
              {file.pdf?.contourSurface && (
                <p className="mt-1 text-xs text-muted-foreground">Its options are under Elevation found, above.</p>
              )}
              {file.pdf && !file.pdf.contourSurface && (
                <p className="mt-1 text-xs text-muted-foreground">{file.pdf.note}</p>
              )}
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

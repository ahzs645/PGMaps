import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { DisclosureCard, DisclosureRow } from '@/components/ui/disclosure'
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
  UNREADABLE_LAYER_NOTE,
  type LayerImportChoice,
  type LayerImportRole,
} from './referenceImport'
import type { SpatialFile } from './spatialImport'
import {
  applyImportMapping,
  guessImportMapping,
  mappingKey,
  sameMapping,
  savableMapping,
  type ImportMapping,
  type MappingRole,
} from './importMapping'
import { forgetSavedMapping, readSavedMappings, rememberImportMappings } from './importMappingStore'
import { ImportMappingFields, type MappingOrigin } from './ImportMappingFields'
import { GENERIC_PROFILE_LABEL } from '@/lib/geoPdf/profiles'

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
  // How each GIS layer's fields map to what the project keeps: a mapping saved in this browser for
  // files of the same fields, else the guess from the field names. Changeable before importing.
  const [mappings, setMappings] = useState<Record<string, MappingState>>(() =>
    Object.fromEntries(
      choices.flatMap(({ file, role }) => (file.pdf ? [] : [[file.fileName, startMapping(file, mappingRole(role))]])),
    ),
  )
  const setMapping = (fileName: string, next: MappingState) =>
    setMappings((previous) => ({ ...previous, [fileName]: next }))
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
  const notices = files.flatMap((file) => file.notices ?? [])
  const unreadable = [...new Set(notices.filter((note) => note.startsWith(UNREADABLE_LAYER_NOTE)))]
  const notes = groupNotes(notices.filter((note) => !note.startsWith(UNREADABLE_LAYER_NOTE)))
  const includeMany = (indices: readonly number[], on: boolean) => {
    const chosen = new Set(indices)
    setIncluded((previous) => previous.map((value, i) => (chosen.has(i) ? on : value)))
    setError('')
  }
  // GIS layers one row each; a map PDF's layers under their sheet, folded when there are many sheets.
  const gisRows = files.flatMap((file, index) => (file.pdf ? [] : [index]))
  const sheetGroups = sheetsOf(files)
  const commit = () => {
    try {
      const remembered: { key: string; fileName: string; mapping: ImportMapping; guess: ImportMapping }[] = []
      const selected = choices
        .filter((_, i) => included[i])
        .map((choice) => {
          const state = mappings[choice.file.fileName]
          if (!state || choice.role === 'terrain') return choice
          const role = mappingRole(choice.role)
          remembered.push({
            key: mappingKey(choice.file, role),
            fileName: choice.file.fileName.split('/').at(-1)!,
            mapping: state.mapping,
            guess: guessImportMapping(choice.file, role),
          })
          const file = applyImportMapping(choice.file, state.mapping, role)
          if (!file.collection.features.length)
            throw Error(`${choice.file.fileName}: no rows are left to import. Choose rows under Fields.`)
          return { ...choice, file }
        })
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
      rememberImportMappings(remembered)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not import the layers.')
    }
  }
  const renderRow = (index: number, label = choices[index].file.fileName) => {
    const { file, role, buffer } = choices[index]
    return (
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
            <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
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
            const state = mappings[file.fileName]
            if (state && role !== 'terrain') setMapping(file.fileName, remapForRole(file, state, mappingRole(role)))
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
                setChoices((previous) => previous.map((choice, i) => (i === index ? { ...choice, buffer } : choice)))
              }
            />
          </div>
        )}
        {mappings[file.fileName] && role !== 'terrain' && (
          <div className="sm:col-span-2">
            <ImportMappingFields
              file={file}
              role={mappingRole(role)}
              mapping={mappings[file.fileName].mapping}
              origin={mappings[file.fileName].origin}
              disabled={!included[index]}
              onChange={(mapping) => {
                const state = mappings[file.fileName]
                const guess = guessImportMapping(file, mappingRole(role))
                // Only what a saved mapping carries decides its origin: the rows kept are this file's own.
                const own = savableMapping(mapping)
                setMapping(file.fileName, {
                  mapping,
                  origin:
                    state.origin.kind === 'saved' && sameMapping(own, savableMapping(state.saved ?? guess))
                      ? state.origin
                      : sameMapping(own, savableMapping(guess))
                        ? { kind: 'guess' }
                        : { kind: 'edited' },
                  saved: state.saved,
                })
              }}
              onReset={() =>
                setMapping(file.fileName, {
                  mapping: guessImportMapping(file, mappingRole(role)),
                  origin: { kind: 'guess' },
                })
              }
              onForget={() => {
                forgetSavedMapping(mappingKey(file, mappingRole(role)))
                setMapping(file.fileName, {
                  mapping: guessImportMapping(file, mappingRole(role)),
                  origin: { kind: 'guess' },
                })
              }}
            />
          </div>
        )}
      </div>
    )
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
        {unreadable.length > 0 && (
          <InlineAlert tone="warning">
            <p>
              {unreadable.length} {unreadable.length === 1 ? 'file was' : 'files were'} skipped. You can still import
              the layers below.
            </p>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {unreadable.map((note) => (
                <li key={note} className="break-words">
                  {note}
                </li>
              ))}
            </ul>
          </InlineAlert>
        )}
        {files.some((file) => file.pdf) && (
          <div className="space-y-2 text-xs">
            {files.some((file) => file.pdf) && (
              <>
                <p>
                  Recognized:{' '}
                  {[...new Set(files.flatMap((file) => (file.pdf ? [file.pdf.source.profile] : [])))].join('; ')}. PDF
                  reading runs on this computer.
                </p>
                {files.some((file) => file.pdf?.source.profile === GENERIC_PROFILE_LABEL) && (
                  <p>
                    A sheet no company profile recognizes brings in its registered image and its named layers only, all
                    unticked: no class layers, contour terrain or image layers.
                  </p>
                )}
                <p>
                  Map sheets are image references. Recovered drawings keep their source page and layer. Check a drawing
                  before choosing it as a design input. Class layers provide point queries and block summaries; JPEG
                  matches remain uncertain estimates. Use original GIS layers when supplied.
                </p>
              </>
            )}
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
        {gisRows.map((index) => renderRow(index))}
        {sheetGroups.length > 1 && (
          <SameLayerToggles files={files} groups={sheetGroups} included={included} onInclude={includeMany} />
        )}
        {sheetGroups.map((group) => {
          const ticked = group.rows.filter((index) => included[index]).length
          return (
            <DisclosureCard
              key={group.sheet}
              title={group.name}
              summary={`${ticked} of ${group.rows.length} layer${group.rows.length === 1 ? '' : 's'} ticked`}
              defaultOpen={sheetGroups.length <= SHEETS_SHOWN_OPEN}
              actions={
                <Button variant="ghost" size="sm" onClick={() => includeMany(group.rows, ticked < group.rows.length)}>
                  {ticked < group.rows.length ? 'Tick all' : 'Untick all'}
                </Button>
              }
            >
              <div className="space-y-2">
                {group.rows.map((index) => renderRow(index, layerLabel(choices[index].file)))}
              </div>
            </DisclosureCard>
          )
        })}
        {notes.length > 0 && (
          <DisclosureRow title="Source import notes" summary={`${notes.length} note${notes.length === 1 ? '' : 's'}`}>
            <ul className="list-disc space-y-1 pl-4">
              {notes.map((note) => (
                <li key={note} className="break-words">
                  {note}
                </li>
              ))}
            </ul>
          </DisclosureRow>
        )}
      </div>
    </PanelDialog>
  )
}

/** Up to this many sheets open with their layers shown; more (an overview set) start folded. */
const SHEETS_SHOWN_OPEN = 3

/** The layer's own name under its sheet: "Lake (FWA)" rather than "sheet.pdf/Page 1/Lake (FWA)". */
const layerLabel = (file: SpatialFile) => file.fileName.split('/').at(-1) ?? file.fileName

/** A map PDF's layers, by sheet, in the order the import read them. */
function sheetsOf(files: readonly SpatialFile[]) {
  const groups = new Map<string, { sheet: string; name: string; rows: number[] }>()
  files.forEach((file, index) => {
    if (!file.pdf) return
    const sheet = file.pdf.source.file
    const group = groups.get(sheet) ?? { sheet, name: sheet.split('/').at(-1) ?? sheet, rows: [] }
    group.rows.push(index)
    groups.set(sheet, group)
  })
  return [...groups.values()]
}

/**
 * One switch per layer that several sheets carry (the same legend on every overview sheet), so
 * "Lake (FWA)" is ticked or unticked on all of them at once. Each sheet's rows stay below.
 */
function SameLayerToggles({
  files,
  groups,
  included,
  onInclude,
}: {
  files: readonly SpatialFile[]
  groups: ReturnType<typeof sheetsOf>
  included: readonly boolean[]
  onInclude: (indices: readonly number[], on: boolean) => void
}) {
  const byLayer = new Map<string, number[]>()
  for (const group of groups)
    for (const index of group.rows) {
      const name = layerLabel(files[index])
      byLayer.set(name, [...(byLayer.get(name) ?? []), index])
    }
  const shared = [...byLayer].filter(([, rows]) => rows.length > 1)
  if (!shared.length) return null
  return (
    <DisclosureCard
      title="Layers on several sheets"
      summary={`${shared.length} layers · tick or untick each on every sheet at once`}
      defaultOpen
    >
      <div className="grid gap-1 sm:grid-cols-2" data-testid="import-shared-layers">
        {shared.map(([name, rows]) => {
          const ticked = rows.filter((index) => included[index]).length
          return (
            <label key={name} className="flex min-w-0 items-center gap-2 text-sm">
              <input
                type="checkbox"
                aria-label={`${name} on every sheet`}
                checked={ticked === rows.length}
                ref={(input) => {
                  if (input) input.indeterminate = ticked > 0 && ticked < rows.length
                }}
                onChange={(event) => onInclude(rows, event.target.checked)}
              />
              <span className="min-w-0 truncate">{name}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                {ticked ? `${ticked} of ${rows.length}` : `${rows.length} sheets`}
              </span>
            </label>
          )
        })}
      </div>
    </DisclosureCard>
  )
}

/** A GIS layer's mapping as the dialog holds it: what is shown, where it came from, and the saved one it started from. */
interface MappingState {
  mapping: ImportMapping
  origin: MappingOrigin
  saved?: ImportMapping
}

/** The mapping roles: a terrain is a PDF's contours and has no fields to map. */
const mappingRole = (role: LayerImportRole): MappingRole => (role === 'terrain' ? 'reference' : role)

/** A layer's first mapping: one saved in this browser for files of the same fields, else the guess. */
function startMapping(file: SpatialFile, role: MappingRole): MappingState {
  const key = mappingKey(file, role)
  const saved = readSavedMappings().find((item) => item.key === key)
  return saved
    ? { mapping: saved.mapping, origin: { kind: 'saved', savedAt: saved.savedAt }, saved: saved.mapping }
    : { mapping: guessImportMapping(file, role), origin: { kind: 'guess' } }
}

/**
 * The mapping after the layer's role changes: the person's own choices of name and rows are kept,
 * and the targets the new role adds or drops (a block's status, year and opening) follow its guess.
 */
function remapForRole(file: SpatialFile, state: MappingState, role: MappingRole): MappingState {
  if (state.origin.kind !== 'edited') return startMapping(file, role)
  const guess = guessImportMapping(file, role)
  const own: ImportMapping = {
    nameFields: state.mapping.nameFields,
    groupField: state.mapping.groupField,
    ...(state.mapping.keep ? { keep: state.mapping.keep } : {}),
  }
  return {
    mapping: {
      ...own,
      ...(guess.status ? { status: guess.status } : {}),
      ...(guess.yearField ? { yearField: guess.yearField } : {}),
      ...(guess.openingIdField ? { openingIdField: guess.openingIdField } : {}),
    },
    origin: { kind: 'edited' },
  }
}

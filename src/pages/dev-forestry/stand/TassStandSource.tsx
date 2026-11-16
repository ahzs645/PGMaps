/**
 * Trial: the stand prescription dialog's *TASS plot* source. Reads a TASS III stem table (`.tdt`,
 * with its `.tcl` when given), shows what it holds, and places the plot over the block as the
 * reviewer chooses (`tassStandImport.ts`). The trees go through the same `onImportTrees` as an
 * imported tree list. Remove this file, `tassStandImport.ts` and the dialog's `tass` mode to drop
 * the trial.
 */

import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { FileDropField } from '@/components/ui/file-drop-field'
import { NumberField, SelectField } from '@/components/ui/form-field'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert } from '@/components/ui/map-panels'
import type { PickedFile } from '@/components/ui/picked-files'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { DEFAULT_LOCALE } from '@/lib/format'

import type { PolygonGeometry } from '../visibility'
import {
  TASS_AXES_LABELS,
  isTassColumnFile,
  placeTassPlot,
  readTassStemTable,
  tassConditionCounts,
  tassLiveSummary,
  tassPlacementLabel,
  type TassAxes,
  type TassStemTable,
} from './tassStandImport'
import type { ImportedTree, ImportedTreeSource } from './treeListImport'

const whole = new Intl.NumberFormat(DEFAULT_LOCALE, { maximumFractionDigits: 0 })
const oneDecimal = new Intl.NumberFormat(DEFAULT_LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const percent = new Intl.NumberFormat(DEFAULT_LOCALE, { style: 'percent', maximumFractionDigits: 0 })

type Repeat = 'repeat' | 'once'
const REPEAT_OPTIONS = [
  { value: 'repeat' as const, label: 'Repeat across the block' },
  { value: 'once' as const, label: 'One plot at the centre' },
]
const AXES_OPTIONS = (Object.keys(TASS_AXES_LABELS) as TassAxes[]).map((value) => ({
  value,
  label: TASS_AXES_LABELS[value],
}))

/** The `.tdt` and, when picked with it, the `.tcl`; one of each at most. */
async function readPicked(files: PickedFile[]): Promise<TassStemTable> {
  const texts = await Promise.all(files.map(async ({ file }) => ({ name: file.name, text: await file.text() })))
  const schemas = texts.filter((entry) => isTassColumnFile(entry.text))
  const tables = texts.filter((entry) => !isTassColumnFile(entry.text))
  if (tables.length !== 1) throw new Error('Choose one TASS stem table (.tdt), with its .tcl if you have it.')
  if (schemas.length > 1) throw new Error('Choose one column file (.tcl) at most.')
  return readTassStemTable({ ...tables[0], schema: schemas[0] ?? null })
}

export function TassStandSource({
  geometry,
  onImportTrees,
}: {
  geometry: PolygonGeometry | null
  onImportTrees: (trees: ImportedTree[], source: ImportedTreeSource) => void
}) {
  const [table, setTable] = useState<TassStemTable | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [axes, setAxes] = useState<TassAxes | null>(null)
  const [bearing, setBearing] = useState(0)
  const [repeat, setRepeat] = useState<Repeat>('repeat')

  const onFiles = async (files: PickedFile[]) => {
    setReadError(null)
    try {
      setTable(await readPicked(files))
    } catch (error) {
      setTable(null)
      setReadError(error instanceof Error ? error.message : String(error))
    }
  }

  const counts = useMemo(() => (table ? tassConditionCounts(table) : null), [table])
  const live = useMemo(() => (table ? tassLiveSummary(table) : null), [table])
  const placement = axes ? { axes, bearingDegrees: bearing, repeat: repeat === 'repeat' } : null
  const placed = useMemo(() => {
    if (!table || !geometry || !placement) return null
    try {
      return { result: placeTassPlot(table, geometry, placement), error: null }
    } catch (error) {
      return { result: null, error: error instanceof Error ? error.message : String(error) }
    }
    // `placement` is rebuilt each render from these three.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, geometry, axes, bearing, repeat])

  return (
    <div className="space-y-3" data-testid="tass-stand-source">
      <InlineAlert tone="info" title="Trial">
        Model output, not a measured stand. The plot is drawn in place of the block&rsquo;s stems for display only; the
        run&rsquo;s sightlines still use the regional canopy.
      </InlineAlert>
      <FileDropField
        label="TASS stem table"
        filesLabel="Choose a .tdt (and its .tcl)"
        accept=".tdt,.tcl,.txt"
        multiple
        onFiles={onFiles}
        onError={(error) => setReadError(error instanceof Error ? error.message : String(error))}
      />
      <p className="text-2xs text-muted-foreground">
        PLOTSY&rsquo;s stem table from TASS III (AppType Tass_Stems). Add the export&rsquo;s .tcl so its columns are
        read by name; without it only TASS 4.3.1.2&rsquo;s layout is read.
      </p>
      {readError && <InlineAlert tone="error">{readError}</InlineAlert>}
      {table && counts && live && (
        <>
          <div className="space-y-0.5 text-2xs text-muted-foreground" data-testid="tass-summary">
            <p>
              {table.name}
              {table.plotMeters &&
                `: ${whole.format(table.plotMeters.width)} × ${whole.format(table.plotMeters.length)} m plot`}
              {table.standAge !== null && `, stand age ${table.standAge}`}.
            </p>
            <p>
              {whole.format(counts.live)} live, {whole.format(counts.snag)} snags, {whole.format(counts.down)} down
              (CWD)
              {counts.unknown > 0 && `, ${whole.format(counts.unknown)} of unknown condition`}. Only live trees are
              drawn.
            </p>
            {live.heightMeters !== null && (
              <p>
                Live median: height {oneDecimal.format(live.heightMeters)} m
                {live.crownWidthMeters !== null && `, crown width ${oneDecimal.format(live.crownWidthMeters)} m`}
                {live.crownBaseShare !== null && `, crown base at ${percent.format(live.crownBaseShare)} of height`}.
              </p>
            )}
          </div>
          {(table.notes.length > 0 || table.skipped.length > 0) && (
            <InlineAlert tone="warning">
              {table.notes.map((note) => (
                <p key={note}>{note}</p>
              ))}
              {table.skipped.length > 0 && <p>{whole.format(table.skipped.length)} rows not read.</p>}
            </InlineAlert>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <SelectField
              label="Plot coordinates"
              aria-label="TASS plot coordinates"
              placeholder="Choose the corner"
              value={axes ?? ''}
              onValueChange={(value) => setAxes((value || null) as TassAxes | null)}
              hintAction={
                <InfoTip label="About TASS plot coordinates">
                  TASS&rsquo;s help measures X/Y from the plot&rsquo;s south-west corner and row/column from its
                  north-west corner, and the stem table labels its X and Y columns &ldquo;Row&rdquo; and
                  &ldquo;Column&rdquo;. Which one an export uses is not yet confirmed, so it is never assumed.
                </InfoTip>
              }
            >
              {AXES_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectField>
            <NumberField
              label="Plot north edge faces"
              aria-label="TASS plot bearing"
              unit="°"
              min={0}
              max={359}
              precision={0}
              value={bearing}
              onValueChange={(value) => setBearing(((Math.round(value) % 360) + 360) % 360)}
            />
          </div>
          <SegmentedControl<Repeat>
            label="Plot placement"
            size="sm"
            value={repeat}
            onChange={setRepeat}
            options={REPEAT_OPTIONS}
          />
          {!geometry ? (
            <InlineAlert tone="warning">The block has no shape to place the plot in.</InlineAlert>
          ) : !axes ? (
            <p className="text-2xs text-muted-foreground">Choose the corner the plot coordinates start from.</p>
          ) : placed?.error ? (
            <InlineAlert tone="error">{placed.error}</InlineAlert>
          ) : placed?.result ? (
            <InlineAlert tone={placed.result.trees.length ? 'info' : 'warning'}>
              <p data-testid="tass-placement">
                {whole.format(placed.result.trees.length)} trees from {whole.format(placed.result.copies)}{' '}
                {placed.result.copies === 1 ? 'copy' : 'copies'} of the plot
                {repeat === 'once' && `, covering ${percent.format(placed.result.coveredShare)} of the block`}.
              </p>
              {placed.result.shortLive > 0 && (
                <p>{whole.format(placed.result.shortLive)} live stems per plot at or under 1.3 m are not drawn.</p>
              )}
              {placed.result.leftOut > 0 && <p>{whole.format(placed.result.leftOut)} trees past the limit left out.</p>}
              {repeat === 'repeat' && (
                <p>Repeated plots show the same pattern every {whole.format(table.plotMeters?.width ?? 0)} m.</p>
              )}
            </InlineAlert>
          ) : null}
          <Button
            size="xs"
            disabled={!placed?.result?.trees.length || !placement}
            onClick={() => {
              const result = placed?.result
              if (!result?.trees.length || !placement) return
              onImportTrees(result.trees, {
                fileName: table.name,
                crs: tassPlacementLabel(table, placement),
                count: result.trees.length,
                dropped: counts.snag + counts.down + counts.unknown + result.shortLive + table.skipped.length,
                ...(result.leftOut ? { leftOut: result.leftOut } : {}),
              })
            }}
          >
            Use this plot
          </Button>
        </>
      )}
    </div>
  )
}

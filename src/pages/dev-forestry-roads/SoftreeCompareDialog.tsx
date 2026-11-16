import { useMemo, useState } from 'react'
import { Crosshair, Download, FileUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PanelDialog } from '@/components/ui/dialog-shell'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { FileButton } from '@/components/ui/file-button'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert } from '@/components/ui/map-panels'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { StatGroup } from '@/components/ui/stat-group'
import { downloadText } from '@/lib/download'
import { cn } from '@/lib/utils'
import { Field, NumberField, roadFieldClass, RoadSelect } from './Controls'
import {
  COMPARE_ABSOLUTE_TOLERANCE,
  COMPARE_DECIMALS,
  compareRoadEngDesignResults,
  compareSoftreeFile,
  comparisonCsv,
  DEFAULT_COMPARE_RELATIVE_PERCENT,
  MAX_COMPARE_FILE_BYTES,
  MAX_COMPARE_RELATIVE_PERCENT,
  SOFTREE_COMPARE_KIND_LABELS,
  type CompareRow,
  type SoftreeComparison,
} from './softreeCompare'
import { activeRoadEngSolution, storedResultsOfSource } from './roadEngStoredResults'
import { softreeUnits } from './softreeExports'
import type { SoftreeUnits } from './softreeHaulCsv'
import type { Alignment, RoadAnalysis, TerrainMetadata } from './types'

/** The most rows the table draws; the comparison CSV holds every one. */
export const MAX_COMPARE_ROWS_SHOWN = 400

const formatters = new Map<number, Intl.NumberFormat>()
const formatter = (digits: number) => {
  let f = formatters.get(digits)
  if (!f) {
    f = new Intl.NumberFormat('en-CA', { minimumFractionDigits: digits, maximumFractionDigits: digits })
    formatters.set(digits, f)
  }
  return f
}
/** A value at the shown decimals; one that rounds to zero prints as 0, never -0. */
const rounded = (v: number, digits: number) => (Math.abs(v) < 0.5 * 10 ** -digits ? 0 : v)
const value = (v: number | null, digits: number) => (v === null ? '—' : formatter(digits).format(rounded(v, digits)))
const signed = (v: number | null, digits: number) => {
  if (v === null) return '—'
  const r = rounded(v, digits)
  return `${r > 0 ? '+' : ''}${formatter(digits).format(r)}`
}
const percent = (r: CompareRow) => (r.percent === null ? (r.difference ? '—' : '0.00') : signed(r.percent, 2))

const UNIT_OPTIONS = [
  { value: 'metric', label: 'Metres and cubic metres' },
  { value: 'imperial', label: 'Feet and cubic yards' },
]

/**
 * **Compare with RoadEng…**: for a road read from a RoadEng design, the results the design stores
 * (its last costing, `roadEngStoredResults.ts`) beside the road's own, with nothing to export; and
 * for any road, a RoadEng Mass Haul or Optimal Haul export, or a Softree Optimal Areas file, beside
 * the same file made from the active road's results (`softreeCompare.ts`). The file stays in this
 * dialog: nothing is written to the project. A row's station button moves the workspace's station
 * there, which the plan and profile follow.
 */
export function SoftreeCompareDialog({
  alignment,
  analysis,
  terrain,
  onStation,
  onClose,
  portalContainer,
}: {
  /** The active road: its name, engineering input and, for a RoadEng design, where its stations start. */
  alignment: Pick<Alignment, 'name' | 'engineering' | 'roadEngSource'>
  analysis: RoadAnalysis
  /** The project's terrain, whose RoadEng plane gives the files' units (`softreeUnits`). */
  terrain: Pick<TerrainMetadata, 'localPlane'>
  onStation: (chainage: number) => void
  onClose: () => void
  portalContainer?: HTMLElement | null
}) {
  const engineering = alignment.engineering
  const scale = alignment.roadEngSource?.stationScale ?? 1
  const [file, setFile] = useState<{ name: string; text: string } | null>(null)
  const [readError, setReadError] = useState('')
  const [reading, setReading] = useState(false)
  const [units, setUnits] = useState<SoftreeUnits>(() => softreeUnits(terrain))
  const [relativePercent, setRelativePercent] = useState(DEFAULT_COMPARE_RELATIVE_PERCENT)
  const [startStationM, setStartStationM] = useState(alignment.roadEngSource?.startStation ?? 0)
  const [show, setShow] = useState<'all' | 'differences'>('all')
  const [selected, setSelected] = useState<string | null>(null)
  const source = alignment.roadEngSource
  const stored = useMemo(() => storedResultsOfSource(source), [source])
  const [mode, setMode] = useState<'design' | 'file'>(() =>
    stored && activeRoadEngSolution(stored) ? 'design' : 'file',
  )

  const outcome = useMemo((): { result: SoftreeComparison } | { error: string } | null => {
    if (mode === 'design') {
      if (!source) return null
      if (!stored)
        return { error: "The design's units are not ones this workspace reads, so its results are not read." }
      try {
        return {
          result: compareRoadEngDesignResults(
            stored,
            { startStation: source.startStation, stationScale: scale, part: source.part },
            { analysis, engineering },
            { relativePercent },
          ),
        }
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'The stored results could not be compared.' }
      }
    }
    if (!file) return null
    try {
      return {
        result: compareSoftreeFile(
          file.text,
          { analysis, engineering },
          {
            units,
            relativePercent,
            frame: { startStationM, scale },
          },
        ),
      }
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'The file could not be compared.' }
    }
  }, [mode, stored, source, file, analysis, engineering, units, relativePercent, startStationM, scale])
  const result = outcome && 'result' in outcome ? outcome.result : null
  const error = (mode === 'file' ? readError : '') || (outcome && 'error' in outcome ? outcome.error : '')

  const read = async (picked: File) => {
    setReadError('')
    setSelected(null)
    if (picked.size > MAX_COMPARE_FILE_BYTES) {
      setFile(null)
      setReadError(
        `${picked.name} is larger than ${MAX_COMPARE_FILE_BYTES / 1_000_000} MB, more than this comparison reads.`,
      )
      return
    }
    setReading(true)
    try {
      setFile({ name: picked.name, text: await picked.text() })
    } catch {
      setFile(null)
      setReadError(`${picked.name} could not be read.`)
    } finally {
      setReading(false)
    }
  }

  const rows = result ? (show === 'differences' ? result.rows.filter((r) => !r.agrees) : result.rows) : []
  const shown = rows.slice(0, MAX_COMPARE_ROWS_SHOWN)
  const download = () => {
    if (!result) return
    if (result.kind === 'roadeng-design') {
      const name = `${alignment.name}${source?.part ? ` ${source.part}` : ''}`
      const stem = name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'roadeng-design'
      downloadText(comparisonCsv(result, name), `${stem}-stored-results-compared.csv`, 'text/csv;charset=utf-8')
      return
    }
    if (!file) return
    const stem = file.name.replace(/\.[^.]+$/, '')
    downloadText(comparisonCsv(result, file.name), `${stem}-compared.csv`, 'text/csv;charset=utf-8')
  }

  return (
    <PanelDialog
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title="Compare with RoadEng"
      subtitle={`${alignment.name}: the road's own results beside ${source ? "RoadEng's" : 'a RoadEng or Softree file'}`}
      size="xl"
      portalContainer={portalContainer}
      contentProps={{ 'data-testid': 'softree-compare-dialog' }}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" disabled={!result} onClick={download}>
            <Download className="size-3.5" aria-hidden="true" />
            Download comparison CSV
          </Button>
          <Button size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {source && (
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl
              label="Compare with"
              size="sm"
              fullWidth={false}
              value={mode}
              onChange={(next) => {
                setMode(next)
                setSelected(null)
              }}
              options={[
                { value: 'design', label: 'Results stored in the design' },
                { value: 'file', label: 'A RoadEng or Softree file' },
              ]}
            />
            <InfoTip label="About the results stored in the design">
              A RoadEng design keeps the last costing of each vertical alignment: its haul, cut, fill and pit opening
              costs, the stations it covered and when RoadEng solved it. They are set beside this road&apos;s own costs
              in the same columns as RoadEng&apos;s Optimal Haul cost summary, with nothing to export from RoadEng. The
              design&apos;s calculated stations were set against the road when it was opened; the import notice gives
              that check.
            </InfoTip>
          </div>
        )}
        {mode === 'file' && (
          <div className="flex flex-wrap items-center gap-2">
            <FileButton
              label="RoadEng or Softree file to compare"
              accept=".csv,.txt,text/csv,text/plain"
              disabled={reading}
              onFiles={(files) => files[0] && void read(files[0])}
            >
              <FileUp className="size-3.5" aria-hidden="true" />
              {reading ? 'Reading…' : file ? 'Choose another file' : 'Choose a file'}
            </FileButton>
            {file && (
              <span className="min-w-0 truncate text-xs text-muted-foreground" data-testid="softree-compare-file">
                {file.name}
                {result && ` · ${SOFTREE_COMPARE_KIND_LABELS[result.kind]}`}
              </span>
            )}
            <InfoTip label="About comparing with RoadEng">
              A RoadEng Mass Haul or Optimal Haul export, or a Softree Optimal Areas file, is told apart by what it
              holds. The road&apos;s side is the same file made from its own results, written in the units chosen here
              and read back, so both sides carry the same precision. The file stays in this dialog; nothing is written
              to the project.
            </InfoTip>
          </div>
        )}
        {mode === 'design' && result && (
          <p className="text-xs text-muted-foreground" data-testid="softree-compare-file">
            {SOFTREE_COMPARE_KIND_LABELS[result.kind]}
            {source?.part ? ` · ${source.part}` : ''}
          </p>
        )}
        <div className={cn('grid grid-cols-1 gap-2', mode === 'file' && 'sm:grid-cols-3')}>
          {mode === 'file' && (
            <Field
              label="Units in the file"
              hint="Softree's files state no units. The project's own units are chosen first: feet and cubic yards for a design read from RoadEng in feet, else metres."
            >
              <RoadSelect
                ariaLabel="Units in the file"
                className={roadFieldClass}
                value={units}
                onValueChange={(v) => setUnits(v as SoftreeUnits)}
                options={UNIT_OPTIONS}
              />
            </Field>
          )}
          <NumberField
            label="Agree within (%)"
            value={relativePercent}
            onChange={setRelativePercent}
            min={0}
            max={MAX_COMPARE_RELATIVE_PERCENT}
            step={0.05}
            precision={2}
            hint={`Two values agree when they differ by no more than this share of the larger, or by no more than the files' rounding: ${Object.entries(
              COMPARE_ABSOLUTE_TOLERANCE,
            )
              .map(([unit, v]) => `${v} ${unit}`)
              .join(', ')}. A value only one side has never agrees.`}
          />
          {mode === 'file' && (
            <NumberField
              label="File's first station (m)"
              value={startStationM}
              onChange={setStartStationM}
              min={-1_000_000}
              max={10_000_000}
              step={1}
              precision={3}
              hint="The station the file's road starts at. A design read from RoadEng starts where its file did; the road here starts at 0, and so do the files Save & export writes."
            />
          )}
        </div>
        {error && (
          <InlineAlert tone="error" title="Not compared">
            {error}
          </InlineAlert>
        )}
        {mode === 'file' && !file && !error && (
          <p className="text-xs text-muted-foreground">
            Choose a RoadEng Mass Haul export, a RoadEng Optimal Haul export or a Softree Optimal Areas file.
          </p>
        )}
        {result && (
          <>
            <StatGroup
              variant="tiles"
              size="md"
              aria-label="Comparison counts"
              items={[
                { key: 'compared', label: 'Values compared', value: result.totals.length + result.rows.length },
                {
                  key: 'differ',
                  label: 'Differ',
                  value: result.differing,
                  tone: result.differing ? 'warning' : 'success',
                },
                {
                  key: 'theirs',
                  label: result.kind === 'roadeng-design' ? 'Only in the design' : 'Only in the file',
                  value: result.onlyTheirs.length,
                },
                { key: 'ours', label: 'Only in PGMaps', value: result.onlyOurs.length },
              ]}
            />
            <p className="text-2xs text-muted-foreground" data-testid="softree-compare-tolerance">
              Agree within {result.tolerance.relativePercent} % of the larger value or the files&apos; rounding (
              {Object.entries(COMPARE_ABSOLUTE_TOLERANCE)
                .map(([unit, v]) => `${v} ${unit}`)
                .join(', ')}
              ){result.tolerance.stationM !== null && `; stations matched within ${result.tolerance.stationM} m`}.
              {result.kind === 'roadeng-design'
                ? ' Read from the design in its own units; shown in metric.'
                : ` Read in ${result.units === 'imperial' ? 'feet and cubic yards' : 'metres and cubic metres'}; shown in metric.`}
            </p>
            {result.notes.map((note) => (
              <p key={note} className="text-2xs text-muted-foreground">
                {note}
              </p>
            ))}
            {result.warnings.length > 0 && (
              <InlineAlert tone="warning" title={`${result.warnings.length} rows of the file were passed over`}>
                <ul className="list-disc space-y-0.5 pl-4">
                  {result.warnings.slice(0, 10).map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </InlineAlert>
            )}
            <section aria-labelledby="softree-compare-totals" className="space-y-1">
              <h3 id="softree-compare-totals" className="text-xs font-medium">
                Totals
              </h3>
              <CompareTable rows={result.totals} label="Totals" theirs={theirsLabel(result)} />
            </section>
            <section aria-labelledby="softree-compare-rows" className="space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id="softree-compare-rows" className="text-xs font-medium">
                  {result.kind === 'roadeng-design'
                    ? 'Stations costed'
                    : `${result.kind === 'optimal-areas' ? 'Stations' : 'Items'}, largest differences first`}
                </h3>
                <SegmentedControl
                  label="Rows shown"
                  size="sm"
                  fullWidth={false}
                  value={show}
                  onChange={setShow}
                  options={[
                    { value: 'all', label: 'All rows' },
                    { value: 'differences', label: 'Differences only' },
                  ]}
                />
              </div>
              {shown.length ? (
                <CompareTable
                  theirs={theirsLabel(result)}
                  rows={shown}
                  label={result.kind === 'optimal-areas' || result.kind === 'roadeng-design' ? 'Stations' : 'Items'}
                  selected={selected}
                  onStation={(r) => {
                    setSelected(r.id)
                    if (r.station !== null) onStation(r.station)
                  }}
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  {result.rows.length ? 'Every row agrees.' : 'No rows matched between the two sides.'}
                </p>
              )}
              {rows.length > shown.length && (
                <p className="text-2xs text-muted-foreground">
                  Showing the first {shown.length} of {rows.length} rows; the comparison CSV holds them all.
                </p>
              )}
            </section>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <OneSide
                title={result.kind === 'roadeng-design' ? 'Only in the design' : 'Only in the file'}
                items={result.onlyTheirs}
                testId="softree-compare-only-theirs"
              />
              <OneSide title="Only in PGMaps" items={result.onlyOurs} testId="softree-compare-only-ours" />
            </div>
          </>
        )}
      </div>
    </PanelDialog>
  )
}

/** What the other side is called in the table: the design, or the file. */
const theirsLabel = (c: SoftreeComparison) => (c.kind === 'roadeng-design' ? 'RoadEng' : 'File')

function CompareTable({
  rows,
  label,
  theirs,
  selected,
  onStation,
}: {
  rows: readonly CompareRow[]
  label: string
  theirs: string
  selected?: string | null
  onStation?: (row: CompareRow) => void
}) {
  return (
    <div className="max-h-96 overflow-auto">
      <EngineeringTable rowHeaders aria-label={label}>
        <thead>
          <tr>
            <ColumnHeader label={label} className="text-left" />
            <ColumnHeader label="Value" className="text-left" />
            <ColumnHeader label={theirs} />
            <ColumnHeader label="PGMaps" />
            <ColumnHeader label="Difference" unit={`PGMaps − ${theirs === 'File' ? 'file' : theirs}`} />
            <ColumnHeader label="Difference" unit="%" />
            <ColumnHeader label="Agrees" />
            {onStation && <ColumnHeader label="Station" unit="m" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const digits = COMPARE_DECIMALS[r.unit]
            return (
              <tr key={r.id} aria-selected={selected === r.id || undefined} data-agrees={r.agrees}>
                <th scope="row" className="max-w-64 whitespace-normal">
                  {r.item}
                </th>
                <td className="text-left">
                  {r.field} <span className="text-muted-foreground">({r.unit})</span>
                </td>
                <td>{value(r.theirs, digits)}</td>
                <td>{value(r.ours, digits)}</td>
                <td className={cn(!r.agrees && 'font-medium text-warning')}>{signed(r.difference, digits)}</td>
                <td className={cn(!r.agrees && 'text-warning')}>{percent(r)}</td>
                <td className="text-center">{r.agrees ? 'Yes' : 'No'}</td>
                {onStation && (
                  <td className="!py-0">
                    {r.station === null ? (
                      '—'
                    ) : (
                      <Button
                        variant="ghost"
                        size="xs"
                        className="gap-1 tabular-nums"
                        aria-label={`Go to station ${value(r.station, 3)}`}
                        onClick={() => onStation(r)}
                      >
                        <Crosshair className="size-3" aria-hidden="true" />
                        {value(r.station, 1)}
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </EngineeringTable>
    </div>
  )
}

function OneSide({ title, items, testId }: { title: string; items: readonly string[]; testId: string }) {
  return (
    <section className="space-y-1" data-testid={testId}>
      <h3 className="text-xs font-medium">
        {title} <span className="text-muted-foreground">({items.length})</span>
      </h3>
      {items.length ? (
        <ul className="max-h-40 list-disc space-y-0.5 overflow-auto pl-4 text-xs">
          {items.slice(0, MAX_COMPARE_ROWS_SHOWN).map((item, k) => (
            <li key={`${item}-${k}`}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">None.</p>
      )}
    </section>
  )
}

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { FORM_INPUT_CLASS, FormField, SelectField } from '@/components/ui/form-field'
import { InlineAlert, SidebarSection } from '@/components/ui/map-panels'
import { PaginationControls } from '@/components/ui/pagination-controls'
import { downloadText } from '@/lib/download'
import { compareSnapshots, type ComparisonRow, type ComparisonSnapshot } from './comparison'
import { comparisonInputSnapshots } from './comparisonAdapters'
import {
  comparisonCsv,
  comparisonDelta,
  comparisonHtml,
  comparisonJson,
  comparisonValue,
  type ComparisonReport,
} from './comparisonExport'

const PAGE_SIZE = 40
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
const metricLabel = (row: ComparisonRow) => row.metric.label ?? row.metric.measure
const dimensions = (row: ComparisonRow) =>
  Object.entries(row.metric.dimensions)
    .map(([key, value]) => `${key}: ${value}`)
    .join(' · ')

export interface ComparisonDialogProps {
  snapshots: readonly ComparisonSnapshot[]
  onImportSnapshot: (snapshot: ComparisonSnapshot) => void
  onRemoveSnapshot?: (id: string) => void
  onRenameSnapshot?: (id: string, label: string) => void
  onClose: () => void
}

export function ComparisonDialog({
  snapshots,
  onImportSnapshot,
  onRemoveSnapshot,
  onRenameSnapshot,
  onClose,
}: ComparisonDialogProps) {
  const [leftId, setLeftId] = useState('')
  const [rightId, setRightId] = useState('')
  const left = snapshots.find((snapshot) => snapshot.id === leftId) ?? snapshots[0]
  const right =
    snapshots.find((snapshot) => snapshot.id === rightId) ?? snapshots.find((snapshot) => snapshot.id !== left?.id)
  const [pending, setPending] = useState<{ name: string; snapshots: ComparisonSnapshot[]; revision: number } | null>(
    null,
  )
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const request = useRef(0)
  useEffect(
    () => () => {
      request.current++
    },
    [],
  )

  async function importFile(file: File) {
    const revision = ++request.current
    setError('')
    setBusy(true)
    try {
      if (file.size > 25_000_000) throw new Error('Choose a comparison or analysis JSON file smaller than 25 MB.')
      const candidates = comparisonInputSnapshots(await file.text())
      if (!candidates.length) throw new Error('This file contains no supported comparison results.')
      if (revision === request.current) setPending({ name: file.name, snapshots: candidates, revision })
    } catch (error) {
      if (revision === request.current) setError(message(error))
    } finally {
      if (revision === request.current) setBusy(false)
    }
  }

  return (
    <DialogShell
      title="CCISS comparison"
      subtitle="Compare saved sites, models, scenarios and settings"
      size="xl"
      onClose={onClose}
    >
      <div className="space-y-4">
        <InlineAlert tone="info">
          Save results from an analysis, change its site or settings, then save another result to compare. Captures
          retain the settings used when they were saved.
        </InlineAlert>
        <p className="text-sm">
          For a direct check against an original Shiny CSV or ZIP, open current data analysis and choose{' '}
          <strong>Compare with Shiny</strong>. That check uses the live assessment and identifies missing or unverified
          reference inputs.
        </p>
        <FormField
          label="Import comparison or analysis JSON"
          description="Accepts a validated comparison snapshot or a supported exported analysis. Imported files stay in this browser."
        >
          <input
            type="file"
            accept=".json,application/json"
            disabled={busy}
            className="block w-full text-sm"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void importFile(file)
              event.target.value = ''
            }}
          />
        </FormField>
        {busy && <InlineAlert loading>Validating comparison data…</InlineAlert>}
        {error && <InlineAlert tone="error">{error}</InlineAlert>}
        {pending && (
          <ImportReview
            key={pending.revision}
            name={pending.name}
            candidates={pending.snapshots}
            onAdd={(snapshot) => {
              try {
                onImportSnapshot(snapshot)
                if (!left) setLeftId(snapshot.id)
                else setRightId(snapshot.id)
                setPending(null)
                setError('')
              } catch (error) {
                setError(message(error))
              }
            }}
          />
        )}
        {snapshots.length === 0 && (
          <SidebarSection title="No saved results yet">
            <p className="text-sm">
              Open an analysis and use its save-for-comparison action, or import a previously saved result above. You
              can compare different sites, climate models, scenarios or period weights.
            </p>
          </SidebarSection>
        )}
        {snapshots.length > 0 && (
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <SnapshotSide
              label="A"
              snapshots={snapshots}
              selected={left}
              onSelect={setLeftId}
              onRemove={onRemoveSnapshot}
              onRename={onRenameSnapshot}
            />
            <SnapshotSide
              label="B"
              snapshots={snapshots}
              selected={right}
              onSelect={setRightId}
              onRemove={onRemoveSnapshot}
              onRename={onRenameSnapshot}
            />
          </div>
        )}
        {left && !right && <InlineAlert tone="info">Save or import a second result to compare with A.</InlineAlert>}
        {left && right && <ComparisonResults key={`${left.id}:${right.id}`} left={left} right={right} />}
      </div>
    </DialogShell>
  )
}

function ImportReview({
  name,
  candidates,
  onAdd,
}: {
  name: string
  candidates: ComparisonSnapshot[]
  onAdd: (snapshot: ComparisonSnapshot) => void
}) {
  const [selected, setSelected] = useState('0')
  const [label, setLabel] = useState('')
  const candidate = candidates[Number(selected)] ?? candidates[0]
  return (
    <SidebarSection title={`Import from ${name}`}>
      <div className="space-y-3">
        <SelectField label="Imported result" value={selected} onChange={(event) => setSelected(event.target.value)}>
          {candidates.map((snapshot, index) => (
            <option key={index} value={index}>
              {snapshot.label}
            </option>
          ))}
        </SelectField>
        <FormField label="Imported result label">
          <input
            className={FORM_INPUT_CLASS}
            value={label}
            maxLength={200}
            placeholder={candidate.label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </FormField>
        <p className="text-xs text-muted-foreground">
          Source: {candidate.provenance.source} · Family: {candidate.family} · {candidate.metrics.length} recorded
          metrics.
        </p>
        {candidate.provenance.synthetic && (
          <InlineAlert tone="warning">This result contains synthetic verification data.</InlineAlert>
        )}
        <Button onClick={() => onAdd({ ...candidate, label: label.trim() || candidate.label })}>
          Add imported result
        </Button>
      </div>
    </SidebarSection>
  )
}

function SnapshotSide({
  label,
  snapshots,
  selected,
  onSelect,
  onRemove,
  onRename,
}: {
  label: string
  snapshots: readonly ComparisonSnapshot[]
  selected: ComparisonSnapshot | undefined
  onSelect: (id: string) => void
  onRemove?: (id: string) => void
  onRename?: (id: string, label: string) => void
}) {
  return (
    <SidebarSection title={`Result ${label}`}>
      <SelectField
        label={`Comparison ${label}`}
        value={selected?.id ?? ''}
        onChange={(event) => onSelect(event.target.value)}
      >
        {!selected && <option value="">Choose a saved result</option>}
        {snapshots.map((snapshot) => (
          <option key={snapshot.id} value={snapshot.id}>
            {snapshot.label}
          </option>
        ))}
      </SelectField>
      {selected && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            {selected.provenance.source} · {selected.provenance.version ?? 'Version unknown'} · {selected.family}
          </p>
          {selected.provenance.synthetic && (
            <p className="text-xs font-medium text-amber-700 dark:text-amber-300">Synthetic verification data</p>
          )}
          <details className="rounded-md border border-border p-2">
            <summary className="cursor-pointer text-xs font-medium">Scope, settings and provenance for {label}</summary>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">
              {JSON.stringify(
                { context: selected.context, provenance: selected.provenance, periods: selected.periods },
                null,
                2,
              )}
            </pre>
          </details>
          {(onRename || onRemove) && (
            <ManageSnapshot
              key={selected.id}
              snapshot={selected}
              side={label}
              onRename={onRename}
              onRemove={onRemove}
            />
          )}
        </div>
      )}
    </SidebarSection>
  )
}

function ManageSnapshot({
  snapshot,
  side,
  onRename,
  onRemove,
}: {
  snapshot: ComparisonSnapshot
  side: string
  onRename?: (id: string, label: string) => void
  onRemove?: (id: string) => void
}) {
  const [name, setName] = useState(snapshot.label)
  return (
    <details>
      <summary className="cursor-pointer text-xs text-muted-foreground">Manage result {side}</summary>
      <div className="mt-2 space-y-2">
        {onRename && (
          <>
            <FormField label={`Rename result ${side}`}>
              <input
                className={FORM_INPUT_CLASS}
                maxLength={200}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </FormField>
            <Button
              size="sm"
              variant="outline"
              disabled={!name.trim()}
              onClick={() => onRename(snapshot.id, name.trim())}
            >
              Rename {side}
            </Button>
          </>
        )}
        {onRemove && (
          <Button size="sm" variant="outline" onClick={() => onRemove(snapshot.id)}>
            Remove {side}
          </Button>
        )}
      </div>
    </details>
  )
}

function ComparisonResults({ left, right }: { left: ComparisonSnapshot; right: ComparisonSnapshot }) {
  const result = useMemo(() => compareSnapshots(left, right), [left, right])
  const [query, setQuery] = useState('')
  const search = useDeferredValue(query.trim().toLowerCase())
  const [measure, setMeasure] = useState('')
  const [changedOnly, setChangedOnly] = useState(false)
  const [rowState, setRowState] = useState('all')
  const [pageState, setPageState] = useState({ key: '', index: 0 })
  const filtersKey = JSON.stringify([search, measure, changedOnly, rowState])
  const filtered = useMemo(
    () =>
      result.rows.filter(
        (row) =>
          (!measure || row.metric.measure === measure) &&
          (!changedOnly || row.interpretation !== 'unchanged') &&
          (rowState !== 'compatible' || (row.compatible && row.leftValue !== null && row.rightValue !== null)) &&
          (rowState !== 'unmatched' || !row.compatible || row.leftValue === null || row.rightValue === null) &&
          (!search ||
            `${metricLabel(row)} ${row.metric.entity} ${dimensions(row)} ${row.metric.period ?? ''} ${row.reason ?? ''}`
              .toLowerCase()
              .includes(search)),
      ),
    [result, measure, changedOnly, rowState, search],
  )
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const page = Math.min(pageState.key === filtersKey ? pageState.index : 0, pageCount - 1)
  const rows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const measures = [...new Set(result.rows.map((row) => row.metric.measure))].sort()
  const notes = [
    'This is an exploratory comparison of saved outputs and their recorded scope. Matching numbers alone do not establish scientific parity.',
    'Ordinal suitability changes are category transitions; no ecological distance or average is inferred.',
  ]
  function report(): ComparisonReport {
    return {
      schema: 'cciss-comparison-report-v1',
      generatedAt: new Date().toISOString(),
      intent: 'explore',
      left,
      right,
      comparison: result,
      notes,
    }
  }
  return (
    <div className="space-y-4">
      {left.id === right.id && <InlineAlert tone="warning">The same saved result is selected for A and B.</InlineAlert>}
      {result.warnings.length > 0 && (
        <InlineAlert tone="warning">
          <ul className="list-disc space-y-1 pl-4">
            {result.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </InlineAlert>
      )}
      <p className="text-sm">
        {result.comparedCount} numeric comparisons · {result.rows.length} aligned rows. Changes are{' '}
        <strong>B minus A</strong>; probabilities use percentage points. Suitability ratings show category transitions.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label="Search comparison">
          <input
            className={FORM_INPUT_CLASS}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Species, period, metric…"
          />
        </FormField>
        <SelectField label="Comparison measure" value={measure} onChange={(event) => setMeasure(event.target.value)}>
          <option value="">All measures</option>
          {measures.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </SelectField>
        <SelectField
          label="Comparison row status"
          value={rowState}
          onChange={(event) => setRowState(event.target.value)}
        >
          <option value="all">All rows</option>
          <option value="compatible">Comparable rows</option>
          <option value="unmatched">Missing or incompatible rows</option>
        </SelectField>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={changedOnly} onChange={(event) => setChangedOnly(event.target.checked)} />
        Changed or unmatched only
      </label>
      <ProbabilityComparison rows={filtered} leftLabel={left.label} rightLabel={right.label} />
      <SidebarSection title="Aligned comparison results">
        <p className="mb-3 text-xs text-muted-foreground">
          Showing {filtered.length ? page * PAGE_SIZE + 1 : 0}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of{' '}
          {filtered.length} filtered rows. Exports contain all rows and both complete source snapshots.
        </p>
        {rows.length ? (
          <div className="overflow-x-auto">
            <EngineeringTable rowHeaders className="whitespace-normal text-xs [&_td]:py-2 [&_tbody_th]:py-2">
              <caption className="sr-only">CCISS aligned comparison</caption>
              <thead>
                <tr>
                  <ColumnHeader label="Metric / entity" className="text-left" />
                  <ColumnHeader label="Period" className="text-left" />
                  <ColumnHeader label="A" />
                  <ColumnHeader label="B" />
                  <ColumnHeader label="Change" />
                  <ColumnHeader label="Status" className="text-left" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">
                      <span className="block font-medium">
                        {metricLabel(row)} · {row.metric.entity}
                      </span>
                      <span className="block text-xs text-muted-foreground">{dimensions(row)}</span>
                    </th>
                    <td className="text-left">
                      {row.metric.period ?? row.metric.periodCoverage?.join(', ') ?? 'Unknown coverage'}
                    </td>
                    <td>
                      {comparisonValue(row.leftValue, row, 'left')}
                      {row.left && <small className="block text-muted-foreground">{row.left.unit}</small>}
                      {row.leftImputed && <small className="block">Inferred zero</small>}
                    </td>
                    <td>
                      {comparisonValue(row.rightValue, row, 'right')}
                      {row.right && <small className="block text-muted-foreground">{row.right.unit}</small>}
                      {row.rightImputed && <small className="block">Inferred zero</small>}
                    </td>
                    <td>{comparisonDelta(row)}</td>
                    <td className="text-left">{row.reason ?? row.interpretation}</td>
                  </tr>
                ))}
              </tbody>
            </EngineeringTable>
          </div>
        ) : (
          <p role="status" className="text-sm">
            No rows match these filters.
          </p>
        )}
        {pageCount > 1 && (
          <PaginationControls
            page={page}
            pageCount={pageCount}
            onPageChange={(index) => setPageState({ key: filtersKey, index })}
            label="Comparison pages"
            className="mt-3 px-0"
          />
        )}
      </SidebarSection>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => downloadText(comparisonJson(report()), 'cciss-comparison.json', 'application/json')}>
          Download comparison JSON
        </Button>
        <Button
          variant="outline"
          onClick={() => downloadText(comparisonCsv(report()), 'cciss-comparison.csv', 'text/csv')}
        >
          Download comparison CSV
        </Button>
        <Button
          variant="outline"
          onClick={() => downloadText(comparisonHtml(report()), 'cciss-comparison.html', 'text/html')}
        >
          Download printable comparison
        </Button>
      </div>
    </div>
  )
}

function ProbabilityComparison({
  rows,
  leftLabel,
  rightLabel,
}: {
  rows: ComparisonRow[]
  leftLabel: string
  rightLabel: string
}) {
  const candidates = rows.filter(
    (row) =>
      row.compatible &&
      row.metric.unit === 'probability' &&
      typeof row.leftValue === 'number' &&
      typeof row.rightValue === 'number',
  )
  const visible = candidates.slice(0, 12)
  if (!visible.length) return null
  return (
    <SidebarSection title="Probability comparison">
      <p className="mb-3 text-xs text-muted-foreground">
        A: {leftLabel} · B: {rightLabel}. Fixed 0–100% scale; changes are percentage points. Showing {visible.length} of{' '}
        {candidates.length} filtered probability rows.
      </p>
      <div role="img" aria-label="Probability comparison bars from zero to one hundred percent" className="space-y-3">
        <div className="flex justify-between pl-6 pr-14 text-xs text-muted-foreground">
          <span>0%</span>
          <span>50%</span>
          <span>100%</span>
        </div>
        {visible.map((row) => (
          <div key={row.key}>
            <p className="mb-1 text-xs">
              {metricLabel(row)} · {row.metric.entity} · {row.metric.period ?? 'Summary'} · {dimensions(row)}{' '}
              <strong>{comparisonDelta(row)}</strong>
            </p>
            {[
              { label: 'A', value: row.leftValue as number, color: 'bg-sky-600' },
              { label: 'B', value: row.rightValue as number, color: 'bg-orange-600' },
            ].map((bar) => (
              <div key={bar.label} className="mb-1 grid grid-cols-[1rem_1fr_3rem] items-center gap-2 text-xs">
                <span>{bar.label}</span>
                <div className="h-3 overflow-hidden rounded-sm bg-muted">
                  <div className={`h-full ${bar.color}`} style={{ width: `${bar.value * 100}%` }} />
                </div>
                <span className="text-right tabular-nums">{(bar.value * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </SidebarSection>
  )
}

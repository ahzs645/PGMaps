import { useDeferredValue, useMemo, useState } from 'react'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { FORM_INPUT_CLASS, FormField, SelectField } from '@/components/ui/form-field'
import { InlineAlert, SidebarSection } from '@/components/ui/map-panels'
import { PaginationControls } from '@/components/ui/pagination-controls'
import { downloadText } from '@/lib/download'
import { AlertList } from './AlertList'
import { compareSnapshots, type ComparisonRow, type ComparisonSnapshot } from './comparison'
import {
  comparisonCsv,
  comparisonDelta,
  comparisonHtml,
  comparisonJson,
  comparisonValue,
  type ComparisonReport,
} from './comparisonExport'
import { DownloadActions } from './DownloadActions'
import { usePagedRows } from './usePagedRows'

const PAGE_SIZE = 40
const PROBABILITY_BARS = 12
const NOTES = [
  'This is an exploratory comparison of saved outputs and their recorded scope. Matching numbers alone do not establish scientific parity.',
  'Ordinal suitability changes are category transitions; no ecological distance or average is inferred.',
]
const metricLabel = (row: ComparisonRow) => row.metric.label ?? row.metric.measure
const dimensions = (row: ComparisonRow) =>
  Object.entries(row.metric.dimensions)
    .map(([key, value]) => `${key}: ${value}`)
    .join(' · ')

/** Side-by-side A/B bars on a fixed 0–100% scale for the first filtered probability rows. */
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
  const visible = candidates.slice(0, PROBABILITY_BARS)
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
              { label: 'A', value: row.leftValue as number, color: 'fixed-palette bg-sky-600' },
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

/** Aligned rows for results A and B, with filters, probability bars and the exports. */
export function ComparisonResults({ left, right }: { left: ComparisonSnapshot; right: ComparisonSnapshot }) {
  const result = useMemo(() => compareSnapshots(left, right), [left, right])
  const [query, setQuery] = useState('')
  const search = useDeferredValue(query.trim().toLowerCase())
  const [measure, setMeasure] = useState('')
  const [changedOnly, setChangedOnly] = useState(false)
  const [rowState, setRowState] = useState('all')
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
  const paged = usePagedRows(filtered, PAGE_SIZE, JSON.stringify([search, measure, changedOnly, rowState]))
  const measures = [...new Set(result.rows.map((row) => row.metric.measure))].sort()

  function download(format: 'json' | 'csv' | 'html') {
    const report: ComparisonReport = {
      schema: 'cciss-comparison-report-v1',
      generatedAt: new Date().toISOString(),
      intent: 'explore',
      left,
      right,
      comparison: result,
      notes: NOTES,
    }
    if (format === 'json') downloadText(comparisonJson(report), 'cciss-comparison.json', 'application/json')
    else if (format === 'csv') downloadText(comparisonCsv(report), 'cciss-comparison.csv', 'text/csv')
    else downloadText(comparisonHtml(report), 'cciss-comparison.html', 'text/html')
  }

  return (
    <div className="space-y-4">
      {left.id === right.id && <InlineAlert tone="warning">The same saved result is selected for A and B.</InlineAlert>}
      <AlertList items={result.warnings} />
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
          Showing {paged.first}–{paged.last} of {filtered.length} filtered rows. Exports contain all rows and both
          complete source snapshots.
        </p>
        {paged.visible.length ? (
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
                {paged.visible.map((row) => (
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
        {paged.pageCount > 1 && (
          <PaginationControls
            page={paged.page}
            pageCount={paged.pageCount}
            onPageChange={paged.setPage}
            label="Comparison pages"
            className="mt-3 px-0"
          />
        )}
      </SidebarSection>
      <DownloadActions
        actions={[
          { label: 'Download comparison JSON', onClick: () => download('json') },
          { label: 'Download comparison CSV', onClick: () => download('csv') },
          { label: 'Download printable comparison', onClick: () => download('html') },
        ]}
      />
    </div>
  )
}

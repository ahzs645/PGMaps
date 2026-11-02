import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SelectField } from '@/components/ui/form-field'
import { InlineAlert, SidebarSection } from '@/components/ui/map-panels'
import { PaginationControls } from '@/components/ui/pagination-controls'
import { downloadText } from '@/lib/download'
import { comparePublishedPeriodRatings, publishedConsistencyCsv } from './publishedConsistency'
import { ratingLabel } from './legacyAnalysis'
import type { ShinyReport } from './shinyReport'

export function PublishedReferenceChecks({ report, source }: { report: ShinyReport; source: string }) {
  const result = useMemo(() => comparePublishedPeriodRatings(report), [report])
  const [status, setStatus] = useState('all')
  const [pageChoice, setPageChoice] = useState(0)
  const rows = useMemo(() => result.rows.filter((row) => status === 'all' || row.status === status), [result, status])
  const pageCount = Math.max(1, Math.ceil(rows.length / 50))
  const page = Math.min(pageChoice, pageCount - 1)
  const visible = rows.slice(page * 50, (page + 1) * 50)
  return (
    <SidebarSection title="Published period-class check">
      <p className="mb-3 text-sm">{result.method}</p>
      {result.reason && <InlineAlert tone="info">{result.reason}</InlineAlert>}
      <p className="mb-3 text-xs text-muted-foreground">
        Source: {source}.{' '}
        {result.rows.length
          ? 'Counts cover every original row in this file.'
          : 'No supported historical raw rows were compared.'}
      </p>
      <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Published comparison counts">
        {[
          ['Compared', result.counts.compared],
          ['Matching classes', result.counts.matched],
          ['Different classes', result.counts.different],
          ['Excluded rows', result.counts.skipped],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-lg font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <InlineAlert tone="info">
        This checks the file’s exported votes against its own published period classes. It does not regenerate
        predictions or establish agreement with current Shiny results. Incomplete and novelty-scaled rows are excluded.
      </InlineAlert>
      {result.rows.length > 0 && (
        <>
          <SelectField
            label="Published check rows"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value)
              setPageChoice(0)
            }}
          >
            <option value="all">All rows</option>
            <option value="difference">Different classes</option>
            <option value="skipped">Excluded rows</option>
            <option value="match">Matching classes</option>
          </SelectField>
          <div className="my-3 flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() =>
                downloadText(publishedConsistencyCsv(result), 'cciss-published-class-check.csv', 'text/csv')
              }
            >
              Download published check CSV
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                downloadText(
                  JSON.stringify({ ...result, source, scientificParityVerified: false }, null, 2),
                  'cciss-published-class-check.json',
                  'application/json',
                )
              }
            >
              Download published check JSON
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Published period-class comparisons</caption>
              <thead>
                <tr>
                  {[
                    'Site',
                    'Site series',
                    'Species',
                    'Original period',
                    'Published class',
                    'Calculated class',
                    'Status / reason',
                  ].map((label) => (
                    <th key={label} scope="col">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((row, index) => (
                  <tr className="border-t" key={JSON.stringify([row.site, row.series, row.species, row.period, index])}>
                    <td className="py-2">{row.site}</td>
                    <td>{row.series}</td>
                    <td>{row.species}</td>
                    <td>{row.period}</td>
                    <td>{ratingLabel(row.sourceClass)}</td>
                    <td>{ratingLabel(row.derivedClass)}</td>
                    <td>{row.reason ?? row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!rows.length && <p className="my-3 text-sm">No rows match this filter.</p>}
          <p className="mt-2 text-xs text-muted-foreground">
            Showing {rows.length ? page * 50 + 1 : 0}–{Math.min((page + 1) * 50, rows.length)} of {rows.length} filtered
            rows.
          </p>
          {pageCount > 1 && (
            <PaginationControls
              page={page}
              pageCount={pageCount}
              onPageChange={setPageChoice}
              label="Published check pages"
            />
          )}
        </>
      )}
    </SidebarSection>
  )
}

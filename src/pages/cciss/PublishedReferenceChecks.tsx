import { useMemo, useState } from 'react'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { SelectField } from '@/components/ui/form-field'
import { InlineAlert, SidebarSection } from '@/components/ui/map-panels'
import { PaginationControls } from '@/components/ui/pagination-controls'
import { StatGroup } from '@/components/ui/stat-group'
import { downloadText } from '@/lib/download'
import { DownloadActions } from './DownloadActions'
import { ratingLabel } from './legacyAnalysis'
import { comparePublishedPeriodRatings, publishedConsistencyCsv } from './publishedConsistency'
import type { ShinyReport } from './shinyReport'
import { usePagedRows } from './usePagedRows'

const PAGE_SIZE = 50
const COLUMNS = [
  'Site',
  'Site series',
  'Species',
  'Original period',
  'Published class',
  'Calculated class',
  'Status / reason',
]

/** Checks a file's exported votes against its own published period classes. */
export function PublishedReferenceChecks({ report, source }: { report: ShinyReport; source: string }) {
  const result = useMemo(() => comparePublishedPeriodRatings(report), [report])
  const [status, setStatus] = useState('all')
  const rows = useMemo(() => result.rows.filter((row) => status === 'all' || row.status === status), [result, status])
  const paged = usePagedRows(rows, PAGE_SIZE, status)
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
      <StatGroup
        aria-label="Published comparison counts"
        variant="tiles"
        size="sm"
        align="start"
        columns={4}
        className="mb-4"
        items={[
          { label: 'Compared', value: result.counts.compared },
          { label: 'Matching classes', value: result.counts.matched },
          { label: 'Different classes', value: result.counts.different },
          { label: 'Excluded rows', value: result.counts.skipped },
        ]}
      />
      <InlineAlert tone="info">
        This checks the file’s exported votes against its own published period classes. It does not regenerate
        predictions or establish agreement with current Shiny results. Incomplete and novelty-scaled rows are excluded.
      </InlineAlert>
      {result.rows.length > 0 && (
        <div className="mt-3 space-y-3">
          <SelectField label="Published check rows" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">All rows</option>
            <option value="difference">Different classes</option>
            <option value="skipped">Excluded rows</option>
            <option value="match">Matching classes</option>
          </SelectField>
          <DownloadActions
            outline
            actions={[
              {
                label: 'Download published check CSV',
                onClick: () =>
                  downloadText(publishedConsistencyCsv(result), 'cciss-published-class-check.csv', 'text/csv'),
              },
              {
                label: 'Download published check JSON',
                onClick: () =>
                  downloadText(
                    JSON.stringify({ ...result, source, scientificParityVerified: false }, null, 2),
                    'cciss-published-class-check.json',
                    'application/json',
                  ),
              },
            ]}
          />
          <div className="overflow-x-auto">
            <EngineeringTable variant="text" className="text-sm">
              <caption className="sr-only">Published period-class comparisons</caption>
              <thead>
                <tr>
                  {COLUMNS.map((label) => (
                    <ColumnHeader key={label} label={label} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.visible.map((row, index) => (
                  <tr key={JSON.stringify([row.site, row.series, row.species, row.period, index])}>
                    <td>{row.site}</td>
                    <td>{row.series}</td>
                    <td>{row.species}</td>
                    <td>{row.period}</td>
                    <td>{ratingLabel(row.sourceClass)}</td>
                    <td>{ratingLabel(row.derivedClass)}</td>
                    <td>{row.reason ?? row.status}</td>
                  </tr>
                ))}
              </tbody>
            </EngineeringTable>
          </div>
          {!rows.length && <p className="text-sm">No rows match this filter.</p>}
          <p className="text-xs text-muted-foreground">
            Showing {paged.first}–{paged.last} of {rows.length} filtered rows.
          </p>
          {paged.pageCount > 1 && (
            <PaginationControls
              page={paged.page}
              pageCount={paged.pageCount}
              onPageChange={paged.setPage}
              label="Published check pages"
            />
          )}
        </div>
      )}
    </SidebarSection>
  )
}

import { NativeSelect } from '@/components/ui/form-field'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert, SearchInput } from '@/components/ui/map-panels'
import { PaginationControls } from '@/components/ui/pagination-controls'
import { downloadText } from '@/lib/download'
import { errorText } from '@/lib/nechakoPortal'
import { CheckState, JsonResults, useReadCheck } from './PortalChecks'
import { PortalSubmissionReader } from './PortalSubmissionReader'
import { adminCell, adminRows, filterAdminRows, type AdminColumn, type AdminRow } from './data/adminInspection'
import { csvExport } from './data/monitoring'

export function AdminOriginal({ data, title }: { data: unknown; title: string }) {
  return (
    <details className="rounded border p-3">
      <summary className="cursor-pointer text-sm font-medium">Original response and JSON export</summary>
      <div className="mt-3 space-y-3">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            downloadText(
              JSON.stringify(data, null, 2),
              `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`,
              'application/json',
            )
          }
        >
          Download original JSON
        </Button>
        <JsonResults data={data} />
      </div>
    </details>
  )
}

/** Source-specific tables share PGMaps search and paging controls; values stay escaped and uncoerced. */
export function AdminDataTable({
  title,
  rows,
  columns,
  onSelect,
  selectLabel = () => 'Inspect record',
  selectionDisabled = false,
  children,
}: {
  title: string
  rows: AdminRow[]
  columns: AdminColumn[]
  onSelect?: (row: AdminRow) => void
  selectLabel?: (row: AdminRow) => string
  selectionDisabled?: boolean
  children?: ReactNode
}) {
  const [query, setQuery] = useState(''),
    [field, setField] = useState(''),
    [page, setPage] = useState(0)
  const [selected, setSelected] = useState<AdminRow>()
  const filtered = useMemo(() => filterAdminRows(rows, query, field), [rows, query, field])
  const pageSize = 25,
    pageCount = Math.max(1, Math.ceil(filtered.length / pageSize)),
    current = Math.min(page, pageCount - 1)
  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 text-sm">
          Filter {title.toLowerCase()}
          <SearchInput
            aria-label={`Filter ${title.toLowerCase()}`}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setPage(0)
            }}
            onClear={() => {
              setQuery('')
              setPage(0)
            }}
            data-map-search-input="false"
          />
        </label>
        <label className="grid gap-1 text-sm">
          Search field
          <NativeSelect
            className="rounded border bg-background p-2 text-base"
            aria-label={`${title} search field`}
            value={field}
            onChange={(event) => {
              setField(event.target.value)
              setPage(0)
            }}
          >
            <option value="">All source fields</option>
            {columns.map((column) => (
              <option key={column.key} value={column.key}>
                {column.label}
              </option>
            ))}
          </NativeSelect>
        </label>
        {children}
        <Button
          size="sm"
          variant="outline"
          disabled={!filtered.length}
          onClick={() =>
            downloadText(
              csvExport(
                columns.map((column) => column.label),
                filtered.map((row) => columns.map((column) => row[column.key])),
              ),
              `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`,
              'text/csv',
            )
          }
        >
          Export matching rows CSV
        </Button>
      </div>
      <p className="text-sm" role="status">
        {filtered.length} matching of {rows.length} loaded records ·{' '}
        {Math.max(0, Math.min(filtered.length - current * pageSize, pageSize))} rows on this page
      </p>
      {filtered.length ? (
        <div className="max-w-full overflow-x-auto rounded border">
          <table className="w-full text-left text-sm" aria-label={title}>
            <thead className="bg-muted/50">
              <tr>
                {columns.map((column) => (
                  <th key={column.key} scope="col" className="p-2 align-top">
                    {column.label}
                  </th>
                ))}
                <th scope="col" className="p-2">
                  Details
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(current * pageSize, (current + 1) * pageSize).map((row, index) => (
                <tr key={current * pageSize + index} className="border-t">
                  {columns.map((column) => (
                    <td key={column.key} className="max-w-80 break-words p-2 align-top">
                      {adminCell(row[column.key], column.boolean)}
                    </td>
                  ))}
                  <td className="p-2 align-top">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={selectionDisabled}
                      onClick={() => (onSelect ? onSelect(row) : setSelected(row))}
                    >
                      {selectLabel(row)}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <InlineAlert>
          {rows.length ? 'No loaded records match this filter.' : 'The source returned an empty list for this request.'}
        </InlineAlert>
      )}
      {pageCount > 1 && (
        <PaginationControls page={current} pageCount={pageCount} onPageChange={setPage} label={`${title} pages`} />
      )}
      {selected && (
        <section className="space-y-3 rounded border p-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-medium">Selected source record</h4>
            <Button size="sm" variant="outline" onClick={() => setSelected(undefined)}>
              Close record details
            </Button>
          </div>
          <PortalSubmissionReader data={selected} />
        </section>
      )}
    </div>
  )
}

export function AdminReadResource({
  title,
  path,
  params,
  columns,
  description,
  autoLoad = false,
  parse = adminRows,
  onSelect,
  selectLabel,
  selectionDisabled,
}: {
  title: string
  path: string
  params?: Record<string, string>
  columns: AdminColumn[]
  description?: string
  autoLoad?: boolean
  parse?: (input: unknown) => AdminRow[]
  onSelect?: (row: AdminRow) => void
  selectLabel?: (row: AdminRow) => string
  selectionDisabled?: boolean
}) {
  const read = useReadCheck(),
    run = read.run,
    paramsKey = JSON.stringify(params ?? {})
  useEffect(() => {
    if (autoLoad) void run(path, JSON.parse(paramsKey))
  }, [autoLoad, path, paramsKey, run])
  const parsed = useMemo(() => {
    if (read.data === undefined) return undefined
    try {
      return { rows: parse(read.data) }
    } catch (reason) {
      return { error: errorText(reason) }
    }
  }, [read.data, parse])
  return (
    <section className="min-w-0 space-y-3 rounded-lg border p-3">
      <h3 className="font-semibold">{title}</h3>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
      <Button size="sm" variant="outline" disabled={read.loading} onClick={() => void run(path, params)}>
        Load {title.toLowerCase()}
      </Button>
      <CheckState {...read} showData={false} />
      {parsed?.error && <InlineAlert tone="error">{parsed.error}</InlineAlert>}
      {parsed?.rows && (
        <AdminDataTable
          key={read.data === undefined ? 'empty' : paramsKey}
          title={title}
          rows={parsed.rows}
          columns={columns}
          onSelect={onSelect}
          selectLabel={selectLabel}
          selectionDisabled={selectionDisabled}
        />
      )}
      {read.data !== undefined && <AdminOriginal title={title} data={read.data} />}
    </section>
  )
}

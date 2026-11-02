import { useId, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { InlineAlert } from '@/components/ui/map-panels'

export const number = (value: number, digits = 0) =>
  new Intl.NumberFormat('en-CA', { maximumFractionDigits: digits }).format(value)

export function Section({
  title,
  description,
  children,
  actions,
  className = '',
}: {
  title: string
  description?: ReactNode
  children: ReactNode
  actions?: ReactNode
  className?: string
}) {
  const id = useId()
  return (
    <section aria-labelledby={id} className={`min-w-0 rounded-xl border bg-card p-4 sm:p-5 ${className}`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={id} className="font-semibold tracking-tight">
            {title}
          </h2>
          {description && <div className="mt-1 text-xs leading-5 text-muted-foreground">{description}</div>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

export interface TableColumn<T> {
  key: string
  label: string
  unit?: string
  value: (row: T) => ReactNode
  left?: boolean
}

export function ResultTable<T>({
  label,
  rows,
  columns,
}: {
  label: string
  rows: readonly T[]
  columns: readonly TableColumn<T>[]
}) {
  const [page, setPage] = useState(0)
  const pageSize = 50
  const finalPage = Math.max(0, Math.ceil(rows.length / pageSize) - 1)
  const safePage = Math.min(page, finalPage)
  const shown = rows.slice(safePage * pageSize, (safePage + 1) * pageSize)
  return (
    <div className="min-w-0 space-y-2">
      <div className="max-h-[26rem] overflow-auto rounded-md border" tabIndex={0} aria-label={`${label} table`}>
        <EngineeringTable aria-label={label}>
          <thead className="sticky top-0 z-10">
            <tr>
              {columns.map((column) => (
                <ColumnHeader
                  key={column.key}
                  label={column.label}
                  unit={column.unit}
                  className={column.left ? 'text-left' : ''}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, index) => (
              <tr key={safePage * pageSize + index}>
                {columns.map((column) => (
                  <td key={column.key} className={column.left ? 'text-left' : ''}>
                    {column.value(row)}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="py-4 text-center text-muted-foreground">
                  No records for this run.
                </td>
              </tr>
            )}
          </tbody>
        </EngineeringTable>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {rows.length > pageSize
            ? `${number(safePage * pageSize + 1)}–${number(Math.min(rows.length, (safePage + 1) * pageSize))} of `
            : ''}
          {number(rows.length)} records
        </span>
        {rows.length > pageSize && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={safePage === finalPage} onClick={() => setPage(safePage + 1)}>
              Next
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

/** Apply is explicit so a partly typed JSON document never mutates the active scenario. */
export function JsonEditor({
  label,
  value,
  onApply,
  description,
}: {
  label: string
  value: unknown
  onApply: (value: unknown) => void
  description?: ReactNode
}) {
  const id = useId()
  const serialized = JSON.stringify(value, null, 2)
  const [text, setText] = useState(serialized)
  const [error, setError] = useState('')
  const [previousValue, setPreviousValue] = useState(serialized)
  if (previousValue !== serialized) {
    setPreviousValue(serialized)
    setText(serialized)
    setError('')
  }
  return (
    <details className="rounded-lg border p-3">
      <summary className="cursor-pointer text-sm font-medium">{label}</summary>
      <div className="mt-3 space-y-3">
        {description && <p className="text-xs leading-5 text-muted-foreground">{description}</p>}
        <label htmlFor={id} className="sr-only">
          {label} JSON
        </label>
        <textarea
          id={id}
          value={text}
          onChange={(event) => setText(event.target.value)}
          spellCheck={false}
          rows={12}
          className="w-full resize-y rounded-md border bg-background p-3 font-mono text-xs"
        />
        {error && <InlineAlert tone="error">{error}</InlineAlert>}
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            try {
              onApply(JSON.parse(text))
              setError('')
            } catch (cause: unknown) {
              setError(cause instanceof Error ? cause.message : 'This JSON could not be applied.')
            }
          }}
        >
          Apply {label.toLowerCase()}
        </Button>
      </div>
    </details>
  )
}

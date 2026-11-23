import type { Key, ReactNode } from 'react'
import { CopyButton } from '@/components/ui/copy-button'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'

/** A displayed equation may contain context that isn't part of the expression being copied. */
export function CalculationFormula({ expression, copyText = expression }: { expression: string; copyText?: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-md bg-muted px-3 py-2">
      <code className="min-w-0 flex-1 select-text whitespace-pre-wrap break-words text-xs text-foreground">
        {expression}
      </code>
      <CopyButton
        text={copyText}
        title="Copy equation to clipboard"
        failedLabel="Select formula to copy"
        className="shrink-0 rounded border border-input bg-background px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        Copy
      </CopyButton>
    </div>
  )
}

/** Callers supply the domain's row ordering, units and interpretation. An absent reading stays unknown. */
export function CalculationTable<Row>({
  caption,
  rows,
  rowKey,
  columns,
}: {
  caption: string
  rows: readonly Row[]
  rowKey: (row: Row) => Key
  columns: readonly { label: string; render: (row: Row) => ReactNode }[]
}) {
  return (
    <div className="min-w-0 overflow-x-auto">
      <EngineeringTable variant="text" rowHeaders compact>
        <caption className="mb-1 text-left text-xs text-muted-foreground">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <ColumnHeader key={c.label} label={c.label} />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c, i) => {
                const value = c.render(row) ?? 'Unknown'
                return i === 0 ? (
                  <th key={c.label} scope="row">
                    {value}
                  </th>
                ) : (
                  <td key={c.label}>{value}</td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </EngineeringTable>
    </div>
  )
}

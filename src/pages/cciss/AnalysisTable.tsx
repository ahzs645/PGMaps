import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import type { CurrentAnalysisTable } from './currentAnalysisExport'

/**
 * One exported table as the dialog shows it. `textColumns` is how many leading columns hold
 * labels; the columns after them are numbers, right-aligned. A missing value reads "No data".
 */
export function AnalysisTable({ table, textColumns }: { table: CurrentAnalysisTable; textColumns: number }) {
  if (!table.rows.length) return <p className="text-sm">No rows are available for this selection.</p>
  const align = (position: number) => (position < textColumns ? 'text-left' : '')
  return (
    <div className="overflow-x-auto">
      <EngineeringTable className="whitespace-normal text-xs [&_td]:py-2">
        <caption className="sr-only">{table.title}</caption>
        <thead>
          <tr>
            {table.columns.map((column, position) => (
              <ColumnHeader key={column} label={column} className={align(position)} />
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, index) => (
            <tr key={index}>
              {row.map((value, position) => (
                <td key={position} className={align(position)}>
                  {value === null ? 'No data' : value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </EngineeringTable>
    </div>
  )
}

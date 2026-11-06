import type { TableHTMLAttributes, ThHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

interface EngineeringTableProps extends TableHTMLAttributes<HTMLTableElement> {
  /**
   * `numeric` right-aligns tabular numbers on one line. `text` keeps the rules, banding and
   * header but reads left to right and wraps, for rows of text, chips, actions and checkboxes.
   */
  variant?: 'numeric' | 'text'
  /** Style a `<th scope="row">` in the body as the row's left-aligned first cell. */
  rowHeaders?: boolean
}

/**
 * A dense, ruled data table for engineering schedules: right-aligned tabular numbers, a cell
 * rule between columns, banded rows and a tinted `aria-selected` row. Put it inside a scroll
 * container and give the `<thead>` `className="sticky top-0"` when the header should stay.
 */
export function EngineeringTable({
  className,
  variant = 'numeric',
  rowHeaders = false,
  ...props
}: EngineeringTableProps) {
  const text = variant === 'text'
  return (
    <table
      className={cn(
        'w-full border-collapse',
        text ? 'whitespace-normal text-left text-xs' : 'whitespace-nowrap text-right text-[11px] tabular-nums',
        '[&_td]:border-x [&_td]:border-b [&_td]:border-border/60',
        text ? '[&_td]:p-2' : '[&_td]:px-2 [&_td]:py-0.5',
        rowHeaders &&
          '[&_tbody_th]:border-x [&_tbody_th]:border-b [&_tbody_th]:border-border/60 [&_tbody_th]:text-left [&_tbody_th]:font-normal',
        rowHeaders && (text ? '[&_tbody_th]:p-2' : '[&_tbody_th]:px-2 [&_tbody_th]:py-0.5'),
        '[&_tbody_tr:nth-child(even)]:bg-muted/25 [&_tbody_tr:hover]:bg-muted/50',
        '[&_tbody_tr[aria-selected=true]]:bg-rose-500/15 [&_tbody_tr[aria-selected=true]]:font-medium',
        className,
      )}
      {...props}
    />
  )
}

/** Column header with the quantity on the first line and its unit underneath. */
export function ColumnHeader({
  label,
  unit,
  className,
  ...props
}: { label: string; unit?: string } & Omit<ThHTMLAttributes<HTMLTableCellElement>, 'children'>) {
  return (
    <th
      scope="col"
      className={cn('border border-border/70 bg-muted px-2 py-1 align-bottom font-medium leading-tight', className)}
      {...props}
    >
      <span className="block">{label}</span>
      {unit && <span className="block text-[10px] font-normal text-muted-foreground">{unit}</span>}
    </th>
  )
}

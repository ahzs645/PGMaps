import type { TableHTMLAttributes, ThHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/**
 * A dense, ruled data table for engineering schedules: right-aligned tabular numbers, a cell
 * rule between columns, banded rows and a tinted `aria-selected` row. Put it inside a scroll
 * container and give the `<thead>` `className="sticky top-0"` when the header should stay.
 */
export function EngineeringTable({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <table
      className={cn(
        'w-full border-collapse whitespace-nowrap text-right text-[11px] tabular-nums',
        '[&_td]:border-x [&_td]:border-b [&_td]:border-border/60 [&_td]:px-2 [&_td]:py-0.5',
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

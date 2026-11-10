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
  /**
   * For a narrow sidebar: halve the cells' side padding and let row headers wrap, so a few
   * numeric columns fit without scrolling sideways. Numbers still stay on one line. Words wrap
   * whole even inside a container that sets `overflow-wrap: anywhere` (the road sidebar does),
   * which would otherwise shrink a row header to a letter a line.
   */
  compact?: boolean
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
  compact = false,
  ...props
}: EngineeringTableProps) {
  const text = variant === 'text'
  return (
    <table
      className={cn(
        'w-full border-collapse',
        text ? 'whitespace-normal text-left text-xs' : 'whitespace-nowrap text-right text-2xs tabular-nums',
        '[&_td]:border-x [&_td]:border-b [&_td]:border-border/60',
        text ? '[&_td]:p-2' : '[&_td]:px-2 [&_td]:py-0.5',
        rowHeaders &&
          '[&_tbody_th]:border-x [&_tbody_th]:border-b [&_tbody_th]:border-border/60 [&_tbody_th]:text-left [&_tbody_th]:font-normal',
        rowHeaders && (text ? '[&_tbody_th]:p-2' : '[&_tbody_th]:px-2 [&_tbody_th]:py-0.5'),
        compact &&
          '[overflow-wrap:normal] [&_td]:px-1 [&_tbody_th]:px-1 [&_tbody_th]:whitespace-normal [&_thead_th]:px-1',
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
      {unit && <span className="block text-3xs font-normal text-muted-foreground">{unit}</span>}
    </th>
  )
}

/**
 * An editable number inside an `EngineeringTable` cell: borderless and right-aligned like the
 * numbers around it, outlined on hover and focus, with no spinner. Give its `<td>` `!p-0.5` and
 * hide the field's visible label; the column header names it and an `aria-label` names the row.
 */
export const engineeringCellInputClass =
  'w-full min-w-0 rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-right text-base leading-4 tabular-nums text-foreground [appearance:textfield] hover:border-input focus:border-ring focus:bg-background focus:outline-none disabled:opacity-60 md:text-2xs [&::-webkit-inner-spin-button]:appearance-none'

/** Keeps a row's identifying first column in view while the table scrolls sideways. */
export const engineeringPinnedColumnClass = 'sticky left-0 z-[1]'

import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export type InsetBoxOptions = {
  /** `none` for a list whose rows pad themselves (`divide-y`), `sm` for a dense group, `lg` for a form. */
  padding?: 'none' | 'sm' | 'md' | 'lg'
  /**
   * `plain` is the card fill: one step above the page in a sidebar, and one step above the dialog
   * inside a dialog, since a border alone does not set a box apart in the dark theme. `muted`
   * tints the box so it reads apart from its neighbours; `background` sits it on a map or chart.
   */
  tone?: 'plain' | 'muted' | 'background'
  /**
   * Rows highlight under the pointer, for a `padding: 'none'` list a reader acts on: `li` and `div`
   * rows and the header rows of `CollapsibleSection`s directly inside. Leave it off for rows that
   * only read.
   */
  hoverRows?: boolean
}

const paddingClasses: Record<NonNullable<InsetBoxOptions['padding']>, string> = {
  none: '',
  sm: 'p-1.5',
  md: 'p-2',
  lg: 'p-3',
}

const toneClasses: Record<NonNullable<InsetBoxOptions['tone']>, string> = {
  plain: 'bg-card',
  muted: 'bg-muted/20',
  background: 'bg-background',
}

// A wash of the text colour, so the row lightens on a dark fill and darkens on a light one.
const hoverRowClasses =
  '[&>li]:transition-colors [&>li:hover]:bg-foreground/[0.06] [&>div]:transition-colors [&>div:hover]:bg-foreground/[0.06] [&>section>div:first-child]:transition-colors [&>section>div:first-child:hover]:bg-foreground/[0.06]'

/**
 * Classes for a bordered group inside a sidebar section: a fieldset, a details
 * block, a figure, a scrolling list. One radius and a fixed padding scale, so
 * every such box in a tool matches. Add spacing (`space-y-2`) and layout at the
 * call site; for a note or warning use `InlineAlert` instead.
 */
export function insetBox({ padding = 'md', tone = 'plain', hoverRows = false }: InsetBoxOptions = {}) {
  return cn('rounded-md border', paddingClasses[padding], toneClasses[tone], hoverRows && hoverRowClasses)
}

/** `insetBox` on a `div`. Other elements take `className={insetBox(…)}`. */
export function InsetBox({
  padding,
  tone,
  hoverRows,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & InsetBoxOptions) {
  return <div className={cn(insetBox({ padding, tone, hoverRows }), className)} {...props} />
}

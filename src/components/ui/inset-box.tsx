import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export type InsetBoxOptions = {
  /** `none` for a list whose rows pad themselves (`divide-y`), `sm` for a dense group, `lg` for a form. */
  padding?: 'none' | 'sm' | 'md' | 'lg'
  /** `muted` tints the box so it reads apart from its neighbours; `background` sits it on a map or chart. */
  tone?: 'plain' | 'muted' | 'background'
}

const paddingClasses: Record<NonNullable<InsetBoxOptions['padding']>, string> = {
  none: '',
  sm: 'p-1.5',
  md: 'p-2',
  lg: 'p-3',
}

const toneClasses: Record<NonNullable<InsetBoxOptions['tone']>, string> = {
  plain: '',
  muted: 'bg-muted/20',
  background: 'bg-background',
}

/**
 * Classes for a bordered group inside a sidebar section: a fieldset, a details
 * block, a figure, a scrolling list. One radius and a fixed padding scale, so
 * every such box in a tool matches. Add spacing (`space-y-2`) and layout at the
 * call site; for a note or warning use `InlineAlert` instead.
 */
export function insetBox({ padding = 'md', tone = 'plain' }: InsetBoxOptions = {}) {
  return cn('rounded-md border', paddingClasses[padding], toneClasses[tone])
}

/** `insetBox` on a `div`. Other elements take `className={insetBox(…)}`. */
export function InsetBox({ padding, tone, className, ...props }: HTMLAttributes<HTMLDivElement> & InsetBoxOptions) {
  return <div className={cn(insetBox({ padding, tone }), className)} {...props} />
}

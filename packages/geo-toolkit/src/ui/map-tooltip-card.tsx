import type { HTMLAttributes } from 'react'
import { escapeHtml } from './escape-html.js'
import { cn } from '../utils.js'

const TOOLTIP_CARD_CLASS =
  'pointer-events-none max-w-72 break-words rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg'

/** The themed surface inside a chrome-free MapLibre hover popup. */
export function MapTooltipCard({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn(TOOLTIP_CARD_CLASS, className)} {...props} />
}

type MapTooltipContent = {
  title: string
  subtitle?: string
  lines?: readonly string[]
  rows?: ReadonlyArray<readonly [label: string, value: string | number | null | undefined]>
  footer?: string
}

/**
 * String counterpart for layer hoverHtml and imperative MapLibre/deck.gl popups.
 * Supply plain text: every title, label and value is escaped here.
 */
export function mapTooltipHtml({ title, subtitle, lines = [], rows = [], footer }: MapTooltipContent): string {
  const detailRows = rows
    .filter(([, value]) => value != null && value !== '')
    .map(
      ([label, value]) =>
        `<div><span>${escapeHtml(label)}:</span> <span class="font-medium text-popover-foreground">${escapeHtml(value)}</span></div>`,
    )
    .join('')

  return `<div class="${TOOLTIP_CARD_CLASS}">
    <div class="font-semibold leading-5">${escapeHtml(title)}</div>
    ${subtitle ? `<div class="mt-1 text-muted-foreground">${escapeHtml(subtitle)}</div>` : ''}
    ${lines
      .filter(Boolean)
      .map((line) => `<div class="mt-1 text-muted-foreground">${escapeHtml(line)}</div>`)
      .join('')}
    ${detailRows ? `<div class="mt-1 space-y-0.5 text-muted-foreground">${detailRows}</div>` : ''}
    ${footer ? `<div class="mt-2 font-semibold">${escapeHtml(footer)}</div>` : ''}
  </div>`
}

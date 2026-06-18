import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'

type CollapsiblePanelProps = {
  title: string
  icon: ReactNode
  /** Open on first render. Debug/reference panels pass false to reduce clutter. */
  defaultOpen?: boolean
  children: ReactNode
}

/**
 * Card panel whose header toggles its body. Matches the dev workbench card
 * chrome (rounded border + white surface) used across the acknowledgement page,
 * so supporting panels can collapse without changing their content.
 */
export function CollapsiblePanel({ title, icon, defaultOpen = true, children }: CollapsiblePanelProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="rounded-lg border bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-semibold">{title}</span>
        </span>
        <ChevronDown className={cn('h-4 w-4 flex-none text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </section>
  )
}

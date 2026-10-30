import { Link } from 'react-router-dom'
import type { ElementType } from 'react'
import { ArrowRight } from 'lucide-react'

import { cn } from '@/lib/utils'

export type DevSubpage = {
  label: string
  href: string
}

export type DevEntry = {
  title: string
  description: string
  href: string
  icon: ElementType
  color: string
  label: string
  subpages?: DevSubpage[]
}

/** A dev tool card: the whole card opens the page; subpage chips link deeper. Shared by /dev and section hubs like /dev/forestry. */
export function DevCard({ title, description, href, icon: Icon, color, label, subpages }: DevEntry) {
  return (
    <div className="group relative flex h-full flex-col rounded-lg border bg-card p-5 transition-all duration-200 hover:border-primary/50 hover:shadow-lg sm:p-6">
      {/* Stretched link makes the whole card open the main page, while the
          subpage buttons below sit on top (relative z-10) as separate links —
          avoids nesting anchors inside an anchor. */}
      <Link to={href} aria-label={`Open ${title}`} className="absolute inset-0 rounded-lg" />

      <div className="mb-4 flex items-start justify-between gap-3">
        <div className={cn('flex h-11 w-11 items-center justify-center rounded-lg', color)}>
          <Icon className="h-5 w-5 text-white" />
        </div>
        <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">{label}</span>
      </div>

      <h2 className="text-xl font-semibold text-foreground">{title}</h2>
      <p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">{description}</p>

      <div className="mt-5 flex items-center gap-1 text-sm font-medium text-primary transition-all group-hover:gap-2">
        Open dev page
        <ArrowRight className="h-4 w-4" />
      </div>

      {subpages && subpages.length > 0 && (
        <div className="relative z-10 mt-4 border-t pt-4">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Subpages</div>
          <div className="flex flex-wrap gap-2">
            {subpages.map((subpage) => (
              <Link
                key={subpage.href}
                to={subpage.href}
                className="inline-flex items-center gap-1 rounded-md border bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-muted"
              >
                {subpage.label}
                <ArrowRight className="h-3 w-3" />
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

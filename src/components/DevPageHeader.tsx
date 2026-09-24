import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

type DevPageHeaderProps = {
  /** Small label above the title, styled like the Dev library's own badge. */
  eyebrow?: ReactNode
  icon?: LucideIcon
  title: ReactNode
  description?: ReactNode
  /** Links or buttons shown beside the title, wrapping under it on narrow screens. */
  actions?: ReactNode
  className?: string
}

/** Title block for a `/dev/*` page: eyebrow badge, heading, description, actions. */
export function DevPageHeader({ eyebrow, icon: Icon, title, description, actions, className }: DevPageHeaderProps) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-4', className)}>
      <div className="min-w-0 max-w-3xl">
        {eyebrow && (
          <div className="mb-3 inline-flex items-center gap-2 rounded-md border bg-background px-3 py-1 text-sm font-medium text-muted-foreground">
            {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
            {eyebrow}
          </div>
        )}
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{title}</h1>
        {description && (
          <p className="mt-2 text-sm leading-6 text-muted-foreground sm:text-base">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

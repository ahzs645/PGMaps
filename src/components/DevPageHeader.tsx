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
  /** Dense title row for dashboards where the plots need the vertical space. */
  compact?: boolean
  /** Combine the title and all controls in one desktop toolbar; wrap on phones. */
  singleRow?: boolean
  className?: string
}

/** Title block for a `/dev/*` page: eyebrow badge, heading, description, actions. */
export function DevPageHeader({
  eyebrow,
  icon: Icon,
  title,
  description,
  actions,
  compact = false,
  singleRow = false,
  className,
}: DevPageHeaderProps) {
  return (
    <div
      role={singleRow ? 'group' : undefined}
      aria-label={singleRow ? 'Page controls' : undefined}
      className={cn(
        'flex flex-wrap justify-between',
        compact ? 'items-center gap-2' : 'items-start gap-4',
        singleRow && 'lg:flex-nowrap',
        className,
      )}
    >
      <div className={cn('min-w-0 max-w-3xl', singleRow && 'lg:flex-1')}>
        {eyebrow && (
          <div className="mb-3 inline-flex items-center gap-2 rounded-md border bg-background px-3 py-1 text-sm font-medium text-muted-foreground">
            {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
            {eyebrow}
          </div>
        )}
        <h1
          className={cn(
            'font-bold tracking-tight text-foreground',
            compact ? 'text-lg' : 'text-2xl sm:text-3xl',
            singleRow && 'lg:truncate lg:text-sm',
          )}
        >
          {title}
        </h1>
        {description && <p className="mt-2 text-sm leading-6 text-muted-foreground sm:text-base">{description}</p>}
      </div>
      {actions && (
        <div className={cn('flex flex-wrap gap-2', singleRow && 'items-center lg:shrink-0 lg:flex-nowrap')}>
          {actions}
        </div>
      )}
    </div>
  )
}

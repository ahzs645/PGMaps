import type { CSSProperties, ElementType, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * A project sidebar's title block: a coloured icon tile beside the project
 * title and one line of context (region, scene count). The tile colour comes
 * from the project theme (`iconClassName`) or a story accent (`iconStyle`).
 */
export function ProjectHeader({
  title,
  subtitle,
  icon: Icon,
  iconClassName,
  iconStyle,
  className,
}: {
  title: ReactNode
  subtitle?: ReactNode
  icon: ElementType
  iconClassName?: string
  iconStyle?: CSSProperties
  className?: string
}) {
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <div
        className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-white', iconClassName)}
        style={iconStyle}
        aria-hidden="true"
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <h1 className="text-base font-bold leading-tight text-foreground">{title}</h1>
        {subtitle && <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div>}
      </div>
    </div>
  )
}

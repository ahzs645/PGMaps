import type { ButtonHTMLAttributes, ElementType, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type ToggleRowTone =
  | 'sky'
  | 'green'
  | 'emerald'
  | 'lime'
  | 'cyan'
  | 'indigo'
  | 'amber'
  | 'violet'
  | 'orange'
  | 'rose'
  | 'teal'
  | 'primary'

const activeClasses: Record<ToggleRowTone, string> = {
  sky: 'border-sky-500 bg-sky-50 text-sky-800 dark:bg-sky-950/30 dark:text-sky-300',
  green: 'border-green-500 bg-green-50 text-green-800 dark:bg-green-950/30 dark:text-green-400',
  emerald: 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300',
  lime: 'border-lime-500 bg-lime-50 text-lime-800 dark:bg-lime-950/30 dark:text-lime-300',
  indigo: 'border-indigo-500 bg-indigo-50 text-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-300',
  cyan: 'border-cyan-500 bg-cyan-50 text-cyan-800 dark:bg-cyan-950/30 dark:text-cyan-300',
  amber: 'border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300',
  violet: 'border-violet-500 bg-violet-50 text-violet-800 dark:bg-violet-950/30 dark:text-violet-300',
  orange: 'border-orange-500 bg-orange-50 text-orange-800 dark:bg-orange-950/30 dark:text-orange-300',
  rose: 'border-rose-500 bg-rose-50 text-rose-800 dark:bg-rose-950/30 dark:text-rose-300',
  teal: 'border-teal-500 bg-teal-50 text-teal-800 dark:bg-teal-950/30 dark:text-teal-300',
  primary: 'border-primary bg-primary/10 text-foreground',
}

type ToggleRowProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  active: boolean
  label: ReactNode
  description?: ReactNode
  icon?: ElementType
  /** Left marker when an icon does not fit, e.g. a colour dot. */
  leading?: ReactNode
  /** Classes while active, for a colour outside the tone palette. */
  activeClassName?: string
  /** Right-hand content: a count, a colour swatch, an ON/OFF label. */
  trailing?: ReactNode
  tone?: ToggleRowTone
  /** `row` (default) full-width row; `tile` a compact centred button for grids. */
  layout?: 'row' | 'tile'
}

/**
 * An on/off control for a layer or data source, sized for fingers and
 * announced with aria-pressed. The border and fill share one tone, so an
 * active row never mixes colours.
 */
export function ToggleRow({
  active,
  label,
  description,
  icon: Icon,
  leading,
  activeClassName,
  trailing,
  tone = 'sky',
  layout = 'row',
  className,
  type = 'button',
  ...props
}: ToggleRowProps) {
  return (
    <button
      type={type}
      aria-pressed={active}
      className={cn(
        'flex min-w-0 items-center gap-2 rounded-md border text-xs transition-colors disabled:pointer-events-none disabled:opacity-50 touch:min-h-10',
        layout === 'row' ? 'w-full px-3 py-2 text-left' : 'justify-center px-2 py-1.5',
        active ? cn(activeClasses[tone], activeClassName) : 'border-input text-muted-foreground hover:bg-accent hover:text-foreground',
        className,
      )}
      {...props}
    >
      {leading && <span className="flex shrink-0 items-center">{leading}</span>}
      {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}
      <span className={cn('min-w-0', layout === 'row' && 'flex-1')}>
        <span className="block truncate font-medium">{label}</span>
        {description && <span className="block truncate text-[11px] opacity-80">{description}</span>}
      </span>
      {trailing && <span className="shrink-0">{trailing}</span>}
    </button>
  )
}

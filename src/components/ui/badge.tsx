import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'violet' | 'cyan' | 'orange'

const softClasses: Record<BadgeTone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  info: 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200',
  success: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300',
  danger: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300',
  violet: 'bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-300',
  cyan: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/50 dark:text-cyan-200',
  orange: 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300',
}

const solidClasses: Record<BadgeTone, string> = {
  neutral: 'bg-gray-500 text-white',
  info: 'bg-sky-600 text-white',
  success: 'bg-green-600 text-white',
  warning: 'bg-amber-400 text-amber-950',
  danger: 'bg-red-600 text-white',
  violet: 'bg-violet-600 text-white',
  cyan: 'bg-cyan-600 text-white',
  orange: 'bg-orange-500 text-white',
}

const outlineClasses: Record<BadgeTone, string> = {
  neutral: 'border-border text-muted-foreground',
  info: 'border-sky-300 text-sky-700 dark:border-sky-800 dark:text-sky-300',
  success: 'border-green-300 text-green-700 dark:border-green-800 dark:text-green-300',
  warning: 'border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300',
  danger: 'border-red-300 text-red-700 dark:border-red-800 dark:text-red-300',
  violet: 'border-violet-300 text-violet-700 dark:border-violet-800 dark:text-violet-300',
  cyan: 'border-cyan-300 text-cyan-700 dark:border-cyan-800 dark:text-cyan-300',
  orange: 'border-orange-300 text-orange-700 dark:border-orange-800 dark:text-orange-300',
}

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone
  /** `soft` (default) tinted fill, `solid` for alarms, `outline` for quiet tags. */
  variant?: 'soft' | 'solid' | 'outline'
  size?: 'xs' | 'sm'
  /** Pill instead of the default small radius; use for counts. */
  pill?: boolean
}

/** Tags, statuses and counts. Colour carries meaning, so pick the tone for what it says. */
export function Badge({ tone = 'neutral', variant = 'soft', size = 'xs', pill = false, className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-medium',
        size === 'xs' ? 'px-1.5 py-0.5 text-[11px] leading-4' : 'px-2 py-0.5 text-xs',
        pill ? 'rounded-full' : 'rounded',
        variant === 'soft' && softClasses[tone],
        variant === 'solid' && solidClasses[tone],
        variant === 'outline' && cn('border', outlineClasses[tone]),
        className,
      )}
      {...props}
    />
  )
}

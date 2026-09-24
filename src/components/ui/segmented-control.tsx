import type { ElementType } from 'react'
import { cn } from '@/lib/utils'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  icon?: ElementType
  /** Hide the text label and show only the icon (the label becomes the accessible name). */
  iconOnly?: boolean
  /** Classes for this option while selected, e.g. a mode's own colour. */
  activeClassName?: string
  disabled?: boolean
  title?: string
}

interface SegmentedControlProps<T extends string> {
  value: T
  options: readonly SegmentedOption<T>[]
  onChange: (value: T) => void
  /** Accessible name for the group, e.g. "Map colours". */
  label: string
  size?: 'sm' | 'md'
  /**
   * `subtle` (default): raised light chip on a grey track.
   * `solid`: filled primary chip, for toolbars that need a stronger signal.
   */
  variant?: 'subtle' | 'solid'
  /** Stretch options to fill the width (default) or size them to their labels. */
  fullWidth?: boolean
  className?: string
}

/**
 * Pick one of a few mutually exclusive views. Buttons with aria-pressed rather
 * than a radio group, matching the other toggles in the map sidebars.
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
  size = 'md',
  variant = 'subtle',
  fullWidth = true,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'rounded-lg bg-secondary',
        fullWidth ? 'flex' : 'inline-flex',
        size === 'md' ? 'p-1' : 'p-0.5',
        className,
      )}
    >
      {options.map((option) => {
        const selected = value === option.value
        const Icon = option.icon
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            aria-label={option.iconOnly ? option.label : undefined}
            title={option.title ?? (option.iconOnly ? option.label : undefined)}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 touch:min-h-10',
              fullWidth && 'flex-1',
              size === 'md' ? 'rounded-md px-3 py-2 text-xs' : 'rounded px-2 py-1 text-xs',
              selected
                ? cn(
                    variant === 'solid'
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : // A raised light chip in both themes: bg-background alone is
                        // darker than the track in dark mode and reads as pressed-in.
                        'bg-background text-foreground shadow-sm dark:bg-white/15',
                    option.activeClassName,
                  )
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
            {!option.iconOnly && option.label}
          </button>
        )
      })}
    </div>
  )
}

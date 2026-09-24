import { useRef, type ButtonHTMLAttributes, type ElementType, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface TabOption<T extends string> {
  value: T
  label: string
  icon?: ElementType
  /** Count or status shown after the label. */
  badge?: ReactNode
  disabled?: boolean
}

interface TabBarProps<T extends string> {
  value: T
  options: readonly TabOption<T>[]
  onChange: (value: T) => void
  /** Accessible name for the tab list. */
  label: string
  /**
   * `pill`: filled chip on a grey track (dialogs, settings).
   * `underline`: text tabs with an underline (panels with lots of content).
   */
  variant?: 'pill' | 'underline'
  /** `responsive`: a row on phones, a column from md up (settings sidebars). */
  orientation?: 'horizontal' | 'responsive'
  /** Prefix for tab/panel ids; panels use `${idPrefix}-panel-${value}`. */
  idPrefix?: string
  /** Classes for the selected tab, e.g. a section's accent colour. */
  activeClassName?: string
  /** Extra attributes per tab, e.g. `data-*` hooks tests click. */
  getTabProps?: (option: TabOption<T>) => ButtonHTMLAttributes<HTMLButtonElement> & Record<`data-${string}`, string | undefined>
  className?: string
}

/**
 * Tabs that switch a panel's content, with tablist semantics and arrow-key
 * movement. Use `SegmentedControl` instead when the options change a view
 * setting rather than which panel is showing.
 */
export function TabBar<T extends string>({
  value,
  options,
  onChange,
  label,
  variant = 'pill',
  orientation = 'horizontal',
  idPrefix,
  activeClassName,
  getTabProps,
  className,
}: TabBarProps<T>) {
  const listRef = useRef<HTMLDivElement>(null)
  const enabled = options.filter((option) => !option.disabled)

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']
    if (!keys.includes(event.key) || enabled.length === 0) return
    event.preventDefault()
    const index = enabled.findIndex((option) => option.value === value)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? enabled.length - 1
          : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
            ? (index - 1 + enabled.length) % enabled.length
            : (index + 1) % enabled.length
    onChange(enabled[next].value)
    requestAnimationFrame(() =>
      listRef.current?.querySelector<HTMLElement>(`[data-tab-value="${CSS.escape(enabled[next].value)}"]`)?.focus(),
    )
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      aria-orientation={orientation === 'responsive' ? undefined : 'horizontal'}
      onKeyDown={onKeyDown}
      className={cn(
        'flex gap-1 overflow-x-auto',
        orientation === 'responsive' && 'md:flex-col md:overflow-visible',
        variant === 'pill' ? 'rounded-lg bg-secondary p-1' : 'border-b border-border',
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value
        const Icon = option.icon
        return (
          <button
            {...getTabProps?.(option)}
            key={option.value}
            type="button"
            role="tab"
            id={idPrefix ? `${idPrefix}-tab-${option.value}` : undefined}
            aria-controls={idPrefix ? `${idPrefix}-panel-${option.value}` : undefined}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={option.disabled}
            data-tab-value={option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 touch:min-h-10',
              orientation === 'responsive' && 'md:justify-start',
              variant === 'pill'
                ? cn(
                    'rounded-md px-3 py-1.5',
                    selected
                      ? 'bg-background text-foreground shadow-sm dark:bg-white/15'
                      : 'text-muted-foreground hover:text-foreground',
                  )
                : cn(
                    '-mb-px border-b-2 px-3 py-2',
                    selected
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  ),
              selected && activeClassName,
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
            {option.label}
            {option.badge != null && (
              <span className="rounded-full bg-muted px-1.5 text-[10px] leading-4 text-muted-foreground">{option.badge}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

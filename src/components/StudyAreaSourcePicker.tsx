import { useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, ChevronDown, Search } from 'lucide-react'
import type { StudyAreaLevelOption, StudyAreaSourceOption } from '@/lib/studyArea'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'

/**
 * Shared "unified boundaries selector" used by every study-area surface
 * (boundary explorer, Index Lab, and any map sidebar that opts in).
 *
 * The rows are source-first: each boundary source is one card that carries its
 * own hierarchy, so the level never has to be hunted down in a separate control.
 * `selectionMode` is the only behavioural fork — the explorer stacks several
 * sources at once, while a scoring surface can only aggregate against one.
 */

export function StudyAreaPickerSearch({
  value,
  onChange,
  className,
  placeholder = 'Search sources, categories, levels',
}: {
  value: string
  onChange: (value: string) => void
  className?: string
  placeholder?: string
}) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-500"
      />
    </div>
  )
}

export interface StudyAreaPickerRowsProps<TSource extends string, TLevel extends string> {
  pickerQuery: string
  sourceOptions: Array<StudyAreaSourceOption<TSource>>
  levelOptionsForSource: (source: TSource) => Array<StudyAreaLevelOption<TLevel>>
  activeSources: TSource[]
  sourceLevels: Partial<Record<TSource, TLevel>>
  onToggleSource: (source: TSource) => void
  onSelectLevel: (source: TSource, level: TLevel) => void
  /** Layer swatch shown next to the label; omitted when the surface renders one source at a time. */
  sourceColor?: (source: TSource) => string | undefined
  /** Extra data-* attribute stamped on each source button so e2e specs can target it. */
  sourceDataAttribute?: string
}

export function StudyAreaPickerRows<TSource extends string, TLevel extends string>({
  pickerQuery,
  sourceOptions,
  levelOptionsForSource,
  activeSources,
  sourceLevels,
  onToggleSource,
  onSelectLevel,
  sourceColor,
  sourceDataAttribute,
}: StudyAreaPickerRowsProps<TSource, TLevel>) {
  // The active source starts expanded so its hierarchy is visible without a hunt.
  const [expandedSource, setExpandedSource] = useState<TSource | null>(() => activeSources[0] ?? null)

  const filteredGroups = useMemo(() => {
    const normalized = pickerQuery.trim().toLowerCase()
    const groupOrder = Array.from(new Set(sourceOptions.map((option) => option.group ?? 'Other')))
    return groupOrder
      .map((group) => ({
        group,
        options: sourceOptions.filter((option) => {
          if ((option.group ?? 'Other') !== group) return false
          if (!normalized) return true
          const levelLabels = levelOptionsForSource(option.value).map((level) => level.label)
          return [option.label, option.description, group, ...levelLabels]
            .join(' ')
            .toLowerCase()
            .includes(normalized)
        }),
      }))
      .filter(({ options }) => options.length > 0)
  }, [levelOptionsForSource, pickerQuery, sourceOptions])

  if (filteredGroups.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-muted/20 p-4 text-center text-xs text-muted-foreground">
        No sources match "{pickerQuery}".
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {filteredGroups.map(({ group, options }) => (
        <div key={group} className="space-y-1.5">
          <div className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">{group}</div>
          {options.map((option) => {
            const active = activeSources.includes(option.value)
            const levelOptions = levelOptionsForSource(option.value)
            const levelCount = levelOptions.length
            const hasLevels = levelCount > 1
            const expanded = expandedSource === option.value
            const selectedLevel = sourceLevels[option.value] ?? levelOptions[0]?.value
            const selectedLevelLabel = levelOptions.find((level) => level.value === selectedLevel)?.label
            const swatch = sourceColor?.(option.value)
            const indentClass = swatch ? 'pl-[1.125rem]' : ''
            return (
              <div key={option.value} className="space-y-1.5">
                <div className="flex items-stretch gap-1.5">
                  <button
                    type="button"
                    {...(sourceDataAttribute ? { [sourceDataAttribute]: option.value } : {})}
                    onClick={() => {
                      if (option.disabled) return
                      onToggleSource(option.value)
                    }}
                    aria-pressed={active}
                    disabled={option.disabled}
                    title={option.disabled ? option.disabledReason : undefined}
                    className={cn(
                      'min-w-0 flex-1 rounded-md border px-3 py-2 text-left transition-colors',
                      active
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-input bg-background text-muted-foreground hover:text-foreground',
                      option.disabled && 'cursor-not-allowed opacity-50 hover:text-muted-foreground',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {swatch && (
                        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: swatch }} />
                      )}
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">{option.label}</span>
                      <span className="shrink-0 rounded border bg-background px-1.5 py-0.5 text-xs text-muted-foreground">
                        {levelCount} level{levelCount === 1 ? '' : 's'}
                      </span>
                      {active && <Check className="size-3.5 shrink-0 text-primary" />}
                    </div>
                    <div className={cn('mt-0.5 text-xs leading-4 text-muted-foreground', indentClass)}>
                      {option.disabled ? option.disabledReason ?? option.description : option.description}
                    </div>
                    {active && hasLevels && selectedLevelLabel && (
                      <div className={cn('mt-0.5 text-xs font-medium leading-4 text-primary', indentClass)}>
                        {selectedLevelLabel}
                      </div>
                    )}
                  </button>
                  {hasLevels && !option.disabled && (
                    <button
                      type="button"
                      onClick={() => setExpandedSource((current) => (current === option.value ? null : option.value))}
                      aria-expanded={expanded}
                      aria-label={`Choose a level for ${option.label}`}
                      title="Choose a level"
                      className={cn(
                        'flex w-9 shrink-0 items-center justify-center rounded-md border transition-colors',
                        expanded
                          ? 'border-primary bg-primary/10 text-foreground'
                          : 'border-input bg-background text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <ChevronDown className={cn('size-4 transition-transform', expanded && 'rotate-180')} />
                    </button>
                  )}
                </div>
                {hasLevels && expanded && !option.disabled && (
                  <div className="grid gap-1 rounded-md border bg-muted/20 p-1.5">
                    {levelOptions.map((level, levelIndex) => {
                      // In single-select a level row doubles as "switch to this source at this
                      // level", so it highlights only once that source is the active one.
                      const levelActive = active && selectedLevel === level.value
                      return (
                        <button
                          key={level.value}
                          type="button"
                          onClick={() => onSelectLevel(option.value, level.value)}
                          aria-pressed={levelActive}
                          className={cn(
                            'flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors',
                            levelActive
                              ? 'border-primary bg-primary/10 text-foreground'
                              : 'border-border bg-background text-muted-foreground hover:text-foreground',
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate font-medium">{level.label}</span>
                          {levelIndex === 0 && (
                            <span className="shrink-0 rounded border bg-background px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wide text-muted-foreground">
                              Top
                            </span>
                          )}
                          {levelActive && <Check className="size-3.5 shrink-0 text-primary" />}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

type PickerShellProps<TSource extends string, TLevel extends string> = Omit<
  StudyAreaPickerRowsProps<TSource, TLevel>,
  'pickerQuery'
> & {
  title?: string
  description?: string
  searchPlaceholder?: string
  /** `single` surfaces aggregate against one study area, so the footer drops the active count. */
  selectionMode?: 'single' | 'multi'
}

export function StudyAreaSourcePickerDialog<TSource extends string, TLevel extends string>({
  open,
  onOpenChange,
  autoFocusSearch = true,
  title,
  description,
  searchPlaceholder,
  selectionMode = 'multi',
  ...rowProps
}: PickerShellProps<TSource, TLevel> & {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Focus the search field when the dialog opens. Disable on mobile to avoid opening the keyboard. */
  autoFocusSearch?: boolean
}) {
  const [pickerQuery, setPickerQuery] = useState('')
  const titleRef = useRef<HTMLHeadingElement>(null)
  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen)
    if (!nextOpen) setPickerQuery('')
  }
  const multi = selectionMode === 'multi'
  const resolvedTitle = title ?? (multi ? 'Add study areas' : 'Choose a study area')
  const resolvedDescription =
    description ??
    (multi
      ? 'Tap a source to add its top-level boundary. Use the chevron to pick a finer level in the hierarchy.'
      : 'Tap a source to switch the study area. Use the chevron to pick a level in its hierarchy.')

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        variant="sheet"
        elevated
        className="sm:max-w-md"
        onOpenAutoFocus={(event) => {
          if (autoFocusSearch) return
          event.preventDefault()
          titleRef.current?.focus({ preventScroll: true })
        }}
      >
        <div className="border-b border-border p-4 pb-3 pr-10">
          <DialogTitle
            ref={titleRef}
            tabIndex={autoFocusSearch ? undefined : -1}
            className="text-base font-semibold text-foreground focus:outline-none"
          >
            {resolvedTitle}
          </DialogTitle>
          <DialogDescription className="mt-0.5 text-xs leading-4 text-muted-foreground">
            {resolvedDescription}
          </DialogDescription>
          <StudyAreaPickerSearch
            value={pickerQuery}
            onChange={setPickerQuery}
            className="mt-3"
            placeholder={searchPlaceholder}
          />
        </div>

        <div
          data-testid="study-area-picker-scroll"
          className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable] p-3"
        >
          <StudyAreaPickerRows {...rowProps} pickerQuery={pickerQuery} />
        </div>

        <div className="border-t border-border p-3">
          <button
            type="button"
            onClick={() => handleOpenChange(false)}
            className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Done{multi && rowProps.activeSources.length > 0 ? ` · ${rowProps.activeSources.length} active` : ''}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function StudyAreaSourcePickerPanel<TSource extends string, TLevel extends string>({
  onClose,
  title,
  description,
  searchPlaceholder,
  selectionMode = 'multi',
  ...rowProps
}: PickerShellProps<TSource, TLevel> & { onClose: () => void }) {
  const [pickerQuery, setPickerQuery] = useState('')
  const multi = selectionMode === 'multi'

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col bg-background md:border-r">
      <div className="border-b border-border p-4 pb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            aria-label="Back to study areas"
            title="Back"
            className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </button>
          <h2 className="text-sm font-semibold text-foreground">{title ?? 'Add study areas'}</h2>
        </div>
        <p className="mt-2 text-xs leading-4 text-muted-foreground">
          {description ??
            'Click a source to add its top-level boundary. Use the chevron to pick a finer level in the hierarchy.'}
        </p>
        <StudyAreaPickerSearch
          value={pickerQuery}
          onChange={setPickerQuery}
          className="mt-3"
          placeholder={searchPlaceholder}
        />
      </div>

      <div
        data-testid="study-area-picker-scroll"
        className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable] p-3"
      >
        <StudyAreaPickerRows {...rowProps} pickerQuery={pickerQuery} />
      </div>

      <div className="border-t border-border p-3">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Done{multi && rowProps.activeSources.length > 0 ? ` · ${rowProps.activeSources.length} active` : ''}
        </button>
      </div>
    </div>
  )
}

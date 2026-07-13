import { useState, type ReactNode } from 'react'
import { Check, Plus, X } from 'lucide-react'
import type { StudyAreaLevelOption, StudyAreaSourceOption } from '@/lib/studyArea'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { AppSelect } from '@/components/ui/select'

interface StudyAreaSelectorProps<TSource extends string = string, TLevel extends string = string> {
  source?: TSource
  sourceOptions?: Array<StudyAreaSourceOption<TSource>>
  level: TLevel
  levelOptions: Array<StudyAreaLevelOption<TLevel>>
  onSourceChange?: (source: TSource) => void
  onSelectedSourceClick?: () => void
  onLevelChange: (level: TLevel) => void
  showPoints?: boolean
  onTogglePoints?: () => void
  toggleOnLabel?: string
  toggleOffLabel?: string
  extraLevelControls?: ReactNode
  title?: string
  levelLabel?: string
  sectionClassName?: string
  levelSelectId?: string
  dataPrefix?: string
}

export function StudyAreaSelector<TSource extends string = string, TLevel extends string = string>({
  source,
  sourceOptions,
  level,
  levelOptions,
  onSourceChange,
  onSelectedSourceClick,
  onLevelChange,
  showPoints,
  onTogglePoints,
  toggleOnLabel = 'Hide points',
  toggleOffLabel = 'Show points',
  extraLevelControls,
  title = 'Study areas',
  levelLabel = 'Boundary level',
  sectionClassName,
  levelSelectId = 'study-area-level',
  dataPrefix = 'study-area'
}: StudyAreaSelectorProps<TSource, TLevel>) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const showLevelSelect = levelOptions.length > 1
  const hasAuxiliaryControls = Boolean(extraLevelControls) || (onTogglePoints && typeof showPoints === 'boolean')
  const hasSourceList = Boolean(sourceOptions && sourceOptions.length > 0)
  const selectedSource = sourceOptions?.find((option) => option.value === source)
  const selectedLevel = levelOptions.find((option) => option.value === level)
  const sourceGroups = sourceOptions?.reduce<Array<{ label: string | null; options: Array<StudyAreaSourceOption<TSource>> }>>(
    (groups, option) => {
      const label = option.group ?? null
      const group = groups.find((item) => item.label === label)
      if (group) {
        group.options.push(option)
      } else {
        groups.push({ label, options: [option] })
      }
      return groups
    },
    [],
  ) ?? []
  const categoryCount = new Set(sourceOptions?.map((option) => option.group).filter(Boolean)).size
  const sourceSummary = categoryCount > 0
    ? `${sourceOptions?.length ?? 0} boundary sources across ${categoryCount} ${categoryCount === 1 ? 'category' : 'categories'}.`
    : `${sourceOptions?.length ?? 0} boundary ${sourceOptions?.length === 1 ? 'source' : 'sources'} available.`

  return (
    <>
      <section
        className={cn('border-b border-border bg-background/95 p-4', sectionClassName)}
        data-score-builder-section={dataPrefix === 'score-builder' ? 'setup' : undefined}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
          </div>
          {hasSourceList && (
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                aria-haspopup="dialog"
                className="inline-flex h-7 items-center gap-1 rounded-md border bg-background px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <Plus className="size-3.5" />
                Add
              </button>
            </div>
          )}
        </div>

        {hasSourceList && !source && (
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="w-full rounded-md border border-dashed bg-muted/20 p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/40"
          >
            <div className="flex items-center gap-2 text-xs font-medium text-foreground">
              <Plus className="size-3.5 text-muted-foreground" />
              Choose study areas
            </div>
            <div className="mt-1 text-xs leading-4 text-muted-foreground">{sourceSummary}</div>
          </button>
        )}

        {hasSourceList && source && (
          <div className="rounded-md border bg-background p-3">
            <div className="flex items-start gap-2">
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                data-score-builder-boundary-source={dataPrefix === 'score-builder' ? source : undefined}
                className="min-w-0 flex-1 text-left"
                aria-label={`Change ${selectedSource?.label ?? source}`}
              >
                <div className="truncate text-xs font-medium text-foreground">{selectedSource?.label ?? source}</div>
                <div className="mt-0.5 line-clamp-2 text-xs leading-4 text-muted-foreground">
                  {selectedSource?.description ?? selectedLevel?.label ?? level}
                </div>
              </button>
              {onSelectedSourceClick && (
                <button
                  type="button"
                  onClick={onSelectedSourceClick}
                  aria-label={`Remove ${selectedSource?.label ?? source}`}
                  title="Remove study area"
                  className="flex size-6 shrink-0 items-center justify-center rounded border bg-background text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>

            {(showLevelSelect || hasAuxiliaryControls) && (
              <div className="mt-3 border-t border-border pt-3">
                {showLevelSelect && (
                  <label htmlFor={levelSelectId} className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    {levelLabel}
                  </label>
                )}
                {showLevelSelect && (
                  <AppSelect
                    id={levelSelectId}
                    data-score-builder-level-select={dataPrefix === 'score-builder' ? 'true' : undefined}
                    value={level}
                    onValueChange={(value) => onLevelChange(value as TLevel)}
                    options={levelOptions}
                    className="w-full"
                    triggerClassName="h-10 rounded-lg text-sm focus:ring-2 focus:ring-cyan-500"
                  />
                )}
                {hasAuxiliaryControls && (
                  <div className={cn('flex items-center justify-end gap-1.5', showLevelSelect && 'mt-2')}>
                    {onTogglePoints && typeof showPoints === 'boolean' && (
                      <button
                        type="button"
                        onClick={onTogglePoints}
                        className={cn(
                          'rounded border px-2 py-1 text-xs transition-colors',
                          showPoints
                            ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                            : 'border-input text-muted-foreground hover:text-foreground'
                        )}
                      >
                        {showPoints ? toggleOnLabel : toggleOffLabel}
                      </button>
                    )}
                    {extraLevelControls}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {!hasSourceList && (
          <div className="rounded-md border bg-background p-3">
            <label htmlFor={levelSelectId} className="mb-1.5 block text-xs font-medium text-muted-foreground">
              {levelLabel}
            </label>
            {showLevelSelect ? (
              <AppSelect
                id={levelSelectId}
                value={level}
                onValueChange={(value) => onLevelChange(value as TLevel)}
                options={levelOptions}
                className="w-full"
                triggerClassName="h-10 rounded-lg text-sm focus:ring-2 focus:ring-cyan-500"
              />
            ) : (
              <div className="text-xs font-medium text-foreground">{selectedLevel?.label ?? level}</div>
            )}
            {hasAuxiliaryControls && (
              <div className="mt-2 flex items-center justify-end gap-1.5">
                {onTogglePoints && typeof showPoints === 'boolean' && (
                  <button
                    type="button"
                    onClick={onTogglePoints}
                    className={cn(
                      'rounded border px-2 py-1 text-xs transition-colors',
                      showPoints
                        ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                        : 'border-input text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {showPoints ? toggleOnLabel : toggleOffLabel}
                  </button>
                )}
                {extraLevelControls}
              </div>
            )}
          </div>
        )}
      </section>

      {hasSourceList && (
        <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
          <DialogContent variant="sheet" elevated className="sm:max-w-md">
            <div className="border-b border-border p-4 pb-3 pr-10">
              <DialogTitle className="text-base font-semibold text-foreground">Choose a study area</DialogTitle>
              <DialogDescription className="mt-0.5 text-xs leading-4 text-muted-foreground">
                Select a boundary source. You can choose its boundary level after adding it.
              </DialogDescription>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <div className="space-y-4">
                {sourceGroups.map((group, index) => (
                  <div key={group.label ?? `ungrouped-${index}`}>
                    {group.label && (
                      <div className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">
                        {group.label}
                      </div>
                    )}
                    <div className="space-y-1.5">
                      {group.options.map((option) => {
                        const selected = source === option.value
                        return (
                          <button
                            key={option.value}
                            type="button"
                            data-score-builder-boundary-source={dataPrefix === 'score-builder' ? option.value : undefined}
                            disabled={option.disabled}
                            title={option.disabled ? option.disabledReason : undefined}
                            onClick={() => {
                              if (option.disabled) return
                              onSourceChange?.(option.value)
                              setPickerOpen(false)
                            }}
                            className={cn(
                              'w-full rounded-md border px-3 py-2 text-left transition-colors',
                              selected
                                ? 'border-cyan-500/70 bg-cyan-50 text-cyan-900 dark:bg-cyan-950/35 dark:text-cyan-100'
                                : 'border-input bg-background text-muted-foreground hover:text-foreground',
                              option.disabled && 'cursor-not-allowed opacity-50 hover:text-muted-foreground'
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <span className="min-w-0 flex-1 text-xs font-medium">{option.label}</span>
                              {selected && <Check className="size-3.5 shrink-0 text-cyan-600 dark:text-cyan-400" />}
                            </div>
                            <div className="mt-0.5 text-xs leading-4 text-muted-foreground">{option.description}</div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-border p-3">
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Done
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

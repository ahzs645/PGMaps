import type { ReactNode } from 'react'
import type { StudyAreaLevelOption, StudyAreaSourceOption } from '@/lib/studyArea'
import { cn } from '@/lib/utils'
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
  title = 'Study area',
  levelLabel = 'Boundary level',
  sectionClassName,
  levelSelectId = 'study-area-level',
  dataPrefix = 'study-area'
}: StudyAreaSelectorProps<TSource, TLevel>) {
  const showLevelSelect = levelOptions.length > 1
  const hasAuxiliaryControls = Boolean(extraLevelControls) || (onTogglePoints && typeof showPoints === 'boolean')
  const hasSourceList = Boolean(sourceOptions && sourceOptions.length > 0)
  const showInlineLevelLabel = hasSourceList && showLevelSelect
  const showInlineRow = showInlineLevelLabel || hasAuxiliaryControls
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
  const showSourceGroupLabels = sourceGroups.some((group) => group.label)
  const renderSourceButton = (option: StudyAreaSourceOption<TSource>) => {
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
          if (selected && onSelectedSourceClick) {
            onSelectedSourceClick()
            return
          }
          onSourceChange?.(option.value)
        }}
        className={cn(
          'w-full rounded-md border px-3 py-2 text-left transition-colors',
          selected
            ? 'border-cyan-500/70 bg-cyan-50 text-cyan-900 dark:bg-cyan-950/35 dark:text-cyan-100'
            : 'border-input bg-background text-muted-foreground hover:text-foreground',
          option.disabled && 'cursor-not-allowed opacity-50 hover:text-muted-foreground'
        )}
      >
        <div className="text-xs font-medium">{option.label}</div>
        <div className="text-[10px] text-muted-foreground">{option.description}</div>
      </button>
    )
  }

  return (
    <section
      className={cn('border-b border-border p-4', sectionClassName)}
      data-score-builder-section={dataPrefix === 'score-builder' ? 'setup' : undefined}
    >
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {hasSourceList ? title : levelLabel}
      </h3>
      {hasSourceList && sourceOptions && (
        <div className="space-y-2">
          {sourceGroups.map((group, index) => (
            <div key={group.label ?? `ungrouped-${index}`} className="space-y-1.5">
              {showSourceGroupLabels && group.label && (
                <div className="px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
                  {group.label}
                </div>
              )}
              {group.options.map(renderSourceButton)}
            </div>
          ))}
        </div>
      )}
      {showInlineRow && (
        <div className={cn('flex items-center justify-between gap-2', hasSourceList && 'mt-3')}>
          {showInlineLevelLabel ? (
            <label htmlFor={levelSelectId} className="text-[11px] font-medium text-muted-foreground">
              {levelLabel}
            </label>
          ) : (
            <div />
          )}
          <div className="flex shrink-0 items-center gap-1.5">
            {onTogglePoints && typeof showPoints === 'boolean' && (
              <button
                type="button"
                onClick={onTogglePoints}
                className={cn(
                  'rounded border px-2 py-1 text-[11px] transition-colors',
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
        </div>
      )}
      {showLevelSelect && (
        <AppSelect
          id={levelSelectId}
          data-score-builder-level-select={dataPrefix === 'score-builder' ? 'true' : undefined}
          value={level}
          onValueChange={(value) => onLevelChange(value as TLevel)}
          options={levelOptions}
          className="mt-2 w-full"
          triggerClassName="h-10 rounded-lg text-sm focus:ring-2 focus:ring-cyan-500"
        />
      )}
    </section>
  )
}

import { cn } from '@/lib/utils'
import { AppSelect } from '@/components/ui/select'

export interface StudyAreaSourceOption<TSource extends string = string> {
  value: TSource
  label: string
  description: string
  disabled?: boolean
}

export interface StudyAreaLevelOption<TLevel extends string = string> {
  value: TLevel
  label: string
}

interface StudyAreaSelectorProps<TSource extends string = string, TLevel extends string = string> {
  source: TSource
  sourceOptions: Array<StudyAreaSourceOption<TSource>>
  level: TLevel
  levelOptions: Array<StudyAreaLevelOption<TLevel>>
  onSourceChange: (source: TSource) => void
  onLevelChange: (level: TLevel) => void
  showPoints?: boolean
  onTogglePoints?: () => void
  toggleOnLabel?: string
  toggleOffLabel?: string
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
  onLevelChange,
  showPoints,
  onTogglePoints,
  toggleOnLabel = 'Hide points',
  toggleOffLabel = 'Show points',
  title = 'Study area',
  levelLabel = 'Boundary level',
  sectionClassName,
  levelSelectId = 'study-area-level',
  dataPrefix = 'study-area'
}: StudyAreaSelectorProps<TSource, TLevel>) {
  return (
    <section
      className={cn('border-b border-border p-4', sectionClassName)}
      data-score-builder-section={dataPrefix === 'score-builder' ? 'setup' : undefined}
    >
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <div className="space-y-1.5">
        {sourceOptions.map((option) => {
          const selected = source === option.value
          return (
            <button
              key={option.value}
              type="button"
              data-score-builder-boundary-source={dataPrefix === 'score-builder' ? option.value : undefined}
              disabled={option.disabled}
              onClick={() => {
                if (!option.disabled) onSourceChange(option.value)
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
        })}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <label htmlFor={levelSelectId} className="text-[11px] font-medium text-muted-foreground">
          {levelLabel}
        </label>
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
      </div>
      <AppSelect
        id={levelSelectId}
        data-score-builder-level-select={dataPrefix === 'score-builder' ? 'true' : undefined}
        value={level}
        onValueChange={(value) => onLevelChange(value as TLevel)}
        options={levelOptions}
        className="mt-2 w-full"
        triggerClassName="h-10 rounded-lg text-sm focus:ring-2 focus:ring-cyan-500"
      />
    </section>
  )
}

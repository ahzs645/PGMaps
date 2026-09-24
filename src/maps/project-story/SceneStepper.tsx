import type { ButtonHTMLAttributes } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/** One previous/next scene arrow. Callers size and shape it; the label and icon stay fixed. */
export function SceneStepButton({
  direction,
  className,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> & { direction: -1 | 1 }) {
  const Icon = direction < 0 ? ChevronLeft : ChevronRight
  return (
    <button
      type="button"
      aria-label={direction < 0 ? 'Previous scene' : 'Next scene'}
      className={cn(
        'flex shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40',
        className,
      )}
      {...props}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  )
}

/**
 * Previous / position / next, the keyboard and pointer alternative to
 * scrolling through a story. `progress` adds a bar in the story accent
 * (narrative sidebar); `compact` is the small pill over the scrolly map.
 */
export function SceneStepper({
  activeIndex,
  count,
  onStep,
  accent,
  variant,
  className,
}: {
  activeIndex: number
  count: number
  onStep: (direction: number) => void
  /** Progress bar colour for the `progress` variant. */
  accent?: string
  variant: 'progress' | 'compact'
  className?: string
}) {
  const progress = count > 0 ? ((activeIndex + 1) / count) * 100 : 0
  const buttonClassName =
    variant === 'progress' ? 'size-7 rounded-full border border-border touch:size-10' : 'size-6 rounded touch:size-10'

  return (
    <div className={cn('flex items-center', variant === 'progress' ? 'gap-2' : 'gap-1', className)}>
      <SceneStepButton
        direction={-1}
        onClick={() => onStep(-1)}
        disabled={activeIndex === 0}
        className={buttonClassName}
      />
      {variant === 'progress' && (
        <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full transition-[width] duration-300"
            style={{ width: `${progress}%`, backgroundColor: accent }}
          />
        </div>
      )}
      <span
        className={cn(
          'shrink-0 text-xs font-medium tabular-nums text-muted-foreground',
          variant === 'compact' && 'px-1',
        )}
      >
        {activeIndex + 1}/{count}
      </span>
      <SceneStepButton
        direction={1}
        onClick={() => onStep(1)}
        disabled={activeIndex >= count - 1}
        className={buttonClassName}
      />
    </div>
  )
}

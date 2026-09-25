import { Check, ChevronDown } from 'lucide-react'
import { useId, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

export type StepStatus = 'done' | 'current' | 'todo'

type StepSectionProps = {
  /** The step's number or short marker, e.g. `1`. */
  step: ReactNode
  title: ReactNode
  /** `current` is the step to work on next; `done` shows a check in the marker. */
  status?: StepStatus
  /** A citation beside the title, e.g. "Handbook 3.1". */
  reference?: ReactNode
  /** One line under the title saying where the step stands. */
  summary?: ReactNode
  defaultOpen?: boolean
  /** Controlled open state; pair with `onOpenChange`. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Extra attributes for the toggle button, e.g. `data-*` hooks tests click. */
  toggleProps?: ButtonHTMLAttributes<HTMLButtonElement> & Record<`data-${string}`, string | undefined>
  children: ReactNode
  className?: string
  contentClassName?: string
  /**
   * `false` renders the header as a plain heading with the content always
   * shown, for a step that already sits in its own tab panel.
   */
  collapsible?: boolean
}

const STATUS_TEXT: Record<StepStatus, string> = {
  done: 'done',
  current: 'current step',
  todo: 'to do',
}

/** The round step marker: the number, filled when current, a check when done. */
export function StepMarker({ step, status = 'todo', className }: { step: ReactNode; status?: StepStatus; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums',
        status === 'done' &&
          'border-emerald-600 bg-emerald-600 text-white dark:border-emerald-500 dark:bg-emerald-500 dark:text-emerald-950',
        status === 'current' && 'border-primary bg-primary text-primary-foreground',
        status === 'todo' && 'border-border text-muted-foreground',
        className,
      )}
    >
      {status === 'done' ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : step}
    </span>
  )
}

/** Screen-reader text for a step's status, for tabs that show only its marker. */
export const stepStatusText = (status: StepStatus) => STATUS_TEXT[status]

/**
 * One numbered step of a procedure that folds to its title and a status line.
 *
 * The content stays mounted while folded, so inputs keep what was typed and a
 * step can be opened programmatically without losing state. The toggle sits
 * inside the heading, which is what lets screen-reader users jump step to
 * step by heading.
 */
export function StepSection({
  step,
  title,
  status = 'todo',
  reference,
  summary,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  toggleProps,
  children,
  className,
  contentClassName,
  collapsible = true,
}: StepSectionProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const open = !collapsible || (controlledOpen ?? internalOpen)
  const id = useId()
  const contentId = `${id}-content`
  const stepId = `${id}-step`
  const titleId = `${id}-title`
  const statusId = `${id}-status`
  const referenceId = `${id}-reference`
  const summaryId = `${id}-summary`
  const toggle = () => {
    const next = !open
    if (controlledOpen === undefined) setInternalOpen(next)
    onOpenChange?.(next)
  }

  const header = (
    <>
      <StepMarker step={step} status={status} className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span id={stepId} className="sr-only">
            Step {step}
          </span>
          <span id={titleId} className="text-sm font-semibold text-foreground">
            {title}
          </span>
          {reference && (
            <span id={referenceId} className="text-[11px] font-normal text-muted-foreground">
              {reference}
            </span>
          )}
          <span id={statusId} className="sr-only">
            ({STATUS_TEXT[status]})
          </span>
        </span>
        {summary && (
          <span id={summaryId} className="mt-0.5 block text-xs font-normal leading-4 text-muted-foreground">
            {summary}
          </span>
        )}
      </span>
    </>
  )


  return (
    <section
      className={cn('border-b border-border bg-background/95', status === 'current' && 'bg-primary/[0.03]', className)}
      data-step-status={status}
    >
      <h2 className="m-0">
        {collapsible ? (
          <button
            {...toggleProps}
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-controls={contentId}
            // Named by the step and its title only; the reference and the status
            // line describe it. Otherwise a summary such as "look from the road"
            // becomes part of the toggle's name and collides with real buttons.
            aria-labelledby={`${stepId} ${titleId} ${statusId}`}
            aria-describedby={[reference && referenceId, summary && summaryId].filter(Boolean).join(' ') || undefined}
            className="flex w-full items-start gap-3 px-4 py-3 text-left touch:min-h-12"
          >
            {header}
            <ChevronDown
              aria-hidden="true"
              className={cn('mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
            />
          </button>
        ) : (
          <div className="flex w-full items-start gap-3 px-4 py-3">{header}</div>
        )}
      </h2>
      <div id={contentId} role="region" aria-labelledby={titleId} className={cn(!open && 'hidden', contentClassName)}>
        {children}
      </div>
    </section>
  )
}

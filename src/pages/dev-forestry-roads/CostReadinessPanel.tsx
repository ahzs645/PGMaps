import { useState } from 'react'
import { ClipboardList } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PanelDialog } from '@/components/ui/dialog-shell'
import { assessCostReadiness } from './costReadiness'
import type { Alignment, RoadAnalysis, RoadSettings } from './types'

const GUIDE = 'https://github.com/ahzs645/PGMaps/blob/main/docs/forestry-road-design/sections-quantities-and-costs.md'

/**
 * One line in the cost dialog that says how much of the estimate still needs review, with the
 * items themselves in their own dialog so they do not push the calculation table down.
 */
export function CostReadiness({
  analysis,
  alignment,
  settings,
  portalContainer,
}: {
  analysis: RoadAnalysis
  alignment: Alignment
  settings: RoadSettings
  portalContainer?: HTMLElement | null
}) {
  const [open, setOpen] = useState(false)
  const review = assessCostReadiness(analysis, alignment, settings)
  const count = review.flags.length
  if (!count) return null
  const placeholders = review.flags.some((flag) => flag.id === 'placeholder-rates')
  return (
    <>
      <div
        className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/35 dark:text-amber-100"
        data-testid="road-cost-review-bar"
      >
        <ClipboardList className="size-3.5 shrink-0" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-[11px] leading-4">
          <strong>
            Scope to review · {count} item{count === 1 ? '' : 's'}
          </strong>
          {placeholders ? ' · placeholder rates in use' : ''}. Section coverage is not cost confidence.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="h-7 shrink-0 bg-background text-xs"
          data-testid="road-cost-review-toggle"
          onClick={() => setOpen(true)}
        >
          Review
        </Button>
      </div>
      <PanelDialog
        open={open}
        onOpenChange={setOpen}
        title="Cost scope and pricing need review"
        subtitle={`${count} item${count === 1 ? '' : 's'} before this estimate is a budget`}
        size="md"
        portalContainer={portalContainer}
        // Opened from the cost dialog, so it sits one layer above it.
        className="z-[1300]"
        contentProps={{ 'data-testid': 'road-cost-readiness' }}
      >
        <div className="space-y-3 text-xs">
          <p className="text-muted-foreground">
            Section coverage measures sampled road length. It does not measure cost confidence or budget completeness.
          </p>
          <ol className="space-y-2.5">
            {review.flags.map((flag, index) => (
              <li
                key={flag.id}
                className="flex gap-2.5 rounded-md border p-2.5"
                data-cost-review={flag.id}
                data-testid={flag.id === 'borrow-screening' ? 'road-borrow-screening' : undefined}
              >
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[10px] font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                  {index + 1}
                </span>
                <span className="min-w-0 leading-5">
                  <strong className="block">{flag.label}</strong>
                  <span className="text-muted-foreground">{flag.detail}</span>
                </span>
              </li>
            ))}
          </ol>
          <a
            className="inline-block text-[11px] text-primary underline underline-offset-2"
            href={GUIDE}
            target="_blank"
            rel="noopener noreferrer"
          >
            How quantities and costs are calculated
          </a>
        </div>
      </PanelDialog>
    </>
  )
}

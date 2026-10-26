import { CollapsibleSection, InlineAlert } from '@/components/ui/map-panels'
import { assessCostReadiness } from './costReadiness'
import type { Alignment, RoadAnalysis, RoadSettings } from './types'

export function CostReadiness({
  analysis,
  alignment,
  settings,
}: {
  analysis: RoadAnalysis
  alignment: Alignment
  settings: RoadSettings
}) {
  const review = assessCostReadiness(analysis, alignment, settings)
  const borrow = review.flags.find((flag) => flag.id === 'borrow-screening')
  const placeholders = review.flags.find((flag) => flag.id === 'placeholder-rates')
  return (
    <div className="space-y-2" data-testid="road-cost-readiness">
      <InlineAlert tone="warning" title="Cost scope and pricing need review">
        <p>
          Section coverage measures sampled road length. It does not measure cost confidence or budget completeness.
        </p>
        {placeholders && (
          <p className="mt-1">
            <strong>{placeholders.label}:</strong> {placeholders.detail}
          </p>
        )}
        {borrow && (
          <p className="mt-1" data-testid="road-borrow-screening">
            <strong>{borrow.label}:</strong> {borrow.detail}
          </p>
        )}
      </InlineAlert>
      <CollapsibleSection
        label="Estimate review details"
        summary={`${review.flags.length} items to review`}
        toggleProps={{ 'data-testid': 'road-cost-review-toggle' }}
        className="rounded border"
        contentClassName="px-3 pb-3"
      >
        <ul className="list-disc space-y-2 pl-4 text-[11px] leading-4 text-muted-foreground">
          {review.flags.map((flag) => (
            <li key={flag.id} data-cost-review={flag.id}>
              <strong className="text-foreground">{flag.label}.</strong> {flag.detail}
            </li>
          ))}
        </ul>
      </CollapsibleSection>
    </div>
  )
}

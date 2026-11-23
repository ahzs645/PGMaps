import { useMemo } from 'react'
import { FORM_INPUT_CLASS, FormField } from '@/components/ui/form-field'
import { InlineAlert } from '@/components/ui/map-panels'
import { ToolSection } from '@/components/ui/tool-section'
import type { Measurement } from '../../../../packages/legal-rules/engine/spatialFacts'
import patchOperation from '../../../../packages/legal-rules/spatial/patch-analysis.json'
import { releaseKey } from '../../../../packages/legal-rules/src/contract'
import { patchFacts } from '../../forest-patches/legalEvidence'
import { order } from '../../forest-patches/project'
import LegalWorkbench, { emptyReview } from '../../legal-workbench/Workspace'
import { scheduleProject } from '../planAnalysis'
import { shownResult } from '../usePlanAnalysis'
import { asEngineAnalysis } from './CompareStep'
import type { StepProps } from './types'

/**
 * Step 5: the landscape pathway (D.5) and each block's rule review. The block review is the
 * PR's workbench for now; its redesign is the next change.
 */
export function ReviewStep({ plan, edit, selectedBlock, analysis, shown }: StepProps) {
  const block = plan.blocks.find((b) => b.id === selectedBlock) ?? null
  const review = plan.reviewSchedule
  const result = shownResult(analysis)
  const reviewName = plan.schedules.find((s) => s.id === review)?.name ?? review
  const measurements = useMemo<Measurement[]>(() => {
    if (!result) return []
    const facts = patchFacts(scheduleProject(plan, review), asEngineAnalysis(result, review), shown.year, 'proposed')
    return [
      {
        operation: patchOperation.id,
        output: 'patch-class-away',
        value: facts.facts[0].value,
        evidence: `${reviewName} · ${shown.year - 5}–${shown.year} · ${facts.facts[0].evidence}`,
      },
    ]
  }, [result, plan, review, reviewName, shown.year])
  const regional = Boolean(plan.area.district && plan.area.ndu)
  return (
    <>
      <ToolSection
        title="Landscape pathway (D.5)"
        help="D.5(a) asks for an old-forest recruitment strategy that is submitted, approved and followed. D.5(b) asks for a rationale to be submitted when the young-forest patch distribution cannot be achieved. Neither is decided here."
        summary={plan.landscape.rationale ? 'Rationale drafted' : 'No rationale yet'}
        defaultOpen
      >
        {order.alternativesAndInterpretations
          .filter((a) => a.id.startsWith('D.5'))
          .map((a) => (
            <p key={a.id} className="text-xs">
              <strong>{a.id}</strong> {a.summary}
            </p>
          ))}
        <FormField
          label="Rationale draft"
          description="The trend, the schedules compared, why quicker ones are impracticable, timber rights, and when results will be checked."
        >
          <textarea
            className={FORM_INPUT_CLASS}
            rows={6}
            value={plan.landscape.rationale ?? ''}
            onChange={(e) =>
              edit((p) => ({ ...p, landscape: { ...p.landscape, rationale: e.target.value || undefined } }))
            }
          />
        </FormField>
      </ToolSection>
      <ToolSection
        title={block ? `Rules for ${block.name}` : 'Rules for a block'}
        summary={block ? `Landscape figures from ${reviewName}, ${shown.year}` : 'Select a block'}
        defaultOpen
      >
        {!block ? (
          <InlineAlert tone="info">Select a block on the map or in step 2 to review it.</InlineAlert>
        ) : (
          <LegalWorkbench
            key={block.id}
            plan={{
              subject: `${block.name} · ${reviewName} · ${shown.year}`,
              measurements,
              evidence: () => ({ plan, block: block.id, schedule: review, year: shown.year }),
              review: plan.reviews[block.id] ?? emptyReview(regional),
              onChange: (next, packs) =>
                edit((p) => ({
                  ...p,
                  reviews: { ...p.reviews, [block.id]: next },
                  packs: [...new Map([...(p.packs as never[]), ...packs].map((x) => [releaseKey(x), x])).values()],
                })),
            }}
          />
        )}
      </ToolSection>
    </>
  )
}

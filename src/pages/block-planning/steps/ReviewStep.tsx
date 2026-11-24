import { blockAreaHa } from '@/lib/forestry/blockSheet/blockFacts'
import { FORM_INPUT_CLASS, FormField, SelectField } from '@/components/ui/form-field'
import { InlineAlert } from '@/components/ui/map-panels'
import { ToolSection } from '@/components/ui/tool-section'
import type { Measurement } from '../../../../packages/legal-rules/engine/spatialFacts'
import profile from '../../../../packages/legal-rules/forestry-profile.json'
import patchOperation from '../../../../packages/legal-rules/spatial/patch-analysis.json'
import { releaseKey } from '../../../../packages/legal-rules/src/contract'
import { defaults } from '../../legal-workbench/registry'
import { saveRangeReview } from '../edits'
import { periodYears, type Plan, type RangeReview, type ReviewCase } from '../plan'
import { extraPacks } from '../review/caseEdits'
import { CaseReview, useLibrary } from '../review/CaseReview'
import { GrazingEvidence } from '../review/GrazingEvidence'
import { PathwayCard } from '../review/PathwayCard'
import { measuredTrend, pathways, trendYearOf } from '../review/pathways'
import { RANGE_INSTRUMENT, rangeReviewCurrent, rangeReviewFor } from '../review/rangeReview'
import { shownResult } from '../usePlanAnalysis'
import type { StepProps } from './types'

/** The Prince George order is reviewed once for the landscape; every other instrument per block. */
export const ORDER_INSTRUMENT = 'bc.pgtsa.biodiversity'
const area = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })

const freshCase = (selected: string[]): ReviewCase => ({ selected, date: profile.assessmentDate, sets: {} })
export const landscapeCase = (plan: Plan) =>
  plan.landscape.review ?? freshCase(profile.releases.filter((k) => k.startsWith(ORDER_INSTRUMENT + '@')))
export const blockCase = (plan: Plan, id: string) => plan.reviews[id] ?? freshCase(profile.blockReleases)

/** Step 5: the order's landscape review with its two D.5 pathways, then the selected block's rules. */
export function ReviewStep({ plan, edit, selectedBlock, selectBlock, analysis }: StepProps) {
  const library = useLibrary(defaults)
  const result = shownResult(analysis)
  const block = plan.blocks.find((b) => b.id === selectedBlock) ?? null
  const blockInstruments = [...new Set(library.map((p) => p.id))].filter(
    (id) => id !== ORDER_INSTRUMENT && id !== RANGE_INSTRUMENT,
  )
  const grazing = block ? rangeReviewFor(plan, block) : null
  const trend = measuredTrend(plan, result)
  const reviewName = plan.schedules.find((s) => s.id === plan.reviewSchedule)?.name ?? ''
  const measurements: Measurement[] = trend
    ? [
        {
          operation: patchOperation.id,
          output: 'patch-class-away',
          value: trend.movedAway,
          evidence: `${reviewName}, ${trend.year - 5}–${trend.year}, ${plan.area.district} · ${plan.area.ndu}, pg-2005-buffer-v1`,
        },
      ]
    : []
  const landscape = landscapeCase(plan)
  const orderPack = library.find(
    (p) => releaseKey(p) === landscape.selected.find((k) => k.startsWith(ORDER_INSTRUMENT + '@')),
  )
  const orderFacts = orderPack ? landscape.sets[releaseKey(orderPack)] : undefined
  const keepPacks = (next: Plan): Plan => ({
    ...next,
    packs: extraPacks(
      [landscapeCase(next), ...Object.values(next.reviews), ...(next.rangeReviews ?? []).map((r) => r.review)],
      library,
      defaults,
    ),
  })
  const updateRange = (change: Partial<Pick<RangeReview, 'reference' | 'review'>>) => {
    if (!block || !grazing) return
    edit((p) => {
      if (!rangeReviewCurrent(p, grazing.record)) return p
      const next = rangeReviewFor(p, block, grazing.record.schedule).record
      return keepPacks(saveRangeReview(p, { ...next, ...change }))
    })
  }
  const years = periodYears(plan.area.startYear)
  return (
    <>
      <ToolSection
        title="Landscape · Prince George order"
        help="Objective C is a landscape trend, so the order is reviewed once for the plan, reading the patch trend of the schedule under review. A pathway's determinations are the reviewer's; the model only measures."
        summary={`Trend from ${reviewName}`}
        defaultOpen
      >
        {!plan.area.ndu && (
          <InlineAlert tone="info">Set the reporting unit in step 1 to measure the trend.</InlineAlert>
        )}
        <SelectField
          label="Measure the trend over"
          value={String(trendYearOf(plan))}
          onValueChange={(y) => edit((p) => ({ ...p, landscape: { ...p.landscape, trendYear: Number(y) } }))}
          description={`The schedule under review is ${reviewName}; change it in step 3.`}
        >
          {years.slice(1).map((y) => (
            <option key={y} value={y}>
              {y - 5}–{y}
            </option>
          ))}
        </SelectField>
        <div className="space-y-2" data-testid="block-planning-pathways">
          {pathways(plan, orderFacts, result).map((pathway) => (
            <PathwayCard key={pathway.id} pathway={pathway} plan={plan} edit={edit} />
          ))}
        </div>
        <CaseReview
          library={library}
          instruments={[ORDER_INSTRUMENT]}
          review={landscape}
          measurements={measurements}
          onChange={(review) => edit((p) => keepPacks({ ...p, landscape: { ...p.landscape, review } }))}
          caseLabel="Whole landscape"
          testId="block-planning-landscape-review"
        />
      </ToolSection>

      <ToolSection
        title={block ? `Block · ${block.name}` : 'Block review'}
        help="The FPPR screens for one block. They flag a provision to review; none decides that a block complies or that an exception applies."
        summary={block ? 'FPPR and other instruments' : 'Select a block'}
        defaultOpen
      >
        <SelectField label="Block" value={block?.id ?? ''} onValueChange={(id) => selectBlock(id || null)}>
          <option value="">Choose…</option>
          {plan.blocks.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </SelectField>
        {block ? (
          <CaseReview
            key={block.id}
            library={library}
            instruments={blockInstruments}
            review={blockCase(plan, block.id)}
            measurements={[]}
            hints={{
              nar: `The drawing’s gross area is ${area.format(blockAreaHa(block.shapes[0].geometry))} ha. Net area to be reforested needs its own survey and exclusions.`,
            }}
            onChange={(review) => edit((p) => keepPacks({ ...p, reviews: { ...p.reviews, [block.id]: review } }))}
            caseLabel="Whole block"
            testId="block-planning-block-review"
          />
        ) : (
          <InlineAlert tone="info">Select a block here, on the map or in step 2.</InlineAlert>
        )}
      </ToolSection>
      {block && grazing && (
        <ToolSection
          key={JSON.stringify([
            block.id,
            grazing.record.schedule,
            grazing.record.footprint,
            grazing.record.harvestYear,
          ])}
          title="Crown grazing and reforestation"
          summary={`${reviewName} · ${grazing.record.harvestYear ?? 'No harvest scheduled'}`}
          help="Review lease terms, range agreements and forest plan clauses for the selected schedule and block shape. Enter evidence from the governing documents and field record."
        >
          <p className="text-xs text-muted-foreground">
            {reviewName} · {block.shapes.find((s) => s.id === grazing.record.shape)?.name} ·{' '}
            {grazing.record.harvestYear ?? 'No harvest scheduled'}. For an existing cutblock, record the original
            harvest and current silviculture activity in the evidence. Change the schedule under review in step 3.
          </p>
          {grazing.stale && (
            <InlineAlert tone="info">The shape or harvest year changed. Enter evidence for this version.</InlineAlert>
          )}
          <FormField label="Documents and observations" description="Record file IDs, plan clauses, dates and links.">
            <textarea
              className={FORM_INPUT_CLASS}
              rows={3}
              maxLength={20000}
              defaultValue={grazing.record.reference ?? ''}
              onBlur={(e) => {
                const reference = e.currentTarget.value.trim() || undefined
                if (reference !== grazing.record.reference) updateRange({ reference })
              }}
            />
          </FormField>
          <GrazingEvidence plan={plan} edit={edit} block={block} schedule={grazing.record.schedule} library={library} />
          <CaseReview
            library={library}
            instruments={[RANGE_INSTRUMENT]}
            review={grazing.record.review}
            measurements={[]}
            hints={{
              'land-act-lease': 'Start with the Crown lands file in Tantalis and confirm it against the signed lease.',
              'range-act-agreement': 'Start with the RAN file on the Range Tenure layer and confirm the agreement.',
              'permanent-grazing-opening':
                'Use the proposed permanent opening footprint. Natural regeneration still aims to establish a free-growing stand.',
              'exclusive-range-use': 'Seasonal grazing on land managed for both timber and forage is shared use.',
              'plan-conflict':
                'Use the exact approved clause and record which activity, footprint and dates it covers.',
              'ada-sra-applicable':
                'Confirm agriculture development area or settlement reserve area coverage with the district. Check permit exclusions and any later orders.',
            }}
            onChange={(review) => updateRange({ review })}
            caseLabel="Schedule and block"
            testId="block-planning-range-review"
          />
        </ToolSection>
      )}
    </>
  )
}

import { blockAreaHa } from '@/lib/forestry/blockSheet/blockFacts'
import { SelectField } from '@/components/ui/form-field'
import { InlineAlert } from '@/components/ui/map-panels'
import { ToolSection } from '@/components/ui/tool-section'
import type { Measurement } from '../../../../packages/legal-rules/engine/spatialFacts'
import profile from '../../../../packages/legal-rules/forestry-profile.json'
import patchOperation from '../../../../packages/legal-rules/spatial/patch-analysis.json'
import { releaseKey } from '../../../../packages/legal-rules/src/contract'
import { defaults } from '../../legal-workbench/registry'
import { periodYears, type Plan, type ReviewCase } from '../plan'
import { extraPacks } from '../review/caseEdits'
import { CaseReview, useLibrary } from '../review/CaseReview'
import { PathwayCard } from '../review/PathwayCard'
import { measuredTrend, pathways, trendYearOf } from '../review/pathways'
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
  const blockInstruments = [...new Set(library.map((p) => p.id))].filter((id) => id !== ORDER_INSTRUMENT)
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
    packs: extraPacks([landscapeCase(next), ...Object.values(next.reviews)], library, defaults),
  })
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
            testId="block-planning-block-review"
          />
        ) : (
          <InlineAlert tone="info">Select a block here, on the map or in step 2.</InlineAlert>
        )}
      </ToolSection>
    </>
  )
}

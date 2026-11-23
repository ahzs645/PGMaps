import { cn } from '@/lib/utils'
import { FORM_INPUT_CLASS, FormField, SelectField } from '@/components/ui/form-field'
import { KeyValueRows } from '@/components/ui/map-panels'
import { ToolDisclosure } from '@/components/ui/tool-section'

import { scopeRows, unitsText, blocksText, type AssessmentScope } from './assessmentScope'
import { REVIEWED_EXTENTS, type LandformRecord, type ReviewedExtent, type ViaReview } from './via'

const SOURCE_LABEL = { run: 'run', reviewer: 'reviewer', scene: 'scene' } as const

/**
 * Step 1's *Reviewed scope* (`assessmentScope.ts`): the landform the figures are measured against and the inventory
 * units it came from, each block's gross and net footprint and treatment, the masks and what each does to the two
 * denominators, and where each came from. Everything shown is derived from the scene and the run; the reviewer's own
 * statement of what the landform is, and a note, are review records on the landform (`LandformRecord`), optional and
 * never a run input.
 */
export function AssessmentScopePanel({
  scope,
  review,
  onReviewChange,
}: {
  scope: AssessmentScope
  review: ViaReview
  onReviewChange: (patch: Partial<ViaReview>) => void
}) {
  const landform = scope.landform
  const record: LandformRecord = landform ? (review.landformRecords?.[landform.name] ?? {}) : {}
  const change = (patch: Partial<LandformRecord>) => {
    if (!landform) return
    const merged = Object.fromEntries(
      Object.entries({ ...record, ...patch }).filter(([, value]) => value !== undefined && value !== ''),
    ) as LandformRecord
    const next = { ...review.landformRecords }
    if (Object.keys(merged).length) next[landform.name] = merged
    else delete next[landform.name]
    onReviewChange({ landformRecords: next })
  }
  const summary = landform
    ? [unitsText(landform.units) ?? landform.provenance.label, blocksText(scope.blocks)].join(' · ')
    : 'No landform assessed'
  return (
    <ToolDisclosure
      label="Reviewed scope"
      summary={summary}
      toggleProps={{ 'data-forestry-disclosure': 'reviewed-scope' }}
      help="What every figure is measured against: the landform and the inventory units it came from, the blocks gross and net of their masks, and what each mask and exclusion does to the planimetric and perspective denominators. Two figures measured on different scopes are not the same measurement. Derived from the scene and the run; only the statement and note below are yours, and they never change the run."
    >
      <div data-assessment-scope="" className="space-y-2">
        <p className="text-2xs text-muted-foreground" data-scope-statement="">
          {scope.statement}
        </p>
        <KeyValueRows
          variant="divided"
          valueMaxWidth="max-w-[15rem]"
          rows={scopeRows(scope).map((row, index) => ({
            key: `${row.label}-${index}`,
            label: row.label,
            value: (
              <>
                {row.value ?? <span className="text-muted-foreground">Not stated</span>}
                <span className="block text-2xs font-normal text-muted-foreground">{SOURCE_LABEL[row.source]}</span>
              </>
            ),
          }))}
        />
        {landform && (
          <>
            <SelectField
              label="The landform assessed is"
              aria-label={`What ${landform.name} is against the inventory`}
              value={record.reviewedAs ?? ''}
              onChange={(event) =>
                change({ reviewedAs: (event.target.value || undefined) as ReviewedExtent | undefined })
              }
            >
              <option value="">
                {landform.suggestedExtent
                  ? `Not stated (the geometry suggests: ${REVIEWED_EXTENTS[landform.suggestedExtent].toLowerCase()})`
                  : 'Not stated'}
              </option>
              {(Object.keys(REVIEWED_EXTENTS) as ReviewedExtent[]).map((id) => (
                <option key={id} value={id}>
                  {REVIEWED_EXTENTS[id]}
                </option>
              ))}
            </SelectField>
            <FormField label="Scope note">
              <textarea
                className={cn(FORM_INPUT_CLASS, 'min-h-9 py-1.5')}
                rows={2}
                maxLength={4000}
                aria-label={`Scope note for ${landform.name}`}
                placeholder="Optional: e.g. the face east of the draw, gross blocks as laid out"
                value={record.scopeNote ?? ''}
                onChange={(event) => change({ scopeNote: event.target.value })}
              />
            </FormField>
          </>
        )}
      </div>
    </ToolDisclosure>
  )
}

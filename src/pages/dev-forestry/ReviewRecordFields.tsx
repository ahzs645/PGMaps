import { FORM_INPUT_CLASS, FormField, SelectField } from '@/components/ui/form-field'
import { ToolDisclosure, ToolSection } from '@/components/ui/tool-section'

import {
  VIEWPOINT_SIGNIFICANCE,
  type KeyViewpointRecord,
  type LandformRecord,
  type ViaReview,
  type ViewpointRecord,
  type ViewpointSignificance,
} from './via'

/** Drops empty text, so a cleared field leaves no record behind. */
function tidy<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== ''),
  ) as T
}

function withEntry<T extends object>(
  records: Record<string, T> | undefined,
  name: string,
  entry: T | null,
): Record<string, T> {
  const next = { ...records }
  if (entry && Object.keys(entry).length) next[name] = entry
  else delete next[name]
  return next
}

/**
 * Step 2's Table 3 (22, 23): each saved view's significance on the MOF 2005 five-point scale, why it was chosen,
 * the viewing experience and how long the view lasts. Facts the reviewer gives per viewpoint, held on the review
 * record by the view's name; they never change the run.
 */
export function ViewpointRecordsSection({
  views,
  plannedNames,
  review,
  onReviewChange,
}: {
  /** The saved views' names, as the report names them. */
  views: readonly string[]
  /** Names of planned views of interest, rated in their own rows rather than here. */
  plannedNames?: ReadonlySet<string>
  review: ViaReview
  onReviewChange: (patch: Partial<ViaReview>) => void
}) {
  const records = review.viewpointRecords ?? {}
  const recorded = views.filter((name) => records[name]?.significance).length
  // A planned view of interest is rated in its own row (`ViewsOfInterestPanel`); only views saved by hand are here.
  const listed = plannedNames ? views.filter((name) => !plannedNames.has(name)) : views
  const plannedCount = views.length - listed.length
  return (
    <ToolSection
      title="Viewpoint significance"
      summary={views.length ? `${recorded} of ${views.length} rated` : 'No saved views'}
      toggleProps={{ 'data-forestry-disclosure': 'viewpoint-records' }}
      help="Table 3 of the consultant VIA reports, per saved view: the viewpoint's significance on the MOF 2005 five-point scale, why it was chosen, what viewing from it is like and how long the view lasts. The reports print them for every viewpoint, and choosing a key viewpoint by impact reads the significance. A review record: editing it never changes the run."
    >
      {!views.length && (
        <p className="text-2xs text-muted-foreground">Save a view from the road view&rsquo;s bar to rate it.</p>
      )}
      {plannedCount > 0 && (
        <p className="text-2xs text-muted-foreground">
          {plannedCount === 1 ? 'One view of interest is' : `${plannedCount} views of interest are`} rated in its row
          under Views of interest, step 2.
        </p>
      )}
      {listed.map((name) => {
        const record = records[name] ?? {}
        return (
          <ToolDisclosure
            key={name}
            label={name}
            summary={record.significance ?? 'Not rated'}
            toggleProps={{ 'data-forestry-disclosure': `viewpoint-record-${name}` }}
          >
            <ViewpointRecordFields name={name} review={review} onReviewChange={onReviewChange} />
          </ToolDisclosure>
        )
      })}
    </ToolSection>
  )
}

/**
 * Step 2's key viewpoints: the saved view each block is assessed from in the consultant reports, and the one the
 * blocks are assessed from together, when the reviewer chooses rather than the run (`chooseKeyViewpoints`).
 */
export function KeyViewpointsSection({
  views,
  blocks,
  review,
  onReviewChange,
}: {
  views: readonly string[]
  /** The proposed blocks' names. */
  blocks: readonly string[]
  review: ViaReview
  onReviewChange: (patch: Partial<ViaReview>) => void
}) {
  const record = review.keyViewpoints ?? {}
  const chosen = blocks.filter((block) => record.blocks?.[block]).length + (record.group ? 1 : 0)
  const setBlock = (block: string, entry: KeyViewpointRecord | null) =>
    onReviewChange({ keyViewpoints: tidy({ ...record, blocks: withEntry(record.blocks, block, entry) }) })
  const setGroup = (entry: KeyViewpointRecord | null) =>
    onReviewChange({ keyViewpoints: tidy({ ...record, group: entry }) })
  const picker = (
    label: string,
    entry: KeyViewpointRecord | undefined | null,
    onPick: (entry: KeyViewpointRecord | null) => void,
  ) => (
    <div className="space-y-1.5" key={label}>
      <SelectField
        label={label}
        aria-label={label}
        className="w-full rounded-md border bg-background p-1"
        value={entry?.view ?? ''}
        onChange={(event) =>
          onPick(event.target.value ? tidy({ view: event.target.value, reason: entry?.reason }) : null)
        }
      >
        <option value="">Chosen by the run</option>
        {views.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </SelectField>
      {entry?.view && (
        <FormField label={`Why · ${label.toLowerCase()}`} hideLabel>
          <input
            className={FORM_INPUT_CLASS}
            maxLength={2000}
            aria-label={`Why · ${label}`}
            placeholder="Why this viewpoint (optional)"
            value={entry.reason ?? ''}
            onChange={(event) => onPick(tidy({ view: entry.view, reason: event.target.value }))}
          />
        </FormField>
      )}
    </div>
  )
  return (
    <ToolSection
      title="Key viewpoints"
      summary={chosen ? `${chosen} chosen by you` : 'Chosen by the run'}
      toggleProps={{ 'data-forestry-disclosure': 'key-viewpoints' }}
      help="The consultant reports discuss each block once, from its key viewpoint. The run chooses it (the largest share of the block in view, or the most significant impact); choose one here to override it, and the report says you chose it, with your reason. A viewpoint that does not see the block is not taken: the report lists it to complete. A review record: it never changes the run."
    >
      {!views.length || !blocks.length ? (
        <p className="text-2xs text-muted-foreground">Save a view and draw a cutblock to choose its key viewpoint.</p>
      ) : (
        <>
          {blocks.map((block) =>
            picker(`Key viewpoint for ${block}`, record.blocks?.[block], (entry) => setBlock(block, entry)),
          )}
          {blocks.length > 1 && picker('Key viewpoint for the blocks together', record.group, setGroup)}
        </>
      )}
    </ToolSection>
  )
}

/**
 * Step 1's sub-landforms: for a landform that is part of another, the landform it belongs to and what divides it from
 * the rest (a draw, a creek). The consultant reports' Table 2 and the sub-landform sentences read them; without a
 * record the parent is read from the name ("Landform 1b" is part of Landform 1) and the divider is left to complete.
 */
export function SubLandformFields({
  landforms,
  review,
  onReviewChange,
}: {
  /** The scene's landforms' names. */
  landforms: readonly string[]
  review: ViaReview
  onReviewChange: (patch: Partial<ViaReview>) => void
}) {
  const records = review.landformRecords ?? {}
  const recorded = landforms.filter((name) => records[name]?.parent).length
  return (
    <ToolDisclosure
      label="Sub-landforms"
      summary={recorded ? `${recorded} recorded` : 'None recorded'}
      toggleProps={{ 'data-forestry-disclosure': 'sub-landforms' }}
      help="Where a landform is part of a larger one, name the larger landform and what divides them, as the consultant reports' Table 2 does. A review record: it never changes the run."
    >
      {landforms.map((name) => {
        const record = records[name] ?? {}
        const change = (patch: Partial<LandformRecord>) =>
          onReviewChange({ landformRecords: withEntry(review.landformRecords, name, tidy({ ...record, ...patch })) })
        return (
          <div key={name} className="space-y-1.5">
            <p className="text-2xs font-medium">{name}</p>
            <FormField label="Part of landform">
              <input
                className={FORM_INPUT_CLASS}
                maxLength={200}
                aria-label={`Landform ${name} is part of`}
                placeholder="Not a sub-landform"
                value={record.parent ?? ''}
                onChange={(event) => change({ parent: event.target.value })}
              />
            </FormField>
            <FormField label="Divided at">
              <input
                className={FORM_INPUT_CLASS}
                maxLength={2000}
                aria-label={`Where ${name} is divided`}
                placeholder="e.g. the draw east of the block"
                value={record.divider ?? ''}
                onChange={(event) => change({ divider: event.target.value })}
              />
            </FormField>
          </div>
        )
      })}
    </ToolDisclosure>
  )
}

/**
 * One viewpoint's Table 3 fields: significance, why it was chosen, the viewing experience and how long the view
 * lasts, held on the review record by the view's name. Shown in the views of interest's row for a planned view and
 * in *Viewpoint significance* for a view saved by hand; never an input to the run.
 */
export function ViewpointRecordFields({
  name,
  review,
  onReviewChange,
}: {
  name: string
  review: ViaReview
  onReviewChange: (patch: Partial<ViaReview>) => void
}) {
  const records = review.viewpointRecords ?? {}
  const record = records[name] ?? {}
  const change = (name: string, patch: Partial<ViewpointRecord>) =>
    onReviewChange({
      viewpointRecords: withEntry(review.viewpointRecords, name, tidy({ ...records[name], ...patch })),
    })
  return (
    <div className="space-y-2">
      <SelectField
        label="Significance"
        aria-label={`Significance of ${name}`}
        className="w-full rounded-md border bg-background p-1"
        value={record.significance ?? ''}
        onChange={(event) =>
          change(name, { significance: (event.target.value || undefined) as ViewpointSignificance | undefined })
        }
      >
        <option value="">Not rated</option>
        {VIEWPOINT_SIGNIFICANCE.map((level) => (
          <option key={level} value={level}>
            {level}
          </option>
        ))}
      </SelectField>
      <FormField label="Why it was chosen">
        <textarea
          className={FORM_INPUT_CLASS}
          rows={2}
          maxLength={2000}
          aria-label={`Why ${name} was chosen`}
          placeholder="e.g. high boat traffic"
          value={record.reason ?? ''}
          onChange={(event) => change(name, { reason: event.target.value })}
        />
      </FormField>
      <FormField label="Viewing experience">
        <input
          className={FORM_INPUT_CLASS}
          maxLength={2000}
          aria-label={`Viewing experience from ${name}`}
          placeholder="e.g. sustained focal and side views from watercraft"
          value={record.experience ?? ''}
          onChange={(event) => change(name, { experience: event.target.value })}
        />
      </FormField>
      <FormField label="View duration">
        <input
          className={FORM_INPUT_CLASS}
          maxLength={200}
          aria-label={`View duration from ${name}`}
          placeholder="e.g. sustained, or under 10 seconds"
          value={record.duration ?? ''}
          onChange={(event) => change(name, { duration: event.target.value })}
        />
      </FormField>
    </div>
  )
}

/** Moves a viewpoint's record to its new name when the view is renamed; unchanged when it had none. */
export function renamedViewpointRecords(review: ViaReview, from: string, to: string): Partial<ViaReview> | null {
  const record = review.viewpointRecords?.[from]
  if (!record || from === to || review.viewpointRecords?.[to]) return null
  const next = { ...review.viewpointRecords }
  delete next[from]
  next[to] = record
  return { viewpointRecords: next }
}

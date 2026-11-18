import { CheckboxField, FORM_INPUT_CLASS, FormField, SelectField } from '@/components/ui/form-field'
import { ToolDisclosure } from '@/components/ui/tool-section'

import {
  VIEWPOINT_SIGNIFICANCE,
  VIEWPOINT_TYPES,
  type KeyViewpointRecord,
  type LandformRecord,
  type ViaReview,
  type ViewpointRecord,
  type ViewpointSignificance,
  type ViewpointTypeId,
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
 * A view of interest's key-viewpoint choices, in its row: whether it is the key viewpoint the consultant reports
 * discuss its block from, and the blocks together from, overriding the run's choice (`chooseKeyViewpoints`). Held on
 * the review by block name and view name; never an input to the run.
 */
export function KeyViewpointFields({
  name,
  blocks,
  group,
  review,
  onReviewChange,
}: {
  /** The view's name, as the reports name it. */
  name: string
  /** The blocks it can be key for: its own block, and any block the review already gives it. */
  blocks: readonly string[]
  /** Offer *the blocks together* (more than one block in the scene). */
  group: boolean
  review: ViaReview
  onReviewChange: (patch: Partial<ViaReview>) => void
}) {
  const record = review.keyViewpoints ?? {}
  const setBlock = (block: string, entry: KeyViewpointRecord | null) =>
    onReviewChange({ keyViewpoints: tidy({ ...record, blocks: withEntry(record.blocks, block, entry) }) })
  const setGroup = (entry: KeyViewpointRecord | null) =>
    onReviewChange({ keyViewpoints: tidy({ ...record, group: entry }) })
  const choice = (
    label: string,
    entry: KeyViewpointRecord | undefined | null,
    onPick: (entry: KeyViewpointRecord | null) => void,
  ) => {
    const mine = entry?.view === name
    // Another view already chosen: ticking this one takes the choice over, and the label says from which.
    const other = entry?.view && !mine ? entry.view : null
    return (
      <div className="space-y-1.5" key={label}>
        <CheckboxField
          label={
            <>
              {label}
              {other && <span className="text-muted-foreground"> · now {other}</span>}
            </>
          }
          aria-label={`${label}: ${name}`}
          checked={mine}
          onCheckedChange={(checked) => onPick(checked ? { view: name } : null)}
        />
        {mine && (
          <FormField label={`Why · ${label.toLowerCase()}`} hideLabel>
            <input
              className={FORM_INPUT_CLASS}
              maxLength={2000}
              aria-label={`Why · ${label}: ${name}`}
              placeholder="Why this viewpoint (optional)"
              value={entry?.reason ?? ''}
              onChange={(event) => onPick(tidy({ view: name, reason: event.target.value }))}
            />
          </FormField>
        )}
      </div>
    )
  }
  return (
    <div className="space-y-1.5" data-key-viewpoint={name}>
      {blocks.map((block) =>
        choice(`Key viewpoint for ${block}`, record.blocks?.[block], (entry) =>
          // Unticking clears only this view's choice, never another view's.
          setBlock(block, entry ?? (record.blocks?.[block]?.view === name ? null : (record.blocks?.[block] ?? null))),
        ),
      )}
      {group &&
        choice('Key viewpoint for the blocks together', record.group, (entry) =>
          setGroup(entry ?? (record.group?.view === name ? null : (record.group ?? null))),
        )}
    </div>
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
  typeEstimate,
}: {
  name: string
  review: ViaReview
  onReviewChange: (patch: Partial<ViaReview>) => void
  /**
   * The run's 3.2.1 estimate, offered only for the view the run stands at (`viewpointImportance`); the hint says how
   * it was read, or why there is none.
   */
  typeEstimate?: { rating: ViewpointTypeId | null; hint: string | null }
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
      <SelectField
        label="Viewpoint type (3.2.1)"
        aria-label={`Viewpoint type of ${name}`}
        value={record.type ? String(record.type) : ''}
        onChange={(event) =>
          change(name, { type: event.target.value ? (Number(event.target.value) as ViewpointTypeId) : undefined })
        }
      >
        <option value="">
          {typeEstimate?.rating ? `Use the run's estimate (type ${typeEstimate.rating})` : 'Not recorded'}
        </option>
        {VIEWPOINT_TYPES.map((type) => (
          <option key={type.id} value={String(type.id)}>
            {type.id}. {type.label}
          </option>
        ))}
      </SelectField>
      {typeEstimate?.hint && <p className="text-2xs text-muted-foreground">{typeEstimate.hint}</p>}
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

/**
 * Moves a viewpoint's records to its new name when the view is renamed: its Table 3 record (unless the new name
 * already has one) and any key-viewpoint choice naming it. Null when nothing names it.
 */
export function renamedViewpointRecords(review: ViaReview, from: string, to: string): Partial<ViaReview> | null {
  if (from === to) return null
  const patch: Partial<ViaReview> = {}
  const record = review.viewpointRecords?.[from]
  if (record && !review.viewpointRecords?.[to]) {
    const next = { ...review.viewpointRecords }
    delete next[from]
    next[to] = record
    patch.viewpointRecords = next
  }
  const key = review.keyViewpoints
  const blocks = key?.blocks
  const blockNamed = blocks && Object.values(blocks).some((entry) => entry.view === from)
  const groupNamed = key?.group?.view === from
  if (key && (blockNamed || groupNamed)) {
    patch.keyViewpoints = {
      ...key,
      ...(blocks
        ? {
            blocks: Object.fromEntries(
              Object.entries(blocks).map(([block, entry]) => [
                block,
                entry.view === from ? { ...entry, view: to } : entry,
              ]),
            ),
          }
        : {}),
      ...(groupNamed ? { group: { ...key.group!, view: to } } : {}),
    }
  }
  return Object.keys(patch).length ? patch : null
}

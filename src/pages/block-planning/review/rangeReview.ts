import profile from '../../../../packages/legal-rules/forestry-profile.json'
import { entryOf, shapeOf, type Block, type Plan, type RangeReview } from '../plan'
import { shapeSignature } from '../records'
import { mappedCurrent } from './grazingEvidence'

export const RANGE_INSTRUMENT = 'bc.crown-grazing'
export const RANGE_RELEASE = `${RANGE_INSTRUMENT}@1.1.0`

const sameFootprint = (a: RangeReview, b: RangeReview) =>
  a.shape === b.shape && a.footprint === b.footprint && a.harvestYear === b.harvestYear

function blankRangeReview(plan: Plan, block: Block, schedule: string): RangeReview {
  const entry = entryOf(plan, schedule, block.id)
  const shape = shapeOf(block, entry)
  return {
    block: block.id,
    schedule,
    shape: shape.id,
    footprint: shapeSignature(shape.geometry),
    harvestYear: entry.year,
    review: { selected: [RANGE_RELEASE], date: profile.assessmentDate, sets: {} },
  }
}

export function rangeReviewFor(plan: Plan, block: Block, schedule = plan.reviewSchedule) {
  const blank = blankRangeReview(plan, block, schedule)
  const saved = plan.rangeReviews?.find((r) => r.block === block.id && r.schedule === schedule)
  const stale = Boolean(saved && !sameFootprint(saved, blank))
  // A changed harvest year leaves the ground the same: the mapped read still describes it.
  const mapped = saved?.mapped && mappedCurrent({ ...blank, mapped: saved.mapped }) ? saved.mapped : undefined
  return { record: saved && !stale ? saved : mapped ? { ...blank, mapped } : blank, stale }
}

export function rangeReviewCurrent(plan: Plan, record: RangeReview) {
  const block = plan.blocks.find((b) => b.id === record.block)
  return Boolean(
    block &&
    plan.schedules.some((s) => s.id === record.schedule) &&
    sameFootprint(record, blankRangeReview(plan, block, record.schedule)),
  )
}

/** Whether a record's mapped read describes the block's footprint under its schedule as it stands now. */
export function mappedReadCurrent(plan: Plan, record: RangeReview) {
  const block = plan.blocks.find((b) => b.id === record.block)
  if (!block || !record.mapped || !plan.schedules.some((s) => s.id === record.schedule)) return false
  return mappedCurrent({ ...blankRangeReview(plan, block, record.schedule), mapped: record.mapped })
}

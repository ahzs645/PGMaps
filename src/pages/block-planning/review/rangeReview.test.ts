import { describe, expect, it } from 'vitest'
import raw from '../../../../packages/legal-rules/packs/bc-crown-grazing.json'
import { assess } from '../../../../packages/legal-rules/engine/evaluate'
import { parsePack } from '../../../../packages/legal-rules/src/contract'
import { removeBlock, removeSchedule, saveRangeReview, setEntry } from '../edits'
import { assessmentRecord, buildExport } from '../exports'
import { parsePlan, samplePlan } from '../plan'
import { analyzePlan } from '../planAnalysis'
import { rangeReviewCurrent, rangeReviewFor } from './rangeReview'
import { setFact } from './caseEdits'

const pack = parsePack(raw)

function findings(facts: Record<string, boolean | string>, date = '2026-11-17') {
  const plan = samplePlan()
  const { record } = rangeReviewFor(plan, plan.blocks[0])
  const review = Object.entries(facts).reduce((next, [id, value]) => setFact(next, pack, id, value), record.review)
  const assessment = assess(date, [pack], Object.values(review.sets))
  expect(assessment.bindingDecision).toBe(false)
  return Object.fromEntries(assessment.releases[0].findings.map((f) => [f.rule, f.status]))
}

const PART_B = 'Part B: forest-health harvest'
const NOT_EXEMPT = 'No'
const RANGE_D = '(d) land used exclusively for grazing or hay under a Range Act agreement'
const INTERMEDIATE = '(h) commercial thinning, removal of individual trees or similar intermediate cutting'

describe('Crown grazing rules', () => {
  // A beetle-killed block in a mapped agriculture development area, on an FSP holder with a
  // free-growing duty: the case the review must explain.
  const adaPartB = {
    'ada-sra-applicable': true,
    'ada-sra-excluded': false,
    'ada-sra-harvest': true,
    'ada-sra-pathway': PART_B,
    'section-29-scope': true,
    'exempt-purpose': NOT_EXEMPT,
    'nar-reserved': false,
  }

  it('explains why a Part B block that cannot regenerate naturally should not be cut', () => {
    expect(findings(adaPartB)['cannot-reforest-ada-sra']).toBe('missing_evidence')
    expect(findings({ ...adaPartB, 'natural-regen-meets-standard': false })).toMatchObject({
      'cannot-reforest-ada-sra': 'review_required',
      'ada-sra-part-c': 'review_required',
      'free-growing': 'review_required',
    })
    expect(findings({ ...adaPartB, 'natural-regen-meets-standard': true })['cannot-reforest-ada-sra']).toBe(
      'condition_not_triggered',
    )
    expect(findings({ ...adaPartB, 'ada-sra-planting': true })['ada-sra-planting-restriction']).toBe('review_required')
  })

  it('offers the reserved-ground and Part A routes when planting is the obstacle', () => {
    const stuck = { ...adaPartB, 'natural-regen-meets-standard': false, 'ada-sra-planting': true }
    expect(findings(stuck)['cannot-reforest-ada-sra']).toBe('review_required')
    expect(findings({ ...stuck, 'nar-reserved': true })).toMatchObject({
      'cannot-reforest-ada-sra': 'condition_not_triggered',
      'nar-reserved': 'review_required',
      'ada-sra-planting-restriction': 'review_required',
    })
    const partA = { ...stuck, 'ada-sra-pathway': 'Part A: environmental or safety harvest' }
    expect(findings(partA)).toMatchObject({
      'ada-sra-part-a-planting': 'review_required',
      'ada-sra-planting-restriction': 'outside_scope',
      'cannot-reforest-ada-sra': 'condition_not_triggered',
    })
  })

  it('leaves the order out where Part II excludes the permit, and an intermediate cut out of the free-growing duty', () => {
    const excluded = { ...adaPartB, 'ada-sra-excluded': true, 'natural-regen-meets-standard': false }
    expect(findings(excluded)).toMatchObject({
      'ada-sra-excluded': 'review_required',
      'cannot-reforest-ada-sra': 'condition_not_triggered',
      'ada-sra-part-c': 'outside_scope',
    })
    const thinning = { ...adaPartB, 'exempt-purpose': INTERMEDIATE, 'natural-regen-meets-standard': false }
    expect(findings(thinning)).toMatchObject({
      'cannot-reforest-ada-sra': 'condition_not_triggered',
      'intermediate-cut-stocking': 'review_required',
    })
  })

  it('names the missing pathway, the Part B conditions and the referral', () => {
    expect(findings({ ...adaPartB, 'ada-sra-pathway': 'None of these' })).toMatchObject({
      'ada-sra-no-pathway': 'review_required',
      'ada-sra-part-c': 'condition_not_triggered',
    })
    expect(
      findings({
        ...adaPartB,
        'part-b-indication': false,
        'dead-or-infested-only': false,
        'referred-to-agriculture': false,
      }),
    ).toMatchObject({
      'ada-sra-part-b-basis': 'review_required',
      'ada-sra-part-c1': 'review_required',
      'ada-sra-referral': 'review_required',
    })
  })

  it('flags a preharvest proposal to keep part of the reforestation area permanently open', () => {
    const ordinary = { 'section-29-scope': true, 'exempt-purpose': NOT_EXEMPT }
    expect(findings({ ...ordinary, 'permanent-grazing-opening': false })['permanent-grazing-opening']).toBe(
      'condition_not_triggered',
    )
    expect(findings({ ...ordinary, 'permanent-grazing-opening': true })).toMatchObject({
      'free-growing': 'review_required',
      'permanent-grazing-opening': 'review_required',
      'exclusive-range': 'condition_not_triggered',
    })
  })

  it('needs a Range Act agreement and exclusive use for §44(3)(d), never a Land Act lease', () => {
    const claim = { 'section-29-scope': true, 'exempt-purpose': RANGE_D }
    expect(findings({ ...claim, 'range-act-agreement': true })['exclusive-range']).toBe('missing_evidence')
    expect(findings({ ...claim, 'range-act-agreement': true, 'exclusive-range-use': true })).toMatchObject({
      'exclusive-range': 'review_required',
      'not-exclusive': 'condition_not_triggered',
    })
    expect(findings({ ...claim, 'range-act-agreement': true, 'exclusive-range-use': false })).toMatchObject({
      'exclusive-range': 'condition_not_triggered',
      'not-exclusive': 'review_required',
    })
    expect(findings({ ...claim, 'land-act-lease': true })).toMatchObject({
      'lease-not-crown-range': 'review_required',
      'lease-terms': 'review_required',
      'lease-review-with-lessee': 'review_required',
    })
  })

  it('reads a section 17 grazing designation as a Land Act designation, not a lease or an exemption', () => {
    const s17 = {
      'land-act-designation': 'Section 17 designated use area',
      'range-act-agreement': true,
      'section-29-scope': true,
      'exempt-purpose': NOT_EXEMPT,
    }
    expect(findings(s17)).toMatchObject({
      'land-act-designation': 'review_required',
      'designation-terms': 'missing_evidence',
      'range-holder-livestock': 'review_required',
      'free-growing': 'review_required',
      'lease-not-crown-range': 'condition_not_triggered',
    })
    expect(findings({ ...s17, 'designation-terms-restrict': true })['designation-terms']).toBe('review_required')
    expect(findings({ ...s17, 'exempt-purpose': RANGE_D })).toMatchObject({
      'designation-not-lease': 'review_required',
      'exclusive-range': 'missing_evidence',
      'range-holder-livestock': 'condition_not_triggered',
    })
  })

  it('reviews a lease, a range development and a natural barrier', () => {
    expect(
      findings({
        'land-act-lease': true,
        'lease-conflict': true,
        'range-development-affected': true,
        'barrier-impact': true,
        'plan-conflict': true,
      }),
    ).toMatchObject({
      'lease-terms': 'review_required',
      'lease-conflict': 'review_required',
      'range-development': 'review_required',
      'natural-barrier': 'review_required',
      'restricted-activity': 'review_required',
    })
  })

  it('marks a later legal assessment date as outside the verified source window', () => {
    expect(new Set(Object.values(findings({}, '2027-01-01')))).toEqual(new Set(['outside_source_window']))
  })
})

describe('Grazing reviews follow the schedule and footprint', () => {
  it('round-trips evidence and keeps a changed harvest year pending fresh evidence', () => {
    const initial = samplePlan()
    const block = initial.blocks[0]
    const { record } = rangeReviewFor(initial, block)
    const other = initial.schedules.find((s) => s.id !== record.schedule)!
    const saved = { ...record, reference: 'Signed lease and approved plan reference' }
    const plan = parsePlan(JSON.parse(JSON.stringify(saveRangeReview(initial, saved))))
    expect(rangeReviewFor(plan, block).record).toEqual(saved)
    expect(rangeReviewFor(plan, block, other.id).record.reference).toBeUndefined()
    const changed = setEntry(plan, record.schedule, block.id, { year: (record.harvestYear ?? 2026) + 1 })
    expect(rangeReviewCurrent(changed, saved)).toBe(false)
    expect(rangeReviewFor(changed, block)).toMatchObject({ stale: true, record: { review: { sets: {} } } })
    expect(rangeReviewFor(changed, block).record.reference).toBeUndefined()
    expect(saveRangeReview(changed, saved)).toBe(changed)
    const movedBlock = {
      ...block,
      shapes: block.shapes.map((s) => ({ ...s, geometry: initial.baseline[0].geometry })),
    }
    expect(rangeReviewCurrent({ ...plan, blocks: [movedBlock, ...plan.blocks.slice(1)] }, saved)).toBe(false)
    expect(removeBlock(plan, block.id).rangeReviews).toEqual([])
    expect(removeSchedule(plan, record.schedule).rangeReviews).toEqual([])
  })

  it('exports the current finding and preserves stale evidence without evaluating it', () => {
    const initial = samplePlan()
    const block = initial.blocks[0]
    const { record } = rangeReviewFor(initial, block)
    const plan = saveRangeReview(initial, {
      ...record,
      reference: 'FSP <clause>',
      review: setFact(record.review, pack, 'barrier-impact', true),
    })
    const result = analyzePlan(plan, { schedule: record.schedule, year: plan.area.startYear })
    const exported = assessmentRecord(plan, result, [pack], '2026-11-23')
    expect(exported.rangeReviews[0]).toMatchObject({ current: true, assessment: { bindingDecision: false } })
    const summary = buildExport('summary', plan, result, [pack], '2026-11-23')
    expect(summary).toContain('FSP &lt;clause&gt;')
    expect(summary).toContain('must be followed by the mitigation the operational plan specifies')

    const changed = setEntry(plan, record.schedule, block.id, { year: null })
    expect(assessmentRecord(changed, result, [pack], '2026-11-23').rangeReviews[0]).toMatchObject({
      current: false,
      assessment: null,
      reference: 'FSP <clause>',
    })
  })
})

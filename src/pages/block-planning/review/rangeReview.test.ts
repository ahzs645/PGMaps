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

function findings(facts: Record<string, boolean>, date = '2026-11-17') {
  const plan = samplePlan()
  const { record } = rangeReviewFor(plan, plan.blocks[0])
  const review = Object.entries(facts).reduce((next, [id, value]) => setFact(next, pack, id, value), record.review)
  const assessment = assess(date, [pack], Object.values(review.sets))
  expect(assessment.bindingDecision).toBe(false)
  return Object.fromEntries(assessment.releases[0].findings.map((f) => [f.rule, f.status]))
}

describe('Crown grazing rules', () => {
  it('flags a preharvest proposal to keep part of the reforestation area permanently open', () => {
    const ordinary = { 'section-29-scope': true, 'range-act-agreement': false }
    expect(findings({ ...ordinary, 'permanent-grazing-opening': false })['permanent-grazing-opening']).toBe(
      'condition_not_triggered',
    )
    expect(findings({ ...ordinary, 'permanent-grazing-opening': true })).toMatchObject({
      'free-growing': 'review_required',
      'permanent-grazing-opening': 'review_required',
      'exclusive-range': 'outside_scope',
    })
  })

  it('requires exclusive use and a qualifying harvest, even on confirmed Range Act land', () => {
    const range = { 'range-act-agreement': true, 'section-29-scope': true }
    expect(findings(range)).toMatchObject({
      'range-plan': 'review_required',
      'free-growing': 'review_required',
      'exclusive-range': 'missing_evidence',
    })
    expect(findings({ ...range, 'exclusive-range-use': false })['exclusive-range']).toBe('condition_not_triggered')
    expect(findings({ ...range, 'exclusive-range-use': true })['exclusive-range']).toBe('missing_evidence')
    expect(findings({ ...range, 'exclusive-range-use': true, 'range-only-harvest': true })['exclusive-range']).toBe(
      'review_required',
    )
  })

  it('reviews a lease and a natural barrier without inferring a Range Act exemption', () => {
    expect(
      findings({
        'land-act-lease': true,
        'lease-conflict': true,
        'range-act-agreement': false,
        'section-29-scope': true,
        'barrier-impact': true,
        'plan-conflict': true,
      }),
    ).toMatchObject({
      'lease-terms': 'review_required',
      'lease-conflict': 'review_required',
      'natural-barrier': 'review_required',
      'restricted-activity': 'review_required',
      'free-growing': 'review_required',
      'exclusive-range': 'outside_scope',
    })
  })

  it('marks a later legal assessment date as outside the verified source window', () => {
    expect(new Set(Object.values(findings({}, '2027-01-01')))).toEqual(new Set(['outside_source_window']))
  })

  it('ties the Omineca planting restriction to the order and its forest-health pathway', () => {
    const ada = { 'ada-sra-applicable': true, 'ada-sra-harvest': true, 'ada-sra-planting': true }
    expect(findings(ada)).toMatchObject({
      'ada-sra-harvest-route': 'review_required',
      'ada-sra-planting-restriction': 'missing_evidence',
    })
    expect(findings({ ...ada, 'ada-sra-part-b': true })['ada-sra-planting-restriction']).toBe('review_required')
    expect(findings({ ...ada, 'ada-sra-part-b': false })['ada-sra-planting-restriction']).toBe(
      'condition_not_triggered',
    )
    expect(findings({ ...ada, 'ada-sra-applicable': false })['ada-sra-planting-restriction']).toBe('outside_scope')
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
    expect(summary).toContain('proposed practice triggers review of natural range barrier mitigation')

    const changed = setEntry(plan, record.schedule, block.id, { year: null })
    expect(assessmentRecord(changed, result, [pack], '2026-11-23').rangeReviews[0]).toMatchObject({
      current: false,
      assessment: null,
      reference: 'FSP <clause>',
    })
  })
})

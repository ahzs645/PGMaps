import { describe, expect, it } from 'vitest'
import raw from '../../../../packages/legal-rules/packs/bc-crown-grazing.json'
import raw110 from '../../../../packages/legal-rules/packs/bc-crown-grazing-v1.1.0.json'
import { assess } from '../../../../packages/legal-rules/engine/evaluate'
import { parsePack, type Claim } from '../../../../packages/legal-rules/src/contract'
import { removeBlock, removeSchedule, saveRangeReview, setEntry } from '../edits'
import { assessmentRecord, buildExport } from '../exports'
import { parsePlan, samplePlan } from '../plan'
import { analyzePlan } from '../planAnalysis'
import { RANGE_RELEASE, rangeReviewCurrent, rangeReviewFor } from './rangeReview'
import { setClaim, setFact } from './caseEdits'

const pack = parsePack(raw)
const pack110 = parsePack(raw110)

type Answers = Record<string, boolean | string | number>

function evaluate(facts: Answers, claims: Claim[] = [], date = '2026-11-17') {
  const plan = samplePlan()
  const { record } = rangeReviewFor(plan, plan.blocks[0])
  const answered = Object.entries(facts).reduce((next, [id, value]) => setFact(next, pack, id, value), record.review)
  const review = claims.reduce((next, claim) => setClaim(next, pack, claim.rule, claim), answered)
  const assessment = assess(date, [pack], Object.values(review.sets))
  expect(assessment.bindingDecision).toBe(false)
  return assessment.releases[0].findings
}

function findings(facts: Answers, date = '2026-11-17') {
  return Object.fromEntries(evaluate(facts, [], date).map((f) => [f.rule, f.status]))
}

/** The rule's status, and where the exception claimed on it stands. */
function claimed(facts: Answers, rule: string, exception: string) {
  const finding = evaluate(facts, [{ rule, exception }]).find((f) => f.rule === rule)!
  return { status: finding.status, standing: 'exception' in finding ? finding.exception?.standing : undefined }
}

const PART_B = 'Part B: forest-health harvest'

describe('Crown grazing rules', () => {
  // A beetle-killed block in a mapped agriculture development area, on an FSP holder with a
  // free-growing duty: the case the review must explain.
  const adaPartB = {
    'ada-sra-applicable': true,
    'ada-sra-excluded': false,
    'ada-sra-harvest': true,
    'ada-sra-pathway': PART_B,
    'section-29-scope': true,
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

  it('leaves the order out where Part II excludes the permit, and takes an intermediate cut as an exception', () => {
    const excluded = { ...adaPartB, 'ada-sra-excluded': true, 'natural-regen-meets-standard': false }
    expect(findings(excluded)).toMatchObject({
      'ada-sra-excluded': 'review_required',
      'cannot-reforest-ada-sra': 'condition_not_triggered',
      'ada-sra-part-c': 'outside_scope',
    })
    // An intermediate cut is the reviewer's claim on the raised finding, never an answer that clears it.
    const stuck = { ...adaPartB, 'natural-regen-meets-standard': false }
    expect(claimed(stuck, 'cannot-reforest-ada-sra', 'intermediate-cut')).toEqual({
      status: 'review_required',
      standing: 'relied_on',
    })
    expect(claimed(stuck, 'cannot-reforest-ada-sra', 'part-e-deviation')).toEqual({
      status: 'review_required',
      standing: 'pending',
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
    const ordinary = { 'section-29-scope': true }
    expect(findings({ ...ordinary, 'permanent-grazing-opening': false })['permanent-grazing-opening']).toBe(
      'condition_not_triggered',
    )
    expect(findings({ ...ordinary, 'permanent-grazing-opening': true })).toMatchObject({
      'free-growing': 'review_required',
      'permanent-grazing-opening': 'review_required',
    })
  })

  it('takes the small openings FPPR §46.11(2) tolerates as an exception, tested on the openings entered', () => {
    const open = { 'section-29-scope': true, 'permanent-grazing-opening': true }
    const small = (answers: Answers) => claimed({ ...open, ...answers }, 'permanent-grazing-opening', 'small-openings')
    expect(small({})).toEqual({ status: 'review_required', standing: 'unanswered' })
    expect(small({ 'opening-largest': 0.6 })).toEqual({ status: 'review_required', standing: 'relied_on' })
    expect(small({ 'opening-largest': 1.8, 'opening-share': 4 })).toEqual({
      status: 'review_required',
      standing: 'relied_on',
    })
    expect(small({ 'opening-largest': 1.8, 'opening-share': 7 }).standing).toBe('not_supported')
    expect(small({ 'opening-largest': 3, 'opening-share': 4 }).standing).toBe('not_supported')
  })

  it('needs a Range Act agreement and exclusive use for §44(3)(d), never a Land Act lease', () => {
    const duty = { 'section-29-scope': true }
    const d = (answers: Answers) => claimed({ ...duty, ...answers }, 'free-growing', 'exclusive-range').standing
    expect(d({ 'range-act-agreement': true })).toBe('unanswered')
    expect(d({ 'range-act-agreement': true, 'exclusive-range-use': true, 'land-act-lease': false })).toBe('relied_on')
    expect(d({ 'range-act-agreement': true, 'exclusive-range-use': false, 'land-act-lease': false })).toBe(
      'not_supported',
    )
    expect(d({ 'range-act-agreement': true, 'exclusive-range-use': true, 'land-act-lease': true })).toBe(
      'not_supported',
    )
    expect(findings({ ...duty, 'land-act-lease': true })).toMatchObject({
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
    }
    expect(findings(s17)).toMatchObject({
      'land-act-designation': 'review_required',
      'designation-terms': 'missing_evidence',
      'designation-not-lease': 'review_required',
      'range-holder-livestock': 'review_required',
      'free-growing': 'review_required',
    })
    expect(findings({ ...s17, 'land-act-lease': false })['lease-not-crown-range']).toBe('condition_not_triggered')
    expect(findings({ ...s17, 'designation-terms-restrict': true })['designation-terms']).toBe('review_required')
    // Exclusive range use relieves the free-growing duty the livestock duty serves; the finding stays raised.
    expect(
      claimed(
        { ...s17, 'exclusive-range-use': true, 'land-act-lease': false },
        'range-holder-livestock',
        'exclusive-range',
      ),
    ).toEqual({ status: 'review_required', standing: 'relied_on' })
    expect(claimed(s17, 'range-holder-livestock', 'keep-out-exemption').standing).toBe('pending')
  })

  it('sends an intention not to reforest to the minister’s exemption, and an unmet standard to a proposal', () => {
    const open = { 'section-29-scope': true, 'nar-reserved': false }
    expect(findings({ ...open, 'no-reforestation-intended': true })['ministerial-exemption']).toBe('review_required')
    expect(
      findings({ ...open, 'no-reforestation-intended': true, 'nar-reserved': true })['ministerial-exemption'],
    ).toBe('condition_not_triggered')
    expect(
      claimed({ ...open, 'no-reforestation-intended': true }, 'ministerial-exemption', 'restricted-purpose'),
    ).toEqual({ status: 'review_required', standing: 'relied_on' })
    expect(findings({ 'section-29-scope': true, 'existing-standard-unmet': true })['standard-cannot-be-met']).toBe(
      'review_required',
    )
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

  it('asks no §44(3) purpose or §46.11 question: each is an exception on the rules it relieves', () => {
    expect(pack.version).toBe('1.3.0')
    expect(pack.facts.some((f) => f.id === 'exempt-purpose')).toBe(false)
    for (const id of ['opening-tolerance', 'intermediate-cut-stocking', 'exclusive-range', 'not-exclusive'])
      expect(pack.rules.some((r) => r.id === id)).toBe(false)
    const listed = (rule: string) => pack.rules.find((r) => r.id === rule)?.exceptions?.map((x) => x.id)
    expect(listed('free-growing')).toEqual([
      'restricted-purpose',
      'experimental',
      'exclusive-range',
      'intermediate-cut',
      'minister-exemption',
    ])
    expect(listed('permanent-grazing-opening')).toEqual([
      'small-openings',
      'plan-specifies',
      'exclusive-range',
      'minister-exemption',
    ])
    // The opening figures are asked only once the §46.11(2) exception is claimed.
    const tested = pack.rules.flatMap((r) => [...(r.scope ?? []), ...r.when].flat())
    expect(tested.some((c) => c.fact.startsWith('opening-'))).toBe(false)
  })

  it('marks a later legal assessment date as outside the verified source window', () => {
    expect(new Set(Object.values(findings({}, '2027-01-01')))).toEqual(new Set(['outside_source_window']))
  })
})

describe('Grazing reviews saved with release 1.1.0', () => {
  it('open on the release they were made with, with their answers, and still evaluate', () => {
    const initial = samplePlan()
    const block = initial.blocks[0]
    const { record } = rangeReviewFor(initial, block)
    expect(record.review.selected).toEqual([RANGE_RELEASE])
    expect(RANGE_RELEASE).toBe('bc.crown-grazing@1.3.0')
    const exempt = '(d) land used exclusively for grazing or hay under a Range Act agreement'
    const answers = {
      'section-29-scope': true,
      'exempt-purpose': exempt,
      'range-act-agreement': true,
      'exclusive-range-use': true,
    }
    const start = { ...record.review, selected: ['bc.crown-grazing@1.1.0'] }
    const old = {
      ...record,
      review: Object.entries(answers).reduce((next, [id, value]) => setFact(next, pack110, id, value), start),
    }
    const plan = parsePlan(JSON.parse(JSON.stringify(saveRangeReview(initial, old))))
    const opened = rangeReviewFor(plan, block)
    expect(opened.stale).toBe(false)
    expect(opened.record.review.selected).toEqual(['bc.crown-grazing@1.1.0'])
    expect(opened.record.review.sets['bc.crown-grazing@1.1.0'].facts).toContainEqual(
      expect.objectContaining({ id: 'exempt-purpose', value: exempt }),
    )
    const report = assess('2026-11-17', [pack110], Object.values(opened.record.review.sets))
    const statuses = Object.fromEntries(report.releases[0].findings.map((f) => [f.rule, f.status]))
    expect(statuses).toMatchObject({ 'exclusive-range': 'review_required', 'not-exclusive': 'condition_not_triggered' })
    // The assessment record evaluates it with 1.1.0 from a library holding both releases.
    const result = analyzePlan(plan, { schedule: old.schedule, year: plan.area.startYear })
    const exported = assessmentRecord(plan, result, [pack, pack110], '2026-11-27')
    const assessment = exported.rangeReviews[0].assessment
    const releases = assessment && 'releases' in assessment ? assessment.releases : []
    expect(releases.map((r) => `${r.pack.id}@${r.pack.version}`)).toEqual(['bc.crown-grazing@1.1.0'])
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

import { describe, expect, it } from 'vitest'
import profile from '../../../../packages/legal-rules/forestry-profile.json'
import { parsePack, releaseKey, type Pack, type Scalar } from '../../../../packages/legal-rules/src/contract'
import { analyzePlan } from '../planAnalysis'
import {
  addCrossing,
  confirmCrossing,
  removeBlock,
  removeCrossing,
  removeSchedule,
  setCrossingReview,
  setShapeGeometry,
  updateCrossing,
} from '../edits'
import { assessmentRecord, summaryHtml } from '../exports'
import {
  BLOCK_CROSSINGS_RELEASE,
  BLOCK_WATER_RELEASE,
  MIGRATED_CROSSING_LABEL,
  migrateCrossings,
  openPlanFile,
} from '../migrate'
import { parsePlan, samplePlan, type Plan, type ReviewCase } from '../plan'
import { boardCheckKey, oldForestKey } from '../records'
import { setClaim, setFact } from '../review/caseEdits'
import { CROSSING_INSTRUMENTS, CROSSING_RELEASES, crossingCurrent, crossingsOf } from './record'
import { assessCrossing, CROSSING_STANDING_WORDS, crossingRollup, rollupText, STANDING_ORDER } from './standing'

const library: Pack[] = Object.values(
  import.meta.glob('../../../../packages/legal-rules/packs/*.json', { eager: true, import: 'default' }),
).map(parsePack)
const release = (key: string) => library.find((p) => releaseKey(p) === key)!
const water = release('bc.water-crossings@2.0.0')
const fppr = release('bc.fppr-crossings@1.0.0')

/** Answers a crossing's case under one release. */
function answer(review: ReviewCase, pack: Pack, answers: Record<string, Scalar>) {
  return Object.entries(answers).reduce((r, [id, value]) => setFact(r, pack, id, value), review)
}

/** The sample with two crossings on Block 1 under the proposal: A rests on no authority, B on the forest route. */
function twoCrossings() {
  let plan = samplePlan()
  plan = addCrossing(plan, 'block-1', 'proposed', 'Crossing A').plan
  plan = addCrossing(plan, 'block-1', 'proposed', 'Crossing B').plan
  const [a, b] = plan.crossings!
  plan = setCrossingReview(
    plan,
    a.key,
    answer(a.review, water, {
      'stream-changes': true,
      'route-forest': false,
      'route-listed': false,
      'route-approval': false,
    }),
  )
  plan = setCrossingReview(
    plan,
    b.key,
    answer(b.review, water, {
      'stream-changes': true,
      'route-forest': true,
      'route-listed': false,
      'route-approval': false,
      'forest-holder': true,
      'frpa-compliant': true,
    }),
  )
  return plan
}

describe('crossing records in the plan', () => {
  it('leave a plan without crossings as it was', () => {
    const plan = samplePlan()
    const read = parsePlan(JSON.parse(JSON.stringify(plan)))
    expect(read).not.toHaveProperty('crossings')
    expect(JSON.stringify(read)).toBe(JSON.stringify(parsePlan(plan)))
    expect(openPlanFile(JSON.parse(JSON.stringify(plan)))).toEqual({ plan: read, notes: [] })
  })

  it('read back as written, each with its own key, block, schedule, footprint and review', () => {
    let plan = addCrossing(samplePlan(), 'block-1', 'proposed', '  Culvert at 0+240  ').plan
    plan = updateCrossing(plan, 'crossing-1', {
      role: 'own',
      structure: { kind: 'culvert', spanOrDiameterM: 0.6 },
      at: { road: { name: 'Spur 3' }, stream: { name: 'Unnamed tributary' } },
      note: ' Seen in the field ',
    })
    const [c] = plan.crossings!
    expect(c).toMatchObject({
      key: 'crossing-1',
      label: 'Culvert at 0+240',
      block: 'block-1',
      schedule: 'proposed',
      shape: 'shape-1',
      origin: 'entered',
      role: 'own',
      structure: { kind: 'culvert', spanOrDiameterM: 0.6 },
      note: 'Seen in the field',
      evidence: [],
      review: { selected: [...CROSSING_RELEASES], date: profile.assessmentDate, sets: {} },
    })
    expect(crossingCurrent(plan, c)).toBe(true)
    expect(parsePlan(JSON.parse(JSON.stringify(plan))).crossings).toEqual(plan.crossings)
  })

  it('are parsed tolerantly: a field that does not read is dropped, a record without its identity is left out and named', () => {
    const plan = addCrossing(samplePlan(), 'block-1', 'proposed', 'A').plan
    const good = plan.crossings![0]
    const raw = {
      ...plan,
      crossings: [
        { ...good, structure: { kind: 'aqueduct' }, role: 'mine', at: { point: ['x', 1] } },
        { ...good, key: 'crossing-2', block: 'gone' },
        { ...good, key: 'crossing-3', review: 'none' },
        { ...good }, // the same key again
      ],
    }
    const opened = openPlanFile(JSON.parse(JSON.stringify(raw)))
    expect(opened.plan.crossings).toHaveLength(1)
    const [c] = opened.plan.crossings!
    expect(c.role).toBe('unknown')
    expect(c).not.toHaveProperty('structure')
    expect(c).not.toHaveProperty('at')
    expect(opened.notes.join(' ')).toMatch(/3 stream crossings could not be read/)
  })

  it('stay out of the patch calculation and every check’s key', () => {
    const plan = samplePlan()
    const listed = twoCrossings()
    expect(boardCheckKey(listed)).toBe(boardCheckKey(plan))
    expect(oldForestKey(listed)).toBe(oldForestKey(plan))
    const shown = { schedule: 'proposed', year: 2026 }
    expect(analyzePlan(listed, shown)).toEqual(analyzePlan(plan, shown))
  })
})

describe('crossing edits', () => {
  it('add, rename, change and remove one crossing, and never store an empty field', () => {
    let plan = addCrossing(samplePlan(), 'block-1', 'proposed', '').plan
    expect(plan.crossings![0].label).toBe('Crossing 1')
    plan = updateCrossing(plan, 'crossing-1', { label: '   ' })
    expect(plan.crossings![0].label).toBe('Crossing 1')
    plan = updateCrossing(plan, 'crossing-1', { label: 'Bridge on Spur 3', structure: { kind: 'bridge' }, note: 'x' })
    plan = updateCrossing(plan, 'crossing-1', { structure: undefined, note: '  ' })
    expect(plan.crossings![0]).not.toHaveProperty('structure')
    expect(plan.crossings![0]).not.toHaveProperty('note')
    expect(plan.crossings![0].label).toBe('Bridge on Spur 3')
    const second = addCrossing(plan, 'block-1', 'proposed', 'B')
    expect(second.key).toBe('crossing-2')
    // A removed crossing's key is never handed to the next one.
    const after = addCrossing(removeCrossing(second.plan, 'crossing-1'), 'block-1', 'proposed', 'C')
    expect(after.key).toBe('crossing-3')
    expect(addCrossing(samplePlan(), 'no-block', 'proposed', 'X').key).toBe('')
  })

  it('go with their block or schedule, and a plan without crossings keeps no key', () => {
    const plan = twoCrossings()
    expect(removeBlock(plan, 'block-1').crossings).toEqual([])
    expect(removeSchedule(plan, 'proposed').crossings).toEqual([])
    expect(removeBlock(samplePlan(), 'block-1')).not.toHaveProperty('crossings')
  })

  it('are out of date when the block’s shape changes, and kept with their answers when the reviewer keeps them', () => {
    let plan = twoCrossings()
    const moved = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [-122.77, 53.99],
          [-122.76, 53.99],
          [-122.76, 54.0],
          [-122.77, 53.99],
        ],
      ],
    }
    plan = setShapeGeometry(plan, 'block-1', 'shape-1', moved)
    expect(plan.crossings!.map((c) => crossingCurrent(plan, c))).toEqual([false, false])
    const answers = plan.crossings![0].review
    plan = confirmCrossing(plan, plan.crossings![0].key)
    expect(crossingCurrent(plan, plan.crossings![0])).toBe(true)
    expect(plan.crossings![0].review).toBe(answers)
  })
})

describe('migrating a block’s water crossings answers', () => {
  function legacyPlan(facts: Record<string, Scalar>, claim = false): Plan {
    const earlier = release(BLOCK_WATER_RELEASE)
    let review: ReviewCase = {
      selected: ['bc.fppr@1.3.0', BLOCK_WATER_RELEASE],
      date: '2026-11-20',
      sets: {},
    }
    review = answer(review, earlier, facts)
    if (claim)
      review = setClaim(review, earlier, 'culvert-cover', { rule: 'culvert-cover', exception: 'manufacturer-cover' })
    return { ...samplePlan(), reviews: { 'block-1': review } }
  }

  it('turns a block-level 1.0.0 answer set into one crossing record, and says so', () => {
    const plan = legacyPlan(
      { 'stream-changes': true, 'route-listed': true, 'listed-culvert': true, 'culvert-cover': 250 },
      true,
    )
    const { plan: opened, notes } = openPlanFile(JSON.parse(JSON.stringify(plan)))
    expect(opened.crossings).toHaveLength(1)
    const [c] = opened.crossings!
    expect(c).toMatchObject({
      label: MIGRATED_CROSSING_LABEL,
      origin: 'entered',
      role: 'unknown',
      block: 'block-1',
      schedule: 'proposed',
      review: { selected: [BLOCK_WATER_RELEASE], date: '2026-11-20' },
    })
    expect(c.review.sets[BLOCK_WATER_RELEASE]).toEqual(plan.reviews['block-1'].sets[BLOCK_WATER_RELEASE])
    // The block review asks the block's one question in its place, the answer carried over.
    const block = opened.reviews['block-1']
    expect(block.selected).toEqual(['bc.fppr@1.3.0', BLOCK_CROSSINGS_RELEASE])
    expect(block.sets).not.toHaveProperty(BLOCK_WATER_RELEASE)
    expect(block.sets[BLOCK_CROSSINGS_RELEASE].facts).toEqual([
      expect.objectContaining({ id: 'stream-changes', value: true }),
    ])
    expect(notes.join(' ')).toContain(MIGRATED_CROSSING_LABEL)
    // The migrated crossing still raises what 1.0.0 raised for the block.
    const assessed = assessCrossing(opened, c, library)
    expect(assessed.raised.map((r) => r.finding.rule)).toContain('culvert-cover')
    expect(assessed.exceptions).toBe(1)
    // Opening it again changes nothing.
    expect(migrateCrossings(opened)).toEqual({ plan: opened, notes: [] })
  })

  it('only replaces a 1.0.0 release chosen with nothing answered', () => {
    const { plan: opened, notes } = openPlanFile(JSON.parse(JSON.stringify(legacyPlan({}))))
    expect(opened).not.toHaveProperty('crossings')
    expect(opened.reviews['block-1'].selected).toContain(BLOCK_CROSSINGS_RELEASE)
    expect(notes.join(' ')).toMatch(/nothing answered/)
  })
})

describe('one answer set per crossing', () => {
  it('evaluates each crossing on its own, and the block shows the one with no authority by name', () => {
    const plan = twoCrossings()
    const rollup = crossingRollup(plan, 'block-1', 'proposed', library)
    const [a, b] = rollup.crossings
    expect(a.raised.map((r) => r.finding.rule)).toContain('change-authority')
    // B's forest route does not answer for A, and A's lack of one does not touch B.
    expect(b.raised.map((r) => r.finding.rule)).not.toContain('change-authority')
    expect(rollup.standing).toBe('raised')
    expect(rollup.worst.map((c) => c.record.label)).toContain('Crossing A')
    expect(rollupText(rollup)).toContain('Crossing A (Changes in and about a stream · authority')
  })

  it('reads waiting answers as open, and the worst crossing as the block’s standing', () => {
    let plan = addCrossing(samplePlan(), 'block-1', 'proposed', 'Only').plan
    let rollup = crossingRollup(plan, 'block-1', 'proposed', library)
    expect(rollup.standing).toBe('open')
    expect(rollup.crossings[0].openQuestions).toBeGreaterThan(0)
    plan = setCrossingReview(plan, 'crossing-1', { ...plan.crossings![0].review, selected: [] })
    rollup = crossingRollup(plan, 'block-1', 'proposed', library)
    expect(rollup.standing).toBe('unreviewed')
    expect(crossingRollup(samplePlan(), 'block-1', 'proposed', library)).toEqual({
      standing: null,
      crossings: [],
      worst: [],
    })
    // Another schedule's crossings are not this schedule's.
    expect(crossingsOf(twoCrossings(), 'block-1', 'deferred')).toEqual([])
  })

  it('never reads a crossing whose releases do not cover the review date as clear', () => {
    let plan = addCrossing(samplePlan(), 'block-1', 'proposed', 'Only').plan
    // A date before every crossing release's window: nothing was assessed, so nothing is clear.
    plan = setCrossingReview(plan, 'crossing-1', { ...plan.crossings![0].review, date: '2016-06-01' })
    const rollup = crossingRollup(plan, 'block-1', 'proposed', library)
    expect(rollup.standing).toBe('undated')
    expect(rollup.crossings[0].raised).toEqual([])
    expect(CROSSING_STANDING_WORDS.undated).toBe('Not assessed on this date')
    // A raised rule in a covering release still leads.
    expect(STANDING_ORDER.indexOf('raised')).toBeLessThan(STANDING_ORDER.indexOf('undated'))
    expect(STANDING_ORDER.indexOf('undated')).toBeLessThan(STANDING_ORDER.indexOf('clear'))
  })

  it('keeps each crossing’s exception claims in that crossing’s own facts', () => {
    let plan = twoCrossings()
    const a = plan.crossings![0]
    const claimed = setClaim(
      answer(a.review, water, { 'route-listed': true, 'listed-culvert': true, 'culvert-cover': 250 }),
      water,
      'culvert-cover',
      { rule: 'culvert-cover', exception: 'manufacturer-cover', rationale: 'Manufacturer allows 200 mm' },
    )
    plan = setCrossingReview(plan, a.key, claimed)
    const [ca, cb] = crossingRollup(plan, 'block-1', 'proposed', library).crossings
    expect(ca.exceptions).toBe(1)
    expect(ca.raised.find((r) => r.finding.rule === 'culvert-cover')?.finding).toMatchObject({
      status: 'review_required',
      exception: { standing: 'relied_on' },
    })
    expect(cb.exceptions).toBe(0)
    expect(plan.crossings![1].review.sets[releaseKey(water)].claims).toBeUndefined()
  })

  it('answers FPPR and the water pack side by side for one crossing', () => {
    let plan = addCrossing(samplePlan(), 'block-1', 'proposed', 'Fish stream culvert').plan
    const c = plan.crossings![0]
    plan = setCrossingReview(
      plan,
      c.key,
      answer(c.review, fppr, { 'authorized-person': true, 'listed-species': true, 'activity-passage-effect': true }),
    )
    const assessed = assessCrossing(plan, plan.crossings![0], library)
    expect(assessed.raised.map((r) => `${r.pack.id}:${r.finding.rule}`)).toEqual([
      'bc.fppr-crossings:fish-passage-activity',
    ])
    expect(CROSSING_INSTRUMENTS).toEqual(['bc.water-crossings', 'bc.fppr-crossings'])
  })
})

describe('crossings in the outputs', () => {
  it('list each crossing with its findings, and the block’s roll-up, in the record and the summary', () => {
    const plan = { ...twoCrossings(), area: { ...samplePlan().area } }
    const result = analyzePlan(plan, { schedule: 'proposed', year: 2026 })
    const record = assessmentRecord(plan, result, library, '2026-11-27')
    expect(record.crossings).toHaveLength(1)
    expect(record.crossings[0]).toMatchObject({ block: 'block-1', schedule: 'proposed', standing: 'raised' })
    expect(record.crossings[0].crossings.map((c) => c.label)).toEqual(['Crossing A', 'Crossing B'])
    const html = summaryHtml(plan, result, library, '2026-11-27')
    expect(html).toContain('<h2>Stream crossings</h2>')
    expect(html).toContain('Crossing A')
    expect(html).toContain('Changes in and about a stream · authority')
  })
})

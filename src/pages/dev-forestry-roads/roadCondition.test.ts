import { describe, expect, it } from 'vitest'
import {
  assessRoadCondition,
  createRoadConditionPolicy,
  MAX_ROAD_CONDITION_OBSERVATIONS,
  parseRoadConditionObservations,
  parseRoadConditionPolicy,
  roadConditionDate,
  type RoadConditionObservation,
  type RoadConditionPolicy,
} from './roadCondition'

const policy: RoadConditionPolicy = { maxInspectionAgeDays: 30, maxImageryAgeDays: 7 }
const observation = (patch: Partial<RoadConditionObservation> = {}): RoadConditionObservation => ({
  id: 'inspection-1',
  source: 'inspection',
  component: 'overall',
  finding: 'serviceable',
  observedAt: '2026-10-20',
  sourceUrl: 'https://example.org/inspection-1.pdf',
  notes: 'Road surface and drainage reviewed for planning; no load rating supplied.',
  review: { reviewer: 'Recorded field reviewer', reviewedAt: '2026-10-21' },
  ...patch,
})
const assess = (records: RoadConditionObservation[], asOf = '2026-10-28', p = policy) =>
  assessRoadCondition(records, { asOf, policy: p })

describe('dated road condition estimates', () => {
  it('stays unknown without evidence or configured source-age applicability', () => {
    expect(assess([]).condition).toBe('unknown')
    const result = assess([observation()], '2026-10-28', createRoadConditionPolicy())
    expect(result.condition).toBe('unknown')
    expect(result.records[0].status).toBe('policy-unset')
    expect(result.truckCapacityEstablished).toBe(false)
  })

  it('uses a reviewed overall-road inspection with explicit date, age and expiry', () => {
    const result = assess([observation()])
    expect(result.condition).toBe('serviceable')
    expect(result.basis).toBe('inspection')
    expect(result.usedObservationIds).toEqual(['inspection-1'])
    expect(result.evidenceAgeDays).toEqual({ youngest: 8, oldest: 8 })
    expect(result.expiresAt).toBe('2026-11-19')
    expect(result.truckCapacityEstablished).toBe(false)
  })

  it('uses the boundary day and becomes unknown the next day without predicting deterioration', () => {
    expect(assess([observation()], '2026-11-19').condition).toBe('serviceable')
    const stale = assess([observation()], '2026-11-20')
    expect(stale.condition).toBe('unknown')
    expect(stale.records[0].status).toBe('stale')
    expect(stale.records[0].ageDays).toBe(31)
    expect(stale.usedObservationIds).toEqual([])
  })

  it('applies imagery and inspection windows independently and allows a same-day-only window', () => {
    expect(assess([observation({ source: 'imagery' })]).records[0].status).toBe('stale')
    const sameDay = { maxInspectionAgeDays: 0, maxImageryAgeDays: 0 }
    expect(
      assess([observation({ review: { reviewer: 'Reviewer', reviewedAt: '2026-10-20' } })], '2026-10-20', sameDay)
        .condition,
    ).toBe('serviceable')
    expect(assess([observation()], '2026-10-21', sameDay).condition).toBe('unknown')
  })

  it('excludes unreviewed records and observations/reviews after the evaluation date', () => {
    const records = [
      observation({ id: 'unreviewed', review: undefined }),
      observation({
        id: 'future-observation',
        observedAt: '2026-11-01',
        review: { reviewer: 'Reviewer', reviewedAt: '2026-11-02' },
      }),
      observation({ id: 'future-review', review: { reviewer: 'Reviewer', reviewedAt: '2026-11-02' } }),
    ]
    const result = assess(records)
    expect(result.condition).toBe('unknown')
    expect(result.records.map((record) => record.status)).toEqual(['unreviewed', 'future', 'future'])
  })

  it('keeps reviewed imagery an inference and does not establish crossing capacity', () => {
    const result = assess([
      observation({
        source: 'imagery',
        observedAt: '2026-10-25',
        review: { reviewer: 'Image reviewer', reviewedAt: '2026-10-26' },
      }),
    ])
    expect(result.condition).toBe('serviceable')
    expect(result.basis).toBe('imagery')
    expect(result.truckCapacityEstablished).toBe(false)
    const bridge = assess([
      observation({
        source: 'imagery',
        component: 'bridge',
        observedAt: '2026-10-25',
        review: { reviewer: 'Image reviewer', reviewedAt: '2026-10-26' },
      }),
    ])
    expect(bridge.condition).toBe('unknown')
    expect(bridge.records[0].status).toBe('insufficient-source')
    expect(bridge.truckCapacityEstablished).toBe(false)
  })

  it('allows a visible blocked crossing to flag closure without asserting any load rating', () => {
    const result = assess([
      observation(),
      observation({
        id: 'bridge-closure',
        source: 'imagery',
        component: 'bridge',
        assetReference: 'B-7',
        observedAt: '2026-10-25',
        finding: 'closed',
        review: { reviewer: 'Image reviewer', reviewedAt: '2026-10-26' },
      }),
    ])
    expect(result.condition).toBe('closed')
    expect(result.hasOpenClosureEvidence).toBe(true)
    expect(result.truckCapacityEstablished).toBe(false)
  })

  it('does not generalize a good surface observation to the whole road', () => {
    expect(assess([observation({ component: 'surface' })]).condition).toBe('unknown')
    expect(assess([observation({ component: 'surface', finding: 'rehabilitation' })]).condition).toBe('rehabilitation')
  })

  it('retains contradictory current findings until explicitly resolved, even when one is newer', () => {
    const result = assess([
      observation(),
      observation({
        id: 'newer',
        observedAt: '2026-10-25',
        finding: 'rehabilitation',
        review: { reviewer: 'Reviewer', reviewedAt: '2026-10-26' },
      }),
    ])
    expect(result.condition).toBe('unknown')
    expect(result.hasConflicts).toBe(true)
    expect(result.basis).toBe('conflicting')
    expect(result.usedObservationIds).toHaveLength(2)
    const closure = assess([observation(), observation({ id: 'closed', finding: 'closed' })])
    expect(closure.condition).toBe('closed')
    expect(closure.hasConflicts).toBe(true)
    expect(closure.hasOpenClosureEvidence).toBe(true)
  })

  it('replaces a closure only through applicable reviewed evidence explicitly referencing it', () => {
    const closed = observation({ id: 'closed', finding: 'closed' })
    const reopened = observation({
      id: 'newer',
      observedAt: '2026-10-25',
      review: { reviewer: 'Reviewer', reviewedAt: '2026-10-26' },
      supersedes: ['closed'],
    })
    const result = assess([closed, reopened])
    expect(result.condition).toBe('serviceable')
    expect(result.hasOpenClosureEvidence).toBe(false)
    expect(result.usedObservationIds).toEqual(['newer'])
    expect(result.records[0].status).toBe('superseded')
    expect(assess([closed, { ...reopened, review: undefined }]).condition).toBe('closed')
    expect(assess([closed, { ...reopened, source: 'imagery' }], '2026-11-05').condition).toBe('closed')
  })

  it('resolves supersession chains even when an intermediate source has expired', () => {
    const records = [
      observation({
        id: 'original',
        finding: 'closed',
        observedAt: '2026-10-01',
        review: { reviewer: 'Reviewer', reviewedAt: '2026-10-02' },
      }),
      observation({
        id: 'intermediate',
        source: 'imagery',
        observedAt: '2026-10-10',
        review: { reviewer: 'Reviewer', reviewedAt: '2026-10-11' },
        supersedes: ['original'],
      }),
      observation({
        id: 'latest',
        observedAt: '2026-10-25',
        review: { reviewer: 'Reviewer', reviewedAt: '2026-10-26' },
        supersedes: ['intermediate'],
      }),
    ]
    const result = assess(records)
    expect(result.condition).toBe('serviceable')
    expect(result.usedObservationIds).toEqual(['latest'])
    expect(result.records.map((record) => record.status)).toEqual(['superseded', 'superseded', 'current'])
  })

  it('cannot clear a previously closed structure with positive imagery', () => {
    const records = [
      observation({ id: 'bridge-closed', component: 'bridge', finding: 'closed' }),
      observation({
        id: 'image',
        component: 'bridge',
        source: 'imagery',
        observedAt: '2026-10-25',
        review: { reviewer: 'Reviewer', reviewedAt: '2026-10-26' },
        supersedes: ['bridge-closed'],
      }),
    ]
    const result = assess(records)
    expect(result.condition).toBe('closed')
    expect(result.hasOpenClosureEvidence).toBe(true)
    expect(result.records[1].status).toBe('insufficient-source')
  })

  it('does not reopen a road just because closure evidence ages beyond its applicability window', () => {
    const result = assess([
      observation({
        id: 'earlier-closure',
        observedAt: '2026-08-01',
        finding: 'closed',
        review: { reviewer: 'Reviewer', reviewedAt: '2026-08-02' },
      }),
      observation(),
    ])
    expect(result.condition).toBe('unknown')
    expect(result.hasOpenClosureEvidence).toBe(true)
    expect(result.unresolvedClosureObservationIds).toEqual(['earlier-closure'])
    expect(result.records[0].status).toBe('stale')
    expect(result.records[0].reason).toContain('not been explicitly resolved')
    const reopened = assess([
      observation({
        id: 'earlier-closure',
        observedAt: '2026-08-01',
        finding: 'closed',
        review: { reviewer: 'Reviewer', reviewedAt: '2026-08-02' },
      }),
      observation({ supersedes: ['earlier-closure'] }),
    ])
    expect(reopened.condition).toBe('serviceable')
    expect(reopened.hasOpenClosureEvidence).toBe(false)
  })

  it('retains reviewed closure warnings with no age policy and does not resolve them with an unknown finding', () => {
    const closed = observation({ id: 'closed', finding: 'closed' })
    const noPolicy = assess([closed], '2026-10-28', createRoadConditionPolicy())
    expect(noPolicy.condition).toBe('unknown')
    expect(noPolicy.hasOpenClosureEvidence).toBe(true)
    const unknown = observation({ id: 'unknown', finding: 'unknown', supersedes: ['closed'] })
    expect(assess([closed, unknown]).hasOpenClosureEvidence).toBe(true)
    const bridgeClosed = { ...closed, component: 'bridge' as const }
    const imageRehab = observation({
      id: 'image',
      component: 'bridge',
      source: 'imagery',
      finding: 'rehabilitation',
      supersedes: ['closed'],
    })
    expect(assess([bridgeClosed, imageRehab], '2026-10-25').hasOpenClosureEvidence).toBe(true)
  })

  it('keeps different assets separate rather than treating one damaged culvert as a contradiction of another', () => {
    const result = assess([
      observation({ id: 'culvert-A', component: 'culvert', assetReference: 'C-A' }),
      observation({ id: 'culvert-B', component: 'culvert', assetReference: 'C-B', finding: 'rehabilitation' }),
    ])
    expect(result.hasConflicts).toBe(false)
    expect(result.condition).toBe('rehabilitation')
    expect(result.components.filter((component) => component.observationIds.length)).toHaveLength(2)
  })

  it('keeps an explicit unknown finding unresolved and does not mutate stored observations', () => {
    const input = [observation(), observation({ id: 'unknown-surface', component: 'surface', finding: 'unknown' })]
    const copy = structuredClone(input)
    expect(assess(input).condition).toBe('unknown')
    expect(input).toEqual(copy)
  })
})

describe('dated evidence validation', () => {
  it('rejects array-coerced condition enums so a closed finding cannot bypass strict downstream comparisons', () => {
    expect(() => parseRoadConditionObservations([{ ...observation(), source: ['inspection'] }])).toThrow('source')
    expect(() => parseRoadConditionObservations([{ ...observation(), component: ['overall'] }])).toThrow('component')
    expect(() => parseRoadConditionObservations([{ ...observation(), finding: ['closed'] }])).toThrow('condition')
  })
  it('accepts real leap dates and rejects rollover days and timestamp ambiguity', () => {
    expect(roadConditionDate('2024-02-29')).toBe('2024-02-29')
    expect(() => roadConditionDate('2026-02-29')).toThrow('real calendar')
    expect(() => roadConditionDate('2026-10-28T10:00:00Z')).toThrow()
  })

  it.each([
    'javascript:alert(1)',
    '//example.org/image',
    'https://user:secret@example.org/report',
    'file:///tmp/photo.jpg',
  ])('rejects unsafe or non-portable source links: %s', (sourceUrl) => {
    expect(() => parseRoadConditionObservations([observation({ sourceUrl })])).toThrow('URL')
  })

  it('requires non-empty notes, a named reviewer if reviewed, and review dates after observations', () => {
    expect(() => parseRoadConditionObservations([observation({ notes: '' })])).toThrow('notes')
    expect(() =>
      parseRoadConditionObservations([observation({ review: { reviewer: '', reviewedAt: '2026-10-21' } })]),
    ).toThrow('reviewer')
    expect(() =>
      parseRoadConditionObservations([observation({ review: { reviewer: 'Reviewer', reviewedAt: '2026-10-19' } })]),
    ).toThrow('precede')
  })

  it('rejects duplicate IDs, missing targets, wrong components/assets, backwards supersession and cycles', () => {
    expect(() => parseRoadConditionObservations([observation(), observation()])).toThrow('unique')
    expect(() => parseRoadConditionObservations([observation({ supersedes: ['missing'] })])).toThrow('must exist')
    expect(() =>
      parseRoadConditionObservations([
        observation(),
        observation({ id: 'surface', component: 'surface', supersedes: ['inspection-1'] }),
      ]),
    ).toThrow('same component')
    expect(() =>
      parseRoadConditionObservations([
        observation({ assetReference: 'A' }),
        observation({ id: 'B', assetReference: 'B', supersedes: ['inspection-1'] }),
      ]),
    ).toThrow('same component and asset')
    expect(() =>
      parseRoadConditionObservations([
        observation(),
        observation({ id: 'earlier', observedAt: '2026-10-01', supersedes: ['inspection-1'] }),
      ]),
    ).toThrow('later date')
    expect(() =>
      parseRoadConditionObservations([
        observation({ id: 'a', supersedes: ['b'] }),
        observation({ id: 'b', supersedes: ['a'] }),
      ]),
    ).toThrow('cycle')
  })

  it('bounds record counts and source-age policies without assigning inspection defaults', () => {
    expect(createRoadConditionPolicy()).toEqual({ maxInspectionAgeDays: null, maxImageryAgeDays: null })
    expect(() =>
      parseRoadConditionObservations(
        Array.from({ length: MAX_ROAD_CONDITION_OBSERVATIONS + 1 }, (_, index) =>
          observation({ id: `record-${index}` }),
        ),
      ),
    ).toThrow('at most')
    for (const days of [-1, 0.5, '30', 36_501])
      expect(() => parseRoadConditionPolicy({ maxInspectionAgeDays: days, maxImageryAgeDays: null })).toThrow('integer')
    expect(parseRoadConditionPolicy({ maxInspectionAgeDays: 0, maxImageryAgeDays: null }).maxInspectionAgeDays).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'
import {
  assessmentFingerprint,
  EMPTY_STREAM_ASSESSMENT,
  effectiveClass,
  parseStreamAssessment,
  RIPARIAN_WIDTHS,
  streamStatus,
  suggestRiparianClass,
  type StreamAssessment,
} from './streamClass'

const line = [
  [0, 0],
  [1, 1],
]
const assess = (patch: Partial<StreamAssessment>): StreamAssessment => ({ ...EMPTY_STREAM_ASSESSMENT, ...patch })
const fishClass = (channelWidthM: number, oneKmAverageWidthM?: number | null) =>
  suggestRiparianClass(assess({ channelWidthM, oneKmAverageWidthM, fish: 'present' })).riparianClass
const nonFishClass = (channelWidthM: number) =>
  suggestRiparianClass(assess({ channelWidthM, fish: 'absent-assessed', communityWatershed: 'outside' })).riparianClass

describe('suggestRiparianClass', () => {
  it('holds every width boundary in the regulation', () => {
    expect(fishClass(1.49)).toBe('S4')
    expect(fishClass(1.5)).toBe('S3')
    expect(fishClass(4.99)).toBe('S3')
    expect(fishClass(5)).toBe('S2')
    expect(fishClass(20)).toBe('S2')
    expect(fishClass(20.01)).toBe('S1-B')
    expect(fishClass(3, 100)).toBe('S1-A')
    expect(fishClass(25, 99.9)).toBe('S1-B')
    expect(nonFishClass(3)).toBe('S6')
    expect(nonFishClass(3.01)).toBe('S5')
  })

  it('treats a community watershed like a fish stream, whatever the fish finding', () => {
    const inside = assess({ channelWidthM: 2.4, fish: 'absent-assessed', communityWatershed: 'inside' })
    expect(suggestRiparianClass(inside).riparianClass).toBe('S3')
  })

  it('never lets missing evidence become S5 or S6', () => {
    expect(suggestRiparianClass(assess({ channelWidthM: 1 })).riparianClass).toBeNull()
    expect(suggestRiparianClass(assess({ channelWidthM: 1, communityWatershed: 'outside' })).riparianClass).toBeNull()
    expect(suggestRiparianClass(assess({ channelWidthM: 1, fish: 'absent-assessed' })).riparianClass).toBeNull()
    expect(suggestRiparianClass(EMPTY_STREAM_ASSESSMENT).riparianClass).toBeNull()
    expect(suggestRiparianClass(assess({ channelWidthM: 0, fish: 'present' })).riparianClass).toBeNull()
  })

  it('shows both outcomes when only the width is known', () => {
    const { alternatives, outstanding } = suggestRiparianClass(assess({ channelWidthM: 2.4 }))
    expect(alternatives).toEqual({ ifFishOrWatershed: 'S3', ifNeither: 'S6' })
    expect(outstanding).toEqual([
      'Determine whether it is a fish stream',
      'Check for a community watershed designation',
    ])
  })

  it('says what is settled and what is not', () => {
    const result = suggestRiparianClass(
      assess({ channelWidthM: 2.4, widthBasis: 'field', fish: 'presumed', communityWatershed: 'unresolved' }),
    )
    expect(result.riparianClass).toBe('S3')
    expect(result.basis).toEqual(['Channel width 2.4 m, field measurement', 'Fish stream: presumed fish stream'])
    expect(result.outstanding).toEqual(['Check for a community watershed designation'])
  })

  it('asks about S1-A rather than assuming S1-B on a wide stream', () => {
    expect(suggestRiparianClass(assess({ channelWidthM: 30, fish: 'present' })).outstanding).toContain(
      'Check the 1 km average width for S1-A',
    )
  })
})

describe('RIPARIAN_WIDTHS', () => {
  it('adds up to the totals in the regulation', () => {
    const totals = Object.fromEntries(
      Object.entries(RIPARIAN_WIDTHS).map(([name, w]) => [name, w.reserveM + w.managementM]),
    )
    expect(totals).toEqual({ 'S1-A': 100, 'S1-B': 70, S2: 50, S3: 40, S4: 30, S5: 30, S6: 20 })
  })
})

describe('streamStatus', () => {
  it('reads an old project as unassessed, not as any class', () => {
    expect(streamStatus(undefined, line)).toBe('unassessed')
    expect(effectiveClass(undefined)).toBeNull()
    expect(streamStatus(EMPTY_STREAM_ASSESSMENT, line)).toBe('unassessed')
  })

  it('moves from provisional to reviewed and back when the evidence or the reach changes', () => {
    const provisional = assess({ channelWidthM: 2.4, fish: 'presumed' })
    expect(streamStatus(provisional, line)).toBe('provisional')
    const reviewed = {
      ...provisional,
      reviewedClass: 'S3' as const,
      reviewedFingerprint: assessmentFingerprint(provisional, line),
    }
    expect(streamStatus(reviewed, line)).toBe('reviewed')
    expect(streamStatus({ ...reviewed, channelWidthM: 6 }, line)).toBe('needs-review')
    expect(streamStatus(reviewed, [...line, [2, 2]])).toBe('needs-review')
  })

  it("keeps a person's decision over the rules, and a source class apart from both", () => {
    const assessment = assess({ channelWidthM: 2.4, fish: 'present', importedClass: 'S4', reviewedClass: 'S2' })
    expect(effectiveClass(assessment)).toBe('S2')
    expect(suggestRiparianClass(assessment).riparianClass).toBe('S3')
    expect(assessment.importedClass).toBe('S4')
  })
})

describe('parseStreamAssessment', () => {
  it('round-trips a complete record', () => {
    const record: StreamAssessment = {
      channelWidthM: 2.4,
      widthBasis: 'field',
      widthDate: '2026-08-14',
      fish: 'presumed',
      communityWatershed: 'outside',
      importedClass: 'S4',
      reviewedClass: 'S3',
      reviewedFingerprint: 'abc',
      reviewedRules: 'fppr-s47@2026-11-03',
      assessor: 'A. Reviewer',
      assessedOn: '2026-11-07',
      evidenceUrl: 'https://example.com/card.pdf',
      notes: 'Rooted banks measured at three points.',
    }
    expect(parseStreamAssessment(JSON.parse(JSON.stringify(record)))).toEqual(record)
  })

  it('fills what an older file lacks as unresolved, never as a class', () => {
    const parsed = parseStreamAssessment({})
    expect(parsed).toEqual(EMPTY_STREAM_ASSESSMENT)
    expect(effectiveClass(parsed)).toBeNull()
  })

  it('refuses values it cannot read', () => {
    expect(() => parseStreamAssessment({ fish: 'maybe' })).toThrow(/Fish determination/)
    expect(() => parseStreamAssessment({ channelWidthM: -1 })).toThrow(/Channel width/)
    expect(() => parseStreamAssessment({ reviewedClass: 'S9' })).toThrow(/Reviewed class/)
  })
})

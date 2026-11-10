import { describe, expect, it } from 'vitest'
import {
  MAX_STEEPER_GRADE_PERCENT,
  STEEPER_GRADE_STEPS_PERCENT,
  steeperGrades,
  steeperGradeText,
  sweepSteeperGrades,
} from './steeperGrades'

describe('steeper grades', () => {
  it('tries +2 % then +4 %, held to the 30 % the searches take', () => {
    expect(STEEPER_GRADE_STEPS_PERCENT).toEqual([2, 4])
    expect(steeperGrades(12)).toEqual([14, 16])
    expect(steeperGrades(10.5)).toEqual([12.5, 14.5])
    expect(steeperGrades(27)).toEqual([29, 30])
    expect(steeperGrades(29)).toEqual([MAX_STEEPER_GRADE_PERCENT])
    expect(steeperGrades(30)).toEqual([])
  })

  it('stops at the first grade that connects, and says it is information only', async () => {
    const asked: number[] = []
    const result = await sweepSteeperGrades(12, async (grade) => {
      asked.push(grade)
      return grade >= 14 ? { lengthM: 412.4, search: 'the corridor search' } : null
    })
    expect(asked).toEqual([14])
    expect(result).toMatchObject({ limitPercent: 12, tried: [14], connectsAt: 14 })
    expect(steeperGradeText(result)).toBe(
      'Connects at 14%: 2% over the 12% limit, a 412 m line by the corridor search. For information only: no road was added and the grade limit is still 12%.',
    )
    const second = await sweepSteeperGrades(12, async (grade) =>
      grade >= 16 ? { lengthM: 1250, search: 'the switchback search' } : null,
    )
    expect(steeperGradeText(second)).toMatch(/^Connects at 16%, not at 14%: 4% over the 12% limit, a 1,250 m line/)
  })

  it('says when the ends do not connect up to the last grade tried', async () => {
    const result = await sweepSteeperGrades(12, async () => null)
    expect(result).toMatchObject({ tried: [14, 16], connectsAt: null, line: null })
    expect(steeperGradeText(result)).toBe(
      'Does not connect up to 16%: the search found no line at 14% or 16% in the same corridor either. A steeper grade alone will not join these ends; move an end or widen the corridor.',
    )
    expect(steeperGradeText(await sweepSteeperGrades(30, async () => null))).toBe(
      'No steeper grade tried: 30% is already at the 30% the searches take.',
    )
  })

  it('reports a search that could not run in its own words, and passes a cancel on', async () => {
    const refused = await sweepSteeperGrades(12, async () => {
      throw Error('An end is off the terrain.')
    })
    expect(refused.refused).toBe('An end is off the terrain.')
    expect(steeperGradeText(refused)).toBe('Could not try 14%: An end is off the terrain.')
    await expect(
      sweepSteeperGrades(12, async () => {
        throw new DOMException('Route comparison cancelled.', 'AbortError')
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})

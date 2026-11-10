import { describe, expect, it } from 'vitest'
import { runToCompletion } from './cooperative'
import {
  castWinchLines,
  DEFAULT_WINCH_RULE,
  emptyWinchField,
  rayTable,
  validateWinchRule,
  WINCH_HOLLOW_M,
  WINCH_HUMP_M,
  type WinchGround,
} from './winchReach'

/** One row of 5 m cells on level ground, a line east from the first cell. */
const row = (z: number[]): WinchGround => ({
  width: z.length,
  height: 1,
  cellM: 5,
  z: Float64Array.from(z),
  crossable: new Uint8Array(z.length).fill(1),
})
const rule = { ...DEFAULT_WINCH_RULE, upReachM: 150, downReachM: 150 }

describe('castWinchLines', () => {
  it('stops at the first cell past the reach and keeps the shortest line', () => {
    const ground = row(new Array(40).fill(100))
    const field = emptyWinchField(40)
    runToCompletion(
      castWinchLines(ground, [{ cell: 0, baseM: 0, choiceBase: 0, exit: 0 }], DEFAULT_WINCH_RULE, field, false),
    )
    // Level line: 80.23 m reach, so 80 m (cell 16) yes and 85 m no.
    expect(field.winchM[16]).toBeCloseTo(80, 6)
    expect(Number.isNaN(field.winchM[17])).toBe(true)
  })

  it(`lets the chord pass ${WINCH_HUMP_M} m over a rise and ${WINCH_HOLLOW_M} m over a hollow, no more`, () => {
    // A cell 50 m out already served by another line is passed over untested, so only the cells
    // beyond it test the chord against its ground.
    const reached = (bump: number) => {
      const z = new Array(30).fill(100)
      z[10] = 100 + bump
      const field = emptyWinchField(30)
      field.choice[10] = 0
      runToCompletion(castWinchLines(row(z), [{ cell: 0, baseM: 0, choiceBase: 0, exit: 0 }], rule, field, false))
      return Number.isFinite(field.winchM[20])
    }
    expect(reached(9.9)).toBe(true)
    expect(reached(10.1)).toBe(false)
    expect(reached(-19.9)).toBe(true)
    expect(reached(-20.1)).toBe(false)
  })

  it('stops at missing ground unless optimistic, and at cells it may not cross', () => {
    const z = new Array(20).fill(100)
    z[5] = NaN
    const strict = emptyWinchField(20),
      optimistic = emptyWinchField(20)
    const source = [{ cell: 0, baseM: 0, choiceBase: 0, exit: 0 }]
    runToCompletion(castWinchLines(row(z), source, rule, strict, false))
    runToCompletion(castWinchLines(row(z), source, rule, optimistic, true))
    expect(Number.isFinite(strict.winchM[8])).toBe(false)
    expect(optimistic.winchM[8]).toBeCloseTo(40, 6)
    const closed = row(new Array(20).fill(100))
    closed.crossable[4] = 0
    const field = emptyWinchField(20)
    runToCompletion(castWinchLines(closed, source, rule, field, false))
    expect(Number.isFinite(field.winchM[3])).toBe(true)
    expect(Number.isFinite(field.winchM[6])).toBe(false)
  })
})

describe('rayTable', () => {
  it('lists each bearing’s cells nearest first, north as a step up the rows', () => {
    const table = rayTable(5, 50)
    expect(table.rays).toHaveLength(360)
    const north = table.rays[0]
    expect([north.dc[0], north.dr[0], north.dh[0]]).toEqual([0, -1, 5])
    const east = table.rays[90]
    expect([east.dc[9], east.dr[9], east.dh[9]]).toEqual([10, 0, 50])
    for (const ray of table.rays)
      for (let i = 1; i < ray.dh.length; i++) expect(ray.dh[i]).toBeGreaterThanOrEqual(ray.dh[i - 1])
  })
})

describe('validateWinchRule', () => {
  it('names the field out of range', () => {
    expect(() => validateWinchRule({ ...DEFAULT_WINCH_RULE, upReachM: -1 })).toThrow(/uphill winch length/)
    expect(() => validateWinchRule({ ...DEFAULT_WINCH_RULE, downFullSlopePercent: 0 })).toThrow(/downhill full-length/)
    expect(() => validateWinchRule({ ...DEFAULT_WINCH_RULE, upReachM: 0, downReachM: 0 })).toThrow(
      /uphill or a downhill/,
    )
  })
})

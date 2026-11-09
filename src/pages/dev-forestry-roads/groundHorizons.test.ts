import { describe, expect, it } from 'vitest'
import { horizonReplacements, resolveHorizons } from './groundHorizons'
import type { StratumAssignment } from './engineeringTypes'

const horizon = (
  id: string,
  topDepthM: number,
  bottomDepthM: number | null,
  start = 0,
  end = 100,
): StratumAssignment => ({
  id,
  materialId: id,
  start,
  end,
  topDepthM,
  bottomDepthM,
})
const column = (strata: StratumAssignment[]) =>
  resolveHorizons(strata).map((p) => [p.stratumId, p.topDepthM, p.bottomDepthM])

describe('ground horizons resolved to one column', () => {
  it('keeps horizons that only touch as entered, sorted top down', () => {
    expect(column([horizon('rock', 3, null), horizon('pan', 0, 3)])).toEqual([
      ['pan', 0, 3],
      ['rock', 3, null],
    ])
  })
  it('gives the later horizon the overlap and keeps the rest of the earlier one', () => {
    // Later covers the top of the earlier one, then the bottom, then its whole depth.
    expect(column([horizon('pan', 0, 3), horizon('gravel', 0, 1)])).toEqual([
      ['gravel', 0, 1],
      ['pan', 1, 3],
    ])
    expect(column([horizon('pan', 0, 3), horizon('gravel', 2, 5)])).toEqual([
      ['pan', 0, 2],
      ['gravel', 2, 5],
    ])
    expect(column([horizon('pan', 1, 2), horizon('gravel', 0, 3)])).toEqual([['gravel', 0, 3]])
  })
  it('splits an earlier horizon around a later lens and gives the two parts distinct ids', () => {
    const pieces = resolveHorizons([horizon('rock', 3, null), horizon('gravel', 4, 5)])
    expect(pieces.map((p) => [p.stratumId, p.topDepthM, p.bottomDepthM])).toEqual([
      ['rock', 3, 4],
      ['gravel', 4, 5],
      ['rock', 5, null],
    ])
    expect(pieces.map((p) => p.id)).toEqual(['rock', 'gravel', 'rock~2'])
  })
  it('lets an open-ended later horizon take everything below its top', () => {
    expect(column([horizon('pan', 0, 3), horizon('rock', 5, 8), horizon('deep', 2, null)])).toEqual([
      ['pan', 0, 2],
      ['deep', 2, null],
    ])
  })
  it('never returns overlapping depth intervals, whatever the order', () => {
    const strata = [horizon('a', 0, 4), horizon('b', 1, 2), horizon('c', 1.5, 6), horizon('d', 0.5, 1.75)]
    const pieces = resolveHorizons(strata)
    for (let i = 1; i < pieces.length; i++)
      expect(pieces[i].topDepthM).toBeGreaterThanOrEqual(pieces[i - 1].bottomDepthM ?? Infinity)
    expect(pieces[0].topDepthM).toBe(0)
    expect(pieces.at(-1)!.bottomDepthM).toBe(6)
  })
  it('names the earlier horizons a later one replaces, by station and depth', () => {
    const replaced = horizonReplacements([
      horizon('pan', 0, 3, 0, 930),
      horizon('rock', 3, null, 0, 930),
      horizon('gravel', 0, 3, 0, 215),
      horizon('elsewhere', 0, 3, 930, 1000),
    ])
    expect(replaced.get('gravel')).toEqual(['pan'])
    expect(replaced.has('rock')).toBe(false)
    expect(replaced.has('elsewhere')).toBe(false)
  })
})

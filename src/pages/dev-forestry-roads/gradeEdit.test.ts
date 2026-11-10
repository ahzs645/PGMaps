import { describe, expect, it } from 'vitest'
import {
  CONTROL_HOLD_M,
  dragPvi,
  dragTangent,
  GRADE_SNAP_STEP_PERCENT,
  placePvi,
  removePvi,
  setTangentGrade,
  shiftTangent,
  snapGrade,
  tangentGrade,
} from './gradeEdit'
import type { VerticalControl, VerticalPoint } from './types'

const pvi = (id: string, chainage: number, elevation: number): VerticalPoint => ({
  id,
  chainage,
  elevation,
  curveLength: 0,
})
/** 0+000 at 100 m, up 5 % to 0+100, down 2 % to 0+200, up 1 % to 0+300. */
const profile = () => [pvi('a', 0, 100), pvi('b', 100, 105), pvi('c', 200, 103), pvi('d', 300, 104)]
const control = (chainage: number, elevation: number, tolerance = 0): VerticalControl => ({
  id: `k${chainage}`,
  chainage,
  elevation,
  toleranceAboveM: tolerance,
  toleranceBelowM: tolerance,
  gradePercent: null,
  gradeTolerancePercent: 0,
})
const grades = (points: VerticalPoint[]) =>
  points.slice(1).map((p, i) => Math.round(tangentGrade(points[i], p) * 1e6) / 1e6)

describe('typing a tangent grade', () => {
  it('moves the ahead PVI when the back one holds, and the far grade follows', () => {
    const result = setTangentGrade(profile(), 'b', -4, 'back')
    if ('error' in result) throw Error(result.error)
    expect(result.movedId).toBe('c')
    expect(result.points.find((p) => p.id === 'c')!.elevation).toBe(101)
    expect(grades(result.points)).toEqual([5, -4, 3])
  })

  it('moves the back PVI when the ahead one holds', () => {
    const result = setTangentGrade(profile(), 'b', -4, 'ahead')
    if ('error' in result) throw Error(result.error)
    expect(result.movedId).toBe('b')
    expect(result.points.find((p) => p.id === 'b')!.elevation).toBe(107)
    expect(grades(result.points)).toEqual([7, -4, 1])
  })

  it('keeps the exact grade on an odd run instead of rounding the level to the centimetre', () => {
    const points = [pvi('a', 0, 100), pvi('b', 37.3, 100)]
    const result = setTangentGrade(points, 'a', 4, 'back')
    if ('error' in result) throw Error(result.error)
    expect(tangentGrade(result.points[0], result.points[1])).toBeCloseTo(4, 6)
  })

  it('refuses a grade past the drag cap, and one that makes the far tangent too steep', () => {
    expect(setTangentGrade(profile(), 'b', 120, 'back')).toEqual({ error: 'A profile edit sets at most ±100 %.' })
    const steep = setTangentGrade([pvi('a', 0, 100), pvi('b', 10, 100), pvi('c', 15, 100)], 'a', 90, 'back')
    expect('error' in steep && steep.error).toMatch(/grade out of V2 −180\.00 %/)
  })

  it('refuses to move a PVI held by an elevation control, naming the other choice', () => {
    const result = setTangentGrade(profile(), 'b', -4, 'back', [control(200, 103)])
    expect('error' in result && result.error).toBe(
      'V3 sits on the control at 0+200.0 (103.00 m). Hold V3 instead, or change the control.',
    )
    // Holding the controlled end moves the other one.
    expect('points' in setTangentGrade(profile(), 'b', -4, 'ahead', [control(200, 103)])).toBe(true)
  })

  it('does not hold a PVI that already misses its control', () => {
    expect('points' in setTangentGrade(profile(), 'b', -4, 'back', [control(200, 90)])).toBe(true)
  })

  it('names a tangent that is not there', () => {
    expect(setTangentGrade(profile(), 'd', 1, 'back')).toEqual({ error: 'No tangent starts at that PVI.' })
  })
})

describe('dragging a PVI', () => {
  const base = { sorted: profile(), index: 1, roadLength: 300 }

  it('follows the cursor freely and says nothing', () => {
    expect(dragPvi({ ...base, chainage: 110, elevation: 106 })).toEqual({ chainage: 110, elevation: 106, held: [] })
  })

  it('snaps whichever adjacent grade needs the smaller move to a round value', () => {
    // Grade in from V1 would be 6.1 %, grade out to V3 −3.05 %; 6.0 % in moves the level 0.1 m.
    const out = dragPvi({ ...base, chainage: 100, elevation: 106.1, snapStep: GRADE_SNAP_STEP_PERCENT })
    expect(out.snapped).toEqual({ side: 'back', gradePercent: 6 })
    expect(out.elevation).toBeCloseTo(106, 9)
  })

  it('slides along the grade in when Shift-dragged up-station, holding it', () => {
    const out = dragPvi({ ...base, chainage: 140, elevation: 0, holdGrade: true })
    expect(out.holding).toBe('back')
    expect(out.chainage).toBe(140)
    expect(out.elevation).toBeCloseTo(107, 9)
    expect(out.held).toEqual(['Holding grade in +5.00 %'])
  })

  it('slides along the grade out when Shift-dragged down-station', () => {
    const out = dragPvi({ ...base, chainage: 60, elevation: 0, holdGrade: true })
    expect(out.holding).toBe('ahead')
    expect(out.elevation).toBeCloseTo(105 + 0.02 * 40, 9)
    expect(out.held[0]).toBe('Holding grade out −2.00 %')
  })

  it('snaps the free grade while holding the other, by where the PVI sits on the held line', () => {
    const out = dragPvi({ ...base, chainage: 130, elevation: 0, holdGrade: true, snapStep: 0.5 })
    expect(out.snapped?.side).toBe('ahead')
    const placed = pvi('b', out.chainage, out.elevation)
    expect(tangentGrade(profile()[0], placed)).toBeCloseTo(5, 9)
    expect(tangentGrade(placed, profile()[2])).toBeCloseTo(out.snapped!.gradePercent, 9)
    expect(out.snapped!.gradePercent % 0.5).toBeCloseTo(0, 9)
  })

  it('says an end PVI keeps its station', () => {
    const out = dragPvi({ ...base, index: 0, chainage: 30, elevation: 101 })
    expect(out.chainage).toBe(0)
    expect(out.held).toEqual(['An end PVI keeps its station'])
  })

  it('says when spacing holds the PVI back from its neighbour', () => {
    const out = dragPvi({ ...base, chainage: 199, elevation: 105 })
    expect(out.chainage).toBe(195)
    expect(out.held).toEqual(['Kept 5 m from V3'])
  })

  it('keeps a PVI on its control inside the tolerance band, and says why', () => {
    const out = dragPvi({
      ...base,
      chainage: 120,
      elevation: 108,
      controls: [control(100 + CONTROL_HOLD_M / 2, 105, 0.25)],
    })
    expect(out).toEqual({
      chainage: 100,
      elevation: 105.25,
      held: ['Held by the control at 0+100.3: 105.00 m (+0.25/−0.25)'],
    })
  })

  it('stays quiet inside the slack', () => {
    const out = dragPvi({
      ...base,
      index: 0,
      chainage: 0.2,
      elevation: 100,
      slack: { chainageM: 0.5, elevationM: 0.1 },
    })
    expect(out.held).toEqual([])
  })
})

describe('dragging a tangent', () => {
  it('moves both PVIs by the same amount, keeping its grade', () => {
    const out = dragTangent({ sorted: profile(), index: 1, deltaM: 0.73 })
    expect(out).toEqual({ deltaM: 0.73, held: [] })
    const moved = shiftTangent(profile(), 1, out.deltaM)
    expect(grades(moved)[1]).toBeCloseTo(-2, 9)
    expect(moved.map((p) => p.elevation)).toEqual([100, 105.73, 103.73, 104])
  })

  it('snaps the nearer outer grade', () => {
    const out = dragTangent({ sorted: profile(), index: 1, deltaM: 0.73, snapStep: 0.5 })
    const moved = shiftTangent(profile(), 1, out.deltaM, true)
    const g = grades(moved)
    expect(g[1]).toBeCloseTo(-2, 9)
    expect(out.snapped).toBeDefined()
    expect(g[out.snapped!.side === 'back' ? 0 : 2]).toBeCloseTo(out.snapped!.gradePercent, 9)
  })

  it('is held by a control on either end', () => {
    const out = dragTangent({ sorted: profile(), index: 1, deltaM: 2, controls: [control(200, 103, 0.5)] })
    expect(out.deltaM).toBe(0.5)
    expect(out.held).toEqual(['Held by the control at 0+200.0: 103.00 m (+0.50/−0.50)'])
  })

  it('caps the outer grades', () => {
    const out = dragTangent({ sorted: profile(), index: 1, deltaM: 500 })
    expect(out.deltaM).toBe(95)
    expect(out.held).toEqual(['Grade capped at 100 %'])
  })
})

describe('removing and placing PVIs', () => {
  it('removes one PVI and keeps the profile at two or more', () => {
    const removed = removePvi(profile(), 'b')
    expect('points' in removed && removed.points.map((p) => p.id)).toEqual(['a', 'c', 'd'])
    expect(removePvi([pvi('a', 0, 1), pvi('b', 10, 1)], 'b')).toEqual({
      error: 'A profile keeps at least 2 PVIs; V2 stays.',
    })
  })

  it('rounds a free placement to the centimetre and keeps a snapped one exact', () => {
    expect(placePvi(profile(), 'b', { chainage: 100.123, elevation: 105.456 })[1]).toMatchObject({
      chainage: 100.12,
      elevation: 105.46,
    })
    expect(placePvi(profile(), 'b', { chainage: 100, elevation: 105.4567 }, true)[1].elevation).toBe(105.4567)
  })

  it('snaps to the nearest step without a negative zero', () => {
    expect(snapGrade(4.26)).toBe(4.5)
    expect(snapGrade(-0.2)).toBe(0)
    expect(Object.is(snapGrade(-0.2), -0)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { balanceLevelRange, balanceWhatIf } from './balanceLine'

/** Rises 500 m³ over 100 m, falls back to zero over 200 m: one loop 300 m long. */
const triangle: [number, number][] = [
  [0, 0],
  [100, 500],
  [300, 0],
]

describe('what-if balance line on the mass-haul diagram', () => {
  it('reads a single loop: volume is its height, haul its area, mean haul area over height', () => {
    const result = balanceWhatIf(triangle, 0, null)
    expect(result.loops).toHaveLength(1)
    const [loop] = result.loops
    expect(loop).toMatchObject({ start: 0, end: 300, direction: 'up-station', open: null })
    expect(loop.volumeM3).toBeCloseTo(500, 6)
    expect(loop.haulM3m).toBeCloseTo((500 * 300) / 2, 3)
    expect(loop.meanHaulM).toBeCloseTo(150, 3)
    expect(result.balancedLengthM).toBe(300)
    expect(result.overhaulM3).toBe(0)
  })
  it('splits off overhaul beyond the free-haul distance: V(1 − F/L) and (L − F)²V / 2L', () => {
    const result = balanceWhatIf(triangle, 0, 100)
    expect(result.overhaulM3).toBeCloseTo(500 * (1 - 100 / 300), 0)
    expect(result.overhaulM3m).toBeCloseTo((200 ** 2 * 500) / 600, -1)
  })
  it('moves surplus up-station above the line and down-station below it', () => {
    const result = balanceWhatIf(
      [
        [0, 0],
        [100, 200],
        [200, 0],
        [300, -300],
        [400, 0],
      ],
      0,
      null,
    )
    expect(result.loops.map((loop) => [loop.direction, Math.round(loop.volumeM3), Math.round(loop.haulM3m)])).toEqual([
      ['up-station', 200, 20000],
      ['down-station', 300, 30000],
    ])
    expect(result.balancedLengthM).toBe(400)
    expect(result.volumeM3).toBeCloseTo(500, 6)
  })
  it('leaves what reaches a road end unbalanced, as material in at the start and out at the end', () => {
    const result = balanceWhatIf(triangle, -100, null)
    expect(result.loops).toHaveLength(1)
    expect(result.loops[0].open).toBe('both')
    // Only the layers above the line's crossing of both ends balance: the same triangle.
    expect(result.loops[0].volumeM3).toBeCloseTo(500, 6)
    expect(result.loops[0].haulM3m).toBeCloseTo(75000, 2)
    expect(result.balancedLengthM).toBe(0)
    expect(result.startM3).toBeCloseTo(100)
    expect(result.endM3).toBeCloseTo(100)
  })
  it('crosses the curve between vertices and finds the shorter loop a raised line cuts', () => {
    const result = balanceWhatIf(triangle, 250, null)
    const closed = result.loops.filter((loop) => !loop.open)
    expect(closed).toHaveLength(1)
    expect(closed[0].start).toBeCloseTo(50, 6)
    expect(closed[0].end).toBeCloseTo(200, 6)
    expect(closed[0].volumeM3).toBeCloseTo(250, 6)
    expect(closed[0].haulM3m).toBeCloseTo((250 * 150) / 2, 2)
    // Below the line at both ends: 250 m³ leaves at the start and comes in at the end.
    expect(result.startM3).toBeCloseTo(-250)
    expect(result.endM3).toBeCloseTo(-250)
  })
  it('limits the line to the curve’s range, which always includes zero', () => {
    expect(balanceLevelRange(triangle)).toEqual([0, 500])
    expect(
      balanceLevelRange([
        [0, 10],
        [10, -40],
      ]),
    ).toEqual([-40, 10])
    expect(balanceWhatIf([[0, 0]], 0, null).loops).toEqual([])
  })
})

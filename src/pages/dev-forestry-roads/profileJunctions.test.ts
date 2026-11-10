import { describe, expect, it } from 'vitest'
import { offsetCoordinate } from './engine'
import {
  controlForJunction,
  findProfileJunctions,
  junctionControl,
  MAX_VERTICAL_CONTROLS,
  valueAt,
  withVerticalControl,
  type JunctionProfileRoad,
  type JunctionStation,
} from './profileJunctions'
import type { Coordinate, VerticalControl } from './types'

const origin: Coordinate = [-122.8, 53.9]
/** A point `east` and `north` metres from the origin. */
const at = (east: number, north: number) => offsetCoordinate(offsetCoordinate(origin, 90, east), 0, north) as Coordinate

/** A straight road from `from` to `to` (local metres), stationed every `step` m. */
function road(
  id: string,
  from: [number, number],
  to: [number, number],
  level: { design?: (s: number) => number | null; ground?: (s: number) => number | null } = {},
  options: Partial<JunctionProfileRoad> = {},
): JunctionProfileRoad {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1])
  const stations: JunctionStation[] = []
  for (let s = 0; s <= length + 1e-9; s += 10) {
    const t = s / length
    stations.push({
      chainage: s,
      coordinate: at(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t),
      designElevation: level.design ? level.design(s) : 500 + s / 100,
      groundElevation: level.ground ? level.ground(s) : 499 + s / 100,
    })
  }
  return { id, name: id.toUpperCase(), stations, designed: true, design: true, ...options }
}

describe('junctions on the profile', () => {
  const main = road('main', [0, 0], [0, 400])

  it('marks a crossing road at its station with its formation and the difference from ours', () => {
    const cross = road('x', [-100, 205], [100, 205], { design: () => 510 })
    const { junctions } = findProfileJunctions(main, [cross])
    expect(junctions).toHaveLength(1)
    const [j] = junctions
    expect(j.kind).toBe('crosses')
    expect(j.chainage).toBeCloseTo(205, 0)
    expect(j.otherChainage).toBeCloseTo(100, 0)
    expect(j.levelKind).toBe('design')
    expect(j.level).toBe(510)
    expect(j.designHere).toBeCloseTo(502.05, 1)
    expect(j.difference).toBeCloseTo(510 - j.designHere!, 9)
  })

  it('marks a branch whose end lies on this road once, as a meeting, not also a crossing', () => {
    const branch = road('spur', [0, 150], [120, 150])
    const { junctions } = findProfileJunctions(main, [branch])
    expect(junctions.map((j) => [j.kind, Math.round(j.chainage)])).toEqual([['meets', 150]])
    expect(junctions[0].otherChainage).toBe(0)
  })

  it('marks where this road ends on another', () => {
    const trunk = road('trunk', [-200, 403], [200, 403])
    const { junctions } = findProfileJunctions(main, [trunk])
    expect(junctions.map((j) => [j.kind, j.chainage])).toEqual([['meets', 400]])
    expect(junctions[0].otherChainage).toBeCloseTo(200, 0)
  })

  it('takes the ground of a road with no designed profile, and leaves a gap unknown', () => {
    const mapped = road('mapped', [-100, 100], [100, 100], { ground: (s) => (s === 100 ? null : 480) })
    const { junctions } = findProfileJunctions(main, [{ ...mapped, designed: false, design: false }])
    expect(junctions[0].levelKind).toBe('ground')
    // The crossing falls on the other road's station 100, whose ground is missing.
    expect(junctions[0].level).toBeNull()
    expect(junctions[0].difference).toBeNull()
  })

  it('leaves out a design road drawn from the same start, and roads far away', () => {
    const alternative = road('alt', [0, 0], [150, 300])
    const far = road('far', [5000, 0], [5000, 400])
    expect(findProfileJunctions(main, [alternative, far]).junctions).toEqual([])
    // A mapped road from the same point is a real junction.
    const mapped = { ...road('m', [0, 0], [-150, 0]), design: false, designed: false }
    expect(findProfileJunctions(main, [mapped]).junctions.map((j) => j.chainage)).toEqual([0])
  })

  it('finds every crossing of a winding road', () => {
    const zig: JunctionProfileRoad = {
      ...road('zig', [-50, 0], [50, 0]),
      stations: [0, 1, 2, 3].map((i) => ({
        chainage: i * 120,
        coordinate: at(i % 2 ? 50 : -50, 50 + i * 100),
        designElevation: 500,
        groundElevation: 499,
      })),
    }
    expect(findProfileJunctions(main, [zig]).junctions.map((j) => Math.round(j.chainage))).toEqual([100, 200, 300])
  })
})

describe('adding a control at a junction', () => {
  const junction = findProfileJunctions(road('main', [0, 0], [0, 400]), [
    road('x', [-100, 205.004], [100, 205.004], { design: () => 510.456 }),
  ]).junctions[0]

  it('sets an exact elevation control at the junction station and level', () => {
    expect(controlForJunction(junction, 'k')).toEqual({
      id: 'k',
      chainage: Math.round(junction.chainage * 100) / 100,
      elevation: 510.46,
      toleranceAboveM: 0,
      toleranceBelowM: 0,
      gradePercent: null,
      gradeTolerancePercent: 0,
    })
    expect(controlForJunction({ ...junction, level: null }, 'k')).toBeNull()
  })

  it('finds a control already there and keeps the list in station order under its limit', () => {
    const near: VerticalControl = { ...controlForJunction(junction, 'k')!, chainage: junction.chainage + 0.5 }
    expect(junctionControl([near], junction)).toBe(near)
    expect(junctionControl([{ ...near, chainage: junction.chainage + 5 }], junction)).toBeUndefined()
    const early = { ...near, id: 'e', chainage: 10 }
    expect(withVerticalControl([near], early)!.map((c) => c.id)).toEqual(['e', 'k'])
    expect(withVerticalControl(Array(MAX_VERTICAL_CONTROLS).fill(near), early)).toBeNull()
  })
})

describe('reading a level along the stations', () => {
  const stations: JunctionStation[] = [0, 10, 20].map((chainage, i) => ({
    chainage,
    coordinate: origin,
    groundElevation: i === 2 ? null : 100 + i,
    designElevation: 100,
  }))
  it('interpolates between known values and stays unknown next to a gap or off the road', () => {
    expect(valueAt(stations, 5, 'groundElevation')).toBe(100.5)
    expect(valueAt(stations, 10, 'groundElevation')).toBe(101)
    expect(valueAt(stations, 15, 'groundElevation')).toBeNull()
    expect(valueAt(stations, 25, 'designElevation')).toBeNull()
  })
})

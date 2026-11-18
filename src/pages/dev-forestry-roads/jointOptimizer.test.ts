import { describe, expect, it } from 'vitest'
import { alignmentLength, distance, offsetCoordinate } from './engine'
import {
  MAX_JOINT_BOX_M,
  movementBoxes,
  movementBoxFeatures,
  refinePlanAndProfile,
  scheduleReachM,
  type JointOptimizationOptions,
} from './jointOptimizer'
import type { Alignment, Coordinate, RoadSettings } from './types'

const origin: Coordinate = [-122.8, 53.9]
const settings: RoadSettings = {
  stationInterval: 10,
  crossSectionHalfWidth: 35,
  maxGradePercent: 12,
  minRadius: 10,
  cutRate: 2,
  fillRate: 3,
  surfacingRate: 0,
  clearingRate: 0,
  shrinkFactor: 1,
}
const flat = { elevationAt: () => 800 }
/** Metres east (x) and north (y) of the origin. */
const at = (x: number, y: number) => offsetCoordinate(offsetCoordinate(origin, 90, x), 0, y)
/** Metres east and north of `from`, on the same small flat frame. */
const offsetOf = (from: Coordinate, p: Coordinate) => {
  const r = 6371008.8,
    rad = Math.PI / 180
  return { east: (p[0] - from[0]) * rad * r * Math.cos(from[1] * rad), north: (p[1] - from[1]) * rad * r }
}

/** A road running north with two bends: b and c are the interior controls. */
function road(): Alignment {
  const a: Alignment = {
    id: 'r',
    name: 'Road',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: at(10, 60), radiusM: 20 },
      { id: 'c', coordinate: at(-10, 120), radiusM: 20 },
      { id: 'd', coordinate: at(0, 180), radiusM: 0 },
    ],
    vertical: [],
    overrides: [],
    template: {
      leftWidth: 3,
      rightWidth: 3,
      crossfallPercent: 0,
      cutSlope: 1,
      fillSlope: 1,
      ditchWidth: 0,
      ditchDepth: 0,
      surfaceDepth: 0,
    },
  }
  a.vertical = [
    { id: 's', chainage: 0, elevation: 800, curveLength: 0 },
    { id: 'e', chainage: alignmentLength(a), elevation: 800, curveLength: 0 },
  ]
  return a
}

const quick: Partial<JointOptimizationOptions> = {
  rounds: 2,
  stepM: 6,
  maxEvaluations: 14,
  profile: { pviSpacingM: 90, maxDepthM: 1, levelStepM: 0.5, k: 1 },
}
/** Scores a trial by how far point b is from `target`: the search keeps wanting to move b there. */
const pullB = (target: Coordinate) => (trial: Alignment) => ({ score: distance(trial.points[1].coordinate, target) })

describe('joint refinement movement limits', () => {
  it('runs exactly as before when no limit is set', async () => {
    const pull = pullB(at(40, 60))
    const plain = await refinePlanAndProfile(road(), flat, settings, [], { ...quick, evaluate: pull })
    const unset = await refinePlanAndProfile(road(), flat, settings, [], {
      ...quick,
      evaluate: pull,
      maxSeconds: null,
      limits: { fixedPointIds: [], acrossM: null, alongM: null, perpendicularOnly: true },
    })
    expect(unset.evaluations).toEqual(plain.evaluations)
    expect(unset.alignment.points).toEqual(plain.alignment.points)
    expect(plain.timeLimited).toBe(false)
    // The first descent trial is the old move: square to the neighbours' chord, by the full step.
    const a = road()
    const before = a.points[0].coordinate,
      after = a.points[2].coordinate
    const dy = after[1] - before[1],
      dx = (after[0] - before[0]) * Math.cos((before[1] * Math.PI) / 180)
    const perpendicular = (Math.atan2(dx, dy) * 180) / Math.PI + 90
    expect(plain.evaluations[2].points[1].coordinate).toEqual(
      offsetCoordinate(a.points[1].coordinate, perpendicular, -quick.stepM!),
    )
  })

  it('never moves a point that is not ticked', async () => {
    const start = road()
    const result = await refinePlanAndProfile(start, flat, settings, [], {
      ...quick,
      evaluate: (trial) => ({
        score: distance(trial.points[1].coordinate, at(40, 60)) + distance(trial.points[2].coordinate, at(-40, 120)),
      }),
      limits: { fixedPointIds: ['b'] },
    })
    expect(result.evaluations.length).toBeGreaterThan(2)
    for (const e of result.evaluations) expect(e.points[1].coordinate).toEqual(start.points[1].coordinate)
    expect(result.alignment.points[2].coordinate).not.toEqual(start.points[2].coordinate)
  })

  it('refuses a run with every interior point fixed', async () => {
    await expect(
      refinePlanAndProfile(road(), flat, settings, [], { ...quick, limits: { fixedPointIds: ['b', 'c'] } }),
    ).rejects.toThrow(/Tick at least one/)
  })

  it('keeps every trial inside its box, shortening a move to the box edge', async () => {
    const start = road()
    const acrossM = 4,
      alongM = 2.5
    const boxes = movementBoxes(start, { ...(quick as { stepM: number; rounds: number }), limits: { acrossM, alongM } })
    const result = await refinePlanAndProfile(start, flat, settings, [], {
      ...quick,
      // Far away across and along: every move is pushed against the box.
      evaluate: pullB(at(60, 90)),
      limits: { acrossM, alongM, perpendicularOnly: false },
    })
    expect(result.evaluations.length).toBeGreaterThan(4)
    for (const e of result.evaluations)
      for (const box of boxes) {
        const { east, north } = offsetOf(box.centre, e.points[box.index].coordinate)
        const b = (box.alongBearing! * Math.PI) / 180
        const across = east * Math.cos(b) - north * Math.sin(b),
          along = east * Math.sin(b) + north * Math.cos(b)
        expect(Math.abs(across)).toBeLessThanOrEqual(acrossM + 1e-3)
        expect(Math.abs(along)).toBeLessThanOrEqual(alongM + 1e-3)
      }
    // The pull carried b to its box's corner, not past it.
    const moved = offsetOf(start.points[1].coordinate, result.alignment.points[1].coordinate)
    expect(Math.hypot(moved.east, moved.north)).toBeGreaterThan(acrossM - 0.5)
  })

  it('moves a point along the road only when perpendicular-only is off', async () => {
    // The pull is straight up the road's local direction from b: only an along move gets closer.
    const start = road()
    const [box] = movementBoxes(start, { stepM: 6, rounds: 2 })
    const target = offsetCoordinate(start.points[1].coordinate, box.alongBearing!, 30)
    const along = (r: { alignment: Alignment }) => {
      const { east, north } = offsetOf(start.points[1].coordinate, r.alignment.points[1].coordinate)
      const b = (box.alongBearing! * Math.PI) / 180
      return east * Math.sin(b) + north * Math.cos(b)
    }
    const across = await refinePlanAndProfile(start, flat, settings, [], {
      ...quick,
      evaluate: pullB(target),
      limits: { fixedPointIds: ['c'] },
    })
    const both = await refinePlanAndProfile(start, flat, settings, [], {
      ...quick,
      evaluate: pullB(target),
      limits: { fixedPointIds: ['c'], perpendicularOnly: false },
    })
    expect(Math.abs(along(across))).toBeLessThan(0.5)
    expect(along(both)).toBeGreaterThan(5)
  })

  it('stops at the time limit with the best trial checked and says so', async () => {
    let clock = 0
    const result = await refinePlanAndProfile(road(), flat, settings, [], {
      ...quick,
      evaluate: pullB(at(40, 60)),
      maxSeconds: 1,
      // Each reading of the clock is a second later.
      now: () => (clock += 1000),
    })
    expect(result.evaluations).toHaveLength(2)
    expect(result.timeLimited).toBe(true)
    expect(result.budgetLimited).toBe(true)
  })

  it('rejects limits outside their ranges', async () => {
    await expect(
      refinePlanAndProfile(road(), flat, settings, [], { ...quick, limits: { acrossM: MAX_JOINT_BOX_M + 1 } }),
    ).rejects.toThrow(/movement limits/)
    await expect(refinePlanAndProfile(road(), flat, settings, [], { ...quick, maxSeconds: 0.5 })).rejects.toThrow(
      /time limit/,
    )
  })
})

describe('movement boxes for the plan', () => {
  it('draws the schedule reach until a limit is set, square to the road', () => {
    const a = road()
    const reach = scheduleReachM(6, 2)
    expect(reach).toBe(9)
    const [b, c] = movementBoxes(a, { stepM: 6, rounds: 2 })
    expect(b).toMatchObject({ pointId: 'b', movable: true, acrossM: reach, alongM: 0 })
    expect(b.limited).toEqual({ across: false, along: false })
    // The ring's corners sit `reach` either side of the point, square to the a–c chord.
    const corner = offsetOf(b.centre, b.ring![1])
    const bearing = (b.alongBearing! * Math.PI) / 180
    expect(corner.east * Math.cos(bearing) - corner.north * Math.sin(bearing)).toBeCloseTo(reach, 2)
    expect(b.ring).toHaveLength(5)
    expect(b.ring![4]).toEqual(b.ring![0])
    expect(c).toMatchObject({ pointId: 'c', index: 2, movable: true })
  })

  it('draws a set limit, the along side only when moves along the road are on, and a cross for a fixed point', () => {
    const a = road()
    const limited = movementBoxes(a, {
      stepM: 6,
      rounds: 2,
      limits: { acrossM: 3, alongM: 2, perpendicularOnly: false, fixedPointIds: ['c'] },
    })
    expect(limited[0]).toMatchObject({ acrossM: 3, alongM: 2, limited: { across: true, along: true } })
    expect(limited[1]).toMatchObject({ movable: false, ring: null })
    // A limit wider than the schedule can reach is drawn at the reach.
    expect(movementBoxes(a, { stepM: 1, rounds: 1, limits: { acrossM: 30 } })[0].acrossM).toBe(1)
    const features = movementBoxFeatures(limited, 2).features
    expect(features.map((f) => f.properties!.role)).toEqual(['box', 'fixed'])
    expect(features[1].geometry.type).toBe('MultiLineString')
    expect(movementBoxFeatures(movementBoxes(a, { stepM: 6, rounds: 2 }), 2).features[0].properties!.role).toBe('reach')
  })
})

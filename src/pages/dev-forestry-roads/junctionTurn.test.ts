import { describe, expect, it } from 'vitest'
import { distance, offsetCoordinate } from './engine'
import {
  alignmentJunctionRoad,
  analyzeJunctionTurn,
  contextJunctionRoad,
  findRoadJunctions,
  FLARE_SEARCH_STEP_M,
  isJunctionError,
  junctionTurnOverlay,
  turnSeverity,
  type JunctionArm,
  type JunctionLayout,
  type JunctionTurn,
} from './junctionTurn'
import { VEHICLE_PRESETS } from './sweptPath'
import { DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, ContextFeature, Coordinate, DesignVehicle } from './types'

/** An arm leaving the junction at `bearing` degrees anticlockwise from east. */
const arm = (id: string, bearing: number, halfWidthM = 2, lengthM = 500): JunctionArm => ({
  id,
  label: id,
  roadId: id,
  direction: [Math.cos((bearing * Math.PI) / 180), Math.sin((bearing * Math.PI) / 180)],
  leftHalfWidthM: halfWidthM,
  rightHalfWidthM: halfWidthM,
  lengthM,
})
const unit = (wheelbaseM: number, steeringLockDeg?: number): DesignVehicle => ({
  name: 'Unit',
  widthM: 2.6,
  units: [{ name: 'Unit', wheelbaseM, frontOverhangM: 0, rearOverhangM: 0, hitchOffsetM: 0 }],
  ...(steeringLockDeg === undefined ? {} : { steeringLockDeg }),
})
/** A through road east–west and a branch leaving north: 4 m formations. */
const tee = (flareRadiusM = 0): JunctionLayout => ({ arms: [arm('W', 180), arm('E', 0), arm('N', 90)], flareRadiusM })
const turn = (layout: JunctionLayout, from: string, to: string, vehicle: DesignVehicle, steerRadiusM = 12) => {
  const result = analyzeJunctionTurn(layout, from, to, { vehicle, steerRadiusM, clearanceM: 0.3 })
  if (isJunctionError(result)) throw Error(result.error)
  return result
}

describe('junction turn swept path', () => {
  it('reproduces the offtracking of a 10 m unit through a 90° turn of radius 12 m', () => {
    // Independent fine-step integration of the no-slip trailing equation gives 3.475 m and 42.3°.
    const result = turn(tee(), 'W', 'N', unit(10))
    expect(result.side).toBe('left')
    expect(result.deflectionDegrees).toBeCloseTo(90, 6)
    expect(result.tangentM).toBeCloseTo(12, 6)
    expect(Math.abs(result.maxOfftrackingM - 3.475)).toBeLessThan(0.01)
    expect(Math.abs(result.maxSteerDegrees - 42.3)).toBeLessThan(0.5)
    expect(result.lockExceeded).toBeNull()
    expect(result.minSteerRadiusM).toBeNull()
  })

  it('flags a turn tighter than the steering lock allows, whatever the formation', () => {
    expect(turn(tee(60), 'W', 'N', unit(10, 33)).lockExceeded).toBe(true)
    expect(turn(tee(60), 'W', 'N', unit(10, 45)).lockExceeded).toBe(false)
  })

  it('finds the smallest corner flare that keeps the wheels on the formation', () => {
    const sharp = turn(tee(0), 'W', 'N', unit(10))
    expect(sharp.fits).toBe(false)
    expect(sharp.wheelShortfallM).toBeGreaterThan(0)
    expect(sharp.deficits.length).toBeGreaterThan(0)
    const flare = sharp.requiredFlareRadiusM!
    expect(flare).toBeGreaterThan(0)
    expect(flare % FLARE_SEARCH_STEP_M).toBe(0)
    // A 90° corner: the flare's arc is R(√2 − 1) from the corner of the edges.
    expect(sharp.requiredFlareSetbackM).toBeCloseTo(flare * (Math.SQRT2 - 1), 3)
    const fitted = turn(tee(flare), 'W', 'N', unit(10))
    expect(fitted.fits).toBe(true)
    expect(fitted.wheelShortfallM).toBe(0)
    expect(fitted.deficits).toEqual([])
    expect(turn(tee(flare - FLARE_SEARCH_STEP_M), 'W', 'N', unit(10)).fits).toBe(false)
    // A wide flare lets an R40 turn fit as well.
    expect(turn(tee(50), 'W', 'N', unit(10), 40).fits).toBe(true)
  })

  it('gives mirror-image turns the same result, and draws the wheel and body envelopes', () => {
    const leftTurn = turn(tee(0), 'W', 'N', unit(10))
    const rightTurn = turn(tee(0), 'E', 'N', unit(10))
    expect(rightTurn.side).toBe('right')
    expect(rightTurn.maxOfftrackingM).toBeCloseTo(leftTurn.maxOfftrackingM, 6)
    expect(rightTurn.wheelShortfallM).toBeCloseTo(leftTurn.wheelShortfallM, 6)
    expect(rightTurn.requiredFlareRadiusM).toBe(leftTurn.requiredFlareRadiusM)
    expect(leftTurn.wheelEnvelope.at(0)).toEqual(leftTurn.wheelEnvelope.at(-1))
    // The envelope reaches inside the corner by the offtracking plus half the width.
    const inside = Math.min(...leftTurn.wheelEnvelope.map(([x, y]) => Math.hypot(x + 12, y - 12)))
    expect(inside).toBeLessThan(12 - leftTurn.maxOfftrackingM)
  })

  it('makes the turn toward the acute side of a skewed junction the severe one', () => {
    // A branch leaving at 45° to the road. Out of it toward the east doubles back round the 45°
    // corner (a 135° turn); toward the west it bends 45°.
    const skew: JunctionLayout = { arms: [arm('W', 180, 3), arm('E', 0, 3), arm('B', 45, 3)], flareRadiusM: 0 }
    const lg5 = VEHICLE_PRESETS.find((p) => p.id === 'bc-moti-lg5')!.vehicle
    const towardAcute = turn(skew, 'B', 'E', lg5, 15)
    const towardObtuse = turn(skew, 'B', 'W', lg5, 15)
    expect(Math.abs(towardAcute.deflectionDegrees)).toBeCloseTo(135, 6)
    expect(Math.abs(towardObtuse.deflectionDegrees)).toBeCloseTo(45, 6)
    expect(turnSeverity(towardAcute.deflectionDegrees)).toBe('hairpin')
    expect(turnSeverity(towardObtuse.deflectionDegrees)).toBe('moderate')
    expect(towardAcute.maxOfftrackingM).toBeGreaterThan(towardObtuse.maxOfftrackingM)
    expect(towardAcute.wheelShortfallM).toBeGreaterThan(towardObtuse.wheelShortfallM)
  })

  it('explains turns it cannot model instead of failing', () => {
    // 20° between the road and the branch: turning back into it takes 68 m of tangent at R12.
    const acute: JunctionLayout = {
      arms: [arm('W', 180, 2, 30), arm('E', 0, 2, 30), arm('B', 20, 2, 30)],
      flareRadiusM: 0,
    }
    const back = analyzeJunctionTurn(acute, 'E', 'B', { vehicle: unit(10), steerRadiusM: 12, clearanceM: 0.3 })
    expect(isJunctionError(back) && back.error).toMatch(/Not enough road for an R12 turn: it needs 68\.1 m/)
    const reverse = analyzeJunctionTurn({ arms: [arm('A', 0), arm('B', 3)], flareRadiusM: 0 }, 'A', 'B', {
      vehicle: unit(10),
      steerRadiusM: 12,
      clearanceM: 0.3,
    })
    expect(isJunctionError(reverse) && reverse.error).toMatch(/reversing/)
    expect(() =>
      analyzeJunctionTurn(tee(-1), 'W', 'N', { vehicle: unit(10), steerRadiusM: 12, clearanceM: 0 }),
    ).toThrow(/flare radius/)
    expect(() => analyzeJunctionTurn(tee(), 'W', 'N', { vehicle: unit(10), steerRadiusM: 1, clearanceM: 0 })).toThrow(
      /turn radius/,
    )
  })
})

describe('junctions of a road', () => {
  const origin: Coordinate = [-122.8, 53.9]
  const road = (id: string, points: Coordinate[], halfWidthM: number): Alignment => ({
    id,
    name: id === 'main' ? 'Main road' : 'Spur',
    color: '#16817a',
    points: points.map((coordinate, i) => ({ id: `${id}${i}`, coordinate, radiusM: 0 })),
    vertical: [],
    template: { ...DEFAULT_TEMPLATE, leftWidth: halfWidthM, rightWidth: halfWidthM },
    overrides: [],
  })
  const main = road('main', [origin, offsetCoordinate(origin, 90, 300)], 3)
  const branchStart = offsetCoordinate(offsetCoordinate(origin, 90, 150), 0, 1)
  const spur = road('spur', [branchStart, offsetCoordinate(branchStart, 45, 200)], 2)

  it('finds a branch leaving the road and lists turns into and out of it', () => {
    const { junctions, leftOut } = findRoadJunctions(alignmentJunctionRoad(spur), [alignmentJunctionRoad(main)], 3)
    expect(leftOut).toBe(0)
    expect(junctions).toHaveLength(1)
    const [j] = junctions
    expect(j.branchRoadId).toBe('spur')
    expect(j.chainage).toBeCloseTo(0, 6)
    expect(j.arms.map((a) => a.id).sort()).toEqual(['main:end', 'main:start', 'spur:end'])
    expect(j.widthAssumed).toBe(false)
    expect(j.arms.find((a) => a.id === 'main:end')!.leftHalfWidthM).toBe(3)
    expect(
      j.movements
        .filter((m) => m.kind === 'in')
        .map((m) => m.from)
        .sort(),
    ).toEqual(['main:end', 'main:start'])
    expect(
      j.movements
        .filter((m) => m.kind === 'out')
        .map((m) => m.to)
        .sort(),
    ).toEqual(['main:end', 'main:start'])
    expect(distance(j.coordinate, offsetCoordinate(origin, 90, 150))).toBeLessThan(0.5)

    const results = j.movements.map((m) =>
      analyzeJunctionTurn({ arms: j.arms, flareRadiusM: 0 }, m.from, m.to, {
        vehicle: unit(8),
        steerRadiusM: 15,
        clearanceM: 0.3,
      }),
    )
    const out = results.filter((r): r is JunctionTurn => !isJunctionError(r))
    expect(out).toHaveLength(4)
    // The spur leaves north-east of an eastbound road: out of it toward the road's start (west) is a
    // 45° bend, toward its end a 135° turn back round the acute corner. The spur starts 1 m off the
    // road, so its arm is a few degrees off its own bearing.
    const towardEnd = out.find((r) => r.from === 'spur:end' && r.to === 'main:end')!
    const towardStart = out.find((r) => r.from === 'spur:end' && r.to === 'main:start')!
    expect(Math.abs(Math.abs(towardEnd.deflectionDegrees) - 135)).toBeLessThan(4)
    expect(Math.abs(Math.abs(towardStart.deflectionDegrees) - 45)).toBeLessThan(4)
    expect(towardEnd.maxOfftrackingM).toBeGreaterThan(towardStart.maxOfftrackingM)
    const overlay = junctionTurnOverlay(j, towardEnd)
    expect(overlay.features.map((f) => f.properties?.role)).toContain('swept-wheels')
    for (const feature of overlay.features)
      for (const c of (feature.geometry as GeoJSON.LineString).coordinates)
        expect(distance(c as Coordinate, j.coordinate)).toBeLessThan(250)
  })

  it('finds the same junction from the through road, and assumes a width for a mapped road', () => {
    const fromMain = findRoadJunctions(alignmentJunctionRoad(main), [alignmentJunctionRoad(spur)], 3).junctions
    expect(fromMain).toHaveLength(1)
    expect(fromMain[0].branchRoadId).toBe('spur')
    expect(fromMain[0].chainage).toBeCloseTo(150, 0)

    const mapped: ContextFeature = {
      id: 'fsr',
      name: 'Mapped FSR',
      kind: 'existing-road',
      geometry: { type: 'LineString', coordinates: [origin, offsetCoordinate(origin, 90, 300)] },
    }
    const [j] = findRoadJunctions(alignmentJunctionRoad(spur), [contextJunctionRoad(mapped)!], 4).junctions
    expect(j.widthAssumed).toBe(true)
    expect(j.arms.find((a) => a.roadId === 'fsr')!.leftHalfWidthM).toBe(4)
    expect(contextJunctionRoad({ ...mapped, kind: 'stream' })).toBeNull()
  })

  it('ignores roads that do not meet', () => {
    const far = road('far', [offsetCoordinate(origin, 0, 100), offsetCoordinate(origin, 0, 400)], 2)
    expect(findRoadJunctions(alignmentJunctionRoad(main), [alignmentJunctionRoad(far)], 3).junctions).toEqual([])
  })
})

/**
 * Hand-checkable vectors from the QuickTurn functional specification (clean-specs/quickturn.md §8),
 * computed there from the published equations (Prince & Dubois 2009; Sayers 1986; SAE J695;
 * Gillespie 1992 ch. 6), independently of QuickTurn.
 */
import { describe, expect, it } from 'vitest'
import { offsetCoordinate } from './engine'
import { analyzeSweptPath } from './sweptPath'
import { DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, Coordinate, DesignVehicle } from './types'
import { runCooperatively, runToCompletion } from './cooperative'
import {
  ackermannWheelAngles,
  loadLine,
  lockFromInnerWheelCut,
  steadyStateTurn,
  steeringGeometry,
  trackVehicle,
  type VehiclePose,
  type XY,
} from './vehicleKinematics'
import {
  defaultFilletRadius,
  driveSteps,
  filletPath,
  multiPolygonArea,
  positionAt,
  tracePresets,
  type DriveInput,
} from './vehiclePath'

const unit = (wheelbaseM: number, hitchOffsetM = 0, frontOverhangM = 0, rearOverhangM = 0) => ({
  name: 'Unit',
  wheelbaseM,
  frontOverhangM,
  rearOverhangM,
  hitchOffsetM,
})
const single = (wheelbaseM: number, extra: Partial<DesignVehicle> = {}): DesignVehicle => ({
  name: 'Truck',
  widthM: 2.6,
  units: [unit(wheelbaseM)],
  ...extra,
})
const drive = (input: DriveInput) => runToCompletion(driveSteps(input))
const RAD = Math.PI / 180

/** Straight approach of 4L, an arc of R through `deflection` (left), straight exit of 4L, as fillet vertices. */
function turnPath(R: number, deflectionDeg: number, L: number): XY[] {
  if (deflectionDeg === 90)
    return [
      [-4 * L, 0],
      [R, 0],
      [R, R + 4 * L],
    ]
  // Two 90° corners whose arcs meet: a 180° arc of radius R.
  return [
    [-4 * L, 0],
    [R, 0],
    [R, 2 * R],
    [-4 * L, 2 * R],
  ]
}

describe('steady-state offtracking (spec §8.1, §8.2)', () => {
  it('reproduces the single-unit vectors', () => {
    for (const [R, L, off, steer] of [
      [20, 10, 2.6795, 30],
      [12, 10, 5.3668, 56.443],
      [30, 12.5, 2.7282, 24.624],
    ]) {
      expect(steadyStateTurn(single(L), R).offtrackingM).toBeCloseTo(off, 3)
      expect(steeringGeometry(L, 2.6, { steerRadiusM: R }).lockDeg).toBeCloseTo(steer, 3)
    }
  })
  it('reproduces the tractor–semitrailer vector, fifth wheel over and ahead of the tandem', () => {
    const semi = (h: number): DesignVehicle => ({ name: 'Semi', widthM: 2.6, units: [unit(6, h), unit(12)] })
    const turn = steadyStateTurn(semi(0), 20)
    expect(turn.units[0].rearRadiusM).toBeCloseTo(19.0788, 4)
    expect(turn.units[1].rearRadiusM).toBeCloseTo(14.8324, 4)
    expect(turn.offtrackingM).toBeCloseTo(5.1676, 4)
    expect(turn.offtrackingM).toBeCloseTo(20 - Math.sqrt(220), 9)
    expect(steadyStateTurn(semi(-0.3), 20).offtrackingM).toBeCloseTo(5.1646, 4)
  })
  it('refuses a radius a unit cannot settle on', () => {
    expect(() => steadyStateTurn(single(10), 9)).toThrow(/cannot settle/)
  })
})

describe('exact straight-step tractrix (spec §8.3)', () => {
  const after = (alphaDeg: number, s: number, L: number) => {
    const axis: XY = [Math.cos(alphaDeg * RAD), Math.sin(alphaDeg * RAD)]
    let pose: VehiclePose | null = null
    trackVehicle(
      2,
      (k) => ({ x: k * s, y: 0 }),
      single(L),
      'tractrix',
      (p) => (pose = p),
      { startAxis: axis },
    )
    const [ax, ay] = (pose as unknown as VehiclePose).axes[0]
    return Math.atan2(ay, ax) / RAD
  }
  it('decays the angle as tan(α′/2) = tan(α/2)·e^(−s/L)', () => {
    expect(after(60, 10, 10)).toBeCloseTo(23.982, 3)
    expect(after(90, 5, 10)).toBeCloseTo(62.476, 3)
    expect(after(-60, 10, 10)).toBeCloseTo(-23.982, 3)
  })
})

describe('turning calculator and wheel angles (spec §8.6, §8.7)', () => {
  it('solves width, wheelbase, lock and the three radii from each other', () => {
    const g = steeringGeometry(6, 2.6, { lockDeg: 30 })
    expect(g.rearAxleRadiusM).toBeCloseTo(10.3923, 4)
    expect(g.steerRadiusM).toBeCloseTo(12, 4)
    expect(g.innerRearWheelM).toBeCloseTo(9.0923, 4)
    expect(g.innerFrontWheelM).toBeCloseTo(10.8936, 4)
    expect(g.outerFrontWheelM).toBeCloseTo(13.1419, 4)
    const start = steeringGeometry(10, 2.6, { steerRadiusM: 12 })
    expect(start.rearAxleRadiusM).toBeCloseTo(6.6332, 4)
    expect(start.lockDeg).toBeCloseTo(56.443, 3)
    expect(start.innerFrontWheelM).toBeCloseTo(11.3333, 4)
    expect(start.outerFrontWheelM).toBeCloseTo(12.7647, 4)
    const outer = steeringGeometry(5.5, 2.6, { outerFrontM: 13.7 })
    expect(outer.lockDeg).toBeCloseTo(26.0585, 4)
    expect(outer.steerRadiusM).toBeCloseTo(12.5202, 4)
  })
  it('converts an inner wheel cut to the single-track lock, and back by Ackermann', () => {
    const cut = lockFromInnerWheelCut(6, 2, 40)
    expect(cut.lockDeg).toBeCloseTo(36.359, 3)
    expect(cut.outerWheelDeg).toBeCloseTo(33.253, 3)
    const wheels = ackermannWheelAngles(6, 2, 25)
    expect(wheels.innerDeg).toBeCloseTo(26.821, 3)
    expect(wheels.outerDeg).toBeCloseTo(23.397, 3)
    expect(ackermannWheelAngles(6, 2, cut.lockDeg).innerDeg).toBeCloseTo(40, 9)
  })
})

describe('rigid load (spec §8.8)', () => {
  it('keeps the logs’ length, so the tail moves by the change in bunk spacing', () => {
    // Bunks 10.8 m apart travelling straight; logs 4.2 m ahead and 1.8 m behind: 16.8 m logs.
    const vehicle: DesignVehicle = {
      name: 'Logs',
      widthM: 2.6,
      units: [unit(5), unit(5.8)],
      loads: [
        {
          name: 'Logs',
          front: { unit: 0, behindPivotM: 0 },
          rear: { unit: 1, behindPivotM: 5.8 },
          aheadOfFrontBunkM: 4.2,
          behindRearBunkM: 1.8,
        },
      ],
    }
    // A pose that closes the bunks to 10.6 m: the trailer folds about the hitch.
    const fold = Math.acos((25 + 33.64 - 10.6 ** 2) / (2 * 5 * 5.8))
    const trailerAxis: XY = [Math.cos(Math.PI - fold), Math.sin(Math.PI - fold)]
    const pose: VehiclePose = {
      k: 0,
      fronts: [
        [0, 0],
        [-5, 0],
      ],
      rears: [
        [-5, 0],
        [-5 - trailerAxis[0] * 5.8, -trailerAxis[1] * 5.8],
      ],
      axes: [[1, 0], trailerAxis],
      steerDegrees: 0,
      steerSignedDegrees: 0,
    }
    const bunkGap = (line: ReturnType<typeof loadLine>) =>
      Math.hypot(line.frontBunk[0] - line.rearBunk[0], line.frontBunk[1] - line.rearBunk[1])
    const tail = (line: ReturnType<typeof loadLine>) =>
      Math.hypot(line.rear[0] - line.rearBunk[0], line.rear[1] - line.rearBunk[1])
    const stretch = loadLine(pose, vehicle.loads![0], vehicle)
    expect(bunkGap(stretch)).toBeCloseTo(10.6, 9)
    expect(tail(stretch)).toBeCloseTo(1.8, 9)
    const rigid = loadLine(pose, { ...vehicle.loads![0], lengthMode: 'rigid' }, vehicle)
    expect(tail(rigid)).toBeCloseTo(2.0, 9)
    expect(Math.hypot(rigid.front[0] - rigid.rear[0], rigid.front[1] - rigid.rear[1])).toBeCloseTo(16.8, 9)
  })
})

describe('the steer path', () => {
  it('rounds corners with tangent arcs and refuses what cannot be driven forward', () => {
    const { lengthM } = filletPath(
      [
        [0, 0],
        [20, 0],
        [20, 20],
      ],
      10,
    )
    // Two 10 m straights and a quarter circle of R10.
    expect(lengthM).toBeCloseTo(20 + (Math.PI * 10) / 2, 2)
    expect(() =>
      filletPath(
        [
          [0, 0],
          [20, 0],
          [0, 0.5],
        ],
        5,
      ),
    ).toThrow(/reverse/)
    expect(() =>
      filletPath(
        [
          [0, 0],
          [20, 0],
          [20, 5],
          [40, 5],
        ],
        10,
      ),
    ).toThrow(/does not fit between vertices 2 and 3/)
    expect(() => filletPath([[0, 0]], 0)).toThrow(/two distinct points/)
  })
  it('starts the fillet at the vehicle’s steady minimum, rounded up to 0.5 m', () => {
    expect(defaultFilletRadius(single(5.9, { steeringLockDeg: 32.983 }))).toBe(11)
    expect(defaultFilletRadius(single(5.9))).toBe(15)
  })
})

describe('driving a path', () => {
  it('reproduces the transient entry into a circle (spec §8.4)', () => {
    const R = 12,
      L = 10
    const { samples } = filletPath(turnPath(R, 90, L), R)
    const arcEnd = 4 * L + (R * Math.PI) / 2
    // The arc is sampled to its exact end, so one steer point sits there.
    const end = samples.findIndex((p) => Math.hypot(p.x - R, p.y - R) < 1e-9)
    expect(end).toBeGreaterThan(0)
    let at: VehiclePose | null = null
    trackVehicle(
      samples.length,
      (k) => samples[k],
      single(L),
      'tractrix',
      (pose) => {
        if (pose.k === end)
          at = { ...pose, rears: pose.rears.map((p) => [...p] as XY), axes: pose.axes.map((p) => [...p] as XY) }
      },
    )
    const pose = at as unknown as VehiclePose
    // φ against the path's exact tangent there, due north.
    const [ax, ay] = pose.axes[0]
    expect(Math.acos(ay / Math.hypot(ax, ay)) / RAD).toBeCloseTo(42.277, 2)
    // The reported angle takes the tangent from the neighbouring points, a quarter step's turn off at an arc's end.
    expect(Math.abs(pose.steerDegrees - 42.277)).toBeLessThan(0.35)
    const [x, y] = pose.rears[0]
    expect(Math.hypot(x, y - R)).toBeCloseTo(9.0856, 3)
    expect(Math.abs(R - Math.hypot(x, y - R) - 2.914)).toBeLessThan(0.001)
    // The drive keeps a position within half a metre of the arc end.
    const result = drive({ path: turnPath(R, 90, L), filletRadiusM: R, vehicle: single(L) })
    expect(Math.abs(positionAt(result, arcEnd)!.s - arcEnd)).toBeLessThanOrEqual(0.25 + 1e-9)
  })

  it('reproduces the maximum offtracking of the whole manoeuvre (spec §8.5)', () => {
    for (const [R, L, deflection, expected] of [
      [12, 10, 90, 3.475],
      [30, 12.5, 180, 2.723],
      [20, 10, 180, 2.66],
      [15, 6, 90, 1.197],
    ]) {
      const result = drive({ path: turnPath(R, deflection, L), filletRadiusM: R, vehicle: single(L) })
      expect(Math.abs(result.maxOfftrackingM - expected)).toBeLessThan(0.01)
      expect(result.maxSteer.degrees).toBeGreaterThan(0)
    }
  })

  it('matches the road check’s offtracking on the same tangent–arc–tangent', () => {
    const origin: Coordinate = [-122.8, 53.9]
    const R = 15,
      deflection = 90,
      tangent = R * Math.tan(((deflection / 2) * Math.PI) / 180)
    const pi = offsetCoordinate(origin, 90, tangent + 60)
    const road: Alignment = {
      id: 'curve',
      name: 'Curve',
      color: '#16817a',
      points: [
        { id: 'a', coordinate: origin, radiusM: 0 },
        { id: 'pi', coordinate: pi, radiusM: R },
        { id: 'b', coordinate: offsetCoordinate(pi, 90 - deflection, tangent + 60), radiusM: 0 },
      ],
      vertical: [],
      template: { ...DEFAULT_TEMPLATE, leftWidth: 8, rightWidth: 8 },
      overrides: [],
    }
    const vehicle = single(6)
    const roadCheck = analyzeSweptPath(road, { vehicle, direction: 'up', clearanceM: 0 }).maneuvers[0]
    const free = drive({
      path: [
        [-60, 0],
        [tangent, 0],
        [tangent, tangent + 60],
      ],
      filletRadiusM: R,
      vehicle,
    })
    expect(free.maxOfftrackingM).toBeCloseTo(1.197, 2)
    // The road check keeps its follow-the-leader step, about 0.05 m conservative.
    expect(roadCheck.maxOfftrackingM - free.maxOfftrackingM).toBeGreaterThan(-0.01)
    expect(roadCheck.maxOfftrackingM - free.maxOfftrackingM).toBeLessThan(0.08)
  })

  it('reports the steering side, the lock runs and the swept area of a straight run', () => {
    const vehicle: DesignVehicle = {
      name: 'Truck',
      widthM: 2.6,
      units: [unit(6, 0, 1, 1.5)],
      steeringLockDeg: 30,
    }
    const straight = drive({
      path: [
        [0, 0],
        [20, 0],
      ],
      filletRadiusM: 0,
      vehicle,
    })
    // A rectangle moved 20 m along its axis sweeps width × (travel + length).
    expect(straight.sweptAreaM2).toBeCloseTo(2.6 * (20 + 8.5), 2)
    expect(straight.swept).toHaveLength(1)
    expect(straight.lockExceeded).toBe(false)
    // R8 is tighter than the 12 m minimum at a 30° lock.
    const right = drive({
      path: [
        [0, 0],
        [30, 0],
        [30, -30],
      ],
      filletRadiusM: 8,
      vehicle,
    })
    expect(right.maxSteer.degrees).toBeLessThan(-30)
    expect(right.lockExceeded).toBe(true)
    expect(right.lockRuns.length).toBe(1)
    expect(right.lockRuns[0].maxSteerDeg).toBeLessThan(-30)
    expect(right.lockRuns[0].startS).toBeGreaterThan(20)
  })

  it('traces chosen points and checks the wheels against a footprint', () => {
    const vehicle: DesignVehicle = { name: 'Truck', widthM: 2.6, units: [unit(6, 0, 1, 1.5)] }
    const corner = tracePresets(vehicle).find((t) => t.label.endsWith('front-left corner'))!
    const lane = (half: number): DriveInput['footprint'] => [
      [
        [
          [-20, -half],
          [40, -half],
          [40, half],
          [-20, half],
          [-20, -half],
        ],
      ],
    ]
    const result = drive({
      path: [
        [0, 0],
        [20, 0],
      ],
      filletRadiusM: 0,
      vehicle,
      traces: [corner],
      footprint: lane(1.6),
      clearanceM: 0.3,
    })
    expect(result.traces[0].points[0]).toEqual([1, 1.3])
    expect(result.traces[0].points.at(-1)![0]).toBeCloseTo(21, 9)
    expect(result.footprint!.wheelShortfallM).toBe(0)
    expect(result.footprint!.wheelsFit).toBe(true)
    expect(result.footprint!.bodyOutsideM2).toBeCloseTo(0, 3)
    const narrow = drive({
      path: [
        [0, 0],
        [20, 0],
      ],
      filletRadiusM: 0,
      vehicle,
      footprint: lane(1.2),
      clearanceM: 0.3,
    })
    expect(narrow.footprint!.wheelsFit).toBe(false)
    expect(narrow.footprint!.wheelShortfallM).toBeCloseTo(0.4, 3)
    expect(narrow.footprint!.bodyBeyondM).toBeCloseTo(0.1, 3)
    // 0.1 m each side of the swept rectangle (20 m travel + 8.5 m long) is outside.
    expect(narrow.footprint!.bodyOutsideM2).toBeCloseTo(2 * 0.1 * 28.5, 2)
  })

  it('starts a parked vehicle at its own heading and swings it in', () => {
    const vehicle = single(10)
    const along = drive({
      path: [
        [0, 0],
        [40, 0],
      ],
      filletRadiusM: 0,
      vehicle,
    })
    const parked = drive({
      path: [
        [0, 0],
        [40, 0],
      ],
      filletRadiusM: 0,
      vehicle,
      startBearingDeg: 45,
    })
    expect(along.maxOfftrackingM).toBeCloseTo(0, 6)
    expect(parked.maxOfftrackingM).toBeGreaterThan(1)
    // After four wheelbases the axle has swung onto the path: tan(α/2) has decayed by e⁻⁴.
    expect(Math.abs(parked.positions.at(-1)!.pose.rears[0][1])).toBeLessThan(0.3)
    expect(parked.positions[0].pose.steerSignedDegrees).toBeCloseTo(-45, 6)
    expect(() =>
      drive({
        path: [
          [0, 0],
          [40, 0],
        ],
        filletRadiusM: 0,
        vehicle,
        startBearingDeg: 400,
      }),
    ).toThrow(/bearing/)
  })

  it('runs in slices and honours Cancel', async () => {
    const lg = {
      name: 'Truck and trailer',
      widthM: 2.6,
      units: [unit(5.9, -0.32, 1.1, 1.8), unit(6.59, 1.6, 0.7, 1.6), unit(5.95, 0, 0, 1.85)],
    }
    const input: DriveInput = { path: turnPath(14, 180, 10), filletRadiusM: 14, vehicle: lg }
    let slices = 0
    const result = await runCooperatively(driveSteps(input), { onProgress: () => slices++, sliceMs: 0 })
    expect(slices).toBeGreaterThan(2)
    expect(result.sweptAreaM2).toBeGreaterThan(0)
    expect(multiPolygonArea(result.wheels)).toBeLessThan(result.sweptAreaM2)
    const controller = new AbortController()
    controller.abort()
    await expect(runCooperatively(driveSteps(input), { signal: controller.signal })).rejects.toThrow(/Cancel/)
  })
})

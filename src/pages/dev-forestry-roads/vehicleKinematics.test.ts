import { describe, expect, it } from 'vitest'
import { offsetCoordinate } from './engine'
import { parseProject, serializeProject } from './project'
import { createSwitchbackAlternative, smallestFittingSwitchbackRadius, switchbackSweptTurn } from './switchback'
import { analyzeSweptPath, VEHICLE_PRESETS, validateVehicleCheck } from './sweptPath'
import { createDemoProject, DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, Coordinate, DesignVehicle, VehicleCheck } from './types'
import { minimumSteerRadius, steeringGeometry, trackVehicle, vehicleLength } from './vehicleKinematics'

const origin: Coordinate = [-122.8, 53.9]

/** One circular curve of the given deflection between long straights. */
function curve(radiusM: number, deflection = 160, halfWidthM = 6): Alignment {
  const tangent = radiusM * Math.tan(((deflection / 2) * Math.PI) / 180)
  const pi = offsetCoordinate(origin, 90, tangent + 60)
  return {
    id: 'curve',
    name: 'Curve',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'pi', coordinate: pi, radiusM },
      { id: 'b', coordinate: offsetCoordinate(pi, 90 - deflection, tangent + 60), radiusM: 0 },
    ],
    vertical: [],
    template: { ...DEFAULT_TEMPLATE, leftWidth: halfWidthM, rightWidth: halfWidthM },
    overrides: [],
  }
}

const single = (wheelbaseM: number, steeringLockDeg?: number): DesignVehicle => ({
  name: 'Truck',
  widthM: 2.6,
  units: [{ name: 'Truck', wheelbaseM, frontOverhangM: 0, rearOverhangM: 0, hitchOffsetM: 0 }],
  ...(steeringLockDeg === undefined ? {} : { steeringLockDeg }),
})
const check = (vehicle: DesignVehicle): VehicleCheck => ({ vehicle, direction: 'up', clearanceM: 0 })

describe('steering geometry', () => {
  it('solves a 5.9 m wheelbase truck at a 32.983° lock', () => {
    const g = steeringGeometry(5.9, 2.6, { lockDeg: 32.983 })
    expect(g.steerRadiusM).toBeCloseTo(10.838, 3)
    expect(g.rearAxleRadiusM).toBeCloseTo(9.091, 3)
    expect(g.innerRearWheelM).toBeCloseTo(7.791, 3)
    expect(g.innerFrontWheelM).toBeCloseTo(9.773, 3)
    expect(g.outerFrontWheelM).toBeCloseTo(11.949, 3)
  })

  it('solves a 5.5 m wheelbase tractor at a 26.059° lock', () => {
    const g = steeringGeometry(5.5, 2.6, { lockDeg: 26.059 })
    expect(g.steerRadiusM).toBeCloseTo(12.52, 3)
    expect(g.outerFrontWheelM).toBeCloseTo(13.7, 3)
  })

  it('gives the same geometry from any one of its four values', () => {
    const g = steeringGeometry(6.8, 2.6, { lockDeg: 30 })
    for (const given of [
      { steerRadiusM: g.steerRadiusM },
      { innerRearM: g.innerRearWheelM },
      { outerFrontM: g.outerFrontWheelM },
    ])
      expect(steeringGeometry(6.8, 2.6, given).lockDeg).toBeCloseTo(30, 9)
    expect(() => steeringGeometry(6.8, 2.6, { steerRadiusM: 6 })).toThrow(/longer than the wheelbase/)
    expect(() => steeringGeometry(6.8, 2.6, { outerFrontM: 5 })).toThrow(/too short/)
  })

  it('reproduces the BC MoTI Table 720.A radii from the preset locks', () => {
    const outerFront = (id: string) => {
      const v = VEHICLE_PRESETS.find((p) => p.id === id)!.vehicle
      return steeringGeometry(v.units[0].wheelbaseM, v.widthM, { lockDeg: v.steeringLockDeg! }).outerFrontWheelM
    }
    expect(outerFront('bc-moti-lg5')).toBeCloseTo(13.6, 2)
    expect(outerFront('bc-moti-lg3')).toBeCloseTo(13.6, 2)
    expect(outerFront('bc-moti-wb15')).toBeCloseTo(13.7, 2)
  })
})

describe('exact trailing step', () => {
  /** Tangent, arc of radius R and deflection, tangent, every `step` metres; local metres. */
  function arcPath(R: number, deflectionDeg: number, step: number) {
    const lead = 40,
      sweep = (deflectionDeg * Math.PI) / 180,
      arc = R * sweep
    const points: { x: number; y: number }[] = []
    for (let s = 0; s <= lead + arc + 40 + 1e-9; s += step) {
      if (s <= lead) points.push({ x: s, y: 0 })
      else if (s <= lead + arc) {
        const a = (s - lead) / R
        points.push({ x: lead + R * Math.sin(a), y: R * (1 - Math.cos(a)) })
      } else {
        const d = s - lead - arc
        points.push({
          x: lead + R * Math.sin(sweep) + d * Math.cos(sweep),
          y: R * (1 - Math.cos(sweep)) + d * Math.sin(sweep),
        })
      }
    }
    return points
  }
  /** Largest distance of the rear axle from the path, measured against a 2 cm sampling of it. */
  function maxOfftracking(R: number, deflectionDeg: number, L: number, step: number) {
    const path = arcPath(R, deflectionDeg, step)
    const fine = arcPath(R, deflectionDeg, 0.02)
    let worst = 0
    trackVehicle(
      path.length,
      (k) => path[k],
      single(L),
      'tractrix',
      (pose) => {
        // Until the rear axle is on the path it sits on the straight extension behind its start.
        if (pose.k * step < L + 1) return
        const [x, y] = pose.rears[0]
        let nearest = Infinity
        for (const p of fine) nearest = Math.min(nearest, (p.x - x) ** 2 + (p.y - y) ** 2)
        worst = Math.max(worst, Math.sqrt(nearest))
      },
    )
    return worst
  }

  it('matches the converged offtracking at 1 m steps', () => {
    // References from an independent fine-step integration of the no-slip trailing equation.
    expect(Math.abs(maxOfftracking(30, 180, 12.5, 1) - 2.723)).toBeLessThan(0.01)
    expect(Math.abs(maxOfftracking(12, 90, 10, 1) - 3.475)).toBeLessThan(0.02)
    expect(Math.abs(maxOfftracking(12, 90, 10, 0.25) - 3.475)).toBeLessThan(0.005)
  })
})

describe('steering lock on the road swept path', () => {
  it('flags an 8 m curve a 5.9 m wheelbase, 33° lock truck cannot steer, even with room to spare', () => {
    const tight = analyzeSweptPath(curve(8), check(single(5.9, 33)))
    expect(tight.minSteerRadiusM).toBeCloseTo(5.9 / Math.sin((33 * Math.PI) / 180), 6)
    const [turn] = tight.maneuvers
    // Steady state would be asin(5.9 / 8) = 47.5°; 160° of turn gets within a couple of degrees.
    expect(turn.maxSteerDegrees).toBeGreaterThan(44)
    expect(turn.maxSteerDegrees).toBeLessThan(47.6)
    expect(turn.lockExceeded).toBe(true)
    expect(turn.fits).toBe(true)
    expect(tight.warnings.join(' ')).toMatch(/1 turn needs more steering than the vehicle’s 33° lock/)

    const easy = analyzeSweptPath(curve(15), check(single(5.9, 33))).maneuvers[0]
    expect(easy.maxSteerDegrees).toBeCloseTo(23.16, 0)
    expect(easy.lockExceeded).toBe(false)
  })

  it('sizes a switchback no tighter than the vehicle can steer', () => {
    const start: Alignment = {
      ...curve(30, 160, 8),
      points: [
        { id: 's', coordinate: origin, radiusM: 0 },
        { id: 'e', coordinate: offsetCoordinate(origin, 90, 120), radiusM: 0 },
      ],
      vertical: [
        { id: 'v0', chainage: 0, elevation: 800, curveLength: 0 },
        { id: 'v1', chainage: 120, elevation: 803, curveLength: 0 },
      ],
    }
    const options = {
      id: 'sb',
      direction: 'right' as const,
      radiusM: 20,
      approachM: 40,
      tangentM: 10,
      departureM: 60,
      gradePercent: 3,
      startElevationM: 803,
    }
    const truck = check(single(5.9, 33))
    const radius = smallestFittingSwitchbackRadius(start, options, truck)!
    // The 8 m formation holds the wheels at any radius; the 33° lock (steady minimum 10.8 m) decides.
    expect(radius).toBeGreaterThan(10)
    expect(radius).toBeLessThan(12)
    const at = (r: number) => switchbackSweptTurn(createSwitchbackAlternative(start, { ...options, radiusM: r }), truck)
    expect(at(radius).fits).toBe(true)
    expect(at(radius - 0.5).wheelsFit).toBe(true)
    expect(at(radius - 0.5).lockExceeded).toBe(true)
    expect(at(radius - 0.5).fits).toBe(false)
  })

  it('reports no lock result when no lock is entered', () => {
    const [turn] = analyzeSweptPath(curve(8), check(single(5.9))).maneuvers
    expect(turn.lockExceeded).toBeNull()
    expect(turn.maxSteerDegrees).toBeGreaterThan(44)
  })
})

describe('loads spanning two units', () => {
  it('reproduces a load modelled as its own unit when the bunks are the hitch and the trailer axle', () => {
    const asUnit = VEHICLE_PRESETS[0].vehicle
    const truck = asUnit.units[0],
      logs = asUnit.units[1]
    const asLoad: DesignVehicle = {
      ...asUnit,
      units: [truck, { ...logs, name: 'Trailer', frontOverhangM: 0, rearOverhangM: 0 }],
      loads: [
        {
          name: 'Logs',
          front: { unit: 0, behindPivotM: truck.wheelbaseM + truck.hitchOffsetM },
          rear: { unit: 1, behindPivotM: logs.wheelbaseM },
          aheadOfFrontBunkM: logs.frontOverhangM,
          behindRearBunkM: logs.rearOverhangM,
        },
      ],
    }
    expect(vehicleLength(asLoad)).toBeCloseTo(vehicleLength(asUnit), 9)
    const road = curve(25, 160, 2.5)
    const a = analyzeSweptPath(road, { vehicle: asUnit, direction: 'both', clearanceM: 0.3 })
    const b = analyzeSweptPath(road, { vehicle: asLoad, direction: 'both', clearanceM: 0.3 })
    expect(b.maneuvers.length).toBe(a.maneuvers.length)
    b.maneuvers.forEach((turn, i) => {
      expect(Math.abs(turn.bodyLeftM - a.maneuvers[i].bodyLeftM)).toBeLessThan(0.05)
      expect(Math.abs(turn.bodyRightM - a.maneuvers[i].bodyRightM)).toBeLessThan(0.05)
      expect(turn.maxOfftrackingM).toBeCloseTo(a.maneuvers[i].maxOfftrackingM, 6)
    })
  })

  it('swings a long front log overhang wider than the units alone', () => {
    const lg5 = VEHICLE_PRESETS.find((p) => p.id === 'bc-moti-lg5')!.vehicle
    const road = curve(20, 160, 3)
    const loaded = analyzeSweptPath(road, check(lg5)).maneuvers[0]
    const unloaded = analyzeSweptPath(road, check({ ...lg5, loads: [] })).maneuvers[0]
    expect(loaded.maxOfftrackingM).toBeCloseTo(unloaded.maxOfftrackingM, 6)
    expect(Math.max(loaded.bodyLeftM, loaded.bodyRightM)).toBeGreaterThan(
      Math.max(unloaded.bodyLeftM, unloaded.bodyRightM),
    )
  })
})

describe('BC MoTI presets', () => {
  it('are valid, name their source and mark what must be confirmed', () => {
    for (const id of ['bc-moti-lg5', 'bc-moti-lg3', 'bc-moti-wb15']) {
      const preset = VEHICLE_PRESETS.find((p) => p.id === id)!
      expect(() => validateVehicleCheck({ vehicle: preset.vehicle, direction: 'both', clearanceM: 0.3 })).not.toThrow()
      expect(preset.vehicle.source).toMatch(/Supplement to TAC Geometric Design Guide/)
      expect(preset.vehicle.source).toMatch(/confirm/)
      expect(preset.vehicle.source).toMatch(/not an approval/)
      expect(preset.vehicle.source!.length).toBeLessThanOrEqual(2000)
      expect(minimumSteerRadius(preset.vehicle)).toBeGreaterThan(preset.vehicle.units[0].wheelbaseM)
    }
  })

  it('places the log bunks the figure’s distance apart travelling straight', () => {
    const straightSpacing = (v: DesignVehicle) => {
      const load = v.loads![0]
      let pivot = 0
      const pivots = v.units.map((u) => {
        const at = pivot
        pivot += u.wheelbaseM + u.hitchOffsetM
        return at
      })
      return pivots[load.rear.unit] + load.rear.behindPivotM - pivots[load.front.unit] - load.front.behindPivotM
    }
    expect(straightSpacing(VEHICLE_PRESETS.find((p) => p.id === 'bc-moti-lg5')!.vehicle)).toBeCloseTo(10.8, 6)
    expect(straightSpacing(VEHICLE_PRESETS.find((p) => p.id === 'bc-moti-lg3')!.vehicle)).toBeCloseTo(10.35, 6)
  })

  it('rejects loads that do not span two units, and saves and reopens lock and loads', () => {
    const lg5 = structuredClone(VEHICLE_PRESETS.find((p) => p.id === 'bc-moti-lg5')!.vehicle)
    const bad = { ...lg5, loads: [{ ...lg5.loads![0], rear: { unit: 0, behindPivotM: 1 } }] }
    expect(() => validateVehicleCheck(check(bad))).toThrow(/later unit/)
    expect(() => validateVehicleCheck(check({ ...lg5, steeringLockDeg: 80 }))).toThrow(/lock/)
    const project = createDemoProject()
    project.alignments[0] = { ...project.alignments[0], vehicleCheck: check(lg5) }
    const restored = parseProject(serializeProject(project))
    expect(restored.alignments[0].vehicleCheck).toEqual(check(lg5))
    // Files saved before locks and loads existed still open, without them.
    const older = createDemoProject()
    older.alignments[0] = { ...older.alignments[0], vehicleCheck: check(single(5.8)) }
    expect(parseProject(serializeProject(older)).alignments[0].vehicleCheck?.vehicle).toEqual(single(5.8))
  })
})

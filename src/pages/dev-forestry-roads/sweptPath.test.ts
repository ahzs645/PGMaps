import { describe, expect, it } from 'vitest'
import { offsetCoordinate } from './engine'
import {
  createSwitchbackAlternative,
  smallestFittingSwitchbackRadius,
  switchbackSweptTurn,
  type SwitchbackOptions,
} from './switchback'
import { analyzeSweptPath, DEFAULT_VEHICLE_CHECK, VEHICLE_PRESETS, validateVehicleCheck } from './sweptPath'
import { DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, Coordinate, DesignVehicle, VehicleCheck } from './types'

const origin: Coordinate = [-122.8, 53.9]

/** One long circular curve: 160° of deflection is enough for every unit to reach steady state. */
function hairpin(radiusM: number, halfWidthM = 2.5): Alignment {
  const deflection = 160
  const tangent = radiusM * Math.tan(((deflection / 2) * Math.PI) / 180)
  const pi = offsetCoordinate(origin, 90, tangent + 60)
  return {
    id: 'hairpin',
    name: 'Hairpin',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'pi', coordinate: pi, radiusM },
      { id: 'b', coordinate: offsetCoordinate(pi, 90 - (180 - deflection) + 180, tangent + 60), radiusM: 0 },
    ],
    vertical: [],
    template: { ...DEFAULT_TEMPLATE, leftWidth: halfWidthM, rightWidth: halfWidthM },
    overrides: [],
  }
}

const vehicle = (units: [number, number][], widthM = 2.6): DesignVehicle => ({
  name: 'Test',
  widthM,
  units: units.map(([wheelbaseM, hitchOffsetM], i) => ({
    name: `U${i}`,
    wheelbaseM,
    frontOverhangM: 0,
    rearOverhangM: 0,
    hitchOffsetM,
  })),
})
const check = (v: DesignVehicle, direction: VehicleCheck['direction'] = 'up', clearanceM = 0): VehicleCheck => ({
  vehicle: v,
  direction,
  clearanceM,
})

describe('design-vehicle swept path', () => {
  it('reaches the closed-form steady offtracking of a single unit on a circular curve', () => {
    const R = 60,
      L = 8
    const result = analyzeSweptPath(hairpin(R), check(vehicle([[L, 0]])))
    expect(result.maneuvers).toHaveLength(1)
    const [turn] = result.maneuvers
    expect(turn.curveIds).toEqual(['H1'])
    expect(turn.maxOfftrackingM).toBeCloseTo(R - Math.sqrt(R ** 2 - L ** 2), 1)
    expect(turn.maxArticulationDegrees).toBe(0)
  })

  it('compounds tractor and semitrailer offtracking through the hitch', () => {
    const R = 60,
      L1 = 6,
      L2 = 12
    const [turn] = analyzeSweptPath(
      hairpin(R),
      check(
        vehicle([
          [L1, 0],
          [L2, 0],
        ]),
      ),
    ).maneuvers
    const steady = R - Math.sqrt(R ** 2 - L1 ** 2 - L2 ** 2)
    expect(turn.maxOfftrackingM).toBeCloseTo(steady, 1)
    // Steady articulation: the trailer axis makes asin(L2/Rh) with the tractor's rear tangent.
    expect(turn.maxArticulationDegrees).toBeGreaterThan(10)
    expect(turn.maxArticulationDegrees).toBeLessThan(25)
    // The turn is to the right, so offtracking widens the right (inside) wheel path.
    expect(turn.deflectionDegrees).toBeLessThan(0)
    expect(turn.wheelRightM).toBeCloseTo(steady + 1.3, 1)
    expect(turn.wheelLeftM).toBeCloseTo(1.3, 1)
  })

  it('states the widening the wheels need beyond the formation, with the clearance margin', () => {
    const narrow = analyzeSweptPath(hairpin(25, 2.5), check(VEHICLE_PRESETS[2].vehicle, 'up', 0.3))
    const [turn] = narrow.maneuvers
    expect(narrow.fits).toBe(false)
    expect(turn.fits).toBe(false)
    expect(turn.requiredRightWideningM).toBeCloseTo(turn.wheelRightM + 0.3 - 2.5, 2)
    expect(turn.worstChainage).toBeGreaterThan(turn.start)
    expect(turn.worstChainage).toBeLessThan(turn.end)
    const deficits = narrow.overlay.features.filter((f) => f.properties?.role === 'swept-deficit')
    expect(deficits.length).toBeGreaterThan(0)
    // Widened to the stated amount (plus rounding), the same turn fits.
    const wide = analyzeSweptPath(
      hairpin(25, 2.5 + turn.requiredRightWideningM + 0.01),
      check(VEHICLE_PRESETS[2].vehicle, 'up', 0.3),
    )
    expect(wide.maneuvers[0].fits).toBe(true)
    expect(wide.overlay.features.some((f) => f.properties?.role === 'swept-deficit')).toBe(false)
  })

  it('judges both curves of a switchback as one 180° turn, in each travel direction', () => {
    const start: Alignment = {
      ...hairpin(30),
      points: [
        { id: 's', coordinate: origin, radiusM: 0 },
        { id: 'e', coordinate: offsetCoordinate(origin, 90, 100), radiusM: 0 },
      ],
      vertical: [
        { id: 'v0', chainage: 0, elevation: 800, curveLength: 0 },
        { id: 'v1', chainage: 100, elevation: 803, curveLength: 0 },
      ],
    }
    const { alignment } = createSwitchbackAlternative(start, {
      id: 'sb',
      direction: 'left',
      radiusM: 20,
      approachM: 40,
      tangentM: 10,
      departureM: 60,
      gradePercent: 3,
      startElevationM: 803,
    })
    const result = analyzeSweptPath(alignment, { ...DEFAULT_VEHICLE_CHECK, direction: 'both' })
    expect(result.maneuvers.map((m) => [m.id, m.direction])).toEqual([
      ['H1+H2', 'up'],
      ['H1+H2', 'down'],
    ])
    for (const turn of result.maneuvers) {
      expect(turn.deflectionDegrees).toBeCloseTo(180, 3)
      // A loaded pole trailer on R20 tracks well inside the steer path and outside a 5 m road.
      expect(turn.maxOfftrackingM).toBeGreaterThan(2)
      expect(turn.requiredLeftWideningM).toBeGreaterThan(0)
      expect(turn.bodyLeftM).toBeGreaterThanOrEqual(turn.wheelLeftM - 1e-6)
    }
    expect(result.overlay.features.some((f) => f.properties?.role === 'swept-wheels')).toBe(true)
    expect(result.overlay.features.some((f) => f.properties?.role === 'swept-body')).toBe(true)
    for (const feature of result.overlay.features)
      for (const [lng, lat] of (feature.geometry as GeoJSON.LineString).coordinates) {
        expect(Math.abs(lng - origin[0])).toBeLessThan(0.01)
        expect(Math.abs(lat - origin[1])).toBeLessThan(0.01)
      }
  })

  it('tracks the centreline exactly on the approach, and records nothing on a road without curves', () => {
    const road = hairpin(60)
    // Up-station only: travelling down, these stations follow the turn and the trailer is still recovering.
    const result = analyzeSweptPath(road, { ...DEFAULT_VEHICLE_CHECK, direction: 'up' })
    const [turn] = result.maneuvers
    // The straight approach inside the turn's window: the truck is still straight behind the steer axle.
    const approach = result.bins.filter((b) => b.chainage > turn.start + 3 && b.chainage < turn.start + 8)
    expect(approach.length).toBeGreaterThan(0)
    for (const bin of approach) {
      expect(bin.wheelLeftM).toBeCloseTo(1.3, 3)
      expect(bin.wheelRightM).toBeCloseTo(1.3, 3)
    }
    const straight = analyzeSweptPath(
      { ...road, points: [road.points[0], { ...road.points[2], radiusM: 0 }] },
      DEFAULT_VEHICLE_CHECK,
    )
    expect(straight.maneuvers).toEqual([])
    expect(straight.fits).toBe(true)
    expect(straight.warnings).toContain('No fitted horizontal curves; the vehicle tracks the centreline.')
    expect(straight.bins.every((b) => b.wheelLeftM === null)).toBe(true)
    expect(straight.overlay.features).toEqual([])
  })

  it('rejects vehicles outside the supported dimensions', () => {
    expect(() => validateVehicleCheck(DEFAULT_VEHICLE_CHECK)).not.toThrow()
    const bad = structuredClone(DEFAULT_VEHICLE_CHECK)
    bad.vehicle.units[0].wheelbaseM = 0
    expect(() => validateVehicleCheck(bad)).toThrow(/wheelbase/)
    expect(() => validateVehicleCheck({ ...DEFAULT_VEHICLE_CHECK, clearanceM: -1 })).toThrow(/clearance/)
    expect(() =>
      validateVehicleCheck({ ...DEFAULT_VEHICLE_CHECK, vehicle: { ...DEFAULT_VEHICLE_CHECK.vehicle, units: [] } }),
    ).toThrow(/one to three/)
  })

  it('finds the smallest switchback radius whose turn keeps the wheels on the formation', () => {
    const start: Alignment = {
      ...hairpin(30, 3),
      points: [
        { id: 's', coordinate: origin, radiusM: 0 },
        { id: 'e', coordinate: offsetCoordinate(origin, 90, 120), radiusM: 0 },
      ],
      vertical: [
        { id: 'v0', chainage: 0, elevation: 800, curveLength: 0 },
        { id: 'v1', chainage: 120, elevation: 803, curveLength: 0 },
      ],
    }
    const options: SwitchbackOptions = {
      id: 'sb',
      direction: 'right',
      radiusM: 20,
      approachM: 40,
      tangentM: 10,
      departureM: 60,
      gradePercent: 3,
      startElevationM: 803,
    }
    const check = { ...DEFAULT_VEHICLE_CHECK, clearanceM: 0.3 }
    const radius = smallestFittingSwitchbackRadius(start, options, check)!
    expect(radius).toBeGreaterThan(20)
    const at = (r: number) => switchbackSweptTurn(createSwitchbackAlternative(start, { ...options, radiusM: r }), check)
    expect(at(radius).fits).toBe(true)
    expect(at(radius - 0.5).fits).toBe(false)
    expect(at(20).requiredWideningM).toBeGreaterThan(0)
    // A formation too narrow for the vehicle's own width cannot be fixed by radius alone.
    const tooNarrow = { ...start, template: { ...start.template, leftWidth: 1.2, rightWidth: 1.2 } }
    expect(smallestFittingSwitchbackRadius(tooNarrow, options, check)).toBeNull()
  })
})

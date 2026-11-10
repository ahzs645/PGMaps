import { describe, expect, it } from 'vitest'
import { runToCompletion } from './cooperative'
import { VEHICLE_PRESETS } from './sweptPath'
import type { DesignVehicle } from './types'
import { largestInscribedDisc, loopTurnaroundFit, placeTemplate, steadyPose, turningTemplate } from './turningTemplate'
import { driveSteps, type MultiPolygon } from './vehiclePath'
import type { XY } from './vehicleKinematics'

const RAD = Math.PI / 180
const truck: DesignVehicle = {
  name: 'Truck',
  widthM: 2.6,
  units: [{ name: 'Truck', wheelbaseM: 6, frontOverhangM: 1, rearOverhangM: 1.5, hitchOffsetM: 0 }],
  steeringLockDeg: 30,
}
const rectangle = (w: number, h: number): MultiPolygon => [
  [
    [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
      [0, 0],
    ],
  ],
]

describe('steady pose (spec §8.9)', () => {
  it('puts the rear axle square to its radius', () => {
    const vehicle: DesignVehicle = { ...truck, units: [{ ...truck.units[0], frontOverhangM: 0, rearOverhangM: 0 }] }
    const pose = steadyPose(vehicle, 15, 'left')
    const [rx, ry] = pose.rears[0],
      [fx, fy] = pose.fronts[0]
    expect(Math.hypot(rx, ry)).toBeCloseTo(13.7477, 4)
    const between = Math.acos((rx * fx + ry * fy) / (Math.hypot(rx, ry) * Math.hypot(fx, fy))) / RAD
    expect(between).toBeCloseTo(23.578, 3)
    // The axle moves square to its radius: the unit axis is perpendicular to it.
    expect(rx * pose.axes[0][0] + ry * pose.axes[0][1]).toBeCloseTo(0, 9)
    // Turning left about the origin, the vehicle travels anticlockwise.
    expect(rx * pose.axes[0][1] - ry * pose.axes[0][0]).toBeGreaterThan(0)
    const right = steadyPose(vehicle, 15, 'right')
    expect(right.rears[0][0] * right.axes[0][1] - right.rears[0][1] * right.axes[0][0]).toBeLessThan(0)
  })

  it('carries each trailer on SAE J695’s radii', () => {
    const wb15 = VEHICLE_PRESETS.find((p) => p.id === 'bc-moti-wb15')!.vehicle
    const t = turningTemplate(wb15, { steerRadiusM: 20 })
    expect(t.rearAxleRadiiM[1]).toBeCloseTo(Math.sqrt(400 - 5.5 ** 2 - 11 ** 2), 3)
    expect(Math.hypot(...t.pose.rears[1])).toBeCloseTo(t.rearAxleRadiiM[1], 3)
  })
})

describe('turning template', () => {
  it('reports the outer body, inner wheel and annulus at the lock', () => {
    const t = turningTemplate(truck, { clearanceM: 0.5 })
    // Lock 30°, wheelbase 6: rear axle on 10.3923, steer axle on 12.
    expect(t.steerRadiusM).toBeCloseTo(12, 3)
    expect(t.steerDegrees).toBeCloseTo(30, 3)
    expect(t.innerWheelRadiusM).toBeCloseTo(10.3923 - 1.3, 3)
    // Front outer corner: 1.3 m outside the rear axle's radius, 7 m ahead of it.
    expect(t.outerBodyRadiusM).toBeCloseTo(Math.hypot(10.3923 + 1.3, 7), 3)
    expect(t.annulusWidthM).toBeCloseTo(t.outerBodyRadiusM - t.innerWheelRadiusM, 2)
    expect(t.turnaroundDiameterM).toBeCloseTo(2 * (t.outerBodyRadiusM + 0.5), 3)
    expect(t.lockExceeded).toBe(false)
    expect(turningTemplate(truck, { steerRadiusM: 10 }).lockExceeded).toBe(true)
    expect(() => turningTemplate({ ...truck, steeringLockDeg: undefined })).toThrow(/steering lock or a steer radius/)
  })

  it('is what a vehicle driving a closed loop at the lock radius settles on', () => {
    const t = turningTemplate(truck)
    const R = t.steerRadiusM,
      N = 24
    // Two loops round a circumscribed 24-gon whose fillets of R make a circle about (0, R).
    const path: XY[] = [[-20, 0]]
    for (let j = 0; j < 2 * N; j++) {
      const a = -Math.PI / 2 + ((j + 0.5) * 2 * Math.PI) / N
      const r = R / Math.cos(Math.PI / N)
      path.push([r * Math.cos(a), R + r * Math.sin(a)])
    }
    path.push([5, 0])
    const run = runToCompletion(driveSteps({ path, filletRadiusM: R, vehicle: truck }))
    expect(run.lockExceeded).toBe(false)
    expect(Math.abs(run.maxSteer.degrees)).toBeLessThanOrEqual(truck.steeringLockDeg! + 0.1)
    // The island in the middle is the inner swept circle; the far side of the outer boundary the outer body circle.
    const radius = (p: XY) => Math.hypot(p[0], p[1] - R)
    const holes = run.swept.flatMap((polygon) => polygon.slice(1))
    expect(holes).toHaveLength(1)
    for (const p of holes[0]) expect(Math.abs(radius(p) - t.innerSweptRadiusM)).toBeLessThan(0.05)
    const far = run.swept[0][0].filter((p) => p[1] > R)
    expect(Math.abs(Math.max(...far.map(radius)) - t.outerBodyRadiusM)).toBeLessThan(0.05)
    expect(t.annulusWidthM).toBeCloseTo(t.outerBodyRadiusM - t.innerWheelRadiusM, 6)
  })

  it('places the template’s circles and vehicle about a chosen centre', () => {
    const t = turningTemplate(truck)
    const placed = placeTemplate(t, [100, 50])
    const ring = placed.circle(t.outerBodyRadiusM)
    expect(Math.hypot(ring[0][0] - 100, ring[0][1] - 50)).toBeCloseTo(t.outerBodyRadiusM, 9)
    expect(placed.bodies[0].ring[0][0]).toBeCloseTo(t.outline.bodies[0].ring[0][0] + 100, 9)
  })
})

describe('loop turnaround on a landing', () => {
  it('finds the largest disc inside a footprint, holes excluded', () => {
    const disc = largestInscribedDisc(rectangle(30, 40))!
    expect(disc.radiusM).toBeGreaterThan(15 - 0.06)
    expect(disc.radiusM).toBeLessThanOrEqual(15 + 1e-9)
    expect(disc.centre[0]).toBeCloseTo(15, 0)
    const holed: MultiPolygon = [
      [
        rectangle(40, 40)[0][0],
        [
          [15, 15],
          [15, 25],
          [25, 25],
          [25, 15],
          [15, 15],
        ],
      ],
    ]
    expect(largestInscribedDisc(holed)!.radiusM).toBeLessThan(10)
  })

  it('says whether the loop fits, and by how much it falls short', () => {
    const t = turningTemplate(truck, { clearanceM: 0.5 })
    const roomy = loopTurnaroundFit(t, rectangle(30, 30))
    expect(roomy.fits).toBe(true)
    expect(roomy.shortM).toBe(0)
    const tight = loopTurnaroundFit(t, rectangle(26, 40))
    expect(tight.fits).toBe(false)
    expect(tight.shortM).toBeCloseTo(t.outerBodyRadiusM + 0.5 - 13, 1)
  })
})

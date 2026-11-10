import { describe, expect, it } from 'vitest'
import { runToCompletion } from './cooperative'
import { distance, offsetCoordinate } from './engine'
import { DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, Coordinate, DesignVehicle } from './types'
import { roadTraceSteps, vehicleAtStation } from './vehicleOnRoad'
import { tracePresets } from './vehiclePath'

const origin: Coordinate = [-122.8, 53.9]
function road(radiusM: number, deflection: number, halfWidthM = 4): Alignment {
  const tangent = radiusM * Math.tan(((deflection / 2) * Math.PI) / 180)
  const pi = offsetCoordinate(origin, 90, tangent + 60)
  return {
    id: 'road',
    name: 'Road',
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
const truck: DesignVehicle = {
  name: 'Truck and trailer',
  widthM: 2.6,
  units: [
    { name: 'Truck', wheelbaseM: 6, frontOverhangM: 1, rearOverhangM: 0, hitchOffsetM: 0 },
    { name: 'Trailer', wheelbaseM: 9, frontOverhangM: 0, rearOverhangM: 2, hitchOffsetM: 0 },
  ],
}

describe('the vehicle at a station', () => {
  it('puts the steer axle exactly at the typed station, up or down the road', () => {
    const straight = road(30, 1)
    const up = vehicleAtStation(straight, truck, 20.3, 'up')
    const [x, y] = up.pose.fronts[0]
    expect(distance(up.toCoordinate(x, y), origin)).toBeCloseTo(20.3, 2)
    expect(up.outline.bodies).toHaveLength(2)
    expect(up.outline.axles).toHaveLength(3)
    // Travelling straight: no steering, no articulation; the trailer's rear is 16 m behind.
    expect(Math.abs(up.steerSignedDegrees)).toBeLessThan(0.1)
    expect(Math.abs(up.articulation[0])).toBeLessThan(0.1)
    const down = vehicleAtStation(straight, truck, 20.3, 'down')
    expect(down.pose.axes[0][0]).toBeLessThan(0)
    expect(vehicleAtStation(straight, truck, 0, 'up').station).toBe(0)
  })

  it('steers left through a left curve', () => {
    const curve = road(15, 90)
    const tangent = 15
    const mid = 60 + tangent * 0 + (15 * Math.PI) / 4
    const at = vehicleAtStation(curve, truck, mid, 'up')
    expect(at.steerSignedDegrees).toBeGreaterThan(10)
    expect(at.articulation[0]).toBeLessThan(0)
  })
})

describe('point traces along the road', () => {
  it('reports each side’s widest offset and how far past the formation it goes', () => {
    const curve = road(12, 90, 3)
    const presets = tracePresets(truck)
    const front = presets.find((p) => p.label === 'Truck front-right corner')!
    const tail = presets.find((p) => p.label === 'Trailer rear-left corner')!
    const [frontTrace, tailTrace] = runToCompletion(roadTraceSteps(curve, truck, 'up', [front, tail]))
    // On the straight the front-right corner sits 1.3 m right of the centreline.
    expect(frontTrace.rightM).toBeGreaterThan(1.29)
    expect(frontTrace.coordinates.length).toBeGreaterThan(100)
    // The trailer cuts the inside (left) of the left turn, past a 3 m formation.
    expect(tailTrace.leftM).toBeGreaterThan(3)
    expect(tailTrace.beyondLeftM).toBeCloseTo(tailTrace.leftM - 3, 3)
    expect(tailTrace.beyondStation).not.toBeNull()
    expect(runToCompletion(roadTraceSteps(curve, truck, 'up', []))).toEqual([])
  })
})

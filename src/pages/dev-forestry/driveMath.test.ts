import { describe, expect, it } from 'vitest'
import { distanceAlongRoad, roadPath } from './driveMath'

describe('distance along the road', () => {
  // An L: 0.01° east, then 0.01° north, at 54° N.
  const path = roadPath([
    [-122, 54],
    [-121.99, 54],
    [-121.99, 54.01],
  ])
  const corner = path[1].distanceAlongMeters

  it('projects a click beside the road onto the nearest stretch', () => {
    expect(distanceAlongRoad(path, { lng: -121.995, lat: 54.0003 })).toBeCloseTo(corner / 2, -1)
    expect(distanceAlongRoad(path, { lng: -121.9897, lat: 54.005 })).toBeCloseTo(
      (corner + path[2].distanceAlongMeters) / 2,
      -1,
    )
  })
  it('clamps to the ends and refuses nothing to measure', () => {
    expect(distanceAlongRoad(path, { lng: -122.01, lat: 53.99 })).toBe(0)
    expect(distanceAlongRoad(path, { lng: -121.99, lat: 54.05 })).toBeCloseTo(path[2].distanceAlongMeters, 6)
    expect(distanceAlongRoad([], { lng: 0, lat: 0 })).toBeNull()
  })
})

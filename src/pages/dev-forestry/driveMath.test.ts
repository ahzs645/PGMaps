import { describe, expect, it } from 'vitest'
import { bearingBetween, distanceAlongRoad, pointAlongBearing, roadPath } from './driveMath'

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

describe('plan handles: bearings and points along them', () => {
  const eye = { lng: -122.5, lat: 53.9 }

  it('reads compass bearings clockwise from north', () => {
    expect(bearingBetween(eye, { lng: eye.lng, lat: eye.lat + 0.01 })).toBeCloseTo(0, 6)
    expect(bearingBetween(eye, { lng: eye.lng + 0.01, lat: eye.lat })).toBeCloseTo(90, 6)
    expect(bearingBetween(eye, { lng: eye.lng, lat: eye.lat - 0.01 })).toBeCloseTo(180, 6)
    expect(bearingBetween(eye, { lng: eye.lng - 0.01, lat: eye.lat })).toBeCloseTo(270, 6)
  })

  it('puts a point out along a bearing that reads back as the same bearing and distance', () => {
    for (const bearing of [0, 37, 135, 251, 359]) {
      const tip = pointAlongBearing(eye, bearing, 1500)
      expect(bearingBetween(eye, tip)).toBeCloseTo(bearing, 6)
      const east = (tip.lng - eye.lng) * 111_320 * Math.cos((eye.lat * Math.PI) / 180)
      const north = (tip.lat - eye.lat) * 110_574
      expect(Math.hypot(east, north)).toBeCloseTo(1500, 6)
    }
  })
})

import { describe, expect, it } from 'vitest'

import type { ElevationSource } from './terrain'
import {
  DEFAULT_SIGHTLINE_OPTIONS,
  apparentSolidAngle,
  bearingDegrees,
  earthCurvatureDropMeters,
  haversineMeters,
  lineLengthMeters,
  pointInPolygon,
  polygonAreaMeters,
  polygonBounds,
  polygonGridSamples,
  sampleAlongLine,
  spacingForSampleBudget,
  terrainNormal,
  testSightline,
} from './visibility'

/** Terrain that varies with longitude only — an east–west profile. */
function profileTerrain(elevationForLng: (lng: number) => number): ElevationSource {
  return { elevationAt: (lng) => elevationForLng(lng) }
}

const FLAT = profileTerrain(() => 0)

/** Roughly 1.1 km per 0.01° of longitude at the equator, where these run. */
const ground = (lng: number, lat: number, elevation: number) => ({
  lng,
  lat,
  groundElevationMeters: elevation,
})

describe('earthCurvatureDropMeters', () => {
  it('drops about seven metres over ten kilometres after refraction', () => {
    expect(earthCurvatureDropMeters(10000)).toBeCloseTo(6.83, 2)
    expect(earthCurvatureDropMeters(0)).toBe(0)
  })

  it('drops further without refraction than with it', () => {
    expect(earthCurvatureDropMeters(10000, 0)).toBeGreaterThan(earthCurvatureDropMeters(10000, 0.13))
  })
})

describe('haversineMeters and bearingDegrees', () => {
  it('measures a degree of latitude at about 111 km', () => {
    expect(haversineMeters({ lng: 0, lat: 0 }, { lng: 0, lat: 1 })).toBeCloseTo(111195, 0)
  })

  it('reads north, east, and west correctly', () => {
    expect(bearingDegrees({ lng: 0, lat: 0 }, { lng: 0, lat: 1 })).toBeCloseTo(0, 6)
    expect(bearingDegrees({ lng: 0, lat: 0 }, { lng: 1, lat: 0 })).toBeCloseTo(90, 6)
    expect(bearingDegrees({ lng: 0, lat: 0 }, { lng: -1, lat: 0 })).toBeCloseTo(270, 6)
  })
})

describe('testSightline', () => {
  it('sees across flat ground inside the observer horizon', () => {
    const result = testSightline(FLAT, ground(0, 0, 0), ground(0.045, 0, 0), DEFAULT_SIGHTLINE_OPTIONS)
    expect(result.distanceMeters).toBeGreaterThan(4800)
    expect(result.visible).toBe(true)
  })

  it('loses flat ground beyond the horizon to the curve of the earth', () => {
    const result = testSightline(FLAT, ground(0, 0, 0), ground(0.1, 0, 0), DEFAULT_SIGHTLINE_OPTIONS)
    expect(result.distanceMeters).toBeGreaterThan(11000)
    expect(result.visible).toBe(false)
    expect(result.blockedAtMeters).toBeGreaterThan(0)
  })

  it('is blocked by a ridge that rises above the sightline', () => {
    const ridge = profileTerrain((lng) => (lng > 0.02 && lng < 0.025 ? 300 : 0))
    const result = testSightline(ridge, ground(0, 0, 0), ground(0.045, 0, 0), DEFAULT_SIGHTLINE_OPTIONS)
    expect(result.visible).toBe(false)
    expect(result.blockedAtMeters).toBeGreaterThan(2000)
    expect(result.blockedAtMeters).toBeLessThan(2900)
  })

  it('clears the same ridge from high enough ground', () => {
    const ridge = profileTerrain((lng) => (lng > 0.02 && lng < 0.025 ? 300 : 0))
    const fromAbove = testSightline(ridge, ground(0, 0, 900), ground(0.045, 0, 400), DEFAULT_SIGHTLINE_OPTIONS)
    expect(fromAbove.visible).toBe(true)
  })

  // A ridge peaking at 1000 m on the 0.02° meridian, falling away evenly on
  // both sides. The observer stands on its western flank, on the terrain.
  const ridgeTerrain = profileTerrain((lng) => Math.max(0, 1000 - Math.abs(lng - 0.02) * 40000))
  const onRidge = (lng: number) => ground(lng, 0, Math.max(0, 1000 - Math.abs(lng - 0.02) * 40000))

  it('hides ground on the far side of a slope facing away', () => {
    const result = testSightline(ridgeTerrain, onRidge(0), onRidge(0.03), DEFAULT_SIGHTLINE_OPTIONS)
    expect(result.visible).toBe(false)
    // The flank the observer stands on already rises faster than the sightline,
    // so the block is reported well before the crest at ~2.2 km.
    expect(result.blockedAtMeters).toBeGreaterThan(0)
    expect(result.blockedAtMeters).toBeLessThan(2224)
  })

  it('still sees the front face of that slope', () => {
    const result = testSightline(ridgeTerrain, onRidge(0), onRidge(0.01), DEFAULT_SIGHTLINE_OPTIONS)
    expect(result.visible).toBe(true)
  })

  it('treats anything past the maximum view distance as out of view', () => {
    const near = testSightline(FLAT, ground(0, 0, 0), ground(0.01, 0, 0), DEFAULT_SIGHTLINE_OPTIONS)
    const clipped = testSightline(FLAT, ground(0, 0, 0), ground(0.01, 0, 0), {
      ...DEFAULT_SIGHTLINE_OPTIONS,
      maxDistanceMeters: 500,
    })
    expect(near.visible).toBe(true)
    expect(clipped.visible).toBe(false)
    expect(clipped.blockedAtMeters).toBeNull()
  })

  it('reports terrain the DEM does not cover as unknown, neither clear nor sea level', () => {
    const gappy = profileTerrain((lng) => (lng > 0.01 && lng < 0.03 ? Number.NaN : 0))
    const result = testSightline(gappy, ground(0, 0, 0), ground(0.045, 0, 0), DEFAULT_SIGHTLINE_OPTIONS)
    // Missing ground is not an unobstructed sightline: it is a gap in the evidence.
    expect(result.status).toBe('unknown')
    expect(result.visible).toBe(false)
    expect(result.blockedAtMeters).toBeNull()
  })

  it('still reports occlusion when a known ridge sits beyond a gap in the DEM', () => {
    const gappyRidge = profileTerrain((lng) => (lng > 0.005 && lng < 0.015 ? Number.NaN : lng > 0.02 && lng < 0.025 ? 300 : 0))
    const result = testSightline(gappyRidge, ground(0, 0, 0), ground(0.045, 0, 0), DEFAULT_SIGHTLINE_OPTIONS)
    expect(result.status).toBe('occluded')
    expect(result.visible).toBe(false)
    expect(result.blockedAtMeters).toBeGreaterThan(2000)
  })

  it('distinguishes out-of-range from occluded', () => {
    const clipped = testSightline(FLAT, ground(0, 0, 0), ground(0.01, 0, 0), {
      ...DEFAULT_SIGHTLINE_OPTIONS,
      maxDistanceMeters: 500,
    })
    expect(clipped.status).toBe('out-of-range')
  })

  it('raises a blocked sightline into view once the observer stands tall enough', () => {
    const ridge = profileTerrain((lng) => (lng > 0.02 && lng < 0.025 ? 30 : 0))
    const fromEyeLevel = testSightline(ridge, ground(0, 0, 0), ground(0.045, 0, 0), DEFAULT_SIGHTLINE_OPTIONS)
    const fromTower = testSightline(ridge, ground(0, 0, 0), ground(0.045, 0, 0), {
      ...DEFAULT_SIGHTLINE_OPTIONS,
      observerHeightMeters: 80,
    })
    expect(fromEyeLevel.visible).toBe(false)
    expect(fromTower.visible).toBe(true)
  })
})

describe('sampleAlongLine', () => {
  const line: Array<[number, number]> = [
    [0, 0],
    [0, 0.018],
  ]

  it('keeps both ends and spaces the stations in between', () => {
    const stations = sampleAlongLine(line, 500)
    expect(stations[0]).toMatchObject({ lng: 0, lat: 0, distanceAlongMeters: 0 })
    expect(stations[stations.length - 1].lat).toBeCloseTo(0.018, 9)
    expect(stations.length).toBeGreaterThan(3)
    for (let index = 1; index < stations.length - 1; index += 1) {
      expect(stations[index].distanceAlongMeters - stations[index - 1].distanceAlongMeters).toBeCloseTo(500, 6)
    }
  })

  it('widens the spacing rather than exceeding the station cap', () => {
    expect(sampleAlongLine(line, 1, 20).length).toBeLessThanOrEqual(21)
  })

  it('handles a single position and a zero-length line', () => {
    expect(sampleAlongLine([[1, 2]], 100)).toHaveLength(1)
    expect(
      sampleAlongLine(
        [
          [1, 2],
          [1, 2],
        ],
        100,
      ),
    ).toHaveLength(1)
  })

  it('walks through every vertex of a multi-segment line', () => {
    const elbow: Array<[number, number]> = [
      [0, 0],
      [0, 0.009],
      [0.009, 0.009],
    ]
    const stations = sampleAlongLine(elbow, 250)
    expect(stations[stations.length - 1].distanceAlongMeters).toBeCloseTo(lineLengthMeters(elbow), 6)
    expect(stations.some((station) => station.lng > 0.002 && station.lat > 0.008)).toBe(true)
  })
})

const SQUARE: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [0.01, 0],
      [0.01, 0.01],
      [0, 0.01],
      [0, 0],
    ],
  ],
}

describe('polygon helpers', () => {
  it('measures a square near the equator', () => {
    // 0.01° is about 1.113 km each way, so roughly 1.24 km².
    expect(polygonAreaMeters(SQUARE) / 1e6).toBeCloseTo(1.238, 2)
  })

  it('subtracts holes from the area', () => {
    const withHole: GeoJSON.Polygon = {
      type: 'Polygon',
      coordinates: [
        SQUARE.coordinates[0],
        [
          [0.002, 0.002],
          [0.008, 0.002],
          [0.008, 0.008],
          [0.002, 0.008],
          [0.002, 0.002],
        ],
      ],
    }
    expect(polygonAreaMeters(withHole)).toBeLessThan(polygonAreaMeters(SQUARE) * 0.7)
    expect(pointInPolygon(withHole, 0.005, 0.005)).toBe(false)
    expect(pointInPolygon(withHole, 0.001, 0.005)).toBe(true)
  })

  it('reports bounds and membership', () => {
    expect(polygonBounds(SQUARE)).toEqual([0, 0, 0.01, 0.01])
    expect(pointInPolygon(SQUARE, 0.005, 0.005)).toBe(true)
    expect(pointInPolygon(SQUARE, 0.02, 0.005)).toBe(false)
  })

  it('covers a multipolygon across both parts', () => {
    const multi: GeoJSON.MultiPolygon = {
      type: 'MultiPolygon',
      coordinates: [
        SQUARE.coordinates,
        [
          [
            [0.05, 0],
            [0.06, 0],
            [0.06, 0.01],
            [0.05, 0.01],
            [0.05, 0],
          ],
        ],
      ],
    }
    expect(pointInPolygon(multi, 0.055, 0.005)).toBe(true)
    expect(pointInPolygon(multi, 0.03, 0.005)).toBe(false)
    expect(polygonAreaMeters(multi)).toBeCloseTo(polygonAreaMeters(SQUARE) * 2, -3)
  })
})

describe('polygonGridSamples', () => {
  it('produces cells whose total area matches the polygon', () => {
    const samples = polygonGridSamples(SQUARE, 50)
    const gridded = samples.reduce((total, sample) => total + sample.areaMeters, 0)
    expect(samples.length).toBeGreaterThan(400)
    expect(gridded / polygonAreaMeters(SQUARE)).toBeCloseTo(1, 1)
    expect(samples.every((sample) => pointInPolygon(SQUARE, sample.lng, sample.lat))).toBe(true)
  })

  it('falls back to one sample carrying the whole area for a tiny polygon', () => {
    const samples = polygonGridSamples(SQUARE, 5000)
    expect(samples).toHaveLength(1)
    expect(samples[0].areaMeters).toBeCloseTo(polygonAreaMeters(SQUARE), 0)
  })

  it('picks a spacing that lands near the sample budget but never below the DEM', () => {
    const spacing = spacingForSampleBudget(SQUARE, 900, 10)
    expect(polygonGridSamples(SQUARE, spacing).length).toBeGreaterThan(700)
    expect(polygonGridSamples(SQUARE, spacing).length).toBeLessThan(1100)
    expect(spacingForSampleBudget(SQUARE, 1e9, 25)).toBe(25)
  })
})

describe('terrainNormal and apparentSolidAngle', () => {
  it('points straight up on level ground and tilts downslope on a hillside', () => {
    const level = terrainNormal(FLAT, 0, 0, 30)
    expect(level[0]).toBeCloseTo(0, 12)
    expect(level[1]).toBeCloseTo(0, 12)
    expect(level[2]).toBe(1)

    // Rising towards the east, so the normal leans west.
    const slope = profileTerrain((lng) => lng * 100000)
    const normal = terrainNormal(slope, 0, 0, 30)
    expect(normal[0]).toBeLessThan(0)
    expect(normal[2]).toBeGreaterThan(0)
    expect(Math.hypot(...normal)).toBeCloseTo(1, 10)
  })

  it('shrinks with distance and with how edge-on the ground is', () => {
    const observer = { lng: 0, lat: 0, groundElevationMeters: 500, eyeHeightMeters: 1.6 }
    const near = apparentSolidAngle(observer, ground(0.01, 0, 0), 10000, [0, 0, 1])
    const far = apparentSolidAngle(observer, ground(0.02, 0, 0), 10000, [0, 0, 1])
    expect(near).toBeGreaterThan(far)

    // A vertical face seen from directly above its foot contributes nothing.
    const edgeOn = apparentSolidAngle(observer, ground(0.01, 0, 0), 10000, [0, 1, 0])
    expect(edgeOn).toBeCloseTo(0, 12)
  })
})

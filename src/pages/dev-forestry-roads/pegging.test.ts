import { describe, expect, it } from 'vitest'
import { distance, offsetCoordinate } from './engine'
import { findGradePeg, measurePeg, pegBearing } from './pegging'
import type { Coordinate, TerrainSource } from './types'

const origin: Coordinate = [-122.8, 53.9]
const northing = (latitude: number) => (((latitude - origin[1]) * Math.PI) / 180) * 6371008.8
const slope: TerrainSource = { elevationAt: (_longitude, latitude) => 800 + 0.2 * northing(latitude) }

describe('survey pegging', () => {
  it('measures horizontal leg, true bearing, endpoint grade and sampled grade separately', () => {
    const end = offsetCoordinate(origin, 0, 50)
    const result = measurePeg(origin, end, slope)
    expect(result.length).toBeCloseTo(50, 6)
    expect(result.grade).toBeCloseTo(20, 4)
    expect(result.endElevation).toBeCloseTo(810, 5)
    expect(result.coveragePercent).toBeCloseTo(100, 6)
    expect(pegBearing(origin, offsetCoordinate(origin, 90, 50))).toBeCloseTo(90, 6)
  })
  it('finds the closest permissible bearing for a requested fixed-length ground grade', () => {
    const peg = findGradePeg(origin, 40, 50, 10, slope)!
    expect(peg).not.toBeNull()
    expect(distance(origin, peg.coordinate)).toBeCloseTo(50, 5)
    expect(peg.measurement.bearing).toBeCloseTo(60, 2)
    expect(peg.measurement.grade).toBeCloseTo(10, 4)
  })
  it('reports an unattainable target without inventing a point', () => {
    expect(findGradePeg(origin, 0, 50, 30, slope)).toBeNull()
  })
  it('keeps a gap inside a leg out of coverage and refuses grade-pegging through it', () => {
    const hole: TerrainSource = {
      elevationAt: (longitude, latitude) => {
        const d = distance(origin, [longitude, latitude])
        return d > 20 && d < 30 ? Number.NaN : slope.elevationAt(longitude, latitude)
      },
    }
    const result = measurePeg(origin, offsetCoordinate(origin, 0, 50), hole)
    expect(result.grade).toBeCloseTo(20, 4)
    expect(result.coveragePercent).toBeLessThan(85)
    expect(findGradePeg(origin, 40, 50, 10, hole)).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'

import type { AnalysisResult, StationResult, TargetVisibility } from './types'
import {
  adjustedAlterationPercent,
  bearingDifference,
  compassPoint,
  designDistanceScore,
  viewpointImportance,
  visibleCentre,
  visibleProposalCentre,
} from './vqe'

/** East-west road at lat 54, where 0.01° of longitude is about 655 m. */
const STATION_SPACING_DEGREES = 0.01

function corridorStations(count: number, spacing = STATION_SPACING_DEGREES) {
  return Array.from({ length: count }, (_, index) => ({
    lng: -122 + index * spacing,
    lat: 54,
    groundElevationMeters: 700,
    distanceAlongMeters: index * spacing * 65_500,
  }))
}

function stationResults(percents: number[], spacing = STATION_SPACING_DEGREES): StationResult[] {
  return percents.map((visiblePercent, index) => ({
    ...corridorStations(percents.length, spacing)[index],
    visiblePercent,
  }))
}

/** Only the fields these functions read. */
function block(
  percents: number[],
  {
    samples = [[-122, 54.05]] as Array<[number, number]>,
    visible = [1],
    visibleAreaMeters = 400_000,
    spacing = STATION_SPACING_DEGREES,
  } = {},
): TargetVisibility {
  return {
    targetId: 'block',
    role: 'block',
    positions: Float64Array.from(samples.flat()),
    anyVisible: Uint8Array.from(visible),
    sampleCount: samples.length,
    visibleAreaMeters,
    stations: stationResults(percents, spacing),
  } as unknown as TargetVisibility
}

function analysis(
  targets: TargetVisibility[],
  stationCount: number,
  spacing = STATION_SPACING_DEGREES,
): AnalysisResult {
  return {
    stations: corridorStations(stationCount, spacing),
    targets,
    corridorLengthMeters: (stationCount - 1) * spacing * 65_500,
    assessmentStationIndex: 0,
  } as unknown as AnalysisResult
}

describe('compassPoint', () => {
  it('names the sixteen points, wrapping at north', () => {
    expect(compassPoint(0)).toBe('N')
    expect(compassPoint(90)).toBe('E')
    expect(compassPoint(180)).toBe('S')
    expect(compassPoint(270)).toBe('W')
    expect(compassPoint(359)).toBe('N')
    expect(compassPoint(-90)).toBe('W')
    expect(compassPoint(45)).toBe('NE')
  })

  it('has something to print when there is no bearing', () => {
    expect(compassPoint(Number.NaN)).toBe('—')
  })
})

describe('bearingDifference', () => {
  it('takes the short way round', () => {
    expect(bearingDifference(350, 10)).toBe(20)
    expect(bearingDifference(10, 350)).toBe(20)
    expect(bearingDifference(0, 180)).toBe(180)
    expect(bearingDifference(90, 90)).toBe(0)
  })
})

describe('visibleCentre', () => {
  it('averages only the samples that can be seen', () => {
    const target = block([50], {
      samples: [
        [-122, 54],
        [-121, 54],
      ],
      visible: [1, 0],
    })
    expect(visibleCentre(target)).toEqual({ lng: -122, lat: 54 })
  })

  it('is null when nothing is visible, rather than the centroid', () => {
    // A screened block has no point you are looking at, and reporting its
    // centroid would give a viewing direction nobody can see along.
    expect(visibleCentre(block([0], { samples: [[-122, 54]], visible: [0] }))).toBeNull()
  })

  it('weights several blocks by how much of each is in view', () => {
    const near = block([50], { samples: [[-122, 54]], visible: [1], visibleAreaMeters: 300 })
    const far = { ...block([50], { samples: [[-120, 54]], visible: [1], visibleAreaMeters: 100 }) }
    const centre = visibleProposalCentre(analysis([near, far], 2))
    // Three quarters of the visible ground sits at -122, so the centre lands
    // a quarter of the way towards the smaller block.
    expect(centre?.lng).toBeCloseTo(-121.5, 6)
  })
})

describe('designDistanceScore', () => {
  it('reads FS1252 Table 2 element 4', () => {
    expect(designDistanceScore(9000)).toEqual({ score: -1, grade: 'Good', band: '> 8 km' })
    expect(designDistanceScore(4000)).toEqual({ score: 0, grade: 'Moderate', band: '> 1 and < 8 km' })
    expect(designDistanceScore(500)).toEqual({ score: 1, grade: 'Poor', band: '< 1 km' })
  })

  it('takes the conservative side of each boundary the form leaves open', () => {
    expect(designDistanceScore(8000)?.grade).toBe('Moderate')
    expect(designDistanceScore(1000)?.grade).toBe('Poor')
  })

  it('has no score without a distance', () => {
    expect(designDistanceScore(null)).toBeNull()
  })
})

describe('adjustedAlterationPercent', () => {
  it('is the form’s X * (1 + 0.14 * Y)', () => {
    expect(adjustedAlterationPercent(10, 0)).toBe(10)
    expect(adjustedAlterationPercent(10, 1)).toBeCloseTo(11.4, 6)
    expect(adjustedAlterationPercent(10, -2)).toBeCloseTo(7.2, 6)
  })

  it('spans the whole range the three adjustments allow', () => {
    // Y runs -7 (no roads, good retention, every design element good) to +8,
    // so the adjustment can all but erase the measurement or double it.
    expect(adjustedAlterationPercent(10, -7)).toBeCloseTo(0.2, 6)
    expect(adjustedAlterationPercent(10, 8)).toBeCloseTo(21.2, 6)
  })
})

describe('viewpointImportance', () => {
  it('is a glimpse when the block shows for under ten seconds', () => {
    // Stations 130 m apart, and only the last one sees anything: one 130 m
    // stretch is under 6 s at highway speed.
    const tight = 0.002
    const importance = viewpointImportance(analysis([block([0, 0, 0, 5], { spacing: tight })], 4, tight))
    expect(importance.rating).toBe(1)
    expect(importance.label).toContain('Glimpse')
    expect(importance.exposedSeconds).toBeLessThan(10)
    expect(importance.assumedSpeedKmh).toBe(80)
  })

  it('is a focal view when it is in sight for over a minute straight ahead', () => {
    // The corridor runs east and the block sits east of it, so every seeing
    // station is travelling towards it.
    const ahead = block([40, 40, 40, 40], { samples: [[-121.9, 54]], visible: [1] })
    const importance = viewpointImportance(analysis([ahead], 4), { speedKmh: 40 })
    expect(importance.rating).toBe(3)
    expect(importance.towardFraction).toBe(1)
    expect(importance.exposedSeconds).toBeGreaterThan(60)
  })

  it('is a side view when the same exposure is off to one side', () => {
    // Same road, same duration, block due north: nobody drives towards it.
    const beside = block([40, 40, 40, 40], { samples: [[-121.97, 55]], visible: [1] })
    const importance = viewpointImportance(analysis([beside], 4), { speedKmh: 40 })
    expect(importance.rating).toBe(2)
    expect(importance.towardFraction).toBe(0)
  })

  it('measures only the stretches something can be seen from', () => {
    const half = viewpointImportance(analysis([block([40, 40, 0, 0])], 4))
    const whole = viewpointImportance(analysis([block([40, 40, 40, 40])], 4))
    expect(half.exposedLengthMeters).toBeLessThan(whole.exposedLengthMeters)
    expect(half.exposedLengthMeters).toBeGreaterThan(0)
  })

  it('refuses to rate a corridor that never sees the proposal', () => {
    const importance = viewpointImportance(analysis([block([0, 0, 0, 0])], 4))
    expect(importance.rating).toBeNull()
    expect(importance.exposedLengthMeters).toBe(0)
  })

  it('ignores the landform — importance is about the proposal', () => {
    const landform = { ...block([100, 100, 100, 100]), role: 'landscape' } as TargetVisibility
    expect(viewpointImportance(analysis([landform], 4)).rating).toBeNull()
  })

  it('carries the speed it assumed, because the rating turns on it', () => {
    const slow = viewpointImportance(analysis([block([40, 40, 40, 40])], 4), { speedKmh: 20 })
    const fast = viewpointImportance(analysis([block([40, 40, 40, 40])], 4), { speedKmh: 400 })
    expect(slow.assumedSpeedKmh).toBe(20)
    expect(slow.exposedSeconds).toBeGreaterThan(fast.exposedSeconds)
    expect(slow.exposedLengthMeters).toBe(fast.exposedLengthMeters)
  })
})

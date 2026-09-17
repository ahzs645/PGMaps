import { describe, expect, it } from 'vitest'

import { corridorExposureToGeoJson } from './scene'
import type { AnalysisResult, StationResult, TargetVisibility } from './types'

function station(index: number, visiblePercent: number): StationResult {
  return {
    lng: 0.01 * index,
    lat: 0,
    groundElevationMeters: 0,
    distanceAlongMeters: index * 150,
    visiblePercent,
  }
}

/** Only the fields `corridorExposureToGeoJson` reads. */
function target(targetId: string, role: TargetVisibility['role'], percents: number[]): TargetVisibility {
  return {
    targetId,
    role,
    stations: percents.map((percent, index) => station(index, percent)),
  } as unknown as TargetVisibility
}

function analysis(targets: TargetVisibility[], stationCount: number): AnalysisResult {
  return {
    stations: Array.from({ length: stationCount }, (_, index) => ({
      lng: 0.01 * index,
      lat: 0,
      groundElevationMeters: 0,
      distanceAlongMeters: index * 150,
    })),
    targets,
    assessmentStationIndex: 0,
  } as unknown as AnalysisResult
}

describe('corridorExposureToGeoJson', () => {
  const blockA = target('a', 'block', [0, 40, 80, 20])
  const blockB = target('b', 'block', [10, 0, 0, 0])
  const landform = target('land', 'landscape', [100, 100, 100, 100])

  it('draws the road between stations, not the stations', () => {
    const collection = corridorExposureToGeoJson(analysis([blockA], 4), 'a')

    expect(collection.features).toHaveLength(3)
    expect(collection.features.every((feature) => feature.geometry.type === 'LineString')).toBe(true)
  })

  it('gives each stretch the mean of the two stations it joins', () => {
    const percents = corridorExposureToGeoJson(analysis([blockA], 4), 'a').features.map((feature) =>
      Number(feature.properties?.visiblePercent),
    )
    expect(percents).toEqual([20, 60, 50])
  })

  it('takes the worst block when none is selected, so a hot road stays hot', () => {
    const percents = corridorExposureToGeoJson(analysis([blockA, blockB], 4), null).features.map((feature) =>
      Number(feature.properties?.visiblePercent),
    )
    // Worst block per station first, then the mean across the pair: station 0
    // sees 10% (of B), station 1 sees 40% (of A), so the stretch between is 25.
    // Grading on A alone would have shown 20 and lost the ground B is exposed on.
    expect(percents).toEqual([25, 60, 50])
  })

  it('ignores the landform — the road is graded by what it sees of the proposal', () => {
    const percents = corridorExposureToGeoJson(analysis([blockA, landform], 4), null).features.map((feature) =>
      Number(feature.properties?.visiblePercent),
    )
    expect(percents).toEqual([20, 60, 50])
  })

  it('falls back to every block when the selection was not assessed', () => {
    expect(corridorExposureToGeoJson(analysis([blockA], 4), 'missing').features).toHaveLength(3)
  })

  it('has nothing to draw without a run, a corridor, or a block', () => {
    expect(corridorExposureToGeoJson(null, 'a').features).toHaveLength(0)
    expect(corridorExposureToGeoJson(analysis([blockA], 1), 'a').features).toHaveLength(0)
    expect(corridorExposureToGeoJson(analysis([landform], 4), null).features).toHaveLength(0)
  })
})

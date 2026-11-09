import { describe, expect, it } from 'vitest'
import { designInputsOf, safeAnalyzeRoad } from './analysisResult'
import { offsetCoordinate } from './engine'
import { createEngineeringDesign } from './engineeringTypes'
import type { Alignment, Coordinate, RoadSettings, TerrainSource } from './types'

const origin: Coordinate = [-122.8, 53.9]
const flat: TerrainSource = { elevationAt: () => 800 }
const settings: RoadSettings = {
  stationInterval: 10,
  crossSectionHalfWidth: 30,
  maxGradePercent: 12,
  minRadius: 25,
  cutRate: 2,
  fillRate: 3,
  surfacingRate: 4,
  clearingRate: 0.5,
  shrinkFactor: 0.8,
}
function road(): Alignment {
  return {
    id: 'road',
    name: 'Road',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: offsetCoordinate(origin, 0, 100), radiusM: 0 },
    ],
    vertical: [
      { id: 's', chainage: 0, elevation: 798, curveLength: 0 },
      { id: 'e', chainage: 100, elevation: 798, curveLength: 0 },
    ],
    template: {
      leftWidth: 3,
      rightWidth: 3,
      crossfallPercent: 0,
      cutSlope: 1,
      fillSlope: 1,
      ditchWidth: 0,
      ditchDepth: 0,
      surfaceDepth: 0,
    },
    overrides: [],
    engineering: {
      ...createEngineeringDesign(),
      materials: [
        {
          id: 'strip',
          name: 'Topsoil',
          color: '#553311',
          cutRate: 0,
          reusableFraction: 0,
          compactionFactor: 1,
          purpose: 'stripping',
        },
      ],
    },
  }
}
const stripping = (start: number, end: number) => ({
  id: 's1',
  start,
  end,
  depthM: 0.2,
  leftInsideM: 0,
  rightInsideM: 0,
  leftOutsideM: 0.3,
  rightOutsideM: 0.3,
  materialId: 'strip',
})

describe('an invalid engineering input does not blank the road', () => {
  it('keeps the last valid results, says what was left out and where to fix it', () => {
    const valid = road()
    const before = safeAnalyzeRoad(valid, flat, settings)
    expect(before.invalidInput).toBeUndefined()
    expect(before.cutVolumeM3).toBeCloseTo(1600, 6)
    // The tester's case: a stripping start typed past the end of the range.
    const edited: Alignment = {
      ...valid,
      engineering: { ...valid.engineering!, sitePreparation: [stripping(2000, 100)] },
    }
    const kept = safeAnalyzeRoad(edited, flat, settings, [], {}, designInputsOf(valid))
    expect(kept.length).toBeCloseTo(100, 6)
    expect(kept.stations.length).toBe(before.stations.length)
    expect(kept.cutVolumeM3).toBeCloseTo(before.cutVolumeM3, 9)
    expect(kept.estimatedCost).toBeCloseTo(before.estimatedCost, 9)
    expect(kept.invalidInput).toEqual({
      message: 'Stripping 1: the end station (100 m) must be greater than the start station (2,000 m).',
      target: { list: 'sitePreparation', id: 's1', field: 'end' },
    })
  })
  it('follows the current line and grade, so only the invalid input is left out', () => {
    const valid = road()
    const moved: Alignment = {
      ...valid,
      vertical: valid.vertical.map((p) => ({ ...p, elevation: 797 })),
      engineering: { ...valid.engineering!, sitePreparation: [stripping(50, 10)] },
    }
    const kept = safeAnalyzeRoad(moved, flat, settings, [], {}, designInputsOf(valid))
    // A 3 m cut, 6 m wide at formation with 1:1 batters: 27 m² over 100 m.
    expect(kept.cutVolumeM3).toBeCloseTo(2700, 6)
    expect(kept.invalidInput?.target?.list).toBe('sitePreparation')
  })
  it('reports an empty result when nothing valid is known or the line itself is wrong', () => {
    const edited = road()
    edited.engineering!.sitePreparation = [stripping(2000, 100)]
    const none = safeAnalyzeRoad(edited, flat, settings)
    expect(none.stations).toEqual([])
    expect(none.warnings[0]).toMatch(/^Correct this input before calculating: Stripping 1: /)
    const line = road()
    line.points[1].coordinate = [NaN, 53.9]
    const broken = safeAnalyzeRoad(line, flat, settings, [], {}, designInputsOf(road()))
    expect(broken.stations).toEqual([])
    expect(broken.warnings[0]).toMatch(/^Correct this alignment before calculating: /)
    expect(broken.invalidInput?.target).toBeUndefined()
  })
})

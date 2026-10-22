import { describe, expect, it } from 'vitest'
import { analyzeRoad, offsetCoordinate } from './engine'
import { classifySectionOffset, sectionCodePoints, sectionSampleAt } from './sectionGeometry'
import type { Alignment, Coordinate, RoadSettings } from './types'

const origin: Coordinate = [-122.8, 53.9]
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
function calculated(level: number) {
  const alignment: Alignment = {
    id: 'section-codes',
    name: 'Section codes',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: offsetCoordinate(origin, 0, 100), radiusM: 0 },
    ],
    vertical: [
      { id: 'v0', chainage: 0, elevation: level, curveLength: 0 },
      { id: 'v1', chainage: 100, elevation: level, curveLength: 0 },
    ],
    template: {
      leftWidth: 3,
      rightWidth: 4,
      crossfallPercent: 2,
      cutSlope: 1,
      fillSlope: 1.5,
      ditchWidth: 2,
      ditchDepth: 0.5,
      surfaceDepth: 0.2,
    },
    overrides: [],
  }
  const result = analyzeRoad(alignment, { elevationAt: () => 100 }, settings)
  return { template: alignment.template, station: result.stations.find((s) => s.chainage === 50)! }
}

describe('section point codes share actual calculated geometry', () => {
  it('locates asymmetric formation edges, actual cut-side ditch bottoms and daylights', () => {
    const { station, template } = calculated(99)
    const codes = sectionCodePoints(station, template)
    const left = codes.find((p) => p.code === 'left-ditch-bottom')!,
      right = codes.find((p) => p.code === 'right-ditch-bottom')!
    expect(left.offset).toBe(-4)
    expect(right.offset).toBe(5)
    expect(left.design).toBeCloseTo(99 - 3 * 0.02 - 0.5)
    expect(right.design).toBeCloseTo(99 - 4 * 0.02 - 0.5)
    expect(left.ground).toBe(100)
    expect(codes.find((p) => p.code === 'left-formation-edge')?.offset).toBe(-3)
    expect(codes.find((p) => p.code === 'right-daylight')?.offset).toBe(station.rightDaylightM)
    expect(classifySectionOffset(station, template, 0)).toBe('centreline')
    expect(classifySectionOffset(station, template, -2)).toBe('left-formation')
    expect(classifySectionOffset(station, template, -3)).toBe('left-formation-edge')
    expect(classifySectionOffset(station, template, -4)).toBe('left-ditch-bottom')
    expect(classifySectionOffset(station, template, -4.5)).toBe('left-ditch')
    expect(classifySectionOffset(station, template, -5.5)).toBe('left-batter')
  })

  it('does not infer a ditch from a template when the actual section is fill', () => {
    const { station, template } = calculated(101)
    expect(sectionCodePoints(station, template).some((p) => p.code.includes('ditch'))).toBe(false)
    expect(classifySectionOffset(station, template, -4)).toBe('left-batter')
  })

  it('preserves separate ground/design gaps at named points and while interpolating', () => {
    const { station, template } = calculated(99)
    const bottom = station.section.find((p) => Math.abs(p.offset + 4) < 1e-7)!
    bottom.ground = null
    const point = sectionCodePoints(station, template).find((p) => p.code === 'left-ditch-bottom')!
    expect(point.ground).toBeNull()
    expect(point.design).toBe(bottom.design)
    const before = station.section[station.section.indexOf(bottom) - 1]
    const sample = sectionSampleAt(station, (before.offset + bottom.offset) / 2)
    expect(sample.ground).toBeNull()
    expect(Number.isFinite(sample.design)).toBe(true)
    expect(sectionSampleAt(station, 1000)).toEqual({ offset: 1000, ground: null, design: null })
    expect(sectionSampleAt(station, NaN).ground).toBeNull()
    bottom.design = null
    expect(sectionCodePoints(station, template).some((p) => p.code === 'left-ditch-bottom')).toBe(false)
  })
})

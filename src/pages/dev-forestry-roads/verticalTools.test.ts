import { describe, expect, it } from 'vitest'
import { analyzeRoad, offsetCoordinate } from './engine'
import { DEFAULT_ROAD_SETTINGS } from './terrain'
import { createEngineeringDesign } from './engineeringTypes'
import { optimizeVerticalProfile } from './verticalOptimizer'
import { curveLengthsForK, simplifyProfile } from './verticalTools'
import type { Alignment, Coordinate, TerrainSource } from './types'

const origin: Coordinate = [-122.8, 53.9]
const northOf = (p: [number, number]) => (((p[1] - origin[1]) * Math.PI) / 180) * 6371008.8
function road(length = 400): Alignment {
  return {
    id: 'r',
    name: 'Road',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: offsetCoordinate(origin, 0, length), radiusM: 0 },
    ],
    vertical: [],
    template: {
      leftWidth: 3,
      rightWidth: 3,
      crossfallPercent: 0,
      cutSlope: 1,
      fillSlope: 1.5,
      ditchWidth: 0,
      ditchDepth: 0,
      surfaceDepth: 0,
    },
    overrides: [],
  }
}
// A 6 m hump centred at 200 m on otherwise flat ground.
const hump: TerrainSource = {
  elevationAt: (lng, lat) => 800 + 6 * Math.exp(-(((northOf([lng, lat]) - 200) / 60) ** 2)),
}
const settings = { ...DEFAULT_ROAD_SETTINGS, stationInterval: 10, crossSectionHalfWidth: 40, maxGradePercent: 12 }

describe('curve lengths from K', () => {
  it('sizes each interior curve as K × grade change and keeps it within its tangents', () => {
    const points = [
      { id: 'a', chainage: 0, elevation: 800, curveLength: 0 },
      { id: 'b', chainage: 200, elevation: 816, curveLength: 0 },
      { id: 'c', chainage: 400, elevation: 792, curveLength: 0 },
    ]
    expect(curveLengthsForK(points, 4).map((p) => p.curveLength)).toEqual([0, 80, 0])
    expect(curveLengthsForK(points, 4, 100)[1].curveLength).toBe(100)
    // K 30 asks for 600 m; the tangents allow 400 m.
    expect(curveLengthsForK(points, 30)[1].curveLength).toBeLessThanOrEqual(400)
  })
})

describe('vertical profile optimizer', () => {
  it('cuts the earthwork cost of a grade line over a hump, inside its limits', () => {
    const alignment = road()
    const length = 400
    const result = optimizeVerticalProfile(alignment, length, hump, settings, { pviSpacingM: 50, k: 4 })
    expect(result.vertical[0].elevation).toBeCloseTo(800, 3)
    expect(result.vertical.at(-1)!.elevation).toBeCloseTo(800, 3)
    const optimized = analyzeRoad({ ...alignment, vertical: result.vertical }, hump, settings)
    const level = analyzeRoad(
      {
        ...alignment,
        vertical: [
          { id: 's', chainage: 0, elevation: 800, curveLength: 0 },
          { id: 'e', chainage: length, elevation: 800, curveLength: 0 },
        ],
      },
      hump,
      settings,
    )
    expect(optimized.coveragePercent).toBeGreaterThan(99.9)
    expect(optimized.cutVolumeM3 * settings.cutRate + optimized.fillVolumeM3 * settings.fillRate).toBeLessThan(
      0.5 * (level.cutVolumeM3 * settings.cutRate + level.fillVolumeM3 * settings.fillRate),
    )
    expect(optimized.maxGradePercent).toBeLessThanOrEqual(12 + 1e-6)
    expect(optimized.warnings.some((w) => w.includes('does not fit') || w.includes('overlaps'))).toBe(false)
  })

  it('respects grade ranges, minimum K and control points', () => {
    const alignment = road()
    alignment.verticalStandards = {
      gradeRanges: [{ id: 'g', start: null, end: null, minGradePercent: -4, maxGradePercent: 4 }],
      minSagK: 6,
      minCrestK: 6,
      minCurveLengthM: null,
      minTangentLengthM: null,
    }
    alignment.verticalControls = [
      {
        id: 'c',
        chainage: 120,
        elevation: 801.5,
        toleranceAboveM: 0.1,
        toleranceBelowM: 0.1,
        gradePercent: null,
        gradeTolerancePercent: 0,
      },
    ]
    const result = optimizeVerticalProfile(alignment, 400, hump, settings, { pviSpacingM: 50, k: 6 })
    const checked = analyzeRoad({ ...alignment, vertical: result.vertical }, hump, settings)
    expect((checked.verticalChecks ?? []).map((c) => c.message)).toEqual([])
    expect(result.vertical.some((p) => Math.abs(p.chainage - 120) < 1e-6)).toBe(true)
  })

  it('explains an impossible search instead of returning a profile', () => {
    const steep: TerrainSource = { elevationAt: (lng, lat) => 800 + 0.3 * northOf([lng, lat]) }
    expect(() =>
      optimizeVerticalProfile(road(), 400, steep, { ...settings, maxGradePercent: 5 }, { maxDepthM: 2 }),
    ).toThrow(/No profile meets/)
  })
})

describe('profile simplification', () => {
  it('drops PVIs within tolerance and keeps ends, real breaks and controls', () => {
    const line = [0, 50, 100, 150, 200, 250].map((chainage, i) => ({
      id: `p${i}`,
      chainage,
      // A straight 2% grade with a 0.1 m wobble at 50 m and a real break at 150 m.
      elevation:
        800 + 0.02 * Math.min(chainage, 150) - 0.03 * Math.max(0, chainage - 150) + (chainage === 50 ? 0.1 : 0),
      curveLength: 0,
    }))
    expect(simplifyProfile(line, 0.3).map((p) => p.chainage)).toEqual([0, 150, 250])
    expect(simplifyProfile(line, 0.3, [100]).map((p) => p.chainage)).toEqual([0, 100, 150, 250])
    expect(simplifyProfile(line, 0.05).map((p) => p.chainage)).toContain(50)
  })

  it('keeps the optimizer result within its limits after simplifying', () => {
    const result = optimizeVerticalProfile(road(), 400, hump, settings, { pviSpacingM: 25, k: 4 })
    const full = optimizeVerticalProfile(road(), 400, hump, settings, { pviSpacingM: 25, k: 4, simplifyToleranceM: 0 })
    expect(result.vertical.length).toBeLessThanOrEqual(full.vertical.length)
    const checked = analyzeRoad({ ...road(), vertical: result.vertical }, hump, settings)
    expect(checked.maxGradePercent).toBeLessThanOrEqual(12 + 1e-6)
  })
})

describe('total-cost profile optimization', () => {
  it('prices haul, borrow and waste and never does worse than the cut-and-fill line', () => {
    const alignment = road()
    alignment.engineering = createEngineeringDesign()
    alignment.engineering.haul = {
      ...alignment.engineering.haul,
      enabled: true,
      freeHaulDistanceM: 50,
      overhaulDistanceM: 300,
      overhaulRate: 6,
      endHaulRate: 4,
      borrowRate: 40,
      wasteRate: 25,
    }
    const earthwork = optimizeVerticalProfile(alignment, 400, hump, settings, { pviSpacingM: 50, k: 4 })
    const total = optimizeVerticalProfile(alignment, 400, hump, settings, { pviSpacingM: 50, k: 4, objective: 'total' })
    const cost = (vertical: typeof total.vertical) =>
      analyzeRoad({ ...alignment, vertical }, hump, settings).estimatedCost
    expect(cost(total.vertical)).toBeLessThanOrEqual(cost(earthwork.vertical) + 1e-6)
    expect(total.message).toMatch(/lowest total cost with imbalance at \$/)
  })
})

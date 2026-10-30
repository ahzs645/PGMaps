import { describe, expect, it } from 'vitest'
import { analyzeRoad, offsetCoordinate } from './engine'
import { createDemoProject, demoTerrain, DEMO_ORIGIN } from './terrain'
import { DEFAULT_VERTICAL_OPTIMIZATION, optimizeVerticalProfile } from './verticalOptimizer'
import type { Alignment, RoadSettings, TerrainSource, VerticalPoint } from './types'

describe('bounded profile predecessor queries', () => {
  it('completes the training UI’s 12 m search without increasing its transition budget', () => {
    const project = createDemoProject(),
      alignment = project.alignments[0]
    alignment.verticalStandards = {
      gradeRanges: [],
      minSagK: 4,
      minCrestK: 4,
      minCurveLengthM: null,
      minTangentLengthM: null,
    }
    alignment.verticalControls = [
      {
        id: 'selected-start',
        chainage: 0,
        elevation: alignment.vertical[0].elevation,
        toleranceAboveM: 0,
        toleranceBelowM: 0,
        gradePercent: null,
        gradeTolerancePercent: 0,
      },
    ]
    const original = structuredClone(alignment),
      before = analyzeRoad(alignment, demoTerrain, project.settings, project.context)
    expect(DEFAULT_VERTICAL_OPTIMIZATION.maxTransitions).toBe(5_000_000)
    const result = optimizeVerticalProfile(alignment, before.length, demoTerrain, project.settings, {
      maxDepthM: 12,
      tieEndsToGround: false,
    })
    const after = analyzeRoad(
      { ...alignment, vertical: result.vertical },
      demoTerrain,
      project.settings,
      project.context,
    )
    expect(after.estimatedCost).toBeLessThan(before.estimatedCost)
    expect(after.verticalChecks ?? []).toEqual([])
    expect(after.maxGradePercent).toBeLessThanOrEqual(project.settings.maxGradePercent + 1e-6)
    expect(result.vertical[0].elevation).toBeCloseTo(alignment.vertical[0].elevation, 6)
    expect(result.levelsPerPvi).toBe(49)
    expect(alignment).toEqual(original)
  }, 15_000)

  it('retains the exhaustive constrained optimum when equal terminal levels have different occupied tangents', () => {
    // Six 50 m intervals, three levels at each interior PVI: 243 complete prescriptions.
    // A DP keeping only the cheapest history per last level-pair loses the $2,287.50
    // surrogate optimum here and returns $2,973.75 instead.
    const heights = [5, 3, 5, 4, 0, 0, 3]
    const alignment: Alignment = {
      id: 'pareto',
      name: 'Tangent history check',
      color: '#d97706',
      points: [
        { id: 'start', coordinate: DEMO_ORIGIN, radiusM: 0 },
        { id: 'end', coordinate: offsetCoordinate(DEMO_ORIGIN, 0, 300), radiusM: 0 },
      ],
      vertical: heights.map((z, i) => ({ id: `v${i}`, chainage: 50 * i, elevation: 800 + z, curveLength: 0 })),
      overrides: [],
      template: {
        leftWidth: 3,
        rightWidth: 3,
        crossfallPercent: 0,
        cutSlope: 0.1,
        fillSlope: 0.1,
        ditchWidth: 0,
        ditchDepth: 0,
        surfaceDepth: 0,
      },
      verticalStandards: {
        gradeRanges: [],
        minSagK: 6,
        minCrestK: 4,
        minCurveLengthM: null,
        minTangentLengthM: 25,
      },
    }
    const terrain: TerrainSource = {
      elevationAt: (_lng, lat) => {
        const station = (((lat - DEMO_ORIGIN[1]) * Math.PI) / 180) * 6_371_008.8,
          index = Math.max(0, Math.min(heights.length - 2, Math.floor(station / 50))),
          fraction = Math.max(0, Math.min(1, (station - index * 50) / 50))
        return 800 + heights[index] + fraction * (heights[index + 1] - heights[index])
      },
    }
    const settings: RoadSettings = {
      stationInterval: 25,
      crossSectionHalfWidth: 20,
      maxGradePercent: 20,
      minRadius: 0,
      cutRate: 2,
      fillRate: 3,
      surfacingRate: 0,
      clearingRate: 0,
      shrinkFactor: 1,
    }
    // Independent enumeration of the fixed grid and its analytical area-table surrogate.
    // At the unit-depth levels a 6 m section with 0.1:1 batters has area 6.1 m²;
    // interpolation is piecewise linear, and 25 m samples include every zero crossing.
    const intervalCost = (a: number, b: number) =>
      ((6.1 * 50) / 4) *
      [a, (a + b) / 2, (a + b) / 2, b].reduce((sum, offset) => sum + (offset >= 0 ? 3 * offset : -2 * offset), 0)
    let best: { cost: number; offsets: number[] } | null = null
    const enumerate = (offsets: number[]) => {
      if (offsets.length < heights.length - 1) {
        for (const offset of [-1, 0, 1]) enumerate([...offsets, offset])
        return
      }
      const candidate = [...offsets, 0],
        grades = candidate.slice(1).map((offset, i) => 2 * (heights[i + 1] + offset - heights[i] - candidate[i])),
        curves = heights.map((_height, i) => {
          if (!i || i === heights.length - 1) return 0
          const change = grades[i] - grades[i - 1]
          return Math.abs(change) <= 0.05 ? 0 : Math.ceil((change > 0 ? 6 : 4) * Math.abs(change) * 10 - 1e-8) / 10
        })
      if (grades.some((g) => Math.abs(g) > 20) || curves.some((size) => size / 2 > 50)) return
      for (let i = 1; i < curves.length - 2; i++)
        if (curves[i] && curves[i + 1] && (curves[i] + curves[i + 1]) / 2 + 25 > 50) return
      const cost = candidate.slice(1).reduce((sum, offset, i) => sum + intervalCost(candidate[i], offset), 0)
      if (!best || cost < best.cost) best = { cost, offsets: candidate }
    }
    enumerate([0])
    const exhaustive = best as { cost: number; offsets: number[] } | null
    expect(exhaustive).toEqual({ cost: 2287.5, offsets: [0, 1, 0, -1, 1, -1, 0] })
    const result = optimizeVerticalProfile(alignment, 300, terrain, settings, {
      pviSpacingM: 50,
      bandCenter: 'design',
      maxDepthM: 1,
      levelStepM: 1,
      k: 1,
      simplifyToleranceM: 0,
    })
    // Removing collinear PVIs leaves their tangent elevation unchanged.
    const tangentAt = (line: VerticalPoint[], station: number) => {
      const index = Math.max(0, line.findIndex((p) => p.chainage >= station) - 1),
        a = line[index],
        b = line[index + 1]
      return a.elevation + ((b.elevation - a.elevation) * (station - a.chainage)) / (b.chainage - a.chainage)
    }
    const actualOffsets = heights.map((height, i) => Math.round(tangentAt(result.vertical, i * 50) - 800 - height))
    expect(actualOffsets).toEqual(exhaustive!.offsets)
    expect(analyzeRoad({ ...alignment, vertical: result.vertical }, terrain, settings).verticalChecks ?? []).toEqual([])
  })
})

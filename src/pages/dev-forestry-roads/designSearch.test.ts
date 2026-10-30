import { describe, it, expect } from 'vitest'
import { alignmentLength, analyzeRoad, offsetCoordinate } from './engine'
import { designElevationAt, optimizeVerticalProfile } from './verticalOptimizer'
import { curvatureRuleAt, EMPTY_VERTICAL_STANDARDS } from './verticalStandards'
import { refinePlanAndProfile } from './jointOptimizer'
import { parseRouteSearchOptions, suggestRoutes, DEFAULT_ROUTE_OPTIONS } from './routing'
import type { Alignment, Coordinate, RoadSettings } from './types'
import { createEngineeringDesign } from './engineeringTypes'
const origin: Coordinate = [-122.8, 53.9]
const settings: RoadSettings = {
  stationInterval: 10,
  crossSectionHalfWidth: 35,
  maxGradePercent: 12,
  minRadius: 10,
  cutRate: 2,
  fillRate: 3,
  surfacingRate: 0,
  clearingRate: 0,
  shrinkFactor: 1,
}
const flat = { elevationAt: () => 800 }
const point = (x: number, y: number) => offsetCoordinate(offsetCoordinate(origin, 90, x), 0, y)
const road = (): Alignment => ({
  id: 'r',
  name: 'Road',
  color: '#16817a',
  points: [
    { id: 'a', coordinate: origin, radiusM: 0 },
    { id: 'b', coordinate: point(0, 100), radiusM: 0 },
  ],
  vertical: [
    { id: 's', chainage: 0, elevation: 810, curveLength: 0 },
    { id: 'e', chainage: 100, elevation: 810, curveLength: 0 },
  ],
  overrides: [],
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
})
describe('richer bounded design searches', () => {
  it('does not rank infeasible material procurement as a cheap total-cost profile or joint winner', async () => {
    const a = road()
    a.vertical = a.vertical.map((p) => ({ ...p, elevation: 802 }))
    a.engineering = createEngineeringDesign()
    a.engineering.haul.enabled = true
    a.engineering.haul.allocation = 'economic'
    a.verticalControls = [0, 100].map((chainage, i) => ({
      id: `c${i}`,
      chainage,
      elevation: 802,
      toleranceAboveM: 0,
      toleranceBelowM: 0,
      gradePercent: null,
      gradeTolerancePercent: 0,
    }))
    expect(() =>
      optimizeVerticalProfile(a, 100, flat, settings, { objective: 'total', pviSpacingM: 100, maxDepthM: 1 }),
    ).toThrow(/material.*incomplete|material.*infeasible/)
    a.points.splice(1, 0, { id: 'middle', coordinate: point(0, 50), radiusM: 0 })
    await expect(refinePlanAndProfile(a, flat, settings, [], { maxEvaluations: 1 })).rejects.toThrow(
      /prescription.*incomplete|prescription.*infeasible/,
    )
  })
  it('centres level/section tables on the existing fitted design rather than ground', () => {
    const a = road(),
      result = optimizeVerticalProfile(a, 100, flat, settings, {
        bandCenter: 'design',
        maxDepthM: 1,
        levelStepM: 0.5,
        tieEndsToGround: false,
        k: 1,
        pviSpacingM: 50,
      })
    expect(result.vertical.every((p) => p.elevation >= 809 - 1e-6 && p.elevation <= 811 + 1e-6)).toBe(true)
    expect(analyzeRoad({ ...a, vertical: result.vertical }, flat, settings).verticalChecks ?? []).toHaveLength(0)
  })
  it('evaluates parabolic design elevation and restrictive overlapping curvature ranges', () => {
    expect(
      designElevationAt(
        [
          { id: 'a', chainage: 0, elevation: 800, curveLength: 0 },
          { id: 'b', chainage: 100, elevation: 810, curveLength: 40 },
          { id: 'c', chainage: 200, elevation: 800, curveLength: 0 },
        ],
        100,
      ),
    ).toBeCloseTo(809)
    const rule = curvatureRuleAt(
      {
        ...EMPTY_VERTICAL_STANDARDS,
        minSagK: 2,
        curvatureRanges: [
          { id: 'a', start: 40, end: 80, minSagK: 5, minCrestK: 12 },
          { id: 'b', start: 70, end: 90, minSagK: 8, minCrestK: 3, linear: true },
        ],
      },
      50,
      85,
      100,
    )
    expect(rule).toEqual({ minSagK: 8, minCrestK: 12, linear: true })
  })
  it('respects linear-only ranges and asymmetric K inside a profile search', () => {
    const a = road()
    a.verticalStandards = {
      ...EMPTY_VERTICAL_STANDARDS,
      minSagK: 6,
      minCrestK: 12,
      curvatureRanges: [{ id: 'l', start: 20, end: 80, minSagK: null, minCrestK: null, linear: true }],
    }
    const result = optimizeVerticalProfile(a, 100, flat, settings, { k: 1, pviSpacingM: 50, maxDepthM: 1 })
    const checked = analyzeRoad({ ...a, vertical: result.vertical }, flat, settings)
    expect(checked.verticalChecks ?? []).toHaveLength(0)
  })
  it('uses explicit feature/class prices and validates group bounds', () => {
    expect(() => parseRouteSearchOptions({ ...DEFAULT_ROUTE_OPTIONS, crossingGroups: { bad: -1 } })).toThrow(/prices/)
    const context = [
      {
        id: 's',
        name: 'Stream',
        kind: 'stream' as const,
        crossingGroup: 'major',
        geometry: { type: 'LineString' as const, coordinates: [point(-20, -200), point(-20, 200)] },
      },
    ]
    const start = point(-100, 0),
      end = point(100, 0)
    const options = { ...DEFAULT_ROUTE_OPTIONS, alternatives: 1, crossingCost: 1, crossingGroups: { major: 1000 } }
    const grouped = suggestRoutes(start, end, flat, settings, context, options)
    const explicit = suggestRoutes(start, end, flat, settings, [{ ...context[0], crossingCost: 100 }], options)
    expect(grouped.routes[0].cost - explicit.routes[0].cost).toBeCloseTo(900, 3)
  })
  it('changes route geometry when a named short-stream crossing becomes expensive', () => {
    const stream = {
      id: 's',
      name: 'Short stream',
      kind: 'stream' as const,
      crossingGroup: 'sensitive',
      geometry: { type: 'LineString' as const, coordinates: [point(0, -20), point(0, 20)] },
    }
    const options = { ...DEFAULT_ROUTE_OPTIONS, alternatives: 1, baseCostPerM: 1, crossingCost: 0 }
    const cheap = suggestRoutes(point(-100, 0), point(100, 0), flat, settings, [stream], {
      ...options,
      crossingGroups: { sensitive: 0 },
    })
    const expensive = suggestRoutes(point(-100, 0), point(100, 0), flat, settings, [stream], {
      ...options,
      crossingGroups: { sensitive: 1000 },
    })
    expect(cheap.routes[0].crossings).toBeGreaterThan(0)
    expect(expensive.routes[0].crossings).toBe(0)
    expect(expensive.routes[0].coordinates).not.toEqual(cheap.routes[0].coordinates)
  })
  it('joint refinement keeps endpoints and input assumptions and ranks the complete supplied objective', async () => {
    const a = road()
    a.points = [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: point(10, 50), radiusM: 20 },
      { id: 'c', coordinate: point(0, 100), radiusM: 0 },
    ]
    a.vertical = [
      { id: 's', chainage: 0, elevation: 800, curveLength: 0 },
      { id: 'e', chainage: alignmentLength(a), elevation: 800, curveLength: 0 },
    ]
    const before = structuredClone(a)
    const result = await refinePlanAndProfile(a, flat, settings, [], {
      rounds: 1,
      stepM: 5,
      maxEvaluations: 6,
      profile: { pviSpacingM: 50, maxDepthM: 1, levelStepM: 0.5, k: 1 },
      evaluate: (trial) => ({ score: Math.abs(trial.points[1].coordinate[0] - origin[0]) * 1e9 }),
    })
    expect(a).toEqual(before)
    expect(result.alignment.points[0].coordinate).toEqual(origin)
    expect(result.alignment.points.at(-1)!.coordinate).toEqual(before.points.at(-1)!.coordinate)
    expect(result.score).toBeLessThan(result.initialScore!)
    expect(result.alignment.template).toEqual(before.template)
    expect(result.objective).toBe('complete-access')
  })
  it('never substitutes a base cost for an unpriced complete-access evaluator', async () => {
    const a = road()
    a.points = [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: point(10, 50), radiusM: 20 },
      { id: 'c', coordinate: point(0, 100), radiusM: 0 },
    ]
    a.vertical = [
      { id: 's', chainage: 0, elevation: 800, curveLength: 0 },
      { id: 'e', chainage: alignmentLength(a), elevation: 800, curveLength: 0 },
    ]
    await expect(
      refinePlanAndProfile(a, flat, settings, [], {
        maxEvaluations: 2,
        profile: { maxDepthM: 1 },
        evaluate: () => ({ score: null, blockers: ['Supply unpriced'] }),
      }),
    ).rejects.toThrow(/Supply unpriced/)
  })
  it('rejects invalid evaluator costs and honours cancellation without returning a partial best', async () => {
    const a = road()
    a.points = [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: point(10, 50), radiusM: 20 },
      { id: 'c', coordinate: point(0, 100), radiusM: 0 },
    ]
    a.vertical = [
      { id: 's', chainage: 0, elevation: 800, curveLength: 0 },
      { id: 'e', chainage: alignmentLength(a), elevation: 800, curveLength: 0 },
    ]
    await expect(
      refinePlanAndProfile(a, flat, settings, [], { maxEvaluations: 1, evaluate: () => ({ score: -1 }) }),
    ).rejects.toThrow(/invalid cost/)
    const controller = new AbortController()
    await expect(
      refinePlanAndProfile(a, flat, settings, [], {
        signal: controller.signal,
        yieldControl: async () => {
          controller.abort()
        },
      }),
    ).rejects.toThrow(/cancelled/)
  })
})

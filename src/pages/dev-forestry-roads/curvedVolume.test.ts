import { describe, expect, it } from 'vitest'
import {
  centroidOffset,
  curvatureCorrectionText,
  pappusVolume,
  prismoidalVolume,
  sectionAreaMoments,
  withReportedArea,
} from './curvedVolume'
import { analyzeRoad, offsetCoordinate } from './engine'
import { roadSummaryMetrics } from './roadSummaryMetrics'
import { createEngineeringDesign } from './engineeringTypes'
import type { Alignment, Coordinate, RoadSettings, TerrainSource } from './types'

describe('Pappus volumes', () => {
  it('corrects a region by its centroid against the centreline radius', () => {
    // A 30 m right-hand curve; a 20 m² cut region whose centroid is 6 m right (inside) sweeps less.
    const right = { area: 20, moment: 20 * 6 }
    expect(pappusVolume(right, right, 1 / 30, 10)).toBeCloseTo(160, 9)
    const left = { area: 20, moment: -20 * 6 }
    expect(pappusVolume(left, left, 1 / 30, 10)).toBeCloseTo(240, 9)
    // On a tangent it is average end areas, whatever the centroid.
    expect(pappusVolume(right, { area: 10, moment: -40 }, 0, 10)).toBeCloseTo(150, 9)
    // A centroid past the centre of curvature has no swept volume.
    expect(pappusVolume({ area: 5, moment: 5 * 40 }, right, 1 / 30, 10)).toBeNull()
  })

  it('takes areas and first moments from the sampled section, splitting where ground crosses the design', () => {
    const section = [
      { offset: -6, ground: 2, design: 0 },
      { offset: -2, ground: 2, design: 0 },
      { offset: 0, ground: 1, design: 0 },
      { offset: 2, ground: -1, design: 0 },
      { offset: 4, ground: null, design: 0 },
    ]
    const { cut, fill } = sectionAreaMoments(section)
    // Cut: 2 m deep over −6…−2, then 2→1 over −2…0, then 1→0 over 0…1.
    expect(cut.area).toBeCloseTo(8 + 3 + 0.5, 9)
    expect(cut.moment).toBeCloseTo(-32 + (2 * (2 * -2 + 0) + 1 * (-2 + 0)) / 3 + 0.5 / 3, 9)
    // Fill: 0→1 over 1…2; the sample with unknown ground is skipped.
    expect(fill.area).toBeCloseTo(0.5, 9)
    expect(centroidOffset(fill)).toBeCloseTo(1 + 2 / 3, 9)
    expect(withReportedArea(fill, 2)).toEqual({ area: 2, moment: expect.closeTo(2 * (5 / 3), 9) })
  })
})

describe('curvature-corrected road quantities', () => {
  const origin: Coordinate = [-122.8, 53.9]
  const xy = (east: number, north: number) =>
    offsetCoordinate(origin, (Math.atan2(east, north) * 180) / Math.PI, Math.hypot(east, north))
  const local = (p: Coordinate) => ({
    east: (((p[0] - origin[0]) * Math.PI) / 180) * 6371008.8 * Math.cos((origin[1] * Math.PI) / 180),
    north: (((p[1] - origin[1]) * Math.PI) / 180) * 6371008.8,
  })
  const settings: RoadSettings = {
    stationInterval: 5,
    crossSectionHalfWidth: 30,
    maxGradePercent: 12,
    minRadius: 25,
    cutRate: 2,
    fillRate: 3,
    surfacingRate: 4,
    clearingRate: 0.5,
    shrinkFactor: 0.8,
  }
  const road = (points: Alignment['points']): Alignment => ({
    id: 'main',
    name: 'Main',
    color: '#16817a',
    points,
    vertical: [
      { id: 'v0', chainage: 0, elevation: 800, curveLength: 0 },
      { id: 'v1', chainage: 500, elevation: 800, curveLength: 0 },
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
  })
  // North 60 m, a 40 m right-hand curve to the east about (40, 60), then east.
  const centre = { east: 40, north: 60 }
  // Ground rises away from the curve centre at 50 %: cut outside (left), fill inside (right).
  const sidehill: TerrainSource = {
    elevationAt: (lng, lat) => {
      const p = local([lng, lat])
      return 800 + 0.5 * (Math.hypot(p.east - centre.east, p.north - centre.north) - 40)
    },
  }

  it('matches average end areas on a straight road', () => {
    const straight = road([
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: xy(0, 200), radiusM: 0 },
    ])
    const result = analyzeRoad(straight, sidehill, settings)
    expect(result.curvatureCorrection).toEqual({
      cutVolumeM3: result.cutVolumeM3,
      fillVolumeM3: result.fillVolumeM3,
      curvedLengthM: 0,
      uncorrectedIntervals: 0,
    })
    for (const s of result.stations) {
      expect(s.curvedCutVolumeM3).toBe(s.cutVolumeM3)
      expect(s.curvedFillVolumeM3).toBe(s.fillVolumeM3)
    }
  })

  it('adds cut outside a right-hand curve and removes fill inside it, by 1 ± e/R', () => {
    const curved = road([
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'pi', coordinate: xy(0, 100), radiusM: 40 },
      { id: 'b', coordinate: xy(100, 100), radiusM: 0 },
    ])
    const result = analyzeRoad(curved, sidehill, settings)
    expect(result.coveragePercent).toBeCloseTo(100, 6)
    const arc = result.stations.filter(
      (s, i) => i > 0 && result.stations[i - 1].chainage >= 60 - 1e-6 && s.chainage <= 60 + 20 * Math.PI + 1e-6,
    )
    expect(arc.length).toBeGreaterThan(10)
    // On the arc each section is the same: cut 4.5 m² centred 3 m left, fill 4.5 m² centred 3 m right.
    for (const s of arc) {
      expect(s.cutAreaM2!).toBeCloseTo(4.5, 2)
      expect(s.curvedCutVolumeM3! / s.cutVolumeM3!).toBeCloseTo(1 + 3 / 40, 3)
      expect(s.curvedFillVolumeM3! / s.fillVolumeM3!).toBeCloseTo(1 - 3 / 40, 3)
    }
    const c = result.curvatureCorrection!
    expect(c.curvedLengthM).toBeCloseTo(20 * Math.PI, 3)
    expect(c.cutVolumeM3).toBeGreaterThan(result.cutVolumeM3)
    expect(c.fillVolumeM3).toBeLessThan(result.fillVolumeM3)
    // Exactly the arc's correction, φ·M with φ = π/2 and M = ∓13.5 m³/m, moves each total.
    expect(c.cutVolumeM3 - result.cutVolumeM3).toBeCloseTo((Math.PI / 2) * 13.5, 1)
    expect(result.fillVolumeM3 - c.fillVolumeM3).toBeCloseTo((Math.PI / 2) * 13.5, 1)
    // Reported only: the cost and balance stay on the uncorrected volumes.
    expect(result.balanceM3).toBeCloseTo(result.cutVolumeM3 * 0.8 - result.fillVolumeM3, 9)
    // A left-hand curve mirrors it.
    const mirrored = road([
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'pi', coordinate: xy(0, 100), radiusM: 40 },
      { id: 'b', coordinate: xy(-100, 100), radiusM: 0 },
    ])
    const centreLeft = { east: -40, north: 60 }
    const leftHill: TerrainSource = {
      elevationAt: (lng, lat) => {
        const p = local([lng, lat])
        return 800 + 0.5 * (Math.hypot(p.east - centreLeft.east, p.north - centreLeft.north) - 40)
      },
    }
    const left = analyzeRoad(mirrored, leftHill, settings)
    expect(left.curvatureCorrection!.cutVolumeM3 - left.cutVolumeM3).toBeCloseTo((Math.PI / 2) * 13.5, 1)
    const text = curvatureCorrectionText(c, result.cutVolumeM3, result.fillVolumeM3)
    expect(text).toMatch(/over 63 m of curves, cut would be [\d,]+ m³ \(\+[\d.]+ %\)/)
    expect(text).toContain('use the uncorrected average end areas')
    expect(curvatureCorrectionText(undefined, 1, 1)).toMatch(/no curvature correction applies/)
  })

  it('applies the corrected volumes to totals, mass and cost when asked, and says so', () => {
    const curved = road([
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'pi', coordinate: xy(0, 100), radiusM: 40 },
      { id: 'b', coordinate: xy(100, 100), radiusM: 0 },
    ])
    const reported = analyzeRoad(curved, sidehill, settings)
    const applied = analyzeRoad(curved, sidehill, { ...settings, curvatureCorrection: 'apply' })
    const c = applied.curvatureCorrection!
    expect(c.applied).toBe(true)
    expect(applied.cutVolumeM3).toBeCloseTo(reported.curvatureCorrection!.cutVolumeM3, 6)
    expect(applied.fillVolumeM3).toBeCloseTo(reported.curvatureCorrection!.fillVolumeM3, 6)
    expect(c.averageEndCutVolumeM3).toBeCloseTo(reported.cutVolumeM3, 6)
    expect(c.averageEndFillVolumeM3).toBeCloseTo(reported.fillVolumeM3, 6)
    // The road summary's earthworks label says so too, in either wording, and never when not applied.
    const label = (analysis: typeof applied, curveNote?: 'full' | 'short') =>
      roadSummaryMetrics({
        analysis,
        alignment: curved,
        settings,
        groundOnly: false,
        preview: null,
        record: undefined,
        recordCurrent: false,
        unpriced: 0,
        incomplete: [],
        costOpen: false,
        onCost: () => {},
        onIncomplete: () => {},
        curveNote,
      }).find((metric) => metric.key === 'earthworks')!.label
    expect(label(applied)).toMatch(/· curve-corrected$/)
    expect(label(applied, 'short')).toMatch(/· curve$/)
    expect(label(reported)).not.toMatch(/curve/)
    expect(applied.balanceM3).toBeCloseTo(applied.cutVolumeM3 * 0.8 - applied.fillVolumeM3, 6)
    expect(applied.stations[applied.stations.length - 1].massM3).toBeCloseTo(applied.balanceM3, 6)
    expect(applied.estimatedCost).toBeCloseTo(
      applied.cutVolumeM3 * settings.cutRate +
        applied.fillVolumeM3 * settings.fillRate +
        applied.surfaceVolumeM3 * settings.surfacingRate +
        applied.clearingAreaM2 * settings.clearingRate,
      6,
    )
    for (const s of applied.stations) expect(s.cutVolumeM3).toBe(s.curvedCutVolumeM3)
    const text = curvatureCorrectionText(c, applied.cutVolumeM3, applied.fillVolumeM3)
    expect(text).toContain('uses the corrected volumes')
    // Off by default: the same road without the setting is the reported one.
    expect(reported.curvatureCorrection!.applied).toBeUndefined()
  })

  it('carries the correction into every material excavated when engineering is on', () => {
    const curved = {
      ...road([
        { id: 'a', coordinate: origin, radiusM: 0 },
        { id: 'pi', coordinate: xy(0, 100), radiusM: 40 },
        { id: 'b', coordinate: xy(100, 100), radiusM: 0 },
      ]),
      engineering: createEngineeringDesign(),
    }
    const applied = analyzeRoad(curved, sidehill, { ...settings, curvatureCorrection: 'apply' })
    const bank = applied.engineering!.materials.reduce((sum, m) => sum + m.bankCutM3, 0)
    expect(bank).toBeCloseTo(applied.cutVolumeM3, 3)
  })
})

// Lima VVA functional specification §11, T1 and T2 (hand-derived): two triangular cut sections 20 m
// apart, A₁ = 10 m² with its centroid 4 m right (M₁ = 40 m³/m), A₂ = 30 m² at 6 m right (M₂ = 180).
describe('reference volumes (Lima specification T1, T2)', () => {
  const first = { area: 10, moment: 40 },
    second = { area: 30, moment: 180 }
  it('average end area, prismoidal, and Pappus on right and left curves', () => {
    expect(pappusVolume(first, second, 0, 20)).toBeCloseTo(400, 9)
    expect(prismoidalVolume(10, 18.75, 30, 20)).toBeCloseTo(383.333, 3)
    expect(pappusVolume(first, second, 0.02, 20)).toBeCloseTo(356, 9)
    expect(pappusVolume(first, second, -0.02, 20)).toBeCloseTo(444, 9)
  })
  it('samples curvature mid-interval; a section at the curve start makes it exact', () => {
    // The curve starts 5 m in. Mid-interval (10 m) is on the curve, so the whole interval is corrected.
    expect(pappusVolume(first, second, 0.02, 20)).toBeCloseTo(356, 9)
    // A, M linear in x: A(5) = 15, M(5) = 75. Split there, the trapezoid rule is exact: 361.75 m³.
    const atCurveStart = { area: 15, moment: 75 }
    const split = pappusVolume(first, atCurveStart, 0, 5)! + pappusVolume(atCurveStart, second, 0.02, 15)!
    expect(split).toBeCloseTo(361.75, 9)
  })
})

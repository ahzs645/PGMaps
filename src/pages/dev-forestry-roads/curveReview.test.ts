import { describe, expect, it } from 'vitest'
import { alignmentLength, analyzeRoad, horizontalCurveSummary, offsetCoordinate } from './engine'
import { buildCurveReview, curveReviewCsv } from './curveReview'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, Coordinate, TerrainSource } from './types'

const origin: Coordinate = [-122.8, 53.9]
const settings = { ...DEFAULT_ROAD_SETTINGS, stationInterval: 5, crossSectionHalfWidth: 100 }
const ground: TerrainSource = { elevationAt: () => 800 }

function road(direction: 'left' | 'right' = 'right', radius = 50, spiral = 0): Alignment {
  const corner = offsetCoordinate(origin, 0, 150)
  const alignment: Alignment = {
    id: 'r',
    name: 'Curve review',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: corner, radiusM: radius, spiralM: spiral },
      { id: 'c', coordinate: offsetCoordinate(corner, direction === 'right' ? 90 : 270, 150), radiusM: 0 },
    ],
    vertical: [],
    template: {
      ...DEFAULT_TEMPLATE,
      leftWidth: 3,
      rightWidth: 4,
      crossfallPercent: 0,
      ditchWidth: 0,
      ditchDepth: 0,
      surfaceDepth: 0,
      fillSlope: 1,
    },
    overrides: [],
  }
  const length = alignmentLength(alignment)
  alignment.vertical = [
    { id: 'v0', chainage: 0, elevation: 800, curveLength: 0 },
    { id: 'v1', chainage: length, elevation: 800 + 0.08 * length, curveLength: 0 },
  ]
  return alignment
}
const review = (alignment: Alignment, terrain = ground) =>
  buildCurveReview(alignment, analyzeRoad(alignment, terrain, settings))

describe('fitted curve and switchback review', () => {
  it('derives inner-edge radius and grade from the actual inside formation width for both turn directions', () => {
    const right = review(road('right'))[0],
      left = review(road('left'))[0]
    expect(right.direction).toBe('right')
    expect(right.insideWidthM).toEqual({ min: 4, max: 4 })
    expect(right.innerFormationRadiusM).toEqual({ min: 46, max: 46 })
    expect(right.centrelineGradePercent!.min).toBeCloseTo(8, 8)
    expect(right.innerEdgeGradePercent!.min).toBeCloseTo((8 * 50) / 46, 8)
    expect(right.innerEdgeGradePercent!.max).toBeCloseTo((8 * 50) / 46, 8)
    expect(left.direction).toBe('left')
    expect(left.innerFormationRadiusM).toEqual({ min: 47, max: 47 })
    expect(left.innerEdgeGradePercent!.max).toBeCloseTo((8 * 50) / 47, 8)
    expect(right.events.map((e) => e.label)).toEqual(['BC', 'EC'])
  })

  it('shows full spiral events and uses total deflection for radius/deflection widening criteria', () => {
    const alignment = road('right', 50, 10)
    alignment.curveDesign = {
      designSpeedKmh: 20,
      maxSuperelevationPercent: 8,
      sideFrictionFactor: 0.15,
      runoffLengthM: 10,
      wideningVehicleLengthM: null,
      wideningTable: [
        { radiusM: 50, deflectionDegrees: 0, insideM: 0, outsideM: 0 },
        { radiusM: 50, deflectionDegrees: 180, insideM: 10, outsideM: 2 },
      ],
    }
    const r = review(alignment)[0]
    expect(r.events.map((e) => e.label)).toEqual(['TS', 'SC', 'CS', 'ST'])
    expect(r.events[1].chainage - r.events[0].chainage).toBeCloseTo(10, 8)
    expect(r.events[3].chainage - r.events[2].chainage).toBeCloseTo(10, 8)
    expect(r.deflectionDegrees).toBeCloseTo(90, 2)
    expect(r.circularDeflectionDegrees).toBeLessThan(r.deflectionDegrees - 10)
    expect(r.fullLength).toBeCloseTo(r.length + 20, 8)
    expect(r.insideWideningM).toBeCloseTo(5, 3)
    expect(r.insideWidthM!.max).toBeCloseTo(9, 3)
  })

  it('distinguishes speed-required e, capped target and the crown-retaining actual crossfall', () => {
    const alignment = road()
    alignment.template.crossfallPercent = 4
    alignment.curveDesign = {
      designSpeedKmh: 33,
      maxSuperelevationPercent: 8,
      sideFrictionFactor: 0.15,
      runoffLengthM: 30,
      wideningVehicleLengthM: null,
    }
    const r = review(alignment)[0]
    const needed = 100 * (33 ** 2 / (127 * 50) - 0.15)
    expect(r.requiredSuperelevationPercent).toBeCloseTo(needed, 8)
    expect(r.cappedSuperelevationPercent).toBeCloseTo(needed, 8)
    expect(r.insideCrossfallPercent!.min).toBeCloseTo(4, 6)
    expect(r.outsideCrossfallPercent!.max).toBeCloseTo(-4, 6)
    alignment.curveDesign.designSpeedKmh = 80
    const capped = review(alignment)[0]
    expect(capped.requiredSuperelevationPercent).toBeGreaterThan(8)
    expect(capped.cappedSuperelevationPercent).toBe(8)
    expect(capped.warnings.join(' ')).toContain('requires')
  })

  it('reports an actual retained crown above the entered cap', () => {
    const alignment = road()
    alignment.template.crossfallPercent = 4
    alignment.curveDesign = {
      designSpeedKmh: 33,
      maxSuperelevationPercent: 2,
      sideFrictionFactor: 0.15,
      runoffLengthM: 30,
      wideningVehicleLengthM: null,
    }
    const r = review(alignment)[0]
    expect(r.cappedSuperelevationPercent).toBe(2)
    expect(r.insideCrossfallPercent!.max).toBeCloseTo(4, 6)
    expect(r.warnings.join(' ')).toContain('retaining the template crown')
  })

  it('does not treat ordinary crown as superelevation when the rotation target is zero', () => {
    const alignment = road()
    alignment.template.crossfallPercent = 4
    alignment.curveDesign = {
      designSpeedKmh: 20,
      maxSuperelevationPercent: 0,
      sideFrictionFactor: 0.15,
      runoffLengthM: 30,
      wideningVehicleLengthM: null,
    }
    const r = review(alignment)[0]
    expect(r.cappedSuperelevationPercent).toBe(0)
    expect(r.insideCrossfallPercent!.min).toBe(4)
    expect(r.outsideCrossfallPercent!.min).toBe(4)
    expect(r.warnings.join(' ')).not.toContain('retaining the template crown')
  })

  it('recognizes a single-PVI constant formation independently of ground', () => {
    const alignment = road()
    alignment.vertical = [{ id: 'flat', chainage: 0, elevation: 802, curveLength: 0 }]
    const r = review(alignment)[0]
    expect(r.independentProfile).toBe(true)
    expect(r.centrelineGradePercent).toEqual({ min: 0, max: 0 })
    expect(r.innerEdgeGradePercent).toEqual({ min: 0, max: 0 })
    expect(r.innerEdgeGradeReason).toBeNull()
  })

  it('withholds the constant-offset grade formula on width transitions and ground-following roads', () => {
    const alignment = road()
    const curve = horizontalCurveSummary(alignment)[0]
    alignment.overrides = [
      {
        id: 'w',
        name: 'Taper',
        kind: 'turnout',
        side: 'right',
        start: curve.start,
        end: curve.end,
        extraWidth: 3,
        taper: 15,
      },
    ]
    const changing = review(alignment)[0]
    expect(changing.insideWidthM!.max).toBeGreaterThan(changing.insideWidthM!.min)
    expect(changing.innerEdgeGradePercent).toBeNull()
    expect(changing.innerEdgeGradeReason).toContain('changes across the arc')
    alignment.overrides = []
    alignment.vertical = []
    const following = review(alignment)[0]
    expect(following.centrelineGradePercent).toBeNull()
    expect(following.innerEdgeGradePercent).toBeNull()
    expect(following.innerEdgeGradeReason).toContain('No independent formation profile')
  })

  it('does not emit infinite edge grades when the inside formation reaches the curve centre', () => {
    const alignment = road('right', 20)
    alignment.template.rightWidth = 20
    const r = review(alignment)[0]
    expect(r.innerFormationRadiusM!.min).toBe(0)
    expect(r.innerEdgeGradePercent).toBeNull()
    expect(r.warnings.join(' ')).toContain('swept formation folds')
  })

  it('flags inside daylight folding independently of the formation radius', () => {
    const alignment = road('right', 20)
    alignment.vertical.forEach((p) => {
      p.elevation = 820
    })
    alignment.template.fillSlope = 2
    const r = review(alignment)[0]
    expect(r.innerFormationRadiusM!.min).toBeGreaterThan(0)
    expect(r.minimumInnerDaylightRadiusM).toBeLessThan(0)
    expect(r.warnings.join(' ')).toContain('Swept sections may overlap')
    const analysis = analyzeRoad(alignment, ground, settings)
    const arc = horizontalCurveSummary(alignment)[0]
    const sample = analysis.stations.find((s) => s.chainage > arc.start && s.chainage < arc.end)!
    sample.rightDaylightM = null
    sample.complete = false
    const partial = buildCurveReview(alignment, analysis)[0]
    expect(partial.minimumInnerDaylightRadiusM).toBeNull()
    expect(partial.warnings.join(' ')).toContain('Swept sections may overlap')
    expect(partial.warnings.join(' ')).toContain('daylight is unresolved')
  })

  it('keeps missing terrain and absent fitted geometry explicit', () => {
    const alignment = road()
    const r = review(alignment, { elevationAt: () => Number.NaN })[0]
    expect(r.completeSampleCount).toBe(0)
    expect(r.sampleCount).toBeGreaterThan(0)
    expect(r.minimumInnerDaylightRadiusM).toBeNull()
    expect(r.warnings.join(' ')).toContain('covered subtotals')
    alignment.points[1].radiusM = 5000
    expect(review(alignment)).toEqual([])
  })

  it('exports numeric grades, blank unknowns, formula-safe labels and terrain provenance', () => {
    const alignment = road()
    alignment.name = '=HYPERLINK("bad")'
    alignment.vertical = []
    const csv = curveReviewCsv(alignment, review(alignment), {
      kind: 'demo',
      name: 'Test ground',
      resolutionM: 1,
      verticalReference: 'Test datum',
      sha256: 'known-bytes',
    })
    expect(csv).toContain('"\'=HYPERLINK(""bad"")"')
    expect(csv).toContain('"Test ground",1,"Test datum",,"known-bytes"')
    expect(csv).toContain('No independent formation profile')
    expect(csv).toContain('not a vehicle grade limit')
    expect(csv).not.toContain('NaN')
    expect(csv).not.toContain('Infinity')
    expect(csv.split('\r\n')).toHaveLength(2)
  })
})

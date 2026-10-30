import { describe, expect, it } from 'vitest'
import { analyzeRoad, curveDesignAt, horizontalCurveSummary, offsetCoordinate } from './engine'
import { evaluateCurveCriteria, parseWideningTableCsv, validateCurveCriteria } from './roadCriteria'
import type { Alignment, CurveDesign, RoadSettings } from './types'
const design: CurveDesign = {
  criteriaName: 'Entered low-volume criteria',
  criteriaSource: 'Reviewer worksheet 2026-10',
  designSpeedKmh: 40,
  maxSuperelevationPercent: 8,
  sideFrictionFactor: 0.15,
  runoffLengthM: 30,
  wideningVehicleLengthM: null,
}
const settings: RoadSettings = {
  stationInterval: 10,
  crossSectionHalfWidth: 35,
  maxGradePercent: 12,
  minRadius: 25,
  cutRate: 1,
  fillRate: 1,
  surfacingRate: 1,
  clearingRate: 1,
  shrinkFactor: 1,
}
describe('explicit road-class criteria', () => {
  it('flags a speed/radius conflict rather than silently reporting capped e as suitable', () => {
    const c = evaluateCurveCriteria(design, 25)
    expect(c.requiredSuperelevationPercent).toBeCloseTo(35.3937008)
    expect(c.appliedSuperelevationPercent).toBe(8)
    expect(c.minimumSpeedRadiusM).toBeCloseTo(54.77576, 4)
    expect(c.warnings[0]).toContain('requires 35.39%')
  })
  it('bilinearly interpolates both widening sides, adds offsets and discloses extrapolation', () => {
    const wideningTable = parseWideningTableCsv('50,60,1,2\n50,120,3,4\n100,60,5,6\n100,120,7,8')
    const c = evaluateCurveCriteria({ ...design, wideningTable, insideWideningM: 0.5, outsideWideningM: 0.25 }, 75, 90)
    expect(c.insideWideningM).toBe(4.5)
    expect(c.outsideWideningM).toBe(5.25)
    expect(evaluateCurveCriteria({ ...design, wideningTable }, 200, 90).warnings).toContain(
      'Curve falls outside the widening table; edge values were used. Review widening.',
    )
  })
  it('rejects ambiguous, sparse and invalid widening tables', () => {
    expect(() => parseWideningTableCsv('50,60,1,2\n50,60,2,3')).toThrow(/duplicate/)
    expect(() => parseWideningTableCsv('50,60,1,2\n100,120,2,3')).toThrow(/combination/)
    expect(() => validateCurveCriteria({ ...design, outsideWideningM: -1 })).toThrow(/0 and 50/)
  })
  it('puts the criteria failure on real calculated curve stations', () => {
    const start: [number, number] = [-122.8, 53.9],
      corner = offsetCoordinate(start, 0, 150)
    const a: Alignment = {
      id: 'r',
      name: 'Road',
      color: '#16817a',
      points: [
        { id: 'a', coordinate: start, radiusM: 0 },
        { id: 'b', coordinate: corner, radiusM: 25 },
        { id: 'c', coordinate: offsetCoordinate(corner, 90, 150), radiusM: 0 },
      ],
      vertical: [],
      overrides: [],
      curveDesign: design,
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
    }
    const result = analyzeRoad(a, { elevationAt: () => 800 }, settings)
    expect(result.stations.some((s) => s.flags.some((f) => f.includes('requires 35.39%')))).toBe(true)
    const arc = horizontalCurveSummary(a)[0]
    expect(curveDesignAt(a, (arc.start + arc.end) / 2)?.requiredSuperPercent).toBeCloseTo(35.3937008)
  })
})

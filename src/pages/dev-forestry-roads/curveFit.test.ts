import { describe, expect, it } from 'vitest'
import { horizontalFitNote, limitedRadius, verticalFitNote } from './curveFit'
import { horizontalCurveFits, horizontalCurveSummary, offsetCoordinate, verticalCurveSummary } from './engine'
import { DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, Coordinate, VerticalPoint } from './types'

const origin: Coordinate = [-122.8, 53.9]
/** Legs of 199.5 m and 232.5 m meeting at 25.1°, the walkthrough's IP 2, then a short third leg. */
function road(radii: number[], third = 60): Alignment {
  const p2 = offsetCoordinate(origin, 0, 199.5)
  const p3 = offsetCoordinate(p2, 25.1, 232.5)
  const points = [origin, p2, p3, offsetCoordinate(p3, 65.1, third)]
  return {
    id: 'r',
    name: 'Road',
    color: '#16817a',
    points: points.map((coordinate, i) => ({ id: `p${i + 1}`, coordinate, radiusM: radii[i] ?? 0 })),
    vertical: [],
    template: { ...DEFAULT_TEMPLATE },
    overrides: [],
  }
}
const fitAt = (alignment: Alignment, point: number) => horizontalCurveFits(alignment).find((f) => f.point === point)

describe('a horizontal radius that was not applied as typed', () => {
  it('says nothing when the curve fits, and reports the tangent it took', () => {
    const fit = fitAt(road([0, 60]), 2)!
    expect(fit.status).toBe('fitted')
    expect(fit.deflectionDegrees).toBeCloseTo(25.1, 1)
    expect(fit.tangentM).toBeCloseTo(60 * Math.tan((25.1 * Math.PI) / 360), 1)
    expect(horizontalFitNote(fit)).toBeNull()
    expect(horizontalFitNote(fitAt(road([0, 0]), 2))).toBeNull()
  })

  it('names the tangent needed, the leg that is short and the largest radius that fits', () => {
    const a = road([0, 1000])
    const fit = fitAt(a, 2)!
    // R 1000 at 25.1° needs 222.6 m of tangent; the first leg has 199.5 m.
    expect(fit.status).toBe('tangent')
    expect(fit.tangentM).toBeCloseTo(222.6, 0)
    expect(fit.backM).toBeCloseTo(199.5, 1)
    expect(horizontalCurveSummary(a)).toHaveLength(0)
    const note = horizontalFitNote(fit)!
    expect(note).toMatch(/^Not fitted: R 1,000 needs 222\.\d m of tangent, and the leg back to point 1 has 199\.5 m\./)
    expect(note).toContain('The corner stays sharp.')
    expect(note).toMatch(/Shorten this curve, shorten a neighbouring one, or move the points/)
    // The radius it suggests does fit, and a metre more would not be far off the limit.
    const largest = Number(/largest radius that fits is ([\d,.]+) m/.exec(note)![1].replace(/,/g, ''))
    expect(largest).toBeCloseTo(199.5 / Math.tan((25.1 * Math.PI) / 360), 0)
    expect(fitAt(road([0, largest]), 2)!.status).toBe('fitted')
    expect(fitAt(road([0, largest + 2]), 2)!.status).toBe('tangent')
  })

  it('names the neighbour when two curves need more of a shared leg than it has', () => {
    // Each fits its own legs, but together they need more than the 232.5 m between points 2 and 3.
    const a = road([0, 600, 300], 400)
    const [second, third] = [fitAt(a, 2)!, fitAt(a, 3)!]
    expect(second.tangentM).toBeLessThan(199.5)
    expect(second.tangentM + third.tangentM).toBeGreaterThan(232.5)
    expect([second.status, third.status]).toEqual(['overlap', 'overlap'])
    expect([second.neighbourPoint, third.neighbourPoint]).toEqual([3, 2])
    expect(horizontalFitNote(second)).toMatch(
      /point 3's curve leaves [\d.]+ m of the leg between them\. Both corners stay sharp\./,
    )
    expect(horizontalFitNote(second)).toMatch(/Shorten this curve, shorten point 3's, or move the points apart\.$/)
    // Taking the suggestion for one of them fits both.
    const largest = Number(
      /largest radius that fits is ([\d,.]+) m/.exec(horizontalFitNote(second)!)![1].replace(/,/g, ''),
    )
    expect(horizontalCurveFits(road([0, largest, 300], 400)).map((f) => f.status)).toEqual(['fitted', 'fitted'])
  })

  it('holds a typed radius to the range and says what it did', () => {
    expect(limitedRadius(2000)).toEqual({ radiusM: 2000, note: null })
    expect(limitedRadius(20000)).toEqual({
      radiusM: 10000,
      note: 'Limited to 10,000 m: 20,000 m is over the largest radius.',
    })
    expect(limitedRadius(-5).radiusM).toBe(0)
  })
})

describe('a vertical curve that was not applied as typed', () => {
  // PVI 3 between tangents of 129 m and 140 m, as in the walkthrough.
  const pvis = (curves: number[]): VerticalPoint[] =>
    [0, 250, 379, 519, 760].map((chainage, i) => ({
      id: `v${i + 1}`,
      chainage,
      elevation: 750 + [0, 13, 10.4, 13.1, 20][i],
      curveLength: curves[i] ?? 0,
    }))
  const note = (curves: number[], pvi: number) => {
    const a = { ...road([0, 60]), vertical: pvis(curves) }
    return verticalFitNote(verticalCurveSummary(a).find((c) => c.pvi === pvi))
  }

  it('says nothing for a curve that fits or was not entered', () => {
    expect(note([0, 0, 72.5], 3)).toBeNull()
    expect(note([], 3)).toBeNull()
  })

  it('names the half length needed, the tangent that is short and the length that fits', () => {
    const text = note([0, 0, 400], 3)!
    expect(text).toMatch(
      /^Not fitted: this 400 m curve needs 200 m of tangent each side, and 129 m is available back to PVI 2\. Tangent grades are kept\. A curve of 258 m or less fits\./,
    )
    expect(text).toMatch(/Shorten this curve, shorten a neighbouring one, or move the PVIs apart\.$/)
    expect(note([0, 0, 258], 3)).toBeNull()
  })

  it('names the neighbour whose curve takes the tangent', () => {
    // 200 m at PVI 2 leaves 29 m of the 129 m tangent; 100 m at PVI 3 needs 50 m.
    const text = note([0, 200, 100], 3)!
    expect(text).toMatch(
      /PVI 2's curve leaves 29 m between them\. Tangent grades are kept at both\. A curve of 58 m or less fits\./,
    )
    expect(note([0, 200, 58], 3)).toBeNull()
  })

  it('explains a curve entered at an end of the profile', () => {
    expect(note([80], 1)).toMatch(/PVI 1 is an end of the profile/)
  })
})

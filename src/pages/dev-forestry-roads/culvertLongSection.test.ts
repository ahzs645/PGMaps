import { describe, expect, it } from 'vitest'
import {
  CULVERT_PROFILE_MIN_PX,
  bandPath,
  culvertLongSection,
  culvertProfileMark,
  fixed,
  profileValueAt,
  runsPath,
  type LongSectionStation,
} from './culvertLongSection'
import type { CulvertProfilePoint } from './engineeringTypes'

/** A 10 m barrel, inlet invert 100.0 falling to 99.8, rise 0.6, under a 4 m formation at 102. */
function profile(options: { inverts?: boolean; groundGap?: number[] } = {}): CulvertProfilePoint[] {
  const inverts = options.inverts ?? true
  return Array.from({ length: 11 }, (_, i) => {
    const d = i
    const invert = inverts ? 100 - 0.02 * d : i === 0 ? 100 : null
    return {
      distanceM: d,
      coordinate: [0, 0] as [number, number],
      groundElevation: options.groundGap?.includes(i) ? null : 100.5 - Math.abs(d - 5) * 0.05,
      formationElevation: d >= 3 && d <= 7 ? 102 : null,
      invertElevation: invert,
      crownElevation: invert === null ? null : invert + 0.6,
    }
  })
}

const design = { diameterM: 0.6, skewDegrees: 0 }

describe('culvertProfileMark', () => {
  it('reads the invert, crown and grade at the centreline from the engine samples', () => {
    const mark = culvertProfileMark(
      { chainage: 200, profile: profile() },
      design,
      (c) => c,
      (e) => -e * 10,
    )
    expect(mark.invertM).toBeCloseTo(99.9)
    expect(mark.crownM).toBeCloseTo(100.5)
    expect(mark.gradeM).toBe(102)
    expect(mark.centreCoverM).toBeCloseTo(1.5)
    expect(mark.alongRoadM).toBeCloseTo(0.6)
  })

  it('draws the opening to the profile scales, invert at its true level', () => {
    // 20 px per metre across, 200 px per metre up: 10× vertical exaggeration.
    const mark = culvertProfileMark(
      { chainage: 0, profile: profile() },
      design,
      (c) => c * 20,
      (e) => 1000 - e * 200,
    )
    expect(mark.opening?.toScale).toBe(true)
    expect(mark.opening?.width).toBeCloseTo(12)
    expect(mark.opening?.height).toBeCloseTo(120)
    expect(mark.opening?.invertY).toBeCloseTo(1000 - 99.9 * 200)
    expect(mark.cover?.crownY).toBeCloseTo(1000 - 100.5 * 200)
    expect(mark.cover?.gradeY).toBeCloseTo(1000 - 102 * 200)
  })

  it('widens a skewed barrel along the road by 1 / cos(skew)', () => {
    const mark = culvertProfileMark(
      { chainage: 0, profile: profile() },
      { ...design, skewDegrees: 60 },
      (c) => c,
      (e) => -e,
    )
    expect(mark.alongRoadM).toBeCloseTo(1.2)
  })

  it('keeps a legible least size and says it is not to scale', () => {
    // 1 px per metre across, 10 px per metre up: a 0.6 m pipe would be 0.6 × 6 px.
    const mark = culvertProfileMark(
      { chainage: 0, profile: profile() },
      design,
      (c) => c,
      (e) => -e * 10,
    )
    expect(mark.opening?.toScale).toBe(false)
    expect(mark.opening?.width).toBe(CULVERT_PROFILE_MIN_PX)
    expect(mark.opening?.height).toBe(CULVERT_PROFILE_MIN_PX)
    expect(mark.opening?.invertY).toBeCloseTo(-999)
  })

  it('draws no opening at a guessed depth when the inverts are not entered', () => {
    const mark = culvertProfileMark(
      { chainage: 0, profile: profile({ inverts: false }) },
      design,
      (c) => c,
      (e) => -e,
    )
    expect(mark.invertM).toBeNull()
    expect(mark.opening).toBeUndefined()
    expect(mark.cover).toBeUndefined()
  })

  it('takes a box span as its width', () => {
    const mark = culvertProfileMark(
      { chainage: 0, profile: profile() },
      { diameterM: 1.2, shape: 'box', spanM: 2.4, skewDegrees: 0 },
      (c) => c,
      (e) => -e,
    )
    expect(mark.shape).toBe('box')
    expect(mark.alongRoadM).toBeCloseTo(2.4)
    expect(mark.riseM).toBe(1.2)
  })
})

describe('profileValueAt', () => {
  it('never interpolates across a missing sample', () => {
    const p = profile({ groundGap: [5] })
    expect(profileValueAt(p, 'groundElevation', 4.5)).toBeNull()
    expect(profileValueAt(p, 'groundElevation', 3.5)).toBeCloseTo(100.425)
    expect(profileValueAt(p, 'groundElevation', 11)).toBeNull()
  })
})

const station = (chainage: number, base: number): LongSectionStation => ({
  chainage,
  bearing: 0,
  section: [
    { offset: -8, ground: null, design: null },
    { offset: -6, ground: 100, design: base - 2 },
    { offset: -2, ground: 100.4, design: base },
    { offset: 2, ground: 100.4, design: base },
    { offset: 6, ground: 100, design: base - 2 },
  ],
})

describe('culvertLongSection', () => {
  const culvert = { chainage: 200, bearing: 90, profile: profile(), coverM: 1.38, gradePercent: -2 }

  it('reads the design surface across the barrel, left inlet at a negative offset', () => {
    const drawing = culvertLongSection(culvert, [station(190, 102), station(210, 104)], 0.3)!
    expect(drawing).not.toBeNull()
    const surface = drawing.surface.flat()
    // At the centreline the two sections blend to 103; at the inlet (offset −5) halfway down the batter.
    expect(surface.find((p) => p.distanceM === 5)?.elevation).toBeCloseTo(103)
    expect(surface.find((p) => p.distanceM === 0)?.elevation).toBeCloseTo(101.5)
    expect(drawing.fill.length).toBe(1)
  })

  it('draws the minimum-cover line only over the formation, at crown plus the required cover', () => {
    const drawing = culvertLongSection(culvert, [station(200, 102)], 0.6)!
    const line = drawing.minimumCover.flat()
    expect(line.map((p) => p.distanceM)).toEqual([3, 4, 5, 6, 7])
    expect(line[0].elevation).toBeCloseTo(100 - 0.06 + 0.6 + 0.6)
  })

  it('marks the least-cover sample with the engine figure', () => {
    const drawing = culvertLongSection(culvert, [station(200, 102)], 0.6)!
    // The barrel falls, so the crown is highest at the inlet end of the formation.
    expect(drawing.leastCover?.distanceM).toBe(3)
    expect(drawing.leastCover?.coverM).toBe(1.38)
  })

  it('states the fall as a percent and as 1 in X', () => {
    const drawing = culvertLongSection(culvert, [station(200, 102)], 0.6)!
    expect(drawing.fall).toEqual({ percent: 2, oneIn: 50, falls: true })
    expect(drawing.inlet.invertM).toBe(100)
    expect(drawing.outlet.invertM).toBeCloseTo(99.8)
  })

  it('leaves gaps in the ground and marks no least cover when the engine has none', () => {
    const drawing = culvertLongSection(
      { ...culvert, profile: profile({ groundGap: [4, 5] }), coverM: null },
      [station(200, 102)],
      0.6,
    )!
    expect(drawing.ground.length).toBe(2)
    expect(drawing.ground[0].at(-1)?.distanceM).toBe(3)
    expect(drawing.ground[1][0].distanceM).toBe(6)
    expect(drawing.leastCover).toBeUndefined()
    expect(
      runsPath(
        drawing.ground,
        (d) => d,
        (e) => e,
      ).match(/M/g)?.length,
    ).toBe(2)
  })

  it('has no fall and no barrel when the inverts are not entered', () => {
    const drawing = culvertLongSection(
      { ...culvert, profile: profile({ inverts: false }), coverM: null, gradePercent: null },
      [station(200, 102)],
      0.6,
    )!
    expect(drawing.fall).toBeNull()
    expect(drawing.invert).toEqual([])
    expect(drawing.minimumCover).toEqual([])
    expect(drawing.outlet.invertM).toBeNull()
  })
})

describe('path helpers', () => {
  it('closes a band between two runs', () => {
    const top = [
      { distanceM: 0, elevation: 1 },
      { distanceM: 1, elevation: 1 },
    ]
    const bottom = [
      { distanceM: 0, elevation: 0 },
      { distanceM: 1, elevation: 0 },
    ]
    expect(
      bandPath(
        top,
        bottom,
        (d) => d,
        (e) => e,
      ),
    ).toBe('M0.0,1.0 L1.0,1.0 L1.0,0.0 L0.0,0.0 Z')
  })

  it('formats without a negative zero', () => {
    expect(fixed(-0.001, 2)).toBe('0.00')
    expect(fixed(1.234, 1)).toBe('1.2')
  })
})

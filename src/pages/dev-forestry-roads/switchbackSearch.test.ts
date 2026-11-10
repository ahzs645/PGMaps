import { describe, expect, it } from 'vitest'
import { corridorFrame } from './corridorOptimizer'
import { corridorCandidate } from './corridorCandidate'
import { alignmentLength, horizontalCurveSummary } from './engine'
import { hairpinLoop, sampleLoop, wrapAngle } from './hairpinLoop'
import { parseRouteSearchOptions } from './routing'
import {
  chordTolerance,
  DEFAULT_SWITCHBACK_ROUTE_OPTIONS,
  parseSwitchbackRouteOptions,
  sharpestSwitchbackDegrees,
  type SwitchbackRouteOptions,
} from './switchbackOptions'
import {
  describeSwitchbackFailure,
  searchSwitchbackRoute,
  searchSwitchbackRouteAsync,
  segmentsMeet,
  SwitchbackSearchError,
  switchbackPlaceText,
  type SwitchbackSearchOptions,
} from './switchbackSearch'
import { DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, ContextFeature, RoadSettings, TerrainSource } from './types'

const DEG = Math.PI / 180
const frame = corridorFrame([-122.8, 53.9])
const at = (x: number, y: number) => frame.fromXY([x, y])
/** Planes rising north, `500 + slope × y`, on a block of terrain like the reference runs' 600 m DTM. */
const plane = (slope: number, west = -100): TerrainSource => ({
  elevationAt(lng, lat) {
    const [x, y] = frame.toXY([lng, lat])
    return x < west || y < 0 || x > 600 || y > 600 ? NaN : 500 + slope * y
  },
})
const settings: RoadSettings = {
  stationInterval: 10,
  crossSectionHalfWidth: 30,
  maxGradePercent: 12,
  minRadius: 0,
  cutRate: 1,
  fillRate: 1,
  surfacingRate: 1,
  clearingRate: 1,
  shrinkFactor: 1,
}
/**
 * The reference runs' options (SylvaRoaD 2.2 defaults, 10 November 2026): R 8 m, 2–12 % grades with
 * the minimum refused, 3 m over 42 m pieces, 150 m turn and 80 m grade-change penalties, 40 m on side-hill
 * over 90 %, on 5 m cells.
 */
const reference: SwitchbackRouteOptions = {
  ...DEFAULT_SWITCHBACK_ROUTE_OPTIONS,
  allow: true,
  radiusM: 8,
  middleStraightM: 1,
  minGradePercent: 2,
  minGradeHard: true,
  gradeChangePenaltyM: 80,
  penaltyM: 0,
  sideHillBudgetM: 40,
}
const options = (rules: Partial<SwitchbackRouteOptions> = {}, more: Partial<SwitchbackSearchOptions> = {}) => ({
  objective: 'shortest' as const,
  corridorHalfWidthM: 400,
  rules: { ...reference, ...rules },
  cellM: 5,
  neighbourhoodM: 42,
  turnPenaltyM: 150,
  sideHillSlopePercent: 90,
  ...more,
})
const limits = (rules: SwitchbackRouteOptions, radiusM = rules.radiusM ?? 12) => ({
  maxGradePercent: 12,
  minRadiusM: 5,
  halfWidthM: 400,
  rules,
  radiusM,
  sideHillSlopePercent: 90,
})
const failureOf = (run: () => unknown) => {
  try {
    run()
  } catch (error) {
    if (error instanceof SwitchbackSearchError) return error
    throw error
  }
  throw Error('Expected the search to fail.')
}
const fallLine = [at(300, 100), at(300, 350)]

describe('switchback rules', () => {
  it('reproduces the sharpest stackable turn, spacing and platform radius of the specification', () => {
    expect(sharpestSwitchbackDegrees(12, 8)).toBeCloseTo(154.55, 2)
    expect(sharpestSwitchbackDegrees(10, 8)).toBeCloseTo(155.94, 2)
    expect(sharpestSwitchbackDegrees(12, 12)).toBeCloseTo(159.32, 2)
    expect(sharpestSwitchbackDegrees(15, 10)).toBeCloseTo(155.33, 2)
    // 3 m over a 42 m piece, in proportion for a 38.08 m one.
    expect(chordTolerance(3, 38.08)).toBeCloseTo(2.72, 2)
    expect(chordTolerance(3, 40)).toBeCloseTo(2.857, 3)
  })

  it('parses saved settings with limits and keeps older projects without them', () => {
    expect(parseSwitchbackRouteOptions({})).toEqual(DEFAULT_SWITCHBACK_ROUTE_OPTIONS)
    expect(parseSwitchbackRouteOptions({ allow: true, radiusM: 15 })).toMatchObject({ allow: true, radiusM: 15 })
    expect(() => parseSwitchbackRouteOptions({ radiusM: 2 })).toThrow(/switchback radius \(m\) from 5 to 200, or leave/)
    expect(() => parseSwitchbackRouteOptions({ platformSteepShare: 1.5 })).toThrow(/steep share/)
    expect(() => parseSwitchbackRouteOptions({ allow: 'yes' })).toThrow(/true or false/)
    expect(() => parseSwitchbackRouteOptions([])).toThrow(/must be an object/)
    expect('switchbacks' in parseRouteSearchOptions({})).toBe(false)
    expect(parseRouteSearchOptions({ switchbacks: { allow: true } }).switchbacks).toEqual({
      ...DEFAULT_SWITCHBACK_ROUTE_OPTIONS,
      allow: true,
    })
  })
})

describe('hairpinLoop', () => {
  // The reference run's hairpin: in on azimuth 293.2°, out on 66.8°, a right turn of 133.6°.
  const inHeading = (90 - 293.2) * DEG,
    outHeading = (90 - 66.8) * DEG

  it('comes round by exactly the vertex turn, on the outside, as one continuous line', () => {
    for (const [a, b] of [
      [inHeading, outHeading],
      [outHeading + Math.PI, inHeading + Math.PI],
    ]) {
      const loop = hairpinLoop([0, 0], a, b, 8, 1)!
      const swept = loop.parts.reduce((sum, part) => sum + (part.kind === 'arc' ? part.sweep : 0), 0)
      expect(wrapAngle(swept - loop.turn)).toBeCloseTo(0, 9)
      expect(Math.abs(loop.turn / DEG)).toBeCloseTo(133.6, 6)
      for (let i = 1; i < loop.parts.length; i++)
        expect(Math.hypot(...loop.parts[i].start.map((v, k) => v - loop.parts[i - 1].end[k]))).toBeLessThan(1e-9)
      // It leaves and joins the legs at the trim distance from the vertex.
      const first = loop.parts[0].start,
        last = loop.parts.at(-1)!.end
      expect(Math.hypot(...first)).toBeCloseTo(loop.trimM, 9)
      expect(Math.hypot(...last)).toBeCloseTo(loop.trimM, 9)
      // Round the outside: the far side of the loop is beyond the vertex, away from the legs' wedge.
      const outside = [Math.cos(a) - Math.cos(b), Math.sin(a) - Math.sin(b)]
      const reach = Math.max(...sampleLoop(loop, 0.5).map((s) => s.at[0] * outside[0] + s.at[1] * outside[1]))
      expect(reach).toBeGreaterThan(8)
    }
  })

  it('adds about the length the reference redraw added, and the road engine keeps every curve', () => {
    const loop = hairpinLoop([0, 0], inHeading, outHeading, 8, 1)!
    // The reference redraw took a 641 m route to 663 m: 22 m for one hairpin at R 8 m.
    expect(loop.lengthM - 2 * loop.trimM).toBeGreaterThan(20)
    expect(loop.lengthM - 2 * loop.trimM).toBeLessThan(28)
    const legIn: [number, number] = [-100 * Math.cos(inHeading), -100 * Math.sin(inHeading)],
      legOut: [number, number] = [100 * Math.cos(outHeading), 100 * Math.sin(outHeading)]
    const road: Alignment = {
      id: 'loop',
      name: 'Loop',
      color: '#000000',
      points: [
        { id: 'a', coordinate: frame.fromXY(legIn), radiusM: 0 },
        ...loop.points.map((p, i) => ({ id: `l${i}`, coordinate: frame.fromXY(p.at), radiusM: p.radiusM })),
        { id: 'b', coordinate: frame.fromXY(legOut), radiusM: 0 },
      ],
      vertical: [],
      template: { ...DEFAULT_TEMPLATE },
      overrides: [],
    }
    const curves = horizontalCurveSummary(road)
    expect(curves).toHaveLength(4)
    for (const curve of curves) expect(curve.radius).toBeCloseTo(8, 6)
    expect(alignmentLength(road)).toBeCloseTo(200 - 2 * loop.trimM + loop.lengthM, 2)
  })

  it('gives no loop for a turn too small to be a switchback', () => {
    expect(hairpinLoop([0, 0], 0, 10 * DEG, 8, 1)).toBeNull()
  })
})

describe('segmentsMeet', () => {
  it('finds crossings and touches, not near misses', () => {
    expect(segmentsMeet([0, 0], [10, 0], [5, -5], [5, 5])).toBe(true)
    expect(segmentsMeet([0, 0], [10, 0], [10, 0], [10, 5])).toBe(true)
    expect(segmentsMeet([0, 0], [10, 0], [5, 0.01], [5, 5])).toBe(false)
  })
})

describe('switchback search against the reference runs', () => {
  it('climbs a 30 % fall line through one switchback, as the reference run did', () => {
    const route = searchSwitchbackRoute(fallLine, plane(0.3), settings, [], options())
    // Reference run of SylvaRoaD 2.2, 10 November 2026: 18 pieces, 641 m, one hairpin of 133.6° at
    // (7.5, 222.5), grades 11.82 % and 11.14 %, redrawn 663 m with the loop at 6.78 %.
    expect(route.switchbacks).toHaveLength(1)
    const [turn] = route.switchbacks
    expect(turn.turnDegrees).toBeCloseTo(133.6, 1)
    expect(turn.turnDegrees).toBeLessThanOrEqual(sharpestSwitchbackDegrees(12, 8))
    const [x, y] = frame.toXY(turn.coordinate)
    expect(Math.abs(x - 7.5)).toBeLessThan(10)
    expect(Math.abs(y - 222.5)).toBeLessThan(10)
    expect(route.pieceLengthM).toBeGreaterThan(625)
    expect(Math.abs(route.pieceLengthM - 641) / 641).toBeLessThan(0.02)
    expect(Math.abs(route.lengthM - 663) / 663).toBeLessThan(0.02)
    expect(turn.turnGradePercent).toBeGreaterThan(5)
    expect(turn.turnGradePercent).toBeLessThan(8)
    expect(turn.platformSteepShare).toBe(0)
    for (const piece of route.pieces) {
      expect(Math.abs(piece.gradePercent)).toBeGreaterThanOrEqual(2)
      expect(Math.abs(piece.gradePercent)).toBeLessThanOrEqual(12 + 1e-9)
    }
    // The drawn road is what the engine builds: every curve kept, the length reproduced.
    const road = corridorCandidate(route, { ...DEFAULT_TEMPLATE }, 'Switchback', () => 'id')
    expect(horizontalCurveSummary(road).length).toBe(route.controlPoints.filter((p) => p.radiusM > 0).length)
    expect(alignmentLength(road)).toBeCloseTo(route.lengthM, 3)
  }, 60_000)

  it('needs a second switchback when the loop has no room at the edge of the terrain', () => {
    // The reference run's 600 m DTM and a ±300 m corridor: its hairpin sat 7.5 m from the edge, but a
    // loop of R 8 m and its platform circle must be on mapped ground inside the corridor.
    const route = searchSwitchbackRoute(fallLine, plane(0.3, 0), settings, [], options({}, { corridorHalfWidthM: 300 }))
    expect(route.switchbacks).toHaveLength(2)
    expect(Math.abs(route.pieceLengthM - 641) / 641).toBeLessThan(0.02)
  }, 60_000)

  it('follows the contour case without a switchback', () => {
    const route = searchSwitchbackRoute([at(150, 300), at(450, 366.7)], plane(0.3), settings, [], options())
    // Reference: 10 pieces, 308 m, no hairpin, 7.28 % then 5.88 %.
    expect(route.switchbacks).toHaveLength(0)
    expect(Math.abs(route.pieceLengthM - 308)).toBeLessThan(5)
    const grades = new Set(route.pieces.slice(0, -1).map((p) => p.gradePercent.toFixed(2)))
    expect([...grades].sort()).toEqual(['5.88', '7.28'])
  }, 30_000)

  it('says a 60 % face needs a switchback when none are allowed', () => {
    const rules = { ...reference, allow: false }
    const error = failureOf(() => searchSwitchbackRoute(fallLine, plane(0.6), settings, [], options(rules)))
    expect(error.failure.reason).toBe('no-candidate')
    expect(error.failure.stopped.hairpinOff).toBeGreaterThan(0)
    expect(describeSwitchbackFailure(error.failure, limits(rules))).toMatch(
      /^The ends are 250 m apart and 150 m apart in height \(60%\): at 12% the road is at least 1,250 m long\. No line within 12% reaches the end without a switchback: .* It needs a switchback, and none are allowed: it would have turned back .* of the road's start\. Turn on Allow switchbacks under Search settings → Switchbacks\.$/,
    )
  }, 30_000)

  it('names the switchback rule that stops a 60 % face, and finds the road once the rules allow it', () => {
    // R 8 m: the legs meet at about 157°, sharper than the 154.55° they can be stacked through.
    const sharp = failureOf(() => searchSwitchbackRoute(fallLine, plane(0.6), settings, [], options()))
    expect(describeSwitchbackFailure(sharp.failure, limits(reference))).toMatch(
      /Every switchback it tried was refused, [\d,]+ of them because a switchback .* would turn 15\d\.\d°, sharper than the 154\.5° a 12% road can stack at R 8 m\. Use a larger switchback radius\.$/,
    )
    // R 12 m stacks them, but no platform: all the ground is steeper than 55 %.
    const wider = { ...reference, radiusM: 12 }
    const steep = failureOf(() => searchSwitchbackRoute(fallLine, plane(0.6), settings, [], options(wider)))
    expect(describeSwitchbackFailure(steep.failure, limits(wider))).toMatch(
      /because the platform is too steep .*: 100% of the ground within 15\.0 m is steeper than 55%, and at most 25% may be\./,
    )
    // With a 65 % platform limit the face is climbed: 1,250 m at least, through three switchbacks.
    const route = searchSwitchbackRoute(
      fallLine,
      plane(0.6),
      settings,
      [],
      options({ ...wider, platformSlopePercent: 65 }),
    )
    expect(route.switchbacks.length).toBeGreaterThanOrEqual(2)
    expect(route.pieceLengthM).toBeGreaterThan(1250)
    for (const turn of route.switchbacks)
      expect(turn.turnDegrees).toBeLessThanOrEqual(sharpestSwitchbackDegrees(12, 12))
  }, 60_000)
})

describe('switchback search rules', () => {
  const gentle = (slope: number): TerrainSource => ({
    elevationAt: (lng, lat) => 500 + slope * frame.toXY([lng, lat])[1],
  })

  it('refuses or charges pieces flatter than the minimum grade', () => {
    const flat = gentle(0)
    const ends = [at(0, 0), at(200, 0)]
    const hard = failureOf(() =>
      searchSwitchbackRoute(ends, flat, settings, [], options({}, { corridorHalfWidthM: 60 })),
    )
    expect(hard.failure.stopped.minGrade).toBeGreaterThan(0)
    expect(describeSwitchbackFailure(hard.failure, limits(reference))).toMatch(/stopped by the 2% minimum grade/)
    const soft = searchSwitchbackRoute(
      ends,
      flat,
      settings,
      [],
      options({ minGradeHard: false }, { corridorHalfWidthM: 60 }),
    )
    expect(soft.underMinimumGradeM).toBeCloseTo(soft.pieceLengthM, 6)
  }, 30_000)

  it('keeps side-hill within its budget', () => {
    const ends = [at(150, 300), at(450, 366.7)]
    const none = failureOf(() =>
      searchSwitchbackRoute(
        ends,
        plane(0.3),
        settings,
        [],
        options({ sideHillBudgetM: 0 }, { sideHillSlopePercent: 25 }),
      ),
    )
    expect(none.failure.stopped.sideHill).toBeGreaterThan(0)
    const some = searchSwitchbackRoute(
      ends,
      plane(0.3),
      settings,
      [],
      options({ sideHillBudgetM: 500 }, { sideHillSlopePercent: 25 }),
    )
    expect(some.sideHillM).toBeGreaterThan(250)
    expect(some.sideHillM).toBeLessThanOrEqual(500)
  }, 30_000)

  it('reads micro-relief through the ground trend, and the straight-grade limit on the source', () => {
    // A 6 % plane with ±0.3 m alternating relief on 1 m cells.
    const rough: TerrainSource = {
      elevationAt(lng, lat) {
        const [x, y] = frame.toXY([lng, lat])
        return 500 + 0.06 * y + 0.3 * (Math.floor(x) % 2 ? 1 : -1) * (Math.floor(y) % 2 ? 1 : -1)
      },
    }
    const ends = [at(0, 0), at(0, 150)]
    const tight = { chordCutFillM: 0.1, minGradePercent: 0 }
    const raw = failureOf(() =>
      searchSwitchbackRoute(
        ends,
        rough,
        settings,
        [],
        options(tight, { corridorHalfWidthM: 60, cellM: 2.5, neighbourhoodM: 20 }),
      ),
    )
    expect(raw.failure.stopped.chord).toBeGreaterThan(0)
    const trend = searchSwitchbackRoute(
      ends,
      rough,
      settings,
      [],
      options(tight, { corridorHalfWidthM: 60, cellM: 2.5, neighbourhoodM: 20, groundWindowM: 12 }),
    )
    expect(trend.switchbacks).toHaveLength(0)
    expect(trend.pieceLengthM).toBeLessThan(160)
  }, 60_000)

  it('passes compulsory points within their tolerance', () => {
    const ground = gentle(0.03)
    const guide = [at(0, 0), at(100, 80), at(200, 0)]
    const near = (route: ReturnType<typeof searchSwitchbackRoute>) =>
      Math.min(...route.coordinates.map((c) => Math.hypot(...frame.toXY(c).map((v, i) => v - [100, 80][i]))))
    const free = searchSwitchbackRoute(
      guide,
      ground,
      settings,
      [],
      options({ minGradePercent: 0 }, { corridorHalfWidthM: 100 }),
    )
    expect(near(free)).toBeGreaterThan(40)
    const passing = searchSwitchbackRoute(
      guide,
      ground,
      settings,
      [],
      options({ minGradePercent: 0, passPointsWithinM: 10 }, { corridorHalfWidthM: 100 }),
    )
    expect(near(passing)).toBeLessThanOrEqual(10)
  }, 30_000)

  it('goes round a blocked area and stops at a gap in the terrain', () => {
    const ground = gentle(0.03)
    const block: ContextFeature = {
      id: 'block',
      name: 'Block',
      kind: 'avoid',
      geometry: { type: 'Polygon', coordinates: [[at(80, -30), at(120, -30), at(120, 30), at(80, 30), at(80, -30)]] },
    }
    const route = searchSwitchbackRoute(
      [at(0, 0), at(200, 0)],
      ground,
      settings,
      [block],
      options({ minGradePercent: 0 }, { corridorHalfWidthM: 100 }),
    )
    for (const c of route.coordinates) {
      const [x, y] = frame.toXY(c)
      expect(x > 80 && x < 120 && y > -30 && y < 30).toBe(false)
    }
    const gap: TerrainSource = {
      elevationAt: (lng, lat) => (Math.abs(frame.toXY([lng, lat])[0] - 100) < 4 ? NaN : 500),
    }
    const stopped = failureOf(() =>
      searchSwitchbackRoute(
        [at(0, 0), at(200, 0)],
        gap,
        settings,
        [],
        options({ minGradePercent: 0 }, { corridorHalfWidthM: 60 }),
      ),
    )
    expect(stopped.failure.stopped.terrain).toBeGreaterThan(0)
    expect(describeSwitchbackFailure(stopped.failure, limits(reference))).toMatch(/gaps in the terrain/)
  }, 30_000)

  it('stops at its next slice when cancelled', async () => {
    const controller = new AbortController()
    const run = searchSwitchbackRouteAsync(fallLine, plane(0.3), settings, [], options(), {
      signal: controller.signal,
      sliceMs: 1,
      onProgress: () => controller.abort(),
    })
    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
  }, 30_000)

  it('names places from the nearer end', () => {
    expect(switchbackPlaceText([-290, 200], [0, 250])).toBe("290 m west of the road's end")
    expect(switchbackPlaceText([-150, 20], [0, 250])).toBe("150 m west of the road's start")
    expect(switchbackPlaceText([5, 5], [0, 250])).toBe("at the road's start")
  })
})

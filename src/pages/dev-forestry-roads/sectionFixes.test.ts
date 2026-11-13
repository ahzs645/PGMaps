import { describe, expect, it } from 'vitest'
import { formatRoadStation } from './Charts'
import { analyzeRoad, offsetCoordinate } from './engine'
import { createEngineeringDesign } from './engineeringTypes'
import { incompleteStretches, steepFillPlan, stretchFixes } from './sectionFixes'
import type { Alignment, Coordinate, RoadSettings } from './types'

const origin: Coordinate = [-121.55, 54.07]
const settings: RoadSettings = {
  stationInterval: 10,
  crossSectionHalfWidth: 35,
  maxGradePercent: 12,
  minRadius: 25,
  cutRate: 12,
  fillRate: 8,
  surfacingRate: 40,
  clearingRate: 1.5,
  shrinkFactor: 0.9,
}
/** A road north up a sidehill that falls to the east (the road's right) at `fall` m per m, as on the reference block. */
function sidehill(fall: number) {
  const metresPerDegree = 111_320 * Math.cos((origin[1] * Math.PI) / 180)
  return { elevationAt: (lon: number) => 900 - fall * (lon - origin[0]) * metresPerDegree }
}
function road(): Alignment {
  return {
    id: 'road',
    name: 'TPY-like',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: offsetCoordinate(origin, 0, 200), radiusM: 0 },
    ],
    // No vertical design: the formation follows the ground at the centreline, as the imported roads do.
    vertical: [],
    template: {
      leftWidth: 3,
      rightWidth: 3,
      crossfallPercent: 3,
      cutSlope: 0.75,
      fillSlope: 1.5,
      ditchWidth: 1,
      ditchDepth: 0.5,
      surfaceDepth: 0.25,
    },
    overrides: [],
    engineering: createEngineeringDesign(),
  }
}
let n = 0
const options = { id: () => `id-${++n}`, stationLabel: formatRoadStation }

describe('why sections are incomplete, and what closes them', () => {
  it('finds a fill parallel to a 69 % sidehill, where no reach helps, a full bench leads and a 1:1 fill closes it', () => {
    const analysis = analyzeRoad(road(), sidehill(0.69), settings)
    const stretches = incompleteStretches(analysis.stations, road())
    expect(stretches).toHaveLength(1)
    const [stretch] = stretches
    expect(stretch).toMatchObject({
      from: 0,
      to: 200,
      side: 'right',
      batter: 'fill',
      cause: 'reach',
      reachNeededM: null,
    })
    expect(stretch.stations).toBe(analysis.stations.length)
    expect(stretch.groundPercent).toBeCloseTo(69, 0)
    expect(stretch.batterPercent).toBeCloseTo(66.7, 1)
    // 69 % is past the 60 % full-bench screen: full bench leads, the 1:1 fill stays as the stopgap.
    expect(stretchFixes(stretch)).toEqual([{ kind: 'full-bench' }, { kind: 'steep-fill', slopePercent: 100 }])
    expect(stretchFixes({ ...stretch, groundPercent: 55 })).toEqual([{ kind: 'steep-fill', slopePercent: 100 }])

    const planned = steepFillPlan(road(), stretches, analysis.length, options)
    if ('error' in planned) throw Error(planned.error)
    expect(planned.templates).toBe(1)
    const [range] = planned.alignment.engineering!.assignments
    expect([range.start, range.end, range.side]).toEqual([0, expect.closeTo(200, 6), 'both'])
    const after = analyzeRoad(planned.alignment, sidehill(0.69), settings)
    expect(after.stations.every((s) => s.complete)).toBe(true)
  })

  it('covers a mid-road stretch through its end stations', () => {
    // Steep only between 60 and 140 m up the road, gentle elsewhere.
    const metresPerDegree = 111_320 * Math.cos((origin[1] * Math.PI) / 180)
    const patchy = {
      elevationAt: (lon: number, lat: number) => {
        const north = (lat - origin[1]) * 110_540
        const fall = north >= 55 && north <= 145 ? 0.69 : 0.3
        return 900 - fall * (lon - origin[0]) * metresPerDegree
      },
    }
    const analysis = analyzeRoad(road(), patchy, settings)
    const stretches = incompleteStretches(analysis.stations, road())
    expect(stretches.map((s) => [s.from, s.to])).toEqual([[60, 140]])
    const planned = steepFillPlan(road(), stretches, analysis.length, options)
    if ('error' in planned) throw Error(planned.error)
    expect(planned.alignment.engineering!.assignments).toMatchObject([{ start: 50, end: 150 }])
    const [template] = planned.alignment.engineering!.templates
    expect([template.template.rightFillSlope, template.template.leftFillSlope, template.template.fillSlope]).toEqual([
      1,
      undefined,
      1.5,
    ])
    const after = analyzeRoad(planned.alignment, patchy, settings)
    expect(after.stations.filter((s) => !s.complete).map((s) => [s.chainage, s.incompleteReasons])).toEqual([])
  })

  it('joins fill ranges less than 50 m apart, so the toe does not step back and forth', () => {
    const stretch = (from: number, to: number, rangeFrom: number, rangeTo: number) => ({
      from,
      side: 'right' as const,
      rangeFrom,
      rangeTo,
      to,
    })
    const planned = steepFillPlan(
      road(),
      [stretch(20, 40, 10, 50), stretch(80, 90, 70, 100), stretch(170, 180, 160, 190)],
      200,
      options,
    )
    if ('error' in planned) throw Error(planned.error)
    expect(planned.alignment.engineering!.assignments.map((a) => [a.start, a.end])).toEqual([
      [10, 100],
      [160, 190],
    ])
    expect(planned.templates).toBe(1)
  })

  it('offers the reach a converging batter needs, and only that', () => {
    const short = { ...settings, crossSectionHalfWidth: 8 }
    const analysis = analyzeRoad(road(), sidehill(0.55), short)
    const [stretch] = incompleteStretches(analysis.stations, road())
    expect(stretch.reachNeededM).not.toBeNull()
    const fixes = stretchFixes(stretch)
    const reach = fixes.find((f) => f.kind === 'reach')
    expect(reach).toBeDefined()
    // The offered reach closes every station.
    const reachM = (reach as { reachM: number }).reachM
    expect(
      analyzeRoad(road(), sidehill(0.55), { ...short, crossSectionHalfWidth: reachM }).stations.every(
        (s) => s.complete,
      ),
    ).toBe(true)
  })

  it('calls for a full bench where the ground is steeper than any fill', () => {
    const analysis = analyzeRoad(road(), sidehill(1.2), settings)
    const fill = incompleteStretches(analysis.stations, road()).find((s) => s.batter === 'fill')!
    expect(fill.groundPercent).toBeGreaterThan(100)
    expect(stretchFixes(fill)).toEqual([{ kind: 'full-bench' }])
  })

  it('leaves a road with template ranges in the stretch to Use this section for…', () => {
    const analysis = analyzeRoad(road(), sidehill(0.69), settings)
    const stretches = incompleteStretches(analysis.stations, road())
    const ranged = road()
    ranged.engineering!.templates = [{ id: 't', name: 'Wide', template: { ...ranged.template, rightWidth: 4 } }]
    ranged.engineering!.assignments = [{ id: 'r', templateId: 't', side: 'both', start: 50, end: 80, transitionM: 0 }]
    const planned = steepFillPlan(ranged, stretches, analysis.length, options)
    expect(planned).toEqual({ error: expect.stringMatching(/already has template ranges/) })
  })
})

import { describe, expect, it } from 'vitest'
import { HAUL_DESTINATION_PRESETS } from './haulDestination'
import { createHaulSettings, parseHaulSettings, reviewRoadHaul, type HaulDestinationSettings } from './haulReview'
import { junctionTurnRow } from './readiness'
import type { ContextFeature, Coordinate } from './types'

const RAD = Math.PI / 180,
  R = 6371008.8
const origin: Coordinate = [-122, 54]
const point = (x: number, y: number): Coordinate => [
  origin[0] + x / (R * RAD * Math.cos(origin[1] * RAD)),
  origin[1] + y / (R * RAD),
]
const mapped = (id: string, ...xy: [number, number][]): ContextFeature => ({
  id,
  name: id,
  kind: 'existing-road',
  geometry: { type: 'LineString', coordinates: xy.map(([x, y]) => point(x, y)) },
  roadEvidence: {
    source: 'user',
    roadClass: 'fsr',
    condition: 'unknown',
    conditionBasis: 'unreviewed',
    reuseAllowed: false,
  },
})
/** A 10 km FSR running east, and a road 4 km north that only widens the loaded extent. */
const context = [mapped('Main FSR', [0, 0], [10000, 0]), mapped('Far road', [0, 4000], [10000, 4000])]
const road = (id: string, ...xy: [number, number][]) => ({
  id,
  name: id,
  points: xy.map(([x, y]) => ({ coordinate: point(x, y) })),
})
const east: HaulDestinationSettings = createHaulSettings({ id: 'town', name: 'Town', coordinate: point(50000, 0) })
const review = (alignment: ReturnType<typeof road>, settings: HaulDestinationSettings | undefined = east) =>
  reviewRoadHaul({ context, alignments: [alignment], haulDestination: settings }, alignment)

describe('haul destination settings', () => {
  it('round-trips through the project file and fills defaults for an older or partial record', () => {
    const settings = { ...createHaulSettings(HAUL_DESTINATION_PRESETS[0]), offNetworkFactor: 1.5 }
    expect(parseHaulSettings(JSON.parse(JSON.stringify(settings)))).toEqual(settings)
    expect(parseHaulSettings({})).toEqual(createHaulSettings())
    const partial = parseHaulSettings({ speeds: { fsr: { loadedKmh: null, emptyKmh: 60 } } })
    expect(partial.speeds.fsr).toEqual({ loadedKmh: null, emptyKmh: 60 })
    expect(partial.speeds.proposed).toEqual(createHaulSettings().speeds.proposed)
  })

  it('refuses values outside their limits', () => {
    expect(() => parseHaulSettings({ speeds: { fsr: { loadedKmh: 0, emptyKmh: 50 } } })).toThrow('between 1 and 120')
    expect(() => parseHaulSettings({ terminal: { loadMin: -1 } })).toThrow('between 0 and 600')
    expect(() => parseHaulSettings({ offNetworkFactor: 0.5 })).toThrow('between 1 and 3')
    expect(() => parseHaulSettings({ destination: { id: 'x', name: 'X', coordinate: [0] } })).toThrow('longitude')
  })
})

describe('junction turn on the Review list', () => {
  it('is not assessed until a destination is chosen', () => {
    const row = junctionTurnRow(review(road('r', [4800, 200], [5000, 0]), createHaulSettings()))
    expect(row.state).toBe('not-assessed')
    expect(row.action?.target).toBe('haul-destination')
  })

  it('is met when the road is swept toward the destination, and needs attention when it is not', () => {
    const swept = review(road('swept', [4800, 200], [5000, 0]))
    expect(swept.status).toBe('assessed')
    if (swept.status !== 'assessed') return
    expect(swept.junction.end).toBe('end')
    expect(swept.loadedDirection).toBe('start-to-end')
    expect(swept.junction.measure!.turnDeg).toBeCloseTo(45, 0)
    expect(swept.junction.route.oneWayM).toBeGreaterThan(40000)
    expect(swept.junction.route.cycleMin).not.toBeNull()
    expect(junctionTurnRow(swept).state).toBe('met')

    const back = review(road('back', [5200, 200], [5000, 0]))
    const row = junctionTurnRow(back)
    expect(row.state).toBe('attention')
    expect(row.severity).toBe('limit')
    expect(row.result).toContain('135°')
  })

  it('finds the junction at the road start, with loaded travel back toward it', () => {
    const fromStart = review(road('start', [5000, 0], [4800, 200]))
    if (fromStart.status !== 'assessed') throw Error('Expected an assessed road.')
    expect(fromStart.junction.end).toBe('start')
    expect(fromStart.loadedDirection).toBe('end-to-start')
    expect(fromStart.junction.measure!.turnDeg).toBeCloseTo(45, 0)
  })

  it('is not assessed for a road that meets no loaded road', () => {
    const loose = review(road('loose', [4800, 600], [5000, 400]))
    expect(loose.status).toBe('no-junction')
    expect(junctionTurnRow(loose).state).toBe('not-assessed')
  })

  it('treats another road of the project as a host, so a branch is judged toward its parent', () => {
    const parent = road('parent', [5000, 0], [5000, 1000])
    // The branch leaves the parent at 800 m and runs north-east; loaded trucks head back south.
    const branch = road('branch', [5300, 1200], [5000, 800])
    const result = reviewRoadHaul({ context, alignments: [parent, branch], haulDestination: east }, branch)
    if (result.status !== 'assessed') throw Error('Expected an assessed branch.')
    expect(result.junction.route.joinedRoad).toBe('parent')
    expect(result.junction.route.departureBearing).toBeCloseTo(180, 0)
    expect(result.junction.measure!.turnDeg).toBeCloseTo(37, 0)
    expect(result.junction.route.legs[0].roadClass).toBe('proposed')
  })
})

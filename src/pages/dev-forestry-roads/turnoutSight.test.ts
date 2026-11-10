import { describe, expect, it } from 'vitest'
import { analyzeRoad, offsetCoordinate } from './engine'
import { turnoutSightRow } from './readiness'
import { sightPlanFeatures } from './sightPresentation'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import {
  needsTurnouts,
  reviewTurnoutSight,
  TURNOUT_MAX_SPACING_M,
  turnoutPlaces,
  TURNOUT_SINGLE_LANE_MAX_WIDTH_M,
} from './turnoutSight'
import type { Alignment, Coordinate, TerrainSource, WidthOverride } from './types'

const origin: Coordinate = [-122.75, 53.917]
const at = (east: number, northing: number) =>
  offsetCoordinate(origin, (Math.atan2(east, northing) * 180) / Math.PI, Math.hypot(east, northing))
const local = (lon: number, lat: number) => ({
  north: (((lat - origin[1]) * Math.PI) / 180) * 6371008.8,
  east: (((lon - origin[0]) * Math.PI) / 180) * 6371008.8 * Math.cos((origin[1] * Math.PI) / 180),
})
const flat: TerrainSource = { elevationAt: () => 800 }
/** A 15 m knoll inside the right turn, 30 m across from the curve's centre; the road stays level. */
const knoll: TerrainSource = {
  elevationAt: (lon, lat) => {
    const p = local(lon, lat)
    return 800 + (Math.hypot(p.east - 40, p.north - 170) < 30 ? 15 : 0)
  },
}

const turnout = (id: string, start: number, end = start + 30): WidthOverride => ({
  id,
  name: `Turnout ${id}`,
  kind: 'turnout',
  start,
  end,
  taper: 7.5,
  side: 'right',
  extraWidth: 4,
})
/** North 200 m, a right turn of radius 40, then east-north-east: about 390 m in all. */
const road = (overrides: WidthOverride[], patch: Partial<Alignment> = {}): Alignment => ({
  id: 'spur',
  name: 'Spur',
  color: '#16817a',
  points: [
    { id: 'a', coordinate: at(0, 0), radiusM: 0 },
    { id: 'b', coordinate: at(0, 200), radiusM: 40 },
    { id: 'c', coordinate: at(200, 260), radiusM: 0 },
  ],
  vertical: [],
  template: { ...DEFAULT_TEMPLATE },
  overrides,
  ...patch,
})
const review = (alignment: Alignment, terrain: TerrainSource) =>
  reviewTurnoutSight({ analysis: analyzeRoad(alignment, terrain, DEFAULT_ROAD_SETTINGS), alignment })
const row = (alignment: Alignment, terrain: TerrainSource) =>
  turnoutSightRow({ alignment, analysis: analyzeRoad(alignment, terrain, DEFAULT_ROAD_SETTINGS) })

describe('turnout intervisibility (BC Engineering Manual §3.5.2.6)', () => {
  it('cites the manual’s numbers', () => {
    expect(TURNOUT_MAX_SPACING_M).toBe(300)
    expect(TURNOUT_SINGLE_LANE_MAX_WIDTH_M).toBe(8)
  })
  it('stands each turnout at the middle of its full width, in station order, and skips landings', () => {
    const places = turnoutPlaces(
      [
        turnout('b', 200),
        { ...turnout('l', 50), kind: 'landing' },
        turnout('a', 20, 50),
        { ...turnout('off', 500), start: 500, end: 530 },
      ],
      390,
    )
    expect(places.map((p) => [p.id, p.chainage])).toEqual([
      ['a', 35],
      ['b', 215],
    ])
  })
  it('applies to a road under 8 m unless Sight distance says otherwise', () => {
    expect(needsTurnouts({ template: { ...DEFAULT_TEMPLATE } })).toBe(true)
    expect(needsTurnouts({ template: { ...DEFAULT_TEMPLATE, leftWidth: 4, rightWidth: 4 } })).toBe(false)
    expect(needsTurnouts({ template: { ...DEFAULT_TEMPLATE }, sightDistance: { singleLane: false } })).toBe(false)
    expect(
      review(road([turnout('a', 20), turnout('b', 150)], { sightDistance: { singleLane: false } }), flat).status,
    ).toBe('two-lane')
  })
  it('sees from turnout to turnout over open ground, both ways', () => {
    const result = review(road([turnout('a', 20), turnout('b', 150), turnout('c', 300)]), flat)
    expect(result.status).toBe('checked')
    expect(result.pairs).toHaveLength(2)
    expect(result.pairs.every((pair) => pair.intervisible && pair.ahead === 'clear' && pair.back === 'clear')).toBe(
      true,
    )
    expect(result.pairs.map((pair) => Math.round(pair.spacingM))).toEqual([130, 150])
    const met = row(road([turnout('a', 20), turnout('b', 150), turnout('c', 300)]), flat)!
    expect(met.state).toBe('met')
    expect(met.result).toBe('All 3 turnouts see the next one and are within 300 m')
    expect(met.judgedOn).toMatch(/Engineering Manual §3\.5\.2\.6/)
  })
  it('finds the knoll on the inside of the turn between two turnouts', () => {
    const alignment = road([turnout('a', 140), turnout('b', 260)])
    const result = review(alignment, knoll)
    const [pair] = result.pairs
    expect(pair.intervisible).toBe(false)
    expect(pair.ahead).toBe('surface')
    // The knoll is inside the right turn: right of the centreline, off the road.
    expect(pair.blocking!.offset).toBeGreaterThan(8)
    expect(pair.blocking!.aboveLineM).toBeGreaterThan(13)
    const failed = row(alignment, knoll)!
    expect(failed.state).toBe('attention')
    expect(failed.severity).toBe('limit')
    expect(failed.result).toBe('1 pair of turnouts cannot see each other')
    expect(failed.action).toMatchObject({ target: 'profile', chainage: pair.from.chainage })
    const lines = sightPlanFeatures(null, result).features
    expect(lines.filter((f) => f.properties?.role === 'turnout-sight').map((f) => f.properties?.state)).toEqual([
      'blocked',
    ])
    expect(lines.filter((f) => f.properties?.role === 'turnout')).toHaveLength(2)
  })
  it('flags turnouts more than 300 m apart even when they see each other', () => {
    const alignment = road([turnout('a', 0), turnout('b', 330)], {
      points: [
        { id: 'a', coordinate: at(0, 0), radiusM: 0 },
        { id: 'b', coordinate: at(0, 400), radiusM: 0 },
      ],
    })
    const result = row(alignment, flat)!
    expect(result.state).toBe('attention')
    expect(result.result).toBe('1 pair more than 300 m apart')
  })
  it('is unknown where the line crosses missing terrain, and left out with fewer than two turnouts', () => {
    const holed: TerrainSource = {
      elevationAt: (lon, lat) => {
        const { east, north } = local(lon, lat)
        return east > 8 && north > 150 && north < 260 ? NaN : 800
      },
    }
    const alignment = road([turnout('a', 140), turnout('b', 290)])
    expect(review(alignment, holed).pairs[0].intervisible).toBeNull()
    const unknown = row(alignment, holed)!
    expect(unknown.state).toBe('not-assessed')
    expect(unknown.result).toMatch(/unknown for 1 pair/)
    expect(row(road([turnout('a', 140)]), flat)).toBeNull()
    expect(row(road([]), flat)).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { distance, offsetCoordinate } from './engine'
import {
  addPegLeg,
  DEFAULT_PEG_TOOL,
  isSecondClickOfDouble,
  MAX_PEG_TOOL_LEGS,
  PEG_LEG_COLORS,
  pegChainEnd,
  pegChainFeatures,
  pegChainSummary,
  pegLegClass,
  pegLegLabel,
  pegToolSettingsError,
  removeLastPegLeg,
  solvePegCursor,
  type PegChain,
} from './pegCursor'
import { pegBearing } from './pegging'
import type { Coordinate, TerrainSource } from './types'

const origin: Coordinate = [-122.8, 53.9]
const northing = (latitude: number) => (((latitude - origin[1]) * Math.PI) / 180) * 6371008.8
// A plane rising 20 % to the north.
const slope: TerrainSource = { elevationAt: (_lng, lat) => 800 + 0.2 * northing(lat) }
const LIMIT = 18

describe('the leg under the cursor', () => {
  it('holds the target grade at the step, on the heading nearest the cursor', () => {
    const cursor = offsetCoordinate(origin, 40, 100)
    const result = solvePegCursor(origin, cursor, { ...DEFAULT_PEG_TOOL, gradePercent: 10, stepM: 50 }, slope, LIMIT)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(distance(origin, result.leg.end)).toBeCloseTo(50, 5)
    expect(result.leg.measurement.grade).toBeCloseTo(10, 2)
    // cos(bearing) = 0.5 on a 20 % plane: 60° from north, so it swung 20° clockwise from the cursor.
    expect(result.leg.measurement.bearing).toBeCloseTo(60, 1)
    expect(result.swingDeg).toBeCloseTo(20, 1)
    expect(result.legClass).toBe('up')
    expect(pegLegLabel(result, LIMIT)).toBe('+10.0 % · 50.0 m')
  })
  it('pegs down the slope when the direction is down', () => {
    const cursor = offsetCoordinate(origin, 150, 60)
    const result = solvePegCursor(
      origin,
      cursor,
      { ...DEFAULT_PEG_TOOL, direction: 'down', gradePercent: 8 },
      slope,
      LIMIT,
    )
    expect(result.ok && result.leg.measurement.grade).toBeCloseTo(-8, 2)
    expect(result.ok && result.legClass).toBe('down')
  })
  it('goes straight to the cursor when asked, and colours a leg over the limit', () => {
    const cursor = offsetCoordinate(origin, 0, 40)
    const result = solvePegCursor(origin, cursor, DEFAULT_PEG_TOOL, slope, LIMIT, { straight: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.leg.end).toEqual(cursor)
    expect(result.leg.straight).toBe(true)
    expect(result.leg.measurement.grade).toBeCloseTo(20, 3)
    expect(result.legClass).toBe('over')
    expect(pegLegLabel(result, LIMIT)).toBe('+20.0 % · 40.0 m · straight · over 18.0 %')
  })
  it('says the grade is out of reach, with the ground grades it found, and places nothing', () => {
    const result = solvePegCursor(
      origin,
      offsetCoordinate(origin, 0, 50),
      { ...DEFAULT_PEG_TOOL, gradePercent: 25 },
      slope,
      LIMIT,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('unreachable')
    expect(result.message).toContain('+25.0 % at 30 m')
    expect(result.message).toContain('+20.0 %')
    expect('leg' in result).toBe(false)
  })
  it('says when there is no ground ahead or under the last peg', () => {
    const island: TerrainSource = {
      elevationAt: (lng, lat) => (distance(origin, [lng, lat]) < 10 ? slope.elevationAt(lng, lat) : Number.NaN),
    }
    const ahead = solvePegCursor(origin, offsetCoordinate(origin, 0, 50), DEFAULT_PEG_TOOL, island, LIMIT)
    expect(!ahead.ok && ahead.reason).toBe('no-ground')
    const off = solvePegCursor(offsetCoordinate(origin, 0, 500), origin, DEFAULT_PEG_TOOL, island, LIMIT)
    expect(!off.ok && off.reason).toBe('origin-off-terrain')
  })
  it('says when every leg at the grade crosses a gap', () => {
    const ring: TerrainSource = {
      elevationAt: (lng, lat) => {
        const d = distance(origin, [lng, lat])
        return d > 10 && d < 20 ? Number.NaN : slope.elevationAt(lng, lat)
      },
    }
    const result = solvePegCursor(
      origin,
      offsetCoordinate(origin, 40, 60),
      { ...DEFAULT_PEG_TOOL, gradePercent: 10 },
      ring,
      LIMIT,
    )
    expect(!result.ok && result.reason).toBe('gap')
  })
  it('refuses settings out of range and a cursor on the peg', () => {
    expect(pegToolSettingsError({ ...DEFAULT_PEG_TOOL, stepM: 0.5 })).toMatch(/step/)
    expect(pegToolSettingsError({ ...DEFAULT_PEG_TOOL, gradePercent: 31 })).toMatch(/grade/)
    expect(pegToolSettingsError(DEFAULT_PEG_TOOL)).toBeNull()
    const result = solvePegCursor(origin, origin, DEFAULT_PEG_TOOL, slope, LIMIT)
    expect(!result.ok && result.reason).toBe('no-direction')
  })
})

describe('leg classes', () => {
  it('are up, down, over the limit either way, or unknown', () => {
    expect(pegLegClass(5, LIMIT)).toBe('up')
    expect(pegLegClass(-5, LIMIT)).toBe('down')
    expect(pegLegClass(18, LIMIT)).toBe('up')
    expect(pegLegClass(-18.5, LIMIT)).toBe('over')
    expect(pegLegClass(null, LIMIT)).toBe('unknown')
  })
})

describe('the chain of committed legs', () => {
  const leg = (start: Coordinate, bearing: number) => {
    const result = solvePegCursor(start, offsetCoordinate(start, bearing, 30), DEFAULT_PEG_TOOL, slope, LIMIT, {
      straight: true,
    })
    if (!result.ok) throw Error('no leg')
    return result.leg
  }
  it('adds legs from its end, removes the last, and refuses a leg from elsewhere', () => {
    let chain: PegChain = { origin, legs: [] }
    chain = addPegLeg(chain, leg(origin, 90))
    chain = addPegLeg(chain, leg(pegChainEnd(chain), 0))
    expect(chain.legs).toHaveLength(2)
    expect(addPegLeg(chain, leg(origin, 45))).toBe(chain)
    const summary = pegChainSummary(chain)
    expect(summary.lengthM).toBeCloseTo(60, 3)
    expect(summary.gradePercent).toBeCloseTo(10, 2)
    chain = removeLastPegLeg(chain)
    expect(chain.legs).toHaveLength(1)
    expect(removeLastPegLeg(removeLastPegLeg(chain)).legs).toHaveLength(0)
  })
  it('stops at the leg limit', () => {
    let chain: PegChain = { origin, legs: [] }
    for (let i = 0; i < MAX_PEG_TOOL_LEGS + 3; i++) chain = addPegLeg(chain, leg(pegChainEnd(chain), i % 2 ? 0 : 90))
    expect(chain.legs).toHaveLength(MAX_PEG_TOOL_LEGS)
  })
  it('draws committed legs in their class colour and the preview apart', () => {
    const chain: PegChain = { origin, legs: [leg(origin, 45)] }
    const preview = solvePegCursor(
      pegChainEnd(chain),
      offsetCoordinate(pegChainEnd(chain), 0, 30),
      DEFAULT_PEG_TOOL,
      slope,
      LIMIT,
    )
    const features = pegChainFeatures(chain, preview, LIMIT).features
    expect(features.map((f) => f.properties?.role)).toEqual(['peg-leg', 'peg-point', 'peg-preview'])
    expect(features[0].properties?.color).toBe(PEG_LEG_COLORS.up)
    expect(pegBearing(origin, (features[0].geometry as GeoJSON.LineString).coordinates[1] as Coordinate)).toBeCloseTo(
      45,
      3,
    )
  })
})

describe('double-clicks', () => {
  it('treat a quick second click at the same place as part of the first', () => {
    expect(isSecondClickOfDouble({ time: 0, x: 10, y: 10 }, { time: 250, x: 12, y: 11 })).toBe(true)
    expect(isSecondClickOfDouble({ time: 0, x: 10, y: 10 }, { time: 900, x: 10, y: 10 })).toBe(false)
    expect(isSecondClickOfDouble({ time: 0, x: 10, y: 10 }, { time: 100, x: 40, y: 10 })).toBe(false)
    expect(isSecondClickOfDouble(null, { time: 100, x: 10, y: 10 })).toBe(false)
  })
})

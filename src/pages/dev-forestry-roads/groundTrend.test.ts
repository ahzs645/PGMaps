import { describe, expect, it } from 'vitest'
import { groundTrendTerrain, groundWindowFor, resolvedGroundWindow } from './groundTrend'
import { optimizeRoadCorridor } from './corridorOptimizer'
import { suggestRoutes } from './routing'
import { DEFAULT_ROAD_SETTINGS } from './terrain'
import type { Coordinate, TerrainSource } from './types'

const M = 111_194.93
const origin: Coordinate = [-122.8, 53.9]
const east = (metres: number) => metres / (M * Math.cos((origin[1] * Math.PI) / 180))
/** Repeatable noise on a 1 m lattice, like a DTM's stumps, ruts and mounds. */
const bump = (col: number, row: number) => {
  const v = Math.sin(col * 127.1 + row * 311.7) * 43758.5453
  return (v - Math.floor(v) - 0.5) * 0.6
}
/** A 3 % hillside with up to ±0.3 m of micro-relief: 30 %+ between neighbouring 1 m samples. */
const rough: TerrainSource = {
  elevationAt(lng, lat) {
    const x = (lng - origin[0]) * M * Math.cos((origin[1] * Math.PI) / 180),
      y = (lat - origin[1]) * M
    const col = Math.floor(x),
      row = Math.floor(y),
      fx = x - col,
      fy = y - row
    const relief =
      (bump(col, row) * (1 - fx) + bump(col + 1, row) * fx) * (1 - fy) +
      (bump(col, row + 1) * (1 - fx) + bump(col + 1, row + 1) * fx) * fy
    return 700 + 0.03 * x + relief
  },
}
const start: Coordinate = [origin[0] + east(40), origin[1]],
  end: Coordinate = [origin[0] + east(340), origin[1]]

describe('ground trend', () => {
  it('returns the terrain itself for a zero window', () => {
    expect(groundTrendTerrain(rough, 0)).toBe(rough)
  })
  it('removes micro-relief without moving the ground', () => {
    const trend = groundTrendTerrain(rough, 12)
    for (const x of [50, 123, 200, 301]) {
      const lng = origin[0] + east(x)
      expect(trend.elevationAt(lng, origin[1])).toBeCloseTo(700 + 0.03 * x, 0)
    }
  })
  it('never fills ground the source does not have', () => {
    const holed: TerrainSource = {
      elevationAt: (lng, lat) => (Math.abs(lng - start[0]) < east(1) ? NaN : rough.elevationAt(lng, lat)),
    }
    expect(groundTrendTerrain(holed, 12).elevationAt(start[0], start[1])).toBeNaN()
  })
  it('keeps a mean when part of the window has no ground', () => {
    const edged: TerrainSource = {
      elevationAt: (lng, lat) => (lng > start[0] + east(2) ? NaN : rough.elevationAt(lng, lat)),
    }
    expect(Number.isFinite(groundTrendTerrain(edged, 12).elevationAt(start[0], start[1]))).toBe(true)
  })
  it('applies only where cells resolve micro-relief, unless the project chose', () => {
    expect(groundWindowFor(1)).toBe(12)
    expect(groundWindowFor(22)).toBe(0)
    expect(resolvedGroundWindow({ groundWindowM: 0 }, 1)).toBe(0)
    expect(resolvedGroundWindow({ groundWindowM: null }, 1)).toBe(12)
    expect(resolvedGroundWindow(undefined, 22)).toBe(0)
  })
})

describe('route searches over rough LiDAR-like ground', () => {
  const settings = { ...DEFAULT_ROAD_SETTINGS, maxGradePercent: 12 }
  it('blocks a 3 % hillside without a window, and finds it with one', () => {
    expect(() => suggestRoutes(start, end, rough, settings, [], {})).toThrow()
    expect(() =>
      optimizeRoadCorridor([start, end], rough, settings, [], { objective: 'balanced', corridorHalfWidthM: 60 }),
    ).toThrow()
    expect(suggestRoutes(start, end, rough, settings, [], { groundWindowM: 12 }).routes).toHaveLength(1)
    const corridor = optimizeRoadCorridor([start, end], rough, settings, [], {
      objective: 'balanced',
      corridorHalfWidthM: 60,
      groundWindowM: 12,
    })
    expect(corridor.maxSampledGroundPitchPercent).toBeLessThan(12)
    expect(corridor.warnings.join(' ')).toContain('12 m ground trend')
  })
})

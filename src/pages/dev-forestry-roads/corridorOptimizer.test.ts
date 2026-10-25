import { describe, expect, it } from 'vitest'
import { corridorFrame, optimizeRoadCorridor, optimizeRoadCorridorAsync } from './corridorOptimizer'
import { corridorCandidate } from './corridorCandidate'
import { alignmentLength, distance, horizontalCurveSummary, positionAt } from './engine'
import type { ContextFeature, Coordinate, RoadSettings, RoadTemplate, TerrainSource } from './types'

const frame = corridorFrame([-122.72, 53.89])
const point = (x: number, y: number) => frame.fromXY([x, y])
const terrain = (fn: (x: number, y: number) => number): TerrainSource => ({ elevationAt: (lon, lat) => fn(...frame.toXY([lon, lat])) })
const settings: RoadSettings = { stationInterval: 10, crossSectionHalfWidth: 30, maxGradePercent: 8, minRadius: 35, cutRate: 1, fillRate: 1, surfacingRate: 1, clearingRate: 1, shrinkFactor: 1 }
const template: RoadTemplate = { leftWidth: 3, rightWidth: 3, crossfallPercent: 3, cutSlope: 1, fillSlope: 1.5, ditchWidth: 1, ditchDepth: 0.5, surfaceDepth: 0.2 }
const options = { objective: 'balanced' as const, corridorHalfWidthM: 100 }
const flat = terrain(() => 700)
const box = (x0: number, y0: number, x1: number, y1: number): ContextFeature => ({ id: 'avoid', name: 'Excluded', kind: 'avoid', geometry: { type: 'Polygon', coordinates: [[point(x0, y0), point(x1, y0), point(x1, y1), point(x0, y1), point(x0, y0)]] } })
const barrier = (kind: 'avoid' | 'stream', coordinates: Coordinate[]): ContextFeature => ({ id: kind, name: kind, kind, geometry: { type: 'LineString', coordinates } })

describe('verified sketched-corridor search', () => {
  it('gives guide and corridor guidance when geometry work is exhausted without exclusions', () => {
    expect(() => optimizeRoadCorridor([point(0, 0), point(100, 30), point(200, 0)], flat, settings, [], {
      ...options, maxGeometryOperations: 10,
    })).toThrow(/Corridor geometry budget reached; narrow the corridor, shorten or simplify the guide/)
    expect(() => optimizeRoadCorridor([point(0, 0), point(200, 0)], flat, settings, [], {
      ...options, maxGeometryOperations: 15000001,
    })).toThrow(/Invalid geometry search budget/)
  })
  it('retains exact endpoints, is deterministic and does not mutate inputs', () => {
    const guide = [point(0, 0), point(300, 0)], before = JSON.stringify({ guide, settings, options })
    const a = optimizeRoadCorridor(guide, flat, settings, [], options)
    expect(a).toEqual(optimizeRoadCorridor(guide, flat, settings, [], options))
    expect(a.coordinates[0]).toEqual(guide[0]); expect(a.coordinates.at(-1)).toEqual(guide[1])
    expect(a.controlPoints[0].coordinate).toEqual(guide[0]); expect(a.controlPoints.at(-1)!.coordinate).toEqual(guide[1])
    expect(a.lengthM).toBeCloseTo(300, 5); expect(a.minimumRadiusM).toBeNull()
    expect(JSON.stringify({ guide, settings, options })).toBe(before)
  })
  it('reproduces the actual engine curves, length and station-to-coordinate mapping', () => {
    const guide = [point(0, 0), point(140, 90), point(300, 0)]
    const result = optimizeRoadCorridor(guide, flat, settings, [box(90, -20, 210, 20)], { ...options, corridorHalfWidthM: 120 })
    const alignment = corridorCandidate(result, template, 'Verified candidate')
    expect(result.minimumRadiusM).toBeGreaterThanOrEqual(settings.minRadius)
    expect(horizontalCurveSummary(alignment)).toHaveLength(result.controlPoints.length - 2)
    expect(alignmentLength(alignment)).toBeCloseTo(result.lengthM, 4)
    for (let i = 0; i < result.profile.length; i += 3) {
      expect(distance(positionAt(alignment, result.profile[i].stationM).coordinate, result.coordinates[i])).toBeLessThan(0.002)
      const [x, y] = frame.toXY(result.coordinates[i])
      expect(x >= 90 && x <= 210 && y >= -20 && y <= 20).toBe(false)
    }
    expect(alignment.vertical).toEqual([]); expect(alignment.overrides).toEqual([])
  }, 30000)
  it('checks the whole path against the guide buffer', () => {
    const guide = [point(0, 0), point(100, 100), point(250, 100)]
    const result = optimizeRoadCorridor(guide, flat, settings, [], { ...options, corridorHalfWidthM: 25 })
    const sketch = guide.map(frame.toXY)
    for (const coordinate of result.coordinates) {
      const p = frame.toXY(coordinate)
      const offset = Math.min(...sketch.slice(1).map((b, i) => {
        const a = sketch[i], dx = b[0] - a[0], dy = b[1] - a[1]
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
        return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
      }))
      expect(offset).toBeLessThanOrEqual(25.00001)
    }
  }, 30000)
  it('does not cross a thin exclusion between sample points', () => {
    const result = optimizeRoadCorridor([point(0, 0), point(200, 0)], flat, settings, [box(99.1, -20, 99.2, 20)], options)
    expect(result.coordinates.some(p => Math.abs(frame.toXY(p)[1]) > 20)).toBe(true)
  }, 30000)
  it('rejects endpoint contact and collinear overlap with an exclusion', () => {
    const guide = [point(0, 0), point(200, 0)]
    expect(() => optimizeRoadCorridor(guide, flat, settings, [box(0, -10, 20, 10)], options)).toThrow(/endpoint/)
    expect(() => optimizeRoadCorridor(guide, flat, settings, [barrier('avoid', guide)], options)).toThrow(/endpoint/)
  })
  it('honours an explicit exclusion clearance', () => {
    const guide = [point(0, 0), point(200, 0)]
    expect(() => optimizeRoadCorridor(guide, flat, settings, [box(-10, 4, 10, 8)], { ...options, avoidanceClearanceM: 5 })).toThrow(/endpoint/)
  })
  it('refuses missing endpoint elevations and a continuous no-data barrier', () => {
    const guide = [point(0, 0), point(250, 0)]
    expect(() => optimizeRoadCorridor(guide, terrain(() => NaN), settings, [], options)).toThrow(/valid terrain/)
    expect(() => optimizeRoadCorridor(guide, terrain(x => x > 100 && x < 140 ? NaN : 700), settings, [], { ...options, maxStates: 1500 })).toThrow(/No verified|budget/)
  }, 30000)
  it('applies grade constraints to the final endpoint connection', () => {
    expect(() => optimizeRoadCorridor([point(0, 0), point(60, 0)], terrain(x => x > 57 ? 710 : 700), settings, [], { ...options, corridorHalfWidthM: 25, maxStates: 1500 })).toThrow(/No verified|budget/)
  }, 30000)
  it('never silently doubles the requested ground-grade limit', () => {
    const source = terrain(x => x < 45 ? 700 : x > 55 ? 701.5 : 700 + (x - 45) * 0.15)
    expect(() => optimizeRoadCorridor([point(0, 0), point(100, 0)], source, { ...settings, minRadius: 1000 }, [], { ...options, corridorHalfWidthM: 25, maxStates: 1000 })).toThrow(/No verified|budget/)
  })
  it('reports stream features touched, with vertex contacts counted', () => {
    const guide = [point(0, 0), point(200, 0)]
    const result = optimizeRoadCorridor(guide, flat, settings, [barrier('stream', [point(100, -500), point(100, 0), point(100, 500)])], { ...options, maxStates: 1500 })
    expect(result.streamContacts).toBe(1); expect(result.baseline.streamContacts).toBe(1)
    expect(result.warnings.join(' ')).toMatch(/watercourse/)
  }, 30000)
  it('recomputes ascent, descent and grade from returned profile stations', () => {
    const result = optimizeRoadCorridor([point(0, 0), point(200, 0)], terrain(x => 700 + 0.03 * x), settings, [], options)
    let up = 0, down = 0, peak = 0
    for (let i = 1; i < result.profile.length; i++) {
      const a = result.profile[i - 1], b = result.profile[i], dz = b.elevationM - a.elevationM
      up += Math.max(0, dz); down += Math.max(0, -dz); peak = Math.max(peak, Math.abs(dz) / (b.stationM - a.stationM) * 100)
    }
    expect(result.groundAscentM).toBeCloseTo(up, 6); expect(result.groundDescentM).toBeCloseTo(down, 6)
    expect(result.maxSampledGroundPitchPercent).toBeCloseTo(peak, 5); expect(peak).toBeLessThanOrEqual(8.00001)
  }, 30000)
  it('trades length for reduced unnecessary elevation change on a synthetic mound', () => {
    const source = terrain((x, y) => 700 + 15 * Math.exp(-(((x - 250) / 110) ** 2 + (y / 55) ** 2)))
    const guide = [point(0, 0), point(500, 0)]
    const shortest = optimizeRoadCorridor(guide, source, { ...settings, maxGradePercent: 20 }, [], { ...options, objective: 'shortest', corridorHalfWidthM: 180 })
    const contour = optimizeRoadCorridor(guide, source, { ...settings, maxGradePercent: 20 }, [], { ...options, objective: 'contour', corridorHalfWidthM: 180 })
    expect(contour.excessVerticalM).toBeLessThan(shortest.excessVerticalM * 0.2)
    expect(contour.lengthM).toBeGreaterThan(shortest.lengthM)
    expect(contour.maxSampledGroundPitchPercent).toBeLessThanOrEqual(20.00001)
  }, 60000)
  it('enforces budgets and invalid dimensions', () => {
    const guide = [point(0, 0), point(200, 0)]
    expect(() => optimizeRoadCorridor(guide, flat, settings, [], { ...options, corridorHalfWidthM: NaN })).toThrow(/half-width/)
    expect(() => optimizeRoadCorridor(guide, flat, { ...settings, minRadius: 0 }, [], options)).toThrow(/radius/)
    expect(() => optimizeRoadCorridor([point(0, 0), point(9000, 0), point(200, 0)], flat, settings, [], options)).toThrow(/entire sketch/)
    expect(() => optimizeRoadCorridor([guide[0], guide[0]], flat, settings, [], options)).toThrow(/endpoints/)
    expect(() => optimizeRoadCorridor(guide, flat, settings, [], { ...options, maxTerrainSamples: 1 })).toThrow(/budget/)
  })
  it('cancels before and during asynchronous search without changing inputs', async () => {
    const guide = [point(0, 0), point(300, 0)], frozen = JSON.stringify(guide)
    const before = new AbortController(); before.abort()
    await expect(optimizeRoadCorridorAsync(guide, flat, settings, [], options, { signal: before.signal })).rejects.toThrow(/cancelled/)
    const during = new AbortController()
    await expect(optimizeRoadCorridorAsync(guide, flat, settings, [], options, { signal: during.signal, onProgress: () => during.abort() })).rejects.toThrow(/cancelled/)
    expect(JSON.stringify(guide)).toBe(frozen)
  })
  it('rejects stale/malformed candidate geometry before adoption', () => {
    const result = optimizeRoadCorridor([point(0, 0), point(200, 0)], flat, settings, [], options)
    expect(() => corridorCandidate({ ...result, lengthM: result.lengthM + 10 }, template, 'bad')).toThrow(/nothing was adopted/)
  })
})

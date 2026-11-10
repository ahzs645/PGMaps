import { describe, expect, it } from 'vitest'
import { benchCentreline, benchTerrain } from './roadBenchFixture'
import {
  cumulativeLength,
  nearestOnLine,
  pointAlong,
  resampleLine,
  spreadOf,
  type TerrainSampler,
  type XY,
} from './roadGrid'
import { roadLikeness } from './roadLikeness'
import { runToCompletion } from './cooperative'
import { joinTrace, snapToRoad, traceRoadSteps, traceSegmentOnTerrainSteps } from './roadTrace'
import type { SurfaceGrid } from './surfaceGrid'

const truth = benchCentreline()
const truthCum = cumulativeLength(truth)
/** Clicks every `spacingM` along the true road, moved `offsetM` east. */
const clicks = (spacingM: number, offsetM: number): XY[] => {
  const total = truthCum.at(-1)!
  const out: XY[] = []
  for (let s = 0; s <= total; s += spacingM) {
    const { at } = pointAlong(truth, truthCum, s)
    out.push([at[0] + offsetM, at[1]])
  }
  return out
}
const traceAll = (ground: SurfaceGrid, points: XY[], terrainCellM = 1) =>
  points.slice(1).map((to, i) => runToCompletion(traceSegmentOnTerrainSteps(ground, terrainCellM, points[i], to)))

describe('tracing a road by clicking', () => {
  const bench = benchTerrain()

  it('follows the bench between clicks placed 8 m off it', () => {
    const segments = traceAll(bench, clicks(100, 8))
    expect(segments.every((s) => s.status === 'snapped')).toBe(true)
    const { line, snapped, straight } = joinTrace(segments)
    expect(snapped).toBe(segments.length)
    expect(straight).toBe(0)
    const d = spreadOf(resampleLine(line, 1).map((p) => nearestOnLine(truth, truthCum, p).distance))!
    expect(d.p90).toBeLessThanOrEqual(1)
  })

  it('joins clicks straight on a hillside with no road', () => {
    const segments = traceAll(benchTerrain({ bench: false }), clicks(100, 8))
    expect(segments.every((s) => s.status === 'straight')).toBe(true)
    expect(segments[0].reason).toMatch(/does not look like a road/)
  })

  it('does not claim a road on smooth flat ground, where every cell scores as road-like', () => {
    const segments = traceAll(benchTerrain({ bench: false, crossSlope: 0 }), clicks(100, 8))
    expect(segments.every((s) => s.status === 'straight')).toBe(true)
    expect(segments[0].reason).toMatch(/No road bench in cross-section/)
    expect(segments[0].path).toEqual([clicks(100, 8)[0], clicks(100, 8)[1]])
  })

  it('joins clicks straight on terrain too coarse to show a bench', () => {
    const [segment] = traceAll(bench, clicks(100, 8).slice(0, 2), 22)
    expect(segment.status).toBe('straight')
    expect(segment.reason).toMatch(/regional DEM/)
  })

  it('moves a click beside the road onto it, and gives null for a click with no terrain', () => {
    const like = roadLikeness(bench)
    const near = pointAlong(truth, truthCum, 200).at
    const snapped = snapToRoad(like, [near[0] + 2, near[1]])!
    expect(snapped.onRoad).toBe(true)
    expect(snapped.likeness).toBeGreaterThanOrEqual(0.5)
    expect(nearestOnLine(truth, truthCum, snapped.at).distance).toBeLessThanOrEqual(3)
    const holed: SurfaceGrid = { ...like, values: new Float64Array(like.values) }
    const col = Math.round((near[0] - like.origin[0]) / like.cellM),
      row = Math.round((like.origin[1] - near[1]) / like.cellM)
    holed.values[row * like.width + col] = Number.NaN
    expect(snapToRoad(holed, near)).toBeNull()
    const segment = runToCompletion(traceRoadSteps(holed, near, pointAlong(truth, truthCum, 300).at))
    expect(segment.status).toBe('straight')
    expect(segment.reason).toMatch(/No terrain at a click/)
  })

  it('keeps a long segment search inside its capsule', () => {
    const terrain: TerrainSampler = {
      cellM: 1,
      toLonLat: (xy) => [xy[0], xy[1]],
      terrain: {
        elevationAt(x, y) {
          const ground = 0.3 * x,
            form = -0.02 * y,
            off = Math.abs(x)
          if (off <= 3) return form
          const gd = ground - form
          const batter = form + Math.sign(gd) * ((off - 3) / 1.5)
          return Math.abs(batter - form) < Math.abs(gd) ? batter : ground
        },
      },
    }
    const segment = runToCompletion(traceSegmentOnTerrainSteps(terrain, 1, [6, 0], [6, 750]))
    expect(segment.status).toBe('snapped')
    expect(segment.explored).toBeLessThan(200_000)
    expect(Math.max(...resampleLine(segment.path, 1).map(([x]) => Math.abs(x)))).toBeLessThan(1.5)
    const far = runToCompletion(traceSegmentOnTerrainSteps(terrain, 1, [6, 0], [6, 1000]))
    expect(far.status).toBe('straight')
    expect(far.reason).toMatch(/click more often/)
  })
})

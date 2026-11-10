import { describe, expect, it } from 'vitest'
import { runCooperatively } from './cooperative'
import { BENCH_Y0, benchCentreline, benchMappedLine, benchTerrain } from './roadBenchFixture'
import { cumulativeLength, nearestOnLine, resampleLine, spreadOf, type TerrainSampler, type XY } from './roadGrid'
import { findRoadOnTerrain, findRoadOnTerrainSteps, ROAD_FIND_CHUNK_M } from './roadRelocation'
import type { SurfaceGrid } from './surfaceGrid'

const truth = benchCentreline()
const truthCum = cumulativeLength(truth)
/** Distance from points every metre along `line` to the true centreline. */
const offTruth = (line: XY[]) => spreadOf(resampleLine(line, 1).map((p) => nearestOnLine(truth, truthCum, p).distance))!
/** Distance from the true centreline, every 5 m, to `line`. */
const truthOff = (line: XY[]) => {
  const cum = cumulativeLength(line)
  return spreadOf(resampleLine(truth, 5).map((p) => nearestOnLine(line, cum, p).distance))!
}

describe('finding a mapped road on the terrain', () => {
  const bench = benchTerrain()

  it.each([8, 15, 30])('moves a line %i m off the road onto the bench', (offset) => {
    const line = benchMappedLine(offset)
    const copy = line.map((p) => [...p])
    const result = findRoadOnTerrain({ line, ground: bench, terrainCellM: 1 })
    expect(result.status).toBe('found')
    expect(result.foundShare).toBeGreaterThanOrEqual(0.95)
    expect(offTruth(result.candidate).p90).toBeLessThanOrEqual(1)
    expect(truthOff(result.candidate).p90).toBeLessThanOrEqual(1)
    expect(result.shiftM!.p50).toBeGreaterThan(offset - 3)
    expect(result.shiftM!.p50).toBeLessThan(offset + 3)
    expect(result.likenessAlong!.shareAbove05).toBeGreaterThanOrEqual(0.5)
    expect(result.slices!.widthM!.p50).toBeCloseTo(6, 0)
    expect(result.vertexShiftM).toHaveLength(line.length)
    // A candidate copy: the line it was given is untouched.
    expect(line).toEqual(copy)
    expect(result.candidate).not.toBe(line)
  })

  it.each([
    ['a plain hillside', benchTerrain({ bench: false })],
    ['flat ground', benchTerrain({ bench: false, crossSlope: 0 })],
  ])('does not report a road on %s', (_, ground) => {
    const line = benchMappedLine(10)
    const result = findRoadOnTerrain({ line, ground, terrainCellM: 1 })
    expect(result.status).toBe('not-found')
    expect(result.foundShare).toBe(0)
    expect(result.candidate).toEqual(line)
    expect(result.shiftM).toBeNull()
    expect(result.ranges).toEqual([{ from: 0, to: result.lengthM, kind: 'not-found' }])
  })

  it('refuses terrain coarser than 2 m without searching', () => {
    const line = benchMappedLine(10)
    const result = findRoadOnTerrain({ line, ground: bench, terrainCellM: 22 })
    expect(result.status).toBe('too-coarse')
    expect(result.reason).toMatch(/regional DEM/)
    expect(result.candidate).toEqual(line)
    expect(result.explored).toBe(0)
  })

  it('reports missing terrain across the corridor instead of crossing it', () => {
    const holed: SurfaceGrid = { ...bench, values: new Float64Array(bench.values) }
    for (let r = 300; r < 320; r++) for (let c = 0; c < holed.width; c++) holed.values[r * holed.width + c] = Number.NaN
    const result = findRoadOnTerrain({ line: benchMappedLine(10), ground: holed, terrainCellM: 1 })
    expect(result.status).toBe('incomplete-terrain')
    expect(result.foundLine).toBeNull()
    const gap = result.ranges.find((r) => r.kind === 'no-terrain')!
    // Rows 300–320 are 280–300 m along the line from its start 20 m below the top.
    expect(gap.from).toBeGreaterThan(270)
    expect(gap.to).toBeLessThan(310)
    expect(result.reason).toMatch(/gaps across the 40 m search corridor/)
  })

  it('keeps the original line, flagged, where the bench stops', () => {
    // The bench for the first 300 m only; plain hillside after it.
    const hill = benchTerrain({ bench: false })
    const half: SurfaceGrid = { ...bench, values: new Float64Array(bench.values) }
    for (let r = 320; r < half.height; r++)
      for (let c = 0; c < half.width; c++) half.values[r * half.width + c] = hill.values[r * half.width + c]
    const line = benchMappedLine(10)
    const result = findRoadOnTerrain({ line, ground: half, terrainCellM: 1 })
    expect(result.status).toBe('partial')
    expect(result.foundShare).toBeGreaterThan(0.4)
    expect(result.foundShare).toBeLessThan(0.65)
    const kept = result.ranges.filter((r) => r.kind !== 'found')
    expect(kept).toHaveLength(1)
    expect(kept[0].to).toBeCloseTo(result.lengthM, 3)
    // Where nothing was found the candidate is the original line.
    const lineCum = cumulativeLength(line)
    const tail = resampleLine(result.candidate, 2).filter(([, y]) => y < BENCH_Y0 - 380)
    expect(tail.length).toBeGreaterThan(50)
    expect(Math.max(...tail.map((p) => nearestOnLine(line, lineCum, p).distance))).toBeLessThan(0.6)
    // And the found part is on the road.
    const head = resampleLine(result.candidate, 1).filter(([, y]) => y > BENCH_Y0 - 280)
    expect(spreadOf(head.map((p) => nearestOnLine(truth, truthCum, p).distance))!.p90).toBeLessThanOrEqual(1)
  })

  it('reports progress and stops on Cancel', async () => {
    const controller = new AbortController()
    const phases = new Set<string>()
    const run = runCooperatively(
      findRoadOnTerrainSteps({ line: benchMappedLine(10), ground: bench, terrainCellM: 1 }),
      {
        signal: controller.signal,
        sliceMs: 0,
        onProgress: (p) => {
          phases.add(p.phase)
          if (p.phase === 'search') controller.abort()
        },
      },
    )
    await expect(run).rejects.toThrow(/Cancelled/)
    expect(phases.has('likeness')).toBe(true)
  })

  it('searches a long road in pieces and joins them on the road', () => {
    // A straight 6 m bench running north along x = 0 across a 30 % sidehill, read from terrain.
    const terrain: TerrainSampler = {
      cellM: 1,
      toLonLat: (xy) => [xy[0], xy[1]],
      terrain: {
        elevationAt(x, y) {
          const ground = 0.3 * x
          const form = -0.02 * y
          const off = Math.abs(x)
          if (off <= 3) return form
          const gd = ground - form
          const batter = form + Math.sign(gd) * ((off - 3) / 1.5)
          return Math.abs(batter - form) < Math.abs(gd) ? batter : ground
        },
      },
    }
    const length = 2.2 * ROAD_FIND_CHUNK_M
    const line: XY[] = Array.from({ length: 23 }, (_, i) => [12 + 2 * Math.sin(i), (length * i) / 22])
    const result = findRoadOnTerrain({ line, ground: terrain, terrainCellM: 1 })
    expect(result.status).toBe('found')
    const offsets = spreadOf(resampleLine(result.candidate, 1).map(([x]) => Math.abs(x)))!
    expect(offsets.p90).toBeLessThanOrEqual(1)
    expect(offsets.max).toBeLessThan(5)
  })

  it('refuses a line too short to follow', () => {
    const result = findRoadOnTerrain({
      line: [
        [500_250, 6_000_500],
        [500_250, 6_000_490],
      ],
      ground: bench,
      terrainCellM: 1,
    })
    expect(result.status).toBe('refused')
  })
})

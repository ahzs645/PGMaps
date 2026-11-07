import assert from 'node:assert/strict'
import { describe, expect, it } from 'vitest'
import type { DepressionPolicy } from './drainagePolicies'
import {
  conditionDrainageSurface,
  downstream,
  fillDepressions,
  flowAccumulation,
  flowDirections,
  MISSING,
  OUTLET,
} from './hydrology'
import type { SurfaceGrid } from './surfaceGrid'

/** Independent neighbour enumeration; the reference does not use the production D8 helpers. */
function neighbours(grid: SurfaceGrid, cell: number): number[] {
  const row = Math.floor(cell / grid.width),
    col = cell % grid.width,
    result: number[] = []
  for (let r = Math.max(0, row - 1); r <= Math.min(grid.height - 1, row + 1); r++)
    for (let c = Math.max(0, col - 1); c <= Math.min(grid.width - 1, col + 1); c++) {
      const next = r * grid.width + c
      if (next !== cell) result.push(next)
    }
  return result
}

/**
 * A cell's spill elevation is the minimum, over paths to an open boundary, of the highest
 * elevation on that path. This small O(n²) minimax-path oracle uses neither Priority-Flood,
 * its heap/FIFO, nor a production flow-direction grid. A no-data neighbour is an open boundary,
 * matching the documented support assumption rather than inventing ground across the gap.
 */
function referenceSpillLevels(grid: SurfaceGrid): Float64Array {
  const n = grid.values.length,
    levels = new Float64Array(n).fill(Infinity),
    settled = new Uint8Array(n),
    adjacent = Array.from({ length: n }, (_, i) => neighbours(grid, i))
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(grid.values[i])) {
      levels[i] = NaN
      settled[i] = 1
      continue
    }
    const row = Math.floor(i / grid.width),
      col = i % grid.width
    if (
      row === 0 ||
      col === 0 ||
      row === grid.height - 1 ||
      col === grid.width - 1 ||
      adjacent[i].some((j) => !Number.isFinite(grid.values[j]))
    )
      levels[i] = grid.values[i]
  }
  for (;;) {
    let cell = -1
    for (let i = 0; i < n; i++) if (!settled[i] && (cell < 0 || levels[i] < levels[cell])) cell = i
    if (cell < 0) return levels
    assert.ok(Number.isFinite(levels[cell]), 'Every supported component must reach a sampled or no-data boundary.')
    settled[cell] = 1
    for (const next of adjacent[cell])
      if (!settled[next]) levels[next] = Math.min(levels[next], Math.max(levels[cell], grid.values[next]))
  }
}

/** Fixed seed and quarter-metre heights make cases reproducible, with many genuine equal-height flats. */
function referenceRasters(): SurfaceGrid[] {
  let seed = 1729
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  return Array.from({ length: 120 }, (_, index) => {
    const width = 5 + (index % 7),
      height = 5 + ((index * 3) % 8)
    return {
      width,
      height,
      cellM: 2,
      origin: [0, 2 * (height - 1)] as [number, number],
      values: Float64Array.from({ length: width * height }, () =>
        random() < 0.08 ? NaN : Math.floor(random() * 9) / 4,
      ),
    }
  })
}

function checkRoutingInvariants(
  grid: SurfaceGrid,
  result: ReturnType<typeof conditionDrainageSurface>,
  policy: DepressionPolicy,
  label: string,
) {
  const { directions, surface } = result
  let supportedCells = 0
  for (let i = 0; i < grid.values.length; i++) {
    if (!Number.isFinite(grid.values[i])) {
      assert.equal(directions[i], MISSING, `${label}: missing cell ${i}`)
      assert.ok(Number.isNaN(surface.values[i]), `${label}: missing elevation ${i}`)
      continue
    }
    supportedCells++
    const applied = surface.values[i] - grid.values[i]
    assert.ok(applied >= 0, `${label}: cell ${i} was lowered`)
    if (policy.mode === 'preserve' || (policy.mode === 'depth-limited' && policy.maxDepthM === 0))
      assert.equal(applied, 0, `${label}: preservation raised cell ${i}`)
    if (policy.mode === 'depth-limited') {
      assert.ok(applied <= policy.maxDepthM, `${label}: cell ${i} exceeded its cap`)
      assert.ok(applied === 0 || applied === result.depth[i], `${label}: cell ${i} was only partially filled`)
    }
    const visited = new Set<number>()
    for (let cell = i; ; ) {
      assert.ok(!visited.has(cell), `${label}: routing cycle from cell ${i}`)
      visited.add(cell)
      const next = downstream(directions, grid.width, cell)
      if (next < 0) {
        assert.equal(directions[cell], OUTLET, `${label}: unsupported terminal from cell ${i}`)
        break
      }
      assert.ok(
        next < grid.values.length && directions[next] !== MISSING,
        `${label}: flow from cell ${cell} leaves supported terrain`,
      )
      assert.ok(neighbours(grid, cell).includes(next), `${label}: flow from cell ${cell} skips a neighbour`)
      assert.ok(surface.values[next] <= surface.values[cell], `${label}: flow from cell ${cell} goes uphill`)
      cell = next
    }
  }
  const accumulation = flowAccumulation(directions, grid)
  let terminalArea = 0
  for (let i = 0; i < accumulation.length; i++) {
    if (directions[i] === OUTLET) terminalArea += accumulation[i]
    if (directions[i] === MISSING) assert.equal(accumulation[i], 0, `${label}: missing cell receives area`)
  }
  assert.equal(terminalArea, supportedCells * grid.cellM ** 2, `${label}: contributing area was lost or duplicated`)
}

describe('independent drainage policy reference cases', () => {
  it('grounds the minimax oracle in a known spill level and a missing-terrain opening', () => {
    const grid: SurfaceGrid = {
      width: 5,
      height: 5,
      cellM: 1,
      origin: [0, 4],
      values: new Float64Array(25).fill(10),
    }
    grid.values[12] = 5
    expect(referenceSpillLevels(grid)).toEqual(new Float64Array(25).fill(10))
    grid.values[13] = NaN
    const opened = referenceSpillLevels(grid)
    expect(opened[12]).toBe(5)
    expect(Number.isNaN(opened[13])).toBe(true)
  })

  it('matches independent spill levels and conserves routing across 600 bounded seeded policy runs', () => {
    const policies: DepressionPolicy[] = [
      { mode: 'fill-all' },
      { mode: 'preserve' },
      { mode: 'depth-limited', maxDepthM: 0 },
      { mode: 'depth-limited', maxDepthM: 0.5 },
      { mode: 'depth-limited', maxDepthM: 2 },
    ]
    for (const [index, grid] of referenceRasters().entries()) {
      const original = new Float64Array(grid.values),
        expectedDepth = referenceSpillLevels(grid).map((level, i) => level - grid.values[i])
      for (const policy of policies) {
        const label = `Fixture ${index}, ${JSON.stringify(policy)}`,
          result = conditionDrainageSurface(grid, policy)
        assert.deepEqual(result.depth, expectedDepth, `${label}: physical spill depth differs from minimax oracle`)
        checkRoutingInvariants(grid, result, policy, label)
      }
      assert.deepEqual(grid.values, original, `Fixture ${index}: conditioning mutated the source raster`)
    }
  })

  it('keeps legacy default routing but identifies the physical-depth change at the ponding threshold', () => {
    const grid: SurfaceGrid = {
      width: 21,
      height: 21,
      cellM: 1,
      origin: [0, 20],
      values: Float64Array.from({ length: 21 * 21 }, (_, i) =>
        Math.abs((i % 21) - 10) <= 2 && Math.abs(Math.floor(i / 21) - 10) <= 2 ? 99.95001 : 100,
      ),
    }
    const legacy = fillDepressions(grid),
      current = conditionDrainageSurface(grid)
    expect(current.surface.values).toEqual(legacy.filled.values)
    expect(current.directions).toEqual(flowDirections(legacy.filled))
    expect(legacy.depth[220]).toBeCloseTo(0.05009, 10)
    expect(current.depth[220]).toBeCloseTo(0.04999, 12)
    expect(current.depth).toEqual(referenceSpillLevels(grid).map((level, i) => level - grid.values[i]))
    // A small epsilon difference crosses the reporting threshold for all 25 depression cells.
    // Old evidence therefore needs its own computation provenance despite unchanged routing inputs.
    expect(legacy.depth.filter((depth) => depth > 0.05)).toHaveLength(25)
    expect(current.depth.filter((depth) => depth > 0.05)).toHaveLength(0)
  })
})

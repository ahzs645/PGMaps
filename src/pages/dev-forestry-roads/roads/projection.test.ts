import { describe, expect, it } from 'vitest'
import { CLUS_EXPECTED_ROAD_CELLS, getCLUSExample } from './examples'
import {
  MAX_ROADS_CELLS,
  getGraph,
  graphDistances,
  normalizeRoadsOptions,
  roadEdgeBetween,
  roadsCellAt,
  roadsCellCentre,
  shortestCellPath,
  validateRoadsGrid,
} from './graph'
import { extendRoads, projectRoads } from './projectRoads'
import type { RoadsGrid, RoadsInput } from './types'
import { gradePenaltyFn, simpleCostFn } from './weights'

function grid(width: number, height: number, values?: number[], cellM = 10): RoadsGrid {
  return {
    width,
    height,
    origin: [100, 200],
    cellM,
    values: Float64Array.from(values ?? Array(width * height).fill(1)),
  }
}

function input(width = 3, height = 3): RoadsInput {
  return {
    grid: grid(width, height),
    roadCells: [0],
    landings: [{ id: 'target', cell: width * height - 1 }],
    options: { roadsInWeight: false },
  }
}

describe('upstream scalar weighting', () => {
  it('retains the simple endpoint mean and its horizontal-distance scaling', () => {
    expect(simpleCostFn(0.5, 0.7, 1)).toBeCloseTo(0.6, 12)
    expect(simpleCostFn(4, 8, Math.SQRT2 * 10)).toBeCloseTo(60 * Math.SQRT2, 12)
  })

  it('reproduces published grade examples, barrier precedence and a soft grade-limit weight', () => {
    expect(gradePenaltyFn(0.5, 0.51, 1)).toBeCloseTo(16682, 8)
    expect(gradePenaltyFn(0.5, 0.65, 1)).toBeCloseTo(23738, 8)
    expect(gradePenaltyFn(0.5, 0.75, 1)).toBeNaN()
    expect(gradePenaltyFn(-100, -500, 10)).toBe(5000)
    expect(gradePenaltyFn(-100, 500, 10)).toBe(1000)
    expect(gradePenaltyFn(1, 100, 10, { limitWeight: 90000 })).toBe(900000)
    expect(gradePenaltyFn(NaN, 100, 10)).toBeNaN()
  })

  it('preserves the upstream zero-road quirks instead of quietly correcting its formula', () => {
    expect(gradePenaltyFn(0, 0, 10)).toBe(161780)
    expect(gradePenaltyFn(0, 1, 10)).toBe(161780)
    expect(gradePenaltyFn(0, 500, 10)).toBeNaN()
  })
})

describe('bounded raster graph', () => {
  it('uses cell centres and projects valid boundary points without row wrapping', () => {
    const g = grid(3, 2)
    expect(roadsCellCentre(g, 4)).toEqual([110, 190])
    expect(roadsCellAt(g, [110, 190])).toBe(4)
    expect(roadsCellAt(g, [94.999, 200])).toBe(-1)
    expect(roadsCellAt(g, [125, 200])).toBe(-1)
    const graph = getGraph({ ...input(), options: { neighbourhood: 'rook' } })
    expect(roadEdgeBetween(graph, 2, 3)).toBe(-1)
  })

  it('distinguishes rook, queen and distance-corrected octagon while physical lengths stay metric', () => {
    const base = { ...input(2, 2), roadCells: [], options: { roadsInWeight: true } }
    const rook = getGraph({ ...base, options: { ...base.options, neighbourhood: 'rook' } })
    const queen = getGraph({ ...base, options: { ...base.options, neighbourhood: 'queen' } })
    const octagon = getGraph({ ...base, options: { ...base.options, neighbourhood: 'octagon' } })
    expect(rook.weights.length).toBe(4)
    expect(queen.weights.length).toBe(6)
    expect(queen.weights[roadEdgeBetween(queen, 0, 3)]).toBe(10)
    expect(octagon.weights[roadEdgeBetween(octagon, 0, 3)]).toBeCloseTo(10 * Math.SQRT2)
    expect(queen.lengths[roadEdgeBetween(queen, 0, 3)]).toBeCloseTo(10 * Math.SQRT2)
  })

  it('has explicit multi-source distances and leaves unreachable cells at Infinity', () => {
    const graph = getGraph({ grid: grid(5, 1, [1, 1, NaN, 1, 1]), roadCells: [], landings: [] })
    const tree = graphDistances(graph, [0, 4])
    expect(Array.from(tree.distances)).toEqual([0, 10, Infinity, 10, 0])
    expect(shortestCellPath(tree, 3)).toEqual([4, 3])
    expect(shortestCellPath(tree, 2)).toEqual([])
  })

  it('keeps a blocked corner closed in planning mode, with raw upstream diagonals opt-in', () => {
    const base = { ...input(2, 2), grid: grid(2, 2, [1, NaN, NaN, 1]) }
    const raw = projectRoads({ ...base, options: { preventCornerCutting: false } })
    const safe = projectRoads({ ...base, options: { preventCornerCutting: true } })
    expect(raw.targets[0].status).toBe('connected')
    expect(safe.targets[0].status).toBe('unreachable')
    expect(safe.paths).toEqual([])
  })

  it('does not create terrain or punch through a hard exclusion when roads are burned', () => {
    const base = input(3, 1)
    base.grid.values[1] = NaN
    base.roadCells = [0, 1]
    expect(projectRoads(base).targets[0].status).toBe('unreachable')
    expect(() => projectRoads({ ...base, roadCells: [1] })).toThrow('No existing road cells')
  })

  it('separates real elevations from road zeros and applies positive terrain cost multipliers', () => {
    const terrain = { ...input(2, 1), elevations: Float64Array.from([500, 501]) }
    const options = { roadsInWeight: false, weightFunction: 'grade' as const, gradeMode: 'terrain' as const }
    const result = projectRoads({ ...terrain, options })
    expect(result.targets[0].status).toBe('connected')
    expect(result.objective).toBe(212180)
    const expensive = projectRoads({ ...terrain, grid: grid(2, 1, [1, 5]), options })
    expect(expensive.objective).toBe(result.objective * 3)
    const raw = projectRoads({
      ...terrain,
      grid: grid(2, 1, [500, 501]),
      options: { ...options, gradeMode: 'upstream' },
    })
    expect(raw.targets[0].status).toBe('unreachable')
    expect(result.objective).not.toBeCloseTo(212.18) // upstream weights are not automatically CAD
  })

  it('preserves explicitly supplied seed-road weights in terrain mode when burning is disabled', () => {
    const base = {
      ...input(3, 1),
      roadCells: [0, 1],
      elevations: Float64Array.from([500, 500, 500]),
      grid: grid(3, 1, [2, 2, 1]),
    }
    const preserve = getGraph({
      ...base,
      options: { weightFunction: 'grade', gradeMode: 'terrain', roadsInWeight: true },
    })
    const burn = getGraph({ ...base, options: { weightFunction: 'grade', gradeMode: 'terrain', roadsInWeight: false } })
    expect(preserve.weights[roadEdgeBetween(preserve, 0, 1)]).toBe(16178 * 10 * 2)
    expect(burn.weights[roadEdgeBetween(burn, 0, 1)]).toBe(0)
    const alreadyBurned = getGraph({
      ...base,
      grid: grid(3, 1, [0, 0, 1]),
      options: { weightFunction: 'grade', gradeMode: 'terrain', roadsInWeight: true },
    })
    expect(alreadyBurned.weights[roadEdgeBetween(alreadyBurned, 0, 1)]).toBe(0)
  })

  it('rejects negative simple weights, invalid settings and an oversized grid before graph allocation', () => {
    expect(() => getGraph({ ...input(2, 1), grid: grid(2, 1, [1, -1]) })).toThrow('cannot be negative')
    expect(() => normalizeRoadsOptions({ grade: { penalty: -1 } })).toThrow('non-negative')
    expect(() => normalizeRoadsOptions({ randomSeed: 1.5 })).toThrow('integer')
    expect(() => validateRoadsGrid({ ...grid(1, 1), width: MAX_ROADS_CELLS + 1 })).toThrow('cell limit')
  })
})

describe('LandSciTech CLUS reference fixture', () => {
  for (const method of ['lcp', 'mst', 'snap'] as const) {
    it(`reproduces upstream ${method} expected road cells exactly`, () => {
      const source = getCLUSExample()
      const result = projectRoads({ ...source, options: { ...source.options, method } })
      expect(result.simulation.roadCells).toEqual(CLUS_EXPECTED_ROAD_CELLS[method])
      expect(result.targets.every((target) => target.status === 'connected')).toBe(true)
      expect(source.grid.values[10]).toBe(4.913516923086718)
    })
  }

  it('iterative LCP shares construction and charges each new edge once', () => {
    const source = getCLUSExample()
    const iterative = projectRoads({ ...source, options: { ...source.options, method: 'ilcp' } })
    const independent = projectRoads({ ...source, options: { ...source.options, method: 'lcp' } })
    expect(iterative.objective).toBeLessThan(independent.objective)
    expect(iterative.simulation.roadCells).toEqual([0, 1, 2, 3, 4, 7, 10, 11, 12, 15, 18, 21, 24])
    expect(iterative.newLengthM).toBeLessThan(iterative.paths.reduce((sum, path) => sum + path.lengthM, 0))
    expect(iterative.objective).toBeCloseTo(63.00541151536163, 10)
  })
})

describe('network methods and stages', () => {
  it('connects a one-landing MST and resolves duplicate-cell targets without losing IDs', () => {
    const base = input(3, 1)
    base.landings.push({ id: 'same-cell', cell: 2 })
    const result = projectRoads({ ...base, options: { method: 'mst' } })
    expect(result.paths).toHaveLength(1)
    expect(result.targets.map((target) => target.status)).toEqual(['connected', 'connected'])
    expect(result.targets[0].pathIds).toEqual(result.targets[1].pathIds)
  })

  it('reports missing, outside, already-connected and disconnected landings independently', () => {
    const base: RoadsInput = {
      grid: grid(5, 1, [1, 1, NaN, 1, 1]),
      roadCells: [0],
      landings: [
        { id: 'outside', cell: -1 },
        { id: 'missing', cell: 2 },
        { id: 'seed', cell: 0 },
        { id: 'isolated', cell: 4 },
        { id: 'reachable', cell: 1 },
      ],
      options: { method: 'mst' },
    }
    const result = projectRoads(base)
    expect(result.targets.map((target) => target.status)).toEqual([
      'outside',
      'blocked',
      'already-connected',
      'unreachable',
      'connected',
    ])
    expect(result.simulation.roadCells).toEqual([0, 1])
  })

  it('does not present an isolated MST of landings as a road-connected result', () => {
    const base = input(5, 2)
    base.grid.values[2] = NaN
    base.grid.values[7] = NaN
    base.landings = [
      { id: 'a', cell: 3 },
      { id: 'b', cell: 9 },
    ]
    const result = projectRoads({ ...base, options: { method: 'mst', preventCornerCutting: true } })
    expect(result.paths).toHaveLength(0)
    expect(result.targets.every((target) => target.status === 'unreachable')).toBe(true)
  })

  it('validates the caller assertion used by the connected-roads MST shortcut', () => {
    const base = {
      ...input(),
      roadCells: [0, 8],
      landings: [{ id: 'target', cell: 4 }],
      options: { method: 'mst' as const, roadsConnected: true },
    }
    expect(() => projectRoads(base)).toThrow('not connected')
    expect(
      projectRoads({ ...base, roadCells: [0, 1, 2], options: { ...base.options, roadsInWeight: false } }).targets[0]
        .status,
    ).toBe('connected')
  })

  it('rejects the MST shortcut when geometrically connected seed travel still has a nonzero cost', () => {
    const base: RoadsInput = {
      grid: grid(7, 3, undefined, 1),
      roadCells: [0, 1, 2, 3, 4, 5, 6],
      landings: [
        { id: 'west', cell: 14 },
        { id: 'east', cell: 20 },
      ],
      options: { method: 'mst', neighbourhood: 'rook', roadsInWeight: true },
    }
    expect(projectRoads(base).newLengthM).toBe(4)
    expect(() => projectRoads({ ...base, options: { ...base.options, roadsConnected: true } })).toThrow('zero-cost')
    expect(
      projectRoads({ ...base, options: { ...base.options, roadsInWeight: false, roadsConnected: true } }).newLengthM,
    ).toBe(4)
  })

  it('retains only constructed edge discounts when extending a graph to another period', () => {
    const first = projectRoads({
      ...input(3, 2),
      landings: [{ id: 'first', cell: 4 }],
      options: { method: 'ilcp', neighbourhood: 'rook', roadsInWeight: false },
    })
    const graphBefore = Array.from(first.simulation.graph.weights)
    const second = extendRoads(first.simulation, [{ id: 'second', cell: 5 }])
    expect(second.simulation.graph.baseWeights).toBe(first.simulation.graph.baseWeights)
    expect(second.simulation.graph.weights).not.toBe(first.simulation.graph.weights)
    expect(Array.from(first.simulation.graph.weights)).toEqual(graphBefore)
    expect(first.simulation.stage).toBe(1)
    expect(second.simulation.stage).toBe(2)
    expect(second.newLengthM).toBe(10)
    expect(second.objective).toBe(10)
    expect(second.simulation.cumulativeNewLengthM).toBe(first.newLengthM + second.newLengthM)
    const untouched = roadEdgeBetween(second.simulation.graph, 2, 5)
    expect(second.simulation.graph.weights[untouched]).toBe(10)
    expect(() => extendRoads(first.simulation, [{ id: 'next', cell: 5 }], { neighbourhood: 'queen' })).toThrow(
      'Start a new simulation',
    )
  })

  it('keeps the initial nearest-road endpoint fixed during ILCP and applies reproducible ordering', () => {
    const base = input(1, 6)
    base.landings = [
      { id: 'far', cell: 5 },
      { id: 'middle', cell: 3 },
      { id: 'near', cell: 1 },
    ]
    const close = projectRoads({ ...base, options: { method: 'ilcp', ordering: 'closest' } })
    const far = projectRoads({ ...base, options: { method: 'ilcp', ordering: 'farthest' } })
    expect(close.paths.map((path) => path.targetIds[0])).toEqual(['near', 'middle', 'far'])
    expect(far.paths.map((path) => path.targetIds[0])).toEqual(['far', 'middle', 'near'])
    expect(close.paths.every((path) => path.toCell === 0)).toBe(true)
    const random = () =>
      projectRoads({ ...base, options: { method: 'ilcp', ordering: 'random', randomSeed: 42 } }).paths.map(
        (path) => path.targetIds[0],
      )
    expect(random()).toEqual(random())
  })

  it('rejects a snap baseline across exclusions rather than silently burning a road through them', () => {
    const result = projectRoads({ ...input(3, 1), grid: grid(3, 1, [1, NaN, 1]), options: { method: 'snap' } })
    expect(result.targets[0].status).toBe('unreachable')
    expect(result.paths).toEqual([])
    expect(result.simulation.roadCells).toEqual([0])
    expect(result.warnings.join(' ')).toContain('Unlike R snap')
  })

  it('keeps the snap baseline independent of the routed-neighbourhood selector', () => {
    const base = input(4, 3)
    const rook = projectRoads({ ...base, options: { method: 'snap', neighbourhood: 'rook' } })
    const octagon = projectRoads({ ...base, options: { method: 'snap', neighbourhood: 'octagon' } })
    expect(rook.targets[0].status).toBe('connected')
    expect(rook.paths).toEqual(octagon.paths)
    expect(() => extendRoads(rook.simulation, [{ id: 'next', cell: 7 }], { method: 'ilcp' })).toThrow(
      'Start a new simulation',
    )
  })

  it('bounds targets and honours cancellation inside the graph solver', () => {
    expect(() =>
      projectRoads({ ...input(), landings: Array.from({ length: 65 }, (_, i) => ({ id: `p${i}`, cell: 8 })) }),
    ).toThrow('at most 64')
    expect(() => projectRoads(input(), { shouldAbort: () => true })).toThrow('cancelled')
    const graph = getGraph(input())
    expect(() => graphDistances(graph, [0], { shouldAbort: () => true })).toThrow('cancelled')
  })
})

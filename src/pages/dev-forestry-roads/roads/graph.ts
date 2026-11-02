/** Pure, bounded graph support for the browser adaptation of LandSciTech/roads. */
import { DEFAULT_GRADE_PENALTY, gradePenaltyFn, simpleCostFn, terrainGradeCost } from './weights'
import type { RoadsCallbacks, RoadsDistanceTree, RoadsGraph, RoadsGrid, RoadsInput, RoadsOptions } from './types'

export const MAX_ROADS_CELLS = 250_000
export const MAX_ROADS_TARGETS = 64
export const DEFAULT_ROADS_OPTIONS: RoadsOptions = {
  method: 'ilcp',
  neighbourhood: 'octagon',
  weightFunction: 'simple',
  roadsInWeight: true,
  roadsConnected: false,
  ordering: 'closest',
  randomSeed: 1,
  grade: DEFAULT_GRADE_PENALTY,
  preventCornerCutting: false,
  gradeMode: 'upstream',
}

export function normalizeRoadsOptions(input: RoadsInput['options'] = {}): RoadsOptions {
  const options = { ...DEFAULT_ROADS_OPTIONS, ...input, grade: { ...DEFAULT_GRADE_PENALTY, ...input.grade } }
  if (!['lcp', 'ilcp', 'mst', 'snap'].includes(options.method)) throw Error('Unknown road-network method.')
  if (!['rook', 'queen', 'octagon'].includes(options.neighbourhood)) throw Error('Unknown road-network neighbourhood.')
  if (!['simple', 'grade'].includes(options.weightFunction)) throw Error('Unknown road-network weight function.')
  if (!['upstream', 'terrain'].includes(options.gradeMode)) throw Error('Unknown road-network grade mode.')
  if (!['closest', 'farthest', 'input', 'random'].includes(options.ordering)) throw Error('Unknown landing order.')
  for (const name of ['roadsInWeight', 'roadsConnected', 'preventCornerCutting'] as const) {
    if (typeof options[name] !== 'boolean') throw Error(`${name} must be true or false.`)
  }
  const { baseCost, limit, penalty, limitWeight } = options.grade
  if (![baseCost, limit, penalty].every((n) => Number.isFinite(n) && n >= 0)) {
    throw Error('Grade costs and the maximum grade must be finite, non-negative values.')
  }
  if (limitWeight !== undefined && !(Number.isFinite(limitWeight) && limitWeight >= 0)) {
    throw Error('The optional over-limit weight must be finite and non-negative.')
  }
  if (!Number.isSafeInteger(options.randomSeed)) throw Error('The random seed must be an integer.')
  return options
}

export function validateRoadsGrid(grid: RoadsGrid): void {
  if (!Number.isSafeInteger(grid.width) || !Number.isSafeInteger(grid.height) || grid.width < 1 || grid.height < 1) {
    throw Error('The network grid must have positive integer dimensions.')
  }
  const count = grid.width * grid.height
  if (count > MAX_ROADS_CELLS)
    throw Error(`The network grid exceeds the ${MAX_ROADS_CELLS.toLocaleString('en')} cell limit.`)
  if (!(grid.values instanceof Float64Array) || grid.values.length !== count)
    throw Error('Grid weights do not match its dimensions.')
  if (!grid.origin.every(Number.isFinite) || !Number.isFinite(grid.cellM) || grid.cellM <= 0) {
    throw Error('The network grid needs a finite origin and positive cell size in metres.')
  }
}

export function roadsCellCentre(grid: RoadsGrid, cell: number): [number, number] {
  return [
    grid.origin[0] + (cell % grid.width) * grid.cellM,
    grid.origin[1] - Math.floor(cell / grid.width) * grid.cellM,
  ]
}

export function roadsCellAt(grid: RoadsGrid, xy: [number, number]): number {
  const col = Math.floor((xy[0] - grid.origin[0]) / grid.cellM + 0.5)
  const row = Math.floor((grid.origin[1] - xy[1]) / grid.cellM + 0.5)
  return col >= 0 && row >= 0 && col < grid.width && row < grid.height ? row * grid.width + col : -1
}

export function checkRoadsAbort(callbacks: RoadsCallbacks): void {
  if (callbacks.shouldAbort?.()) throw Error('Road network calculation cancelled.')
}

/** Create the graph once. The four forward neighbours store every undirected edge exactly once. */
export function getGraph(input: RoadsInput, callbacks: RoadsCallbacks = {}): RoadsGraph {
  validateRoadsGrid(input.grid)
  const options = normalizeRoadsOptions(input.options)
  // Snap is independent of the routed neighbourhood. A rook selection must not
  // reject a diagonal straight baseline just because routed alternatives use four neighbours.
  const neighbourhood = options.method === 'snap' ? 'octagon' : options.neighbourhood
  const { grid } = input
  const count = grid.width * grid.height
  if (options.weightFunction === 'grade' && options.gradeMode === 'terrain' && input.elevations?.length !== count) {
    throw Error('Terrain grade mode needs a separate elevation value for every grid cell.')
  }
  const source = grid.values
  const values = new Float64Array(source)
  const roads = new Uint8Array(count)
  for (const cell of input.roadCells) {
    if (Number.isSafeInteger(cell) && cell >= 0 && cell < count && Number.isFinite(source[cell])) {
      roads[cell] = 1
      if (!options.roadsInWeight) values[cell] = 0
    }
  }
  const passable = new Uint8Array(count)
  for (let cell = 0; cell < count; cell++) {
    if (options.weightFunction === 'simple' && Number.isFinite(values[cell]) && values[cell] < 0) {
      throw Error('Simple costs cannot be negative. Use NaN for a hard exclusion or grade mode for barrier penalties.')
    }
    passable[cell] = Number.isFinite(values[cell]) ? 1 : 0
    if (
      options.weightFunction === 'grade' &&
      options.gradeMode === 'terrain' &&
      !Number.isFinite(input.elevations![cell])
    ) {
      passable[cell] = 0
    }
  }
  const maxEdges = count * (neighbourhood === 'rook' ? 2 : 4)
  const from = new Uint32Array(maxEdges)
  const to = new Uint32Array(maxEdges)
  const weights = new Float64Array(maxEdges)
  const lengths = new Float64Array(maxEdges)
  const degree = new Uint32Array(count)
  let edgeCount = 0
  const steps =
    neighbourhood === 'rook'
      ? [
          [1, 0],
          [0, 1],
        ]
      : [
          [1, 0],
          [0, 1],
          [1, 1],
          [-1, 1],
        ]
  for (let cell = 0; cell < count; cell++) {
    if ((cell & 4095) === 0) {
      checkRoadsAbort(callbacks)
      callbacks.onProgress?.({ phase: 'graph', completed: cell, total: count })
    }
    if (!passable[cell]) continue
    const row = Math.floor(cell / grid.width)
    const col = cell % grid.width
    for (const [dx, dy] of steps) {
      const x = col + dx
      const y = row + dy
      if (x < 0 || x >= grid.width || y >= grid.height) continue
      const next = y * grid.width + x
      if (!passable[next]) continue
      const diagonal = dx !== 0 && dy !== 0
      if (
        diagonal &&
        options.preventCornerCutting &&
        (!passable[row * grid.width + x] || !passable[y * grid.width + col])
      )
        continue
      const physicalDistance = grid.cellM * (diagonal ? Math.SQRT2 : 1)
      const weightDistance = diagonal && neighbourhood === 'queen' ? grid.cellM : physicalDistance
      let cost: number
      if (options.weightFunction === 'simple') {
        cost = simpleCostFn(values[cell], values[next], weightDistance)
      } else if (options.gradeMode === 'upstream') {
        cost = gradePenaltyFn(values[cell], values[next], weightDistance, options.grade)
      } else if (roads[cell] && roads[next] && (!options.roadsInWeight || (source[cell] === 0 && source[next] === 0))) {
        cost = 0
      } else if (Math.min(values[cell], values[next]) < 0) {
        cost = Math.abs(Math.min(values[cell], values[next])) * weightDistance
      } else {
        // Terrain mode has a separate DEM: positive grid values are relative cost multipliers.
        // A pre-burn road zero inherits the other endpoint's multiplier instead of halving it.
        const a = roads[cell] && source[cell] === 0 ? source[next] : source[cell]
        const b = roads[next] && source[next] === 0 ? source[cell] : source[next]
        cost =
          terrainGradeCost(input.elevations![cell], input.elevations![next], weightDistance, options.grade) *
          ((a + b) / 2)
      }
      if (!Number.isFinite(cost)) continue
      if (cost < 0) throw Error('Road graph costs must be non-negative.')
      from[edgeCount] = cell
      to[edgeCount] = next
      weights[edgeCount] = cost
      lengths[edgeCount] = physicalDistance
      degree[cell]++
      degree[next]++
      edgeCount++
    }
  }
  const offsets = new Uint32Array(count + 1)
  for (let cell = 0; cell < count; cell++) offsets[cell + 1] = offsets[cell] + degree[cell]
  const neighbours = new Uint32Array(edgeCount * 2)
  const edgeIds = new Uint32Array(edgeCount * 2)
  const cursor = new Uint32Array(offsets.subarray(0, count))
  for (let edge = 0; edge < edgeCount; edge++) {
    const a = from[edge]
    const b = to[edge]
    let index = cursor[a]++
    neighbours[index] = b
    edgeIds[index] = edge
    index = cursor[b]++
    neighbours[index] = a
    edgeIds[index] = edge
  }
  callbacks.onProgress?.({ phase: 'graph', completed: count, total: count })
  const graphWeights = weights.slice(0, edgeCount)
  return {
    cellCount: count,
    offsets,
    neighbours,
    edgeIds,
    from: from.slice(0, edgeCount),
    to: to.slice(0, edgeCount),
    weights: graphWeights,
    baseWeights: new Float64Array(graphWeights),
    lengths: lengths.slice(0, edgeCount),
    passable,
  }
}

/** Indexed heap: each unsettled vertex has one entry, bounding storage to O(cells). */
class MinHeap {
  private readonly cells: Int32Array
  private readonly positions: Int32Array
  private length = 0
  constructor(private readonly distances: Float64Array) {
    this.cells = new Int32Array(distances.length)
    this.positions = new Int32Array(distances.length).fill(-1)
  }
  private before(a: number, b: number): boolean {
    return this.distances[a] < this.distances[b] || (this.distances[a] === this.distances[b] && a < b)
  }
  update(cell: number): void {
    let pos = this.positions[cell]
    if (pos === -2) return
    if (pos < 0) {
      pos = this.length++
      this.cells[pos] = cell
    }
    while (pos > 0) {
      const parent = (pos - 1) >> 1
      const parentCell = this.cells[parent]
      if (!this.before(cell, parentCell)) break
      this.cells[pos] = parentCell
      this.positions[parentCell] = pos
      pos = parent
    }
    this.cells[pos] = cell
    this.positions[cell] = pos
  }
  pop(): number {
    if (!this.length) return -1
    const result = this.cells[0]
    this.positions[result] = -2
    const cell = this.cells[--this.length]
    if (!this.length) return result
    let pos = 0
    while (2 * pos + 1 < this.length) {
      let child = 2 * pos + 1
      if (child + 1 < this.length && this.before(this.cells[child + 1], this.cells[child])) child++
      if (!this.before(this.cells[child], cell)) break
      this.cells[pos] = this.cells[child]
      this.positions[this.cells[pos]] = pos
      pos = child
    }
    this.cells[pos] = cell
    this.positions[cell] = pos
    return result
  }
}

/** Multi-source Dijkstra. Unreachable cells retain Infinity, never zero. */
export function graphDistances(
  graph: RoadsGraph,
  sources: number[],
  options: RoadsCallbacks & { targetCells?: number[] } = {},
): RoadsDistanceTree {
  const distances = new Float64Array(graph.cellCount).fill(Infinity)
  const previous = new Int32Array(graph.cellCount).fill(-1)
  const previousEdge = new Int32Array(graph.cellCount).fill(-1)
  const settled = new Uint8Array(graph.cellCount)
  const heap = new MinHeap(distances)
  for (const source of sources) {
    if (!Number.isSafeInteger(source) || source < 0 || source >= graph.cellCount || !graph.passable[source]) continue
    distances[source] = 0
    heap.update(source)
  }
  const targets = options.targetCells ? new Set(options.targetCells) : undefined
  let visited = 0
  while (true) {
    const current = heap.pop()
    if (current < 0) break
    settled[current] = 1
    if ((visited++ & 4095) === 0) checkRoadsAbort(options)
    if (targets) {
      targets.delete(current)
      if (!targets.size) break
    }
    for (let index = graph.offsets[current]; index < graph.offsets[current + 1]; index++) {
      const next = graph.neighbours[index]
      if (settled[next]) continue
      const edge = graph.edgeIds[index]
      const distance = distances[current] + graph.weights[edge]
      if (distance < distances[next]) {
        distances[next] = distance
        previous[next] = current
        previousEdge[next] = edge
        heap.update(next)
      }
    }
  }
  return { distances, previous, previousEdge }
}

export function shortestCellPath(tree: RoadsDistanceTree, target: number): number[] {
  if (target < 0 || target >= tree.distances.length || !Number.isFinite(tree.distances[target])) return []
  const path: number[] = []
  let current = target
  while (current >= 0 && path.length <= tree.distances.length) {
    path.push(current)
    current = tree.previous[current]
  }
  if (path.length > tree.distances.length) throw Error('Invalid predecessor cycle in road graph.')
  return path.reverse()
}

export function roadEdgeBetween(graph: RoadsGraph, a: number, b: number): number {
  for (let index = graph.offsets[a]; index < graph.offsets[a + 1]; index++) {
    if (graph.neighbours[index] === b) return graph.edgeIds[index]
  }
  return -1
}

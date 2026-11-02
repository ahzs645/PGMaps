/**
 * Browser adaptation of LandSciTech/roads' LCP, iterative LCP, MST and snap methods.
 * Apache-2.0; see LICENSE and NOTICE. Uses cell-centre inputs and deterministic ties.
 */
import {
  MAX_ROADS_TARGETS,
  checkRoadsAbort,
  getGraph,
  graphDistances,
  normalizeRoadsOptions,
  roadEdgeBetween,
  shortestCellPath,
  validateRoadsGrid,
} from './graph'
import type {
  RoadsCallbacks,
  RoadsGraph,
  RoadsInput,
  RoadsLanding,
  RoadsPath,
  RoadsResult,
  RoadsSimulation,
  RoadsTargetResult,
} from './types'

function validateLandings(landings: RoadsLanding[]): void {
  if (!Array.isArray(landings) || !landings.length) throw Error('Supply at least one landing.')
  if (landings.length > MAX_ROADS_TARGETS) throw Error(`A network stage accepts at most ${MAX_ROADS_TARGETS} landings.`)
  const ids = new Set<string>()
  for (const landing of landings) {
    if (typeof landing.id !== 'string' || !landing.id.trim() || ids.has(landing.id))
      throw Error('Landing IDs must be non-empty and unique within a stage.')
    ids.add(landing.id)
  }
}

/** Initial graph construction; inputs are not mutated. */
export function projectRoads(input: RoadsInput, callbacks: RoadsCallbacks = {}): RoadsResult {
  validateLandings(input.landings)
  validateRoadsGrid(input.grid)
  const options = normalizeRoadsOptions(input.options)
  const graph = getGraph(input, callbacks)
  const roadCells = [
    ...new Set(
      input.roadCells.filter(
        (cell) => Number.isSafeInteger(cell) && cell >= 0 && cell < graph.cellCount && graph.passable[cell],
      ),
    ),
  ].sort((a, b) => a - b)
  if (!roadCells.length) throw Error('No existing road cells remain inside the passable grid.')
  const values = new Float64Array(input.grid.values)
  if (!options.roadsInWeight) for (const cell of roadCells) values[cell] = 0
  const simulation: RoadsSimulation = {
    version: 1,
    grid: { ...input.grid, origin: [...input.grid.origin], values },
    options,
    graph,
    seedRoadCells: [...roadCells],
    roadCells,
    constructedEdges: new Uint32Array(),
    stage: 0,
    cumulativeNewLengthM: 0,
    cumulativeObjective: 0,
  }
  return runStage(simulation, input.landings, callbacks)
}

/**
 * Continue a simulation without rebuilding its graph. Previously constructed edges stay free;
 * weights adjacent to those edges retain their original costs, matching the upstream algorithm.
 * Inputs remain unchanged, so a previous result can be compared with a later stage.
 */
export function extendRoads(
  simulation: RoadsSimulation,
  landings: RoadsLanding[],
  options: Pick<RoadsInput, 'options'>['options'] = {},
  callbacks: RoadsCallbacks = {},
): RoadsResult {
  validateLandings(landings)
  if (simulation.version !== 1) throw Error('Unsupported road simulation version.')
  const nextOptions = normalizeRoadsOptions({
    ...simulation.options,
    ...options,
    grade: { ...simulation.options.grade, ...options?.grade },
  })
  // A changed method/order may reuse the graph; costs and neighbourhood require a fresh run.
  const original = simulation.options
  if ((nextOptions.method === 'snap') !== (original.method === 'snap')) {
    throw Error('Start a new simulation to change between snap and a routed network method.')
  }
  if (
    nextOptions.neighbourhood !== original.neighbourhood ||
    nextOptions.weightFunction !== original.weightFunction ||
    nextOptions.gradeMode !== original.gradeMode ||
    nextOptions.roadsInWeight !== original.roadsInWeight ||
    nextOptions.preventCornerCutting !== original.preventCornerCutting ||
    JSON.stringify(nextOptions.grade) !== JSON.stringify(original.grade)
  )
    throw Error('Start a new simulation to change grid costs, neighbourhood, grade limits or exclusion rules.')
  const next: RoadsSimulation = {
    ...simulation,
    options: nextOptions,
    grid: { ...simulation.grid, values: new Float64Array(simulation.grid.values) },
    graph: { ...simulation.graph, weights: new Float64Array(simulation.graph.weights) },
    roadCells: [...simulation.roadCells],
    seedRoadCells: [...simulation.seedRoadCells],
    constructedEdges: new Uint32Array(simulation.constructedEdges),
  }
  return runStage(next, landings, callbacks)
}

interface LandingEndpoint {
  target: RoadsTargetResult
  roadCell: number
  distance2: number
}

/** Seeded Fisher-Yates is an explicit browser extension; upstream offers closest or input order. */
function orderedLandings<T extends { distance2: number }>(items: T[], simulation: RoadsSimulation): T[] {
  const ordered = [...items]
  const { ordering, randomSeed } = simulation.options
  if (ordering === 'closest') ordered.sort((a, b) => a.distance2 - b.distance2)
  if (ordering === 'farthest') ordered.sort((a, b) => b.distance2 - a.distance2)
  if (ordering === 'random') {
    let seed = randomSeed >>> 0
    const random = () => {
      seed += 0x6d2b79f5
      let n = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      n ^= n + Math.imul(n ^ (n >>> 7), 61 | n)
      return ((n ^ (n >>> 14)) >>> 0) / 4294967296
    }
    for (let index = ordered.length - 1; index > 0; index--) {
      const other = Math.floor(random() * (index + 1))
      ;[ordered[index], ordered[other]] = [ordered[other], ordered[index]]
    }
  }
  return ordered
}

/** Nearest Euclidean seed is chosen before graph routing, as in upstream getClosestRoad. */
function nearestSeed(cell: number, seeds: number[], width: number): { cell: number; distance2: number } {
  const x = cell % width
  const y = Math.floor(cell / width)
  let result = seeds[0]
  let distance2 = Infinity
  for (const seed of seeds) {
    const dx = x - (seed % width)
    const dy = y - Math.floor(seed / width)
    const d = dx * dx + dy * dy
    if (d < distance2 || (d === distance2 && seed < result)) {
      result = seed
      distance2 = d
    }
  }
  return { cell: result, distance2 }
}

function seedRoadsConnected(graph: RoadsGraph, seeds: number[], mask: Uint8Array): boolean {
  const visited = new Uint8Array(graph.cellCount)
  const queue = [seeds[0]]
  visited[seeds[0]] = 1
  for (let at = 0; at < queue.length; at++) {
    const cell = queue[at]
    for (let edge = graph.offsets[cell]; edge < graph.offsets[cell + 1]; edge++) {
      const next = graph.neighbours[edge]
      if (mask[next] && !visited[next] && graph.weights[graph.edgeIds[edge]] === 0) {
        visited[next] = 1
        queue.push(next)
      }
    }
  }
  return seeds.every((cell) => visited[cell])
}

function runStage(simulation: RoadsSimulation, landings: RoadsLanding[], callbacks: RoadsCallbacks): RoadsResult {
  checkRoadsAbort(callbacks)
  const { graph, grid, options } = simulation
  const initialRoadCells = [...simulation.roadCells]
  const roadMask = new Uint8Array(graph.cellCount)
  for (const cell of initialRoadCells) roadMask[cell] = 1
  const previousEdges = new Uint8Array(graph.weights.length)
  const seedMask = new Uint8Array(graph.cellCount)
  for (const cell of simulation.seedRoadCells) seedMask[cell] = 1
  for (const edge of simulation.constructedEdges) previousEdges[edge] = 1
  for (let edge = 0; edge < graph.weights.length; edge++) {
    if (seedMask[graph.from[edge]] && seedMask[graph.to[edge]]) previousEdges[edge] = 1
  }
  const warnings: string[] = []
  if (options.weightFunction === 'grade' && options.gradeMode === 'upstream') {
    warnings.push(
      'Upstream grade mode overloads zero as road and negative values as barriers. Zero road elevations still participate in its grade-limit test; this is a relative package objective, not a construction estimate.',
    )
  }
  if (options.weightFunction === 'grade' && options.gradeMode === 'terrain') {
    warnings.push(
      'Terrain grade mode is a PGMaps extension: unchanged elevations determine grade and positive grid values multiply cost. Selected road edges are free when burned to zero; preserved nonzero road weights remain in the objective.',
    )
  }
  if (!options.preventCornerCutting && (options.neighbourhood !== 'rook' || options.method === 'snap')) {
    warnings.push(
      'Upstream diagonal behaviour can pass between blocked cells. Enable corner protection for constrained planning.',
    )
  }
  if (options.method === 'snap')
    warnings.push(
      'Snap is a straight-line geometric comparison. It does not optimize cost or grade and is not an engineered alignment.',
    )
  if (options.roadsInWeight && !initialRoadCells.some((cell) => grid.values[cell] === 0)) {
    warnings.push('No supplied seed cell has zero weight. Existing roads have not been burned into the weight raster.')
  }
  if (options.method === 'mst' && options.roadsConnected && !seedRoadsConnected(graph, initialRoadCells, roadMask)) {
    throw Error(
      'The selected seed roads are not connected by zero-cost road links in this grid. Turn off “Seed roads already connected”, burn the road weights to zero, or supply the missing road links.',
    )
  }
  const targets: RoadsTargetResult[] = landings.map((landing) => ({ ...landing, status: 'unreachable', pathIds: [] }))
  const endpoints: LandingEndpoint[] = []
  for (const target of targets) {
    if (!Number.isSafeInteger(target.cell) || target.cell < 0 || target.cell >= graph.cellCount) {
      target.status = 'outside'
      target.message = 'Landing lies outside the analysis grid.'
    } else if (!graph.passable[target.cell]) {
      target.status = 'blocked'
      target.message = 'Landing has missing terrain or lies in an exclusion.'
    } else if (roadMask[target.cell]) {
      target.status = 'already-connected'
    } else {
      const seed = nearestSeed(target.cell, initialRoadCells, grid.width)
      endpoints.push({ target, roadCell: seed.cell, distance2: seed.distance2 })
    }
  }
  const paths: RoadsPath[] = []
  const addedEdges = new Set<number>()
  const reusedEdges = new Set<number>()
  const visitedNewEdges = new Set<number>()
  const newCells = new Set<number>()
  let newLengthM = 0
  let reusedLengthM = 0
  let objective = 0
  const addPath = (
    cells: number[],
    pathObjective: number,
    targetIds: string[],
    incremental: boolean,
  ): RoadsPath | undefined => {
    if (!cells.length) return
    let length = 0
    let newLength = 0
    let reusedLength = 0
    for (const cell of cells) newCells.add(cell)
    for (let index = 1; index < cells.length; index++) {
      const edge = roadEdgeBetween(graph, cells[index - 1], cells[index])
      if (edge < 0) throw Error('A road path contains an edge excluded by the graph.')
      const distance = graph.lengths[edge]
      length += distance
      if (previousEdges[edge] || visitedNewEdges.has(edge)) reusedLength += distance
      else newLength += distance
      if (previousEdges[edge]) {
        if (!reusedEdges.has(edge)) reusedLengthM += distance
        reusedEdges.add(edge)
      } else if (!addedEdges.has(edge)) {
        newLengthM += distance
        objective += graph.baseWeights[edge]
        addedEdges.add(edge)
      }
      visitedNewEdges.add(edge)
      if (incremental) graph.weights[edge] = 0
    }
    const path: RoadsPath = {
      id: `stage-${simulation.stage + 1}-path-${paths.length + 1}`,
      fromCell: cells[0],
      toCell: cells[cells.length - 1],
      cells,
      objective: pathObjective,
      lengthM: length,
      newLengthM: newLength,
      reusedLengthM: reusedLength,
      targetIds,
    }
    paths.push(path)
    return path
  }
  const connectTarget = (target: RoadsTargetResult, path: RoadsPath | undefined) => {
    if (path) {
      target.status = 'connected'
      target.pathIds.push(path.id)
    } else {
      target.message = 'No permitted path reaches its nearest initial road cell.'
    }
  }
  if (options.method === 'lcp' || options.method === 'ilcp') {
    const ordered = options.method === 'ilcp' ? orderedLandings(endpoints, simulation) : endpoints
    for (let index = 0; index < ordered.length; index++) {
      checkRoadsAbort(callbacks)
      callbacks.onProgress?.({ phase: 'routing', completed: index, total: ordered.length })
      const { target, roadCell } = ordered[index]
      const tree = graphDistances(graph, [target.cell], { ...callbacks, targetCells: [roadCell] })
      const path = addPath(
        shortestCellPath(tree, roadCell),
        tree.distances[roadCell],
        [target.id],
        options.method === 'ilcp',
      )
      connectTarget(target, path)
    }
  } else if (options.method === 'mst') {
    const landingCells = [...new Set(endpoints.map(({ target }) => target.cell))]
    let anchorCells = [...new Set(endpoints.map(({ roadCell }) => roadCell))]
    if (options.roadsConnected) anchorCells = anchorCells.slice(0, 1)
    const vertices = [...new Set([...landingCells, ...anchorCells])]
    const anchorSet = new Set(anchorCells)
    const size = vertices.length
    const costs = new Float64Array(size * size).fill(Infinity)
    for (let from = 0; from < size; from++) {
      checkRoadsAbort(callbacks)
      callbacks.onProgress?.({ phase: 'mst', completed: from, total: size })
      const tree = graphDistances(graph, [vertices[from]], { ...callbacks, targetCells: vertices })
      for (let to = 0; to < size; to++) costs[from * size + to] = tree.distances[vertices[to]]
    }
    // Prim on the finite metric closure, one component at a time. A component without
    // an existing-road anchor is rejected instead of presenting an isolated landing tree.
    const seen = new Uint8Array(size)
    const pairs: [number, number][] = []
    for (let start = 0; start < size; start++) {
      if (seen[start]) continue
      const component = vertices
        .map((_, index) => index)
        .filter((index) => Number.isFinite(costs[start * size + index]))
      if (!component.some((index) => anchorSet.has(vertices[index]))) {
        for (const index of component) seen[index] = 1
        continue
      }
      const best = new Float64Array(size).fill(Infinity)
      const parent = new Int32Array(size).fill(-1)
      best[start] = 0
      for (let iteration = 0; iteration < component.length; iteration++) {
        let next = -1
        for (const index of component) {
          if (
            !seen[index] &&
            (next < 0 || best[index] < best[next] || (best[index] === best[next] && vertices[index] < vertices[next]))
          )
            next = index
        }
        if (next < 0 || !Number.isFinite(best[next])) break
        seen[next] = 1
        if (parent[next] >= 0) pairs.push([vertices[parent[next]], vertices[next]])
        for (const other of component) {
          const cost = costs[next * size + other]
          if (
            !seen[other] &&
            (cost < best[other] ||
              (cost === best[other] && (parent[other] < 0 || vertices[next] < vertices[parent[other]])))
          ) {
            best[other] = cost
            parent[other] = next
          }
        }
      }
    }
    // All shortest paths use the same graph before any newly selected edges are zeroed.
    for (let index = 0; index < pairs.length; index++) {
      const [from, to] = pairs[index]
      checkRoadsAbort(callbacks)
      const tree = graphDistances(graph, [from], { ...callbacks, targetCells: [to] })
      const ids = endpoints
        .filter(({ target }) => target.cell === from || target.cell === to)
        .map(({ target }) => target.id)
      addPath(shortestCellPath(tree, to), tree.distances[to], ids, false)
    }
    for (const { target } of endpoints) {
      const ids = paths.filter((path) => path.cells.includes(target.cell)).map((path) => path.id)
      if (ids.length) {
        target.status = 'connected'
        target.pathIds = ids
      } else target.message = 'No finite network connection reaches an existing road.'
    }
  } else {
    for (let index = 0; index < endpoints.length; index++) {
      checkRoadsAbort(callbacks)
      const { target, roadCell } = endpoints[index]
      const cells = snapCellPath(target.cell, roadCell, grid.width)
      const crossingBlocked = cells.some((cell) => !graph.passable[cell])
      let failed = crossingBlocked
      let cost = 0
      for (let at = 1; !failed && at < cells.length; at++) {
        const edge = roadEdgeBetween(graph, cells[at - 1], cells[at])
        if (edge < 0) failed = true
        else cost += graph.weights[edge]
      }
      // The R snap method ignores constraints. Browser safety mode rejects a line whose
      // touched cell chain is excluded; it never silently turns blocked ground into roads.
      if (failed) {
        target.message = 'The straight snap line crosses excluded cells, an unavailable graph edge or the grade limit.'
        continue
      }
      connectTarget(target, addPath(cells, cost, [target.id], false))
    }
    warnings.push(
      'Snap outputs a rasterized cell-centre line. Unlike R snap, blocked or grade-excluded graph edges are rejected rather than burned through.',
    )
  }
  for (const edge of visitedNewEdges) graph.weights[edge] = 0
  for (const cell of newCells) simulation.grid.values[cell] = 0
  simulation.roadCells = [...new Set([...initialRoadCells, ...newCells])].sort((a, b) => a - b)
  simulation.constructedEdges = Uint32Array.from(new Set([...simulation.constructedEdges, ...addedEdges]))
  simulation.stage++
  simulation.cumulativeNewLengthM += newLengthM
  simulation.cumulativeObjective += objective
  callbacks.onProgress?.({ phase: 'routing', completed: endpoints.length, total: endpoints.length })
  return { method: options.method, paths, targets, newLengthM, reusedLengthM, objective, warnings, simulation }
}

/** Integer Bresenham path, including both ends, for the explicit straight-line baseline. */
function snapCellPath(from: number, to: number, width: number): number[] {
  let x = from % width
  let y = Math.floor(from / width)
  const endX = to % width
  const endY = Math.floor(to / width)
  const dx = Math.abs(endX - x)
  const dy = -Math.abs(endY - y)
  const sx = x < endX ? 1 : -1
  const sy = y < endY ? 1 : -1
  let error = dx + dy
  const cells: number[] = []
  while (true) {
    cells.push(y * width + x)
    if (x === endX && y === endY) break
    const twice = error * 2
    if (twice >= dy) {
      error += dy
      x += sx
    }
    if (twice <= dx) {
      error += dx
      y += sy
    }
  }
  return cells
}

/** Browser equivalents for roads' public raster and landing helpers. See NOTICE.md. */
import { getGraph, graphDistances, roadsCellAt, roadsCellCentre, shortestCellPath, validateRoadsGrid } from './graph'
import type { RoadsGrid } from './types'

export type RoadsXY = [number, number]
export interface RoadsTarget {
  id: string
  name?: string
  /** Polygon components, each an outer ring followed by zero or more holes, in projected metres. */
  polygons: RoadsXY[][][]
}
export interface RoadsLandingPoint {
  id: string
  targetId: string
  name?: string
  point: RoadsXY
}
export interface LandingSamplingOptions {
  /** 'centroid' retains the R API name; its result is guaranteed inside the target. */
  sampleType?: 'centroid' | 'regular' | 'random'
  /** Points per hectare, independent of the supplied CRS identifier. Coordinates must be metres. */
  densityPerHa?: number
  seed?: number
}
export const MAX_LANDING_POINTS = 1_000
export const MAX_LANDING_TARGETS = 500
export const MAX_UTILITY_OPERATIONS = 2_000_000
export const MAX_VECTORIZE_CELLS = 512
export const MAX_VECTORIZE_WORK = 8_000_000

function countOperations() {
  let count = 0
  return (amount = 1) => {
    count += amount
    if (count > MAX_UTILITY_OPERATIONS)
      throw Error('Raster or landing work exceeds its operation budget; reduce the area, geometry or density.')
  }
}

function sourceCells(grid: RoadsGrid, explicit?: number[]): number[] {
  const cells = explicit ?? Array.from(grid.values.keys()).filter((cell) => grid.values[cell] > 0)
  if (cells.some((cell) => !Number.isInteger(cell) || cell < 0 || cell >= grid.values.length)) {
    throw Error('Source cells must be valid integer grid indexes.')
  }
  return [...new Set(cells)].filter((cell) => Number.isFinite(grid.values[cell])).sort((a, b) => a - b)
}

/**
 * All cells touched by the supplied lines, including corner and grid-line contacts.
 * Missing terrain cells are kept missing by default; passing includeNoData is an explicit geometry-only operation.
 */
export function rasterizeLine(
  lines: RoadsXY[][],
  grid: RoadsGrid,
  options: { includeNoData?: boolean } = {},
): number[] {
  validateRoadsGrid(grid)
  const occupied = new Set<number>()
  const tick = countOperations()
  const addAt = (x: number, y: number) => {
    const column = Math.floor(x),
      row = Math.floor(y)
    const columns = Math.abs(x - Math.round(x)) < 1e-9 ? [Math.round(x) - 1, Math.round(x)] : [column]
    const rows = Math.abs(y - Math.round(y)) < 1e-9 ? [Math.round(y) - 1, Math.round(y)] : [row]
    for (const c of columns)
      for (const r of rows) {
        tick()
        if (c >= 0 && c < grid.width && r >= 0 && r < grid.height) {
          const cell = r * grid.width + c
          if (options.includeNoData || Number.isFinite(grid.values[cell])) occupied.add(cell)
        }
      }
  }
  for (const line of lines) {
    tick(line.length)
    if (line.length < 2 || line.some((p) => p.length !== 2 || !p.every(Number.isFinite))) {
      throw Error('A rasterized line needs at least two finite coordinate pairs.')
    }
    for (let index = 1; index < line.length; index++) {
      const [ax, ay] = line[index - 1],
        [bx, by] = line[index]
      const x = (ax - grid.origin[0]) / grid.cellM + 0.5
      const y = (grid.origin[1] - ay) / grid.cellM + 0.5
      const dx = (bx - ax) / grid.cellM,
        dy = (ay - by) / grid.cellM
      let low = 0,
        high = 1
      let outside = false
      for (const [p, q] of [
        [-dx, x],
        [dx, grid.width - x],
        [-dy, y],
        [dy, grid.height - y],
      ]) {
        if (p === 0) {
          if (q < 0) outside = true
          continue
        }
        const t = q / p
        if (p < 0) low = Math.max(low, t)
        else high = Math.min(high, t)
      }
      if (outside || high < low) continue
      const cuts = [low, high]
      for (const [start, delta] of [
        [x, dx],
        [y, dy],
      ]) {
        if (delta === 0) continue
        const a = start + delta * low,
          b = start + delta * high
        for (let edge = Math.ceil(Math.min(a, b)); edge <= Math.floor(Math.max(a, b)); edge++) {
          tick()
          const t = (edge - start) / delta
          if (t > low && t < high) cuts.push(t)
        }
      }
      cuts.sort((a, b) => a - b)
      for (let part = 0; part < cuts.length; part++) {
        addAt(x + dx * cuts[part], y + dy * cuts[part])
        if (part) {
          const t = (cuts[part - 1] + cuts[part]) / 2
          addAt(x + dx * t, y + dy * t)
        }
      }
    }
  }
  return [...occupied].sort((a, b) => a - b)
}

/** Exact one-dimensional squared Euclidean distance transform, ignoring infinite parabolas. */
function squaredDistance1D(values: Float64Array): Float64Array {
  const output = new Float64Array(values.length).fill(Infinity)
  const vertices = new Int32Array(values.length)
  const boundaries = new Float64Array(values.length + 1)
  let last = -1
  for (let q = 0; q < values.length; q++) {
    if (!Number.isFinite(values[q])) continue
    let boundary = -Infinity
    while (last >= 0) {
      const p = vertices[last]
      boundary = (values[q] + q * q - (values[p] + p * p)) / (2 * (q - p))
      if (boundary > boundaries[last]) break
      last--
    }
    last++
    vertices[last] = q
    boundaries[last] = last === 0 ? -Infinity : boundary
    boundaries[last + 1] = Infinity
  }
  if (last < 0) return output
  let active = 0
  for (let q = 0; q < values.length; q++) {
    while (boundaries[active + 1] < q) active++
    output[q] = (q - vertices[active]) ** 2 + values[vertices[active]]
  }
  return output
}

/**
 * Exact straight-line distance to source-cell centres, not travel/haul or least-cost distance.
 * This replaces deprecated getDistFromSource's old focal approximation, following its terra::distance role.
 */
export function getDistFromSource(grid: RoadsGrid, roadCells?: number[], maxDistM = Infinity): RoadsGrid {
  validateRoadsGrid(grid)
  if (!(maxDistM >= 0) || (maxDistM !== Infinity && !Number.isFinite(maxDistM)))
    throw Error('Maximum distance must be non-negative.')
  const sources = sourceCells(grid, roadCells)
  const seed = new Float64Array(grid.values.length).fill(Infinity)
  for (const cell of sources) seed[cell] = 0
  for (let row = 0; row < grid.height; row++) {
    seed.set(squaredDistance1D(seed.subarray(row * grid.width, (row + 1) * grid.width)), row * grid.width)
  }
  const values = new Float64Array(seed.length).fill(NaN)
  for (let column = 0; column < grid.width; column++) {
    const input = Float64Array.from({ length: grid.height }, (_, row) => seed[row * grid.width + column])
    const result = squaredDistance1D(input)
    for (let row = 0; row < grid.height; row++) {
      const cell = row * grid.width + column
      const distance = Math.sqrt(result[row]) * grid.cellM
      if (Number.isFinite(grid.values[cell]) && Number.isFinite(distance) && distance <= maxDistM)
        values[cell] = distance
    }
  }
  return { ...grid, origin: [...grid.origin], values }
}

export interface RoadsRasterLines {
  lines: RoadsXY[][]
  /** Source cells are pixel centres, so reconstructed lines never establish surveyed topology. */
  warnings: string[]
  addedCells: number[]
  components: number
}

/**
 * Approximate raster-road reconstruction: global nearest pairs or an MST on least-cost raster distances.
 * MST uses 0.001 on road cells and 1 on other valid cells, matching the upstream utility's cost surface.
 */
export function rasterToLineSegments(
  grid: RoadsGrid,
  roadCells?: number[],
  options: { method?: 'nearest' | 'mst' } = {},
): RoadsRasterLines {
  validateRoadsGrid(grid)
  const cells = sourceCells(grid, roadCells)
  const method = options.method ?? 'mst'
  if (method !== 'nearest' && method !== 'mst') throw Error('Raster-to-line method must be nearest or mst.')
  if (
    cells.length > MAX_VECTORIZE_CELLS ||
    (method === 'mst' && cells.length * grid.values.length > MAX_VECTORIZE_WORK)
  ) {
    throw Error('Raster-to-line reconstruction exceeds its budget; crop or thin the raster first.')
  }
  const edges = new Map<string, [number, number]>()
  const parent = new Int32Array(grid.values.length).fill(-1)
  const root = (cell: number): number => {
    if (parent[cell] < 0) parent[cell] = cell
    let r = cell
    while (parent[r] !== r) r = parent[r]
    while (parent[cell] !== cell) {
      const next = parent[cell]
      parent[cell] = r
      cell = next
    }
    return r
  }
  const addEdge = (a: number, b: number) => {
    if (a === b) return
    const key = `${Math.min(a, b)}:${Math.max(a, b)}`
    edges.set(key, [Math.min(a, b), Math.max(a, b)])
    parent[root(b)] = root(a)
  }
  const warnings = [
    'Raster reconstruction is approximate; review junctions, gaps and grade-separated crossings before using the lines.',
  ]
  if (method === 'nearest') {
    let minimum = Infinity
    for (let a = 0; a < cells.length; a++)
      for (let b = a + 1; b < cells.length; b++) {
        const p = roadsCellCentre(grid, cells[a]),
          q = roadsCellCentre(grid, cells[b])
        const distance = Math.hypot(p[0] - q[0], p[1] - q[1])
        minimum = Math.min(minimum, distance)
      }
    for (let a = 0; a < cells.length; a++)
      for (let b = a + 1; b < cells.length; b++) {
        const p = roadsCellCentre(grid, cells[a]),
          q = roadsCellCentre(grid, cells[b])
        if (Math.abs(Math.hypot(p[0] - q[0], p[1] - q[1]) - minimum) < grid.cellM * 1e-9) addEdge(cells[a], cells[b])
      }
    warnings.push(
      'Nearest retains all globally nearest pixel pairs; isolated pixels may remain disconnected and inferred straight links may cross gaps.',
    )
  } else if (cells.length > 1) {
    const roadMask = new Set(cells)
    const costs = Float64Array.from(grid.values, (value, cell) =>
      Number.isFinite(value) ? (roadMask.has(cell) ? 0.001 : 1) : NaN,
    )
    const graph = getGraph({
      grid: { ...grid, values: costs },
      roadCells: [],
      landings: [],
      options: {
        method: 'mst',
        weightFunction: 'simple',
        neighbourhood: 'octagon',
        roadsInWeight: true,
        preventCornerCutting: true,
      },
    })
    const used = new Uint8Array(cells.length)
    const best = new Float64Array(cells.length).fill(Infinity)
    const bestFrom = new Int32Array(cells.length).fill(-1)
    best[0] = 0
    for (let step = 0; step < cells.length; step++) {
      let next = -1
      for (let index = 0; index < cells.length; index++)
        if (!used[index] && (next < 0 || best[index] < best[next])) next = index
      if (next < 0) break
      used[next] = 1
      if (bestFrom[next] >= 0 && Number.isFinite(best[next])) {
        const path = shortestCellPath(
          graphDistances(graph, [cells[bestFrom[next]]], { targetCells: [cells[next]] }),
          cells[next],
        )
        for (let i = 1; i < path.length; i++) addEdge(path[i - 1], path[i])
      }
      const distances = graphDistances(graph, [cells[next]], {
        targetCells: cells.filter((_, i) => !used[i]),
      }).distances
      for (let index = 0; index < cells.length; index++) {
        if (!used[index] && distances[cells[index]] < best[index]) {
          best[index] = distances[cells[index]]
          bestFrom[index] = next
        }
      }
    }
  }
  const sourceSet = new Set(cells)
  const addedCells = [...new Set([...edges.values()].flat())]
    .filter((cell) => !sourceSet.has(cell))
    .sort((a, b) => a - b)
  const components = new Set(cells.map(root)).size
  if (addedCells.length)
    warnings.push(
      `MST reconstruction introduced ${addedCells.length} non-road cells to bridge gaps; these are inferred connections.`,
    )
  if (components > 1) warnings.push(`${components} disconnected components remain.`)
  return {
    lines: [...edges.values()]
      .sort((a, b) => a[0] - b[0] || a[1] - b[1])
      .map(([a, b]) => [roadsCellCentre(grid, a), roadsCellCentre(grid, b)]),
    warnings,
    addedCells,
    components,
  }
}

function inRing(point: RoadsXY, ring: RoadsXY[], tick: (amount?: number) => void): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    tick()
    const a = ring[j],
      b = ring[i]
    const cross = (point[0] - a[0]) * (b[1] - a[1]) - (point[1] - a[1]) * (b[0] - a[0])
    if (
      Math.abs(cross) < 1e-8 &&
      point[0] >= Math.min(a[0], b[0]) &&
      point[0] <= Math.max(a[0], b[0]) &&
      point[1] >= Math.min(a[1], b[1]) &&
      point[1] <= Math.max(a[1], b[1])
    )
      return true
    if (a[1] > point[1] !== b[1] > point[1] && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0])
      inside = !inside
  }
  return inside
}

function inPolygon(point: RoadsXY, rings: RoadsXY[][], tick: (amount?: number) => void): boolean {
  return inRing(point, rings[0], tick) && !rings.slice(1).some((hole) => inRing(point, hole, tick))
}

function ringArea(ring: RoadsXY[]): number {
  let area = 0
  const [ox, oy] = ring[0]
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    area += (ring[j][0] - ox) * (ring[i][1] - oy) - (ring[i][0] - ox) * (ring[j][1] - oy)
  return Math.abs(area) / 2
}

function polygonArea(rings: RoadsXY[][]): number {
  return ringArea(rings[0]) - rings.slice(1).reduce((sum, hole) => sum + ringArea(hole), 0)
}

function boundsOf(polygons: RoadsXY[][][]): [number, number, number, number] {
  const bounds: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const rings of polygons)
    for (const ring of rings)
      for (const [x, y] of ring) {
        bounds[0] = Math.min(bounds[0], x)
        bounds[1] = Math.min(bounds[1], y)
        bounds[2] = Math.max(bounds[2], x)
        bounds[3] = Math.max(bounds[3], y)
      }
  return bounds
}

/** Horizontal interior scan; excludes holes and never returns a centroid outside a concave target. */
function interiorPoint(polygons: RoadsXY[][][], tick: (amount?: number) => void): RoadsXY {
  let best: RoadsXY | undefined,
    width = -Infinity
  for (const rings of polygons) {
    const ys = [...new Set(rings.flat().map((p) => p[1]))].sort((a, b) => a - b)
    for (let row = 1; row < ys.length; row++) {
      const y = (ys[row - 1] + ys[row]) / 2
      const xs: number[] = []
      for (const ring of rings)
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          tick()
          const a = ring[j],
            b = ring[i]
          if (a[1] > y !== b[1] > y) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]))
        }
      xs.sort((a, b) => a - b)
      for (let x = 1; x < xs.length; x++) {
        const point: RoadsXY = [(xs[x - 1] + xs[x]) / 2, y]
        if (xs[x] - xs[x - 1] > width && inPolygon(point, rings, tick)) {
          best = point
          width = xs[x] - xs[x - 1]
        }
      }
    }
  }
  if (!best || !(width > 0)) throw Error('A landing target has no valid polygon interior.')
  return best
}

function randomGenerator(seed: number): () => number {
  let value = seed >>> 0
  return () => {
    value += 0x6d2b79f5
    let t = value
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** R's round-to-even count convention. Random coordinates use a documented different seeded generator. */
function roundedCount(value: number): number {
  const floor = Math.floor(value)
  return value - floor === 0.5 ? floor + (floor % 2) : Math.round(value)
}

function rasterTargets(grid: RoadsGrid, tick: (amount?: number) => void): { id: string; cells: number[] }[] {
  validateRoadsGrid(grid)
  const positive = [...new Set(grid.values)].filter((value) => Number.isFinite(value) && value > 0)
  if (positive.length > MAX_LANDING_TARGETS) throw Error('Too many raster harvest IDs.')
  if (positive.length === 0) return []
  if (positive.some((value) => value !== 1)) {
    const groups = new Map<number, number[]>()
    grid.values.forEach((value, cell) => {
      if (Number.isFinite(value) && value > 0) {
        const group = groups.get(value) ?? []
        group.push(cell)
        groups.set(value, group)
      }
    })
    return [...groups].sort((a, b) => a[0] - b[0]).map(([id, cells]) => ({ id: String(id), cells }))
  }
  const visited = new Uint8Array(grid.values.length)
  const groups: { id: string; cells: number[] }[] = []
  for (let cell = 0; cell < grid.values.length; cell++) {
    if (visited[cell] || grid.values[cell] !== 1) continue
    const cells = [cell]
    visited[cell] = 1
    for (let index = 0; index < cells.length; index++) {
      const col = cells[index] % grid.width,
        row = Math.floor(cells[index] / grid.width)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          tick()
          const x = col + dx,
            y = row + dy,
            next = y * grid.width + x
          if (x < 0 || x >= grid.width || y < 0 || y >= grid.height || visited[next] || grid.values[next] !== 1)
            continue
          visited[next] = 1
          cells.push(next)
        }
    }
    groups.push({ id: String(groups.length + 1), cells })
    if (groups.length > MAX_LANDING_TARGETS) throw Error('Too many disconnected raster harvest patches.')
  }
  return groups
}

/** Generate deterministic landing candidates inside polygons or labelled/binary raster harvest patches. */
export function getLandingsFromTarget(
  targets: RoadsTarget[] | RoadsGrid,
  options: LandingSamplingOptions = {},
): RoadsLandingPoint[] {
  const method = options.sampleType ?? 'centroid'
  const density = options.densityPerHa
  if (!['centroid', 'regular', 'random'].includes(method)) throw Error('Unknown landing sample method.')
  if (method !== 'centroid' && !(typeof density === 'number' && Number.isFinite(density) && density > 0))
    throw Error('Provide a positive landing density per hectare.')
  if (options.seed !== undefined && !Number.isSafeInteger(options.seed)) throw Error('Landing seed must be an integer.')
  const random = randomGenerator(options.seed ?? 1),
    tick = countOperations()
  const output: RoadsLandingPoint[] = []
  const add = (targetId: string, point: RoadsXY, name?: string) => {
    if (output.length >= MAX_LANDING_POINTS)
      throw Error(`Landing sampling exceeds ${MAX_LANDING_POINTS} points; reduce density or target area.`)
    output.push({
      id: `${targetId}-${output.filter((p) => p.targetId === targetId).length + 1}`,
      targetId,
      point,
      ...(name ? { name } : {}),
    })
  }
  if (!Array.isArray(targets)) {
    const grid = targets
    for (const target of rasterTargets(grid, tick)) {
      const points = target.cells.map((cell) => roadsCellCentre(grid, cell))
      const mean: RoadsXY = [
        points.reduce((sum, p) => sum + p[0], 0) / points.length,
        points.reduce((sum, p) => sum + p[1], 0) / points.length,
      ]
      const cellSet = new Set(target.cells)
      const interior = cellSet.has(roadsCellAt(grid, mean))
        ? mean
        : points.reduce((best, point) =>
            Math.hypot(point[0] - mean[0], point[1] - mean[1]) < Math.hypot(best[0] - mean[0], best[1] - mean[1])
              ? point
              : best,
          )
      if (method === 'centroid' || target.cells.length === 1) {
        add(target.id, interior)
        continue
      }
      if (method === 'random') {
        const count = Math.max(1, roundedCount((target.cells.length * grid.cellM ** 2 * density!) / 10000))
        if (count === 1) {
          add(target.id, interior)
          continue
        }
        if (count + output.length > MAX_LANDING_POINTS) throw Error('Landing density exceeds the point budget.')
        for (let i = 0; i < count; i++) {
          const center = points[Math.floor(random() * points.length)]
          add(target.id, [center[0] + (random() - 0.5) * grid.cellM, center[1] + (random() - 0.5) * grid.cellM])
        }
      } else {
        const step = Math.sqrt(10000 / density!)
        const bounds = boundsOf([[[...points]]])
        const startX = grid.origin[0] - grid.cellM / 2,
          startY = grid.origin[1] - (grid.height - 0.5) * grid.cellM
        let found = false
        for (
          let y = startY + Math.ceil((bounds[1] - grid.cellM / 2 - startY) / step) * step;
          y <= bounds[3] + grid.cellM / 2;
          y += step
        ) {
          for (
            let x = startX + Math.ceil((bounds[0] - grid.cellM / 2 - startX) / step) * step;
            x <= bounds[2] + grid.cellM / 2;
            x += step
          ) {
            tick()
            if (cellSet.has(roadsCellAt(grid, [x, y]))) {
              add(target.id, [x, y])
              found = true
            }
          }
        }
        if (!found) add(target.id, interior)
      }
    }
    return output
  }
  if (targets.length > MAX_LANDING_TARGETS) throw Error('Too many polygon landing targets.')
  const ids = new Set<string>()
  for (const target of targets) {
    if (!target.id || ids.has(target.id)) throw Error('Landing target IDs must be non-empty and unique.')
    ids.add(target.id)
    if (
      !target.polygons.length ||
      target.polygons.some(
        (rings) =>
          !rings.length ||
          rings.some((ring) => ring.length < 3 || ring.some((p) => p.length !== 2 || !p.every(Number.isFinite))),
      )
    )
      throw Error('Landing targets require finite polygon rings.')
    tick(target.polygons.flat().reduce((sum, ring) => sum + ring.length, 0))
    if (target.polygons.some((rings) => !(polygonArea(rings) > 0)))
      throw Error('Landing polygons must have positive area after subtracting holes.')
  }
  const allBounds = targets.length ? boundsOf(targets.flatMap((target) => target.polygons)) : [0, 0, 0, 0]
  for (const target of targets) {
    const interior = interiorPoint(target.polygons, tick)
    if (method === 'centroid') {
      add(target.id, interior, target.name)
      continue
    }
    const bounds = boundsOf(target.polygons)
    const contains = (point: RoadsXY) => target.polygons.some((rings) => inPolygon(point, rings, tick))
    if (method === 'regular') {
      const step = Math.sqrt(10000 / density!)
      let found = false
      for (let y = allBounds[1] + Math.ceil((bounds[1] - allBounds[1]) / step) * step; y <= bounds[3]; y += step) {
        for (let x = allBounds[0] + Math.ceil((bounds[0] - allBounds[0]) / step) * step; x <= bounds[2]; x += step) {
          tick()
          if (contains([x, y])) {
            add(target.id, [x, y], target.name)
            found = true
          }
        }
      }
      if (!found) add(target.id, interior, target.name)
    } else {
      const areas = target.polygons.map(polygonArea),
        totalArea = areas.reduce((sum, area) => sum + area, 0)
      const count = Math.max(1, roundedCount((totalArea * density!) / 10000))
      if (count === 1) {
        add(target.id, interior, target.name)
        continue
      }
      if (count + output.length > MAX_LANDING_POINTS) throw Error('Landing density exceeds the point budget.')
      const componentBounds = target.polygons.map((polygon) => boundsOf([polygon]))
      for (let i = 0; i < count; i++) {
        let value = random() * totalArea,
          component = 0
        while (component < areas.length - 1 && value >= areas[component]) {
          value -= areas[component]
          component++
        }
        const b = componentBounds[component]
        for (;;) {
          tick()
          const point: RoadsXY = [b[0] + random() * (b[2] - b[0]), b[1] + random() * (b[3] - b[1])]
          if (inPolygon(point, target.polygons[component], tick)) {
            add(target.id, point, target.name)
            break
          }
        }
      }
    }
  }
  return output
}

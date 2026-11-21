/** Display mesh only. Source faces and estimated gap patches are kept separate. */
export interface TerrainVertex {
  x: number
  y: number
  z: number
}

export const MAX_TERRAIN_MESH_SIDE = 128
export const MAX_GPU_TERRAIN_MESH_SIDE = 256
export const MAX_CACHED_TERRAIN_VERTICES = 65536
/**
 * Samples the accelerated 3D scene keeps: the High quality coarse grid (256 a side, 65,536), its fine band along the
 * road (`TERRAIN_BAND_MAX_CELLS.high`, up to 2.25 vertices a cell), the base fit mesh and the canvas preview's focus
 * window, with room to spare for a window that moves. A cache smaller than one rebuild's samples would evict each one
 * before it is read again, so every rebuild would sample the source afresh.
 */
export const MAX_CACHED_GPU_TERRAIN_VERTICES = 524_288
export const MAX_DISPLAY_GAP_M = 80
export const DISPLAY_GAP_ITERATIONS = 128

export interface TerrainMeshOptions {
  /** Display vertex budget along the longest side; capped at the GPU limit. */
  maxSide?: number
  /** Source cell size in metres. More display vertices cannot add detail below this spacing. */
  minSpacing?: number
}

/**
 * Bounded sampler shared by overlapping windows; missing values are cached too. Positions are looked up by their
 * numbers (x, then y), not by a string built for each call, and the oldest sample is evicted first.
 */
export function cachedTerrainSampler(sample: (x: number, y: number) => number, capacity = MAX_CACHED_TERRAIN_VERTICES) {
  const size = Math.max(1, Math.floor(capacity))
  const columns = new Map<number, Map<number, number>>()
  // Insertion order, as x, y pairs in a ring: the next slot to write is the oldest entry once the ring is full.
  const order = new Float64Array(size * 2)
  let next = 0,
    count = 0
  return (x: number, y: number) => {
    const known = columns.get(x)?.get(y)
    if (known !== undefined) return known
    const value = sample(x, y)
    if (count === size) {
      const oldX = order[next * 2],
        oldY = order[next * 2 + 1]
      const column = columns.get(oldX)
      if (column) {
        column.delete(oldY)
        if (!column.size) columns.delete(oldX)
      }
    } else count++
    order[next * 2] = x
    order[next * 2 + 1] = y
    next = (next + 1) % size
    let column = columns.get(x)
    if (!column) {
      column = new Map()
      columns.set(x, column)
    }
    column.set(y, value)
    return value
  }
}

export function terrainMesh(
  bounds: number[],
  elevationAt: (x: number, y: number) => number,
  missing: Array<[number, number]>,
  fillSmallGaps = false,
  options: TerrainMeshOptions = {},
) {
  return terrainMeshGrid(bounds, elevationAt, missing, fillSmallGaps, options).mesh
}

/**
 * The regular display grid behind `terrainMesh`: its mesh, plus the grid it was cut from.
 * Cell `row * columns + col` spans vertices `[row][col]` to `[row + 1][col + 1]`. A cell is drawn
 * when it is not blocked, or when it is infilled; infilled cells are the estimated ones.
 */
export function terrainMeshGrid(
  bounds: number[],
  elevationAt: (x: number, y: number) => number,
  missing: Array<[number, number]>,
  fillSmallGaps = false,
  options: TerrainMeshOptions = {},
) {
  const width = bounds[2] - bounds[0],
    height = bounds[3] - bounds[1]
  const requestedSide = options.maxSide ?? MAX_TERRAIN_MESH_SIDE
  const maxSide = Number.isFinite(requestedSide)
    ? Math.max(4, Math.min(MAX_GPU_TERRAIN_MESH_SIDE, Math.floor(requestedSide)))
    : MAX_TERRAIN_MESH_SIDE
  const minSpacing = Number.isFinite(options.minSpacing) ? Math.max(0, options.minSpacing!) : 0
  // A fixed origin and a discrete spacing keep the same ground vertices as a follow window moves.
  // Round up to respect both the source detail and the budget, including the snapped boundary.
  const required = Math.max(Math.max(width, height) / (maxSide - 2), minSpacing)
  const power = 10 ** Math.floor(Math.log10(required))
  const spacing = [1, 2, 2.5, 5, 10].map((n) => n * power).find((n) => n >= required)!
  const firstColumn = Math.floor(bounds[0] / spacing),
    firstRow = Math.floor(bounds[1] / spacing)
  const columns = Math.ceil(bounds[2] / spacing) - firstColumn,
    rows = Math.ceil(bounds[3] / spacing) - firstRow
  const dx = spacing,
    dy = spacing
  const originX = firstColumn * spacing,
    originY = firstRow * spacing
  const blocked = new Set<number>()
  for (const [x, y] of missing) {
    if (x < bounds[0] || x > bounds[2] || y < bounds[1] || y > bounds[3]) continue
    const col = (x - originX) / dx,
      row = (y - originY) / dy
    // A missing sample on an edge belongs to both cells sharing that edge.
    for (let r = Math.ceil(row - 1e-8) - 1; r <= Math.floor(row + 1e-8); r++)
      for (let c = Math.ceil(col - 1e-8) - 1; c <= Math.floor(col + 1e-8); c++)
        if (r >= 0 && r < rows && c >= 0 && c < columns) blocked.add(r * columns + c)
  }
  const vertices: Array<Array<TerrainVertex | null>> = []
  const elevations: number[] = []
  for (let row = 0; row <= rows; row++) {
    const line: Array<TerrainVertex | null> = []
    for (let col = 0; col <= columns; col++) {
      const x = (firstColumn + col) * dx,
        y = (firstRow + row) * dy,
        z = elevationAt(x, y)
      line.push(Number.isFinite(z) ? { x, y, z } : null)
      if (Number.isFinite(z)) elevations.push(z)
    }
    vertices.push(line)
  }
  const faces: TerrainVertex[][] = []
  const estimatedFaces: TerrainVertex[][] = []
  // Include both sampled no-data and known analysis gaps missed by the coarser grid.
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < columns; col++)
      if (!vertices[row][col] || !vertices[row][col + 1] || !vertices[row + 1][col + 1] || !vertices[row + 1][col])
        blocked.add(row * columns + col)

  const infilled = new Set<number>()
  if (fillSmallGaps) {
    const visited = new Set<number>()
    for (const first of blocked) {
      if (visited.has(first)) continue
      const cells = [first]
      visited.add(first)
      let minCol = columns,
        maxCol = 0,
        minRow = rows,
        maxRow = 0
      for (let i = 0; i < cells.length; i++) {
        const row = Math.floor(cells[i] / columns),
          col = cells[i] % columns
        minCol = Math.min(minCol, col)
        maxCol = Math.max(maxCol, col)
        minRow = Math.min(minRow, row)
        maxRow = Math.max(maxRow, row)
        // Diagonal contact counts as one gap, so a large hole cannot be filled piecemeal.
        for (let r = Math.max(0, row - 1); r <= Math.min(rows - 1, row + 1); r++)
          for (let c = Math.max(0, col - 1); c <= Math.min(columns - 1, col + 1); c++) {
            const key = r * columns + c
            if (blocked.has(key) && !visited.has(key)) {
              visited.add(key)
              cells.push(key)
            }
          }
      }
      // No extrapolation at the preview/terrain boundary, and no bridging large unsupported areas.
      if (
        minCol === 0 ||
        minRow === 0 ||
        maxCol === columns - 1 ||
        maxRow === rows - 1 ||
        Math.max(maxCol - minCol + 1, maxRow - minRow + 1) * spacing > MAX_DISPLAY_GAP_M
      )
        continue

      const unknown: Array<[number, number]> = []
      const known: number[] = []
      for (let row = minRow; row <= maxRow + 1; row++)
        for (let col = minCol; col <= maxCol + 1; col++) {
          const point = vertices[row][col]
          if (point) known.push(point.z)
          else unknown.push([row, col])
        }
      if (!known.length) continue
      const mean = known.reduce((sum, z) => sum + z, 0) / known.length
      // Work on preview vertices only. The source sampler (including its NaNs) is never changed.
      for (const [row, col] of unknown)
        vertices[row][col] = { x: (firstColumn + col) * dx, y: (firstRow + row) * dy, z: mean }
      for (let iteration = 0; iteration < DISPLAY_GAP_ITERATIONS; iteration++) {
        let change = 0
        for (const [row, col] of unknown) {
          const point = vertices[row][col]!
          const neighbours = [
            vertices[row - 1][col],
            vertices[row + 1][col],
            vertices[row][col - 1],
            vertices[row][col + 1],
          ]
          const valid = neighbours.filter((p): p is TerrainVertex => p !== null)
          if (!valid.length) continue
          const z = valid.reduce((sum, p) => sum + p.z, 0) / valid.length
          change = Math.max(change, Math.abs(z - point.z))
          point.z = z
        }
        if (change < 0.001) break
      }
      for (const cell of cells) infilled.add(cell)
    }
  }
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < columns; col++) {
      const cell = row * columns + col
      if (blocked.has(cell) && !infilled.has(cell)) continue
      const a = vertices[row][col],
        b = vertices[row][col + 1],
        c = vertices[row + 1][col + 1],
        d = vertices[row + 1][col]
      if (a && b && c && d) (infilled.has(cell) ? estimatedFaces : faces).push([a, b, c], [a, c, d])
    }
  return {
    mesh: {
      faces,
      estimatedFaces,
      infilledCells: infilled.size,
      openGapCells: blocked.size - infilled.size,
      elevations,
      spacing: Math.max(dx, dy),
    },
    grid: {
      firstColumn,
      firstRow,
      columns,
      rows,
      spacing,
      /** Infilled vertices replace missing ones here; a measured vertex keeps its sampled level. */
      vertices: vertices as ReadonlyArray<ReadonlyArray<TerrainVertex | null>>,
      blocked: blocked as ReadonlySet<number>,
      infilled: infilled as ReadonlySet<number>,
    },
  }
}

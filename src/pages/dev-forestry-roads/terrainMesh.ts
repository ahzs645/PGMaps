/** Display mesh only. Source faces and estimated gap patches are kept separate. */
export interface TerrainVertex {
  x: number
  y: number
  z: number
}

export const MAX_TERRAIN_MESH_SIDE = 128
export const MAX_CACHED_TERRAIN_VERTICES = 65536
export const MAX_DISPLAY_GAP_M = 80
export const DISPLAY_GAP_ITERATIONS = 128

/** Bounded sampler shared by overlapping windows; missing values are cached too. */
export function cachedTerrainSampler(sample: (x: number, y: number) => number, capacity = MAX_CACHED_TERRAIN_VERTICES) {
  const cache = new Map<string, number>()
  return (x: number, y: number) => {
    const key = `${x}:${y}`
    if (cache.has(key)) return cache.get(key)!
    const value = sample(x, y)
    if (cache.size >= capacity) cache.delete(cache.keys().next().value!)
    cache.set(key, value)
    return value
  }
}

export function terrainMesh(
  bounds: number[],
  elevationAt: (x: number, y: number) => number,
  missing: Array<[number, number]>,
  fillSmallGaps = false,
) {
  const width = bounds[2] - bounds[0],
    height = bounds[3] - bounds[1]
  // A fixed origin and a discrete spacing keep the same ground vertices as a follow window moves.
  const required = Math.max(width, height) / (MAX_TERRAIN_MESH_SIDE - 2)
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
    faces,
    estimatedFaces,
    infilledCells: infilled.size,
    openGapCells: blocked.size - infilled.size,
    elevations,
    spacing: Math.max(dx, dy),
  }
}

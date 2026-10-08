export const GRID_NO_DATA = -1
export const GRID_UNCERTAIN = -2

export type GridPaletteEntry = { value: number; rgb: readonly [number, number, number] }
export type PixelRgba = [number, number, number, number]
export type RasterGridCell = {
  value: number
  agreement: number
  column: number
  row: number
  /** Original unpremultiplied bytes, retained only in the lossless pixel view. */
  rgba?: PixelRgba
}
export type RasterClassGrid = {
  width: number
  height: number
  cellPixels: number
  cells: RasterGridCell[]
}

/** Infer one class per globally aligned box; image colours are display evidence. */
export function reconstructImageClassGrid(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  palette: readonly GridPaletteEntry[],
  {
    cellPixels = 4,
    minAgreement = 0.8,
    minAlpha = 250,
    maxColorDistance = 20,
    preserveSourcePixels = false,
  }: {
    cellPixels?: number
    minAgreement?: number
    minAlpha?: number
    maxColorDistance?: number
    preserveSourcePixels?: boolean
  } = {},
): RasterClassGrid {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    rgba.length !== width * height * 4
  ) {
    throw new Error('Expected a complete RGBA tile')
  }
  if (!Number.isInteger(cellPixels) || cellPixels < 1 || width % cellPixels || height % cellPixels) {
    throw new Error('Box size must divide the source tile dimensions')
  }
  if (preserveSourcePixels && cellPixels !== 1) throw new Error('Source preservation requires one box per pixel')
  if (
    !(minAgreement > 0.5 && minAgreement <= 1) ||
    !(minAlpha >= 1 && minAlpha <= 255) ||
    !(maxColorDistance >= 0 && Number.isFinite(maxColorDistance))
  ) {
    throw new Error('Invalid grid classification thresholds')
  }
  if (
    !palette.length ||
    palette.some(
      ({ value, rgb }) =>
        !Number.isSafeInteger(value) || value < 0 || rgb.some((c) => !Number.isFinite(c) || c < 0 || c > 255),
    ) ||
    new Set(palette.map((p) => p.value)).size !== palette.length
  ) {
    throw new Error('Expected unique non-negative class codes and RGB colours')
  }
  const cells: RasterGridCell[] = []
  const classes = cellPixels === 1 ? null : new Float64Array(width * height)
  for (let pixel = 0; pixel < width * height; pixel++) {
    const offset = pixel * 4
    let value = GRID_UNCERTAIN
    if (rgba[offset + 3] === 0) value = GRID_NO_DATA
    else if (rgba[offset + 3] >= minAlpha) {
      let nearest = Infinity,
        runnerUp = Infinity
      for (const entry of palette) {
        const r = entry.rgb[0] - rgba[offset],
          g = entry.rgb[1] - rgba[offset + 1],
          b = entry.rgb[2] - rgba[offset + 2]
        const distance = r * r + g * g + b * b
        if (distance < nearest) {
          runnerUp = nearest
          nearest = distance
          value = entry.value
        } else runnerUp = Math.min(runnerUp, distance)
      }
      if (nearest > maxColorDistance ** 2 || nearest >= runnerUp) value = GRID_UNCERTAIN
    }
    if (classes) classes[pixel] = value
    else {
      // A single pixel needs no voting or intermediate class array. Keep this
      // path cheap enough for every saved level and exhaustive source checks.
      const cell: RasterGridCell = {
        value,
        agreement: value === GRID_UNCERTAIN ? 0 : 1,
        row: Math.floor(pixel / width),
        column: pixel % width,
      }
      if (preserveSourcePixels) cell.rgba = [rgba[offset], rgba[offset + 1], rgba[offset + 2], rgba[offset + 3]]
      cells.push(cell)
    }
  }
  if (!classes) return { width, height, cellPixels, cells }
  for (let row = 0; row < height / cellPixels; row++) {
    for (let column = 0; column < width / cellPixels; column++) {
      const counts = new Map<number, number>()
      // At least one pixel per box. Use the interior of larger boxes to avoid
      // assigning antialiasing at a class boundary to the entire box.
      const inset = Math.floor(cellPixels * 0.2)
      const samples = (cellPixels - inset * 2) ** 2
      for (let y = inset; y < cellPixels - inset; y++) {
        for (let x = inset; x < cellPixels - inset; x++) {
          const value = classes[(row * cellPixels + y) * width + column * cellPixels + x]
          counts.set(value, (counts.get(value) ?? 0) + 1)
        }
      }
      let winner = GRID_UNCERTAIN,
        votes = 0
      for (const [value, count] of counts) {
        if (value !== GRID_UNCERTAIN && count > votes) {
          winner = value
          votes = count
        }
      }
      const agreement = votes / samples
      // An uncoloured box needs wholly transparent evidence. Missing colours
      // and disputed covered/uncoloured boundaries remain visibly uncertain.
      const value =
        winner === GRID_NO_DATA
          ? votes === samples
            ? GRID_NO_DATA
            : GRID_UNCERTAIN
          : agreement >= minAgreement
            ? winner
            : GRID_UNCERTAIN
      cells.push({ value, agreement, row, column })
    }
  }
  return { width, height, cellPixels, cells }
}

/** Global XYZ pixel edges keep neighbouring tile boxes exactly aligned. */
export function rasterGridCellRing(
  cell: Pick<RasterGridCell, 'row' | 'column'>,
  grid: Pick<RasterClassGrid, 'width' | 'height' | 'cellPixels'>,
  tile: { x: number; y: number; z: number },
): Array<[number, number]> {
  const n = 2 ** tile.z
  const west = (tile.x + (cell.column * grid.cellPixels) / grid.width) / n
  const east = (tile.x + ((cell.column + 1) * grid.cellPixels) / grid.width) / n
  const north = (tile.y + (cell.row * grid.cellPixels) / grid.height) / n
  const south = (tile.y + ((cell.row + 1) * grid.cellPixels) / grid.height) / n
  const position = (x: number, y: number): [number, number] => [
    x * 360 - 180,
    (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI,
  ]
  return [position(west, north), position(east, north), position(east, south), position(west, south)]
}

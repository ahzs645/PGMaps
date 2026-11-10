/**
 * The block sheets' raster layers, from a grid of heights: classed slope percent, classed canopy
 * height and a greyscale hillshade, each as straight RGBA. The grid is sampled on the sheet's own
 * Web Mercator frame, so a raster lines up with the vectors drawn over it without resampling.
 * No DOM or network access: any `ElevationSource` (the road tool's terrain, a LiDAR DTM or CHM) feeds it.
 */
import { inverseMercator } from '@/lib/mapSheet/scale'
import {
  classRgba,
  HILLSHADE_PRESET,
  SLOPE_CLASS_OPACITY,
  SLOPE_CLASSES,
  SLOPE_STEEP_OVERLAY,
  type RasterClass,
} from './styles'

/** Metres above a datum (or heights above ground) by longitude/latitude; NaN where unknown. */
export interface HeightSource {
  elevationAt(lng: number, lat: number): number
}

/** Height samples at the centres of a regular Web Mercator grid. */
export interface SheetGrid {
  width: number
  height: number
  values: Float32Array
  /** Ground size of a cell in each row, metres. Mercator is conformal, so cells are square on the ground. */
  cellSizeM: Float64Array
}

/** Most samples a sheet raster takes; finer requests are coarsened to fit. 2.7 million is 150 dpi on a tabloid frame. */
export const MAX_SHEET_GRID_CELLS = 4_000_000
/** Rows sampled between progress reports, so a caller can give the page a turn. */
export const GRID_ROWS_PER_STEP = 16

/**
 * Samples `source` at the centres of a `width` × `height` grid over a Web Mercator box
 * (west, south, east, north in Mercator metres). A generator: it yields the rows done every
 * `GRID_ROWS_PER_STEP` rows and returns the grid, so the caller decides when to pause.
 */
export function* sampleSheetGrid(
  source: HeightSource,
  mercatorBox: [number, number, number, number],
  width: number,
  height: number,
): Generator<number, SheetGrid> {
  if (!(width >= 2 && height >= 2) || width * height > MAX_SHEET_GRID_CELLS)
    throw Error(`A sheet raster holds 4 to ${MAX_SHEET_GRID_CELLS.toLocaleString('en-US')} cells.`)
  const [west, south, east, north] = mercatorBox
  const stepX = (east - west) / width,
    stepY = (north - south) / height
  const values = new Float32Array(width * height)
  const cellSizeM = new Float64Array(height)
  const longitudes = new Float64Array(width)
  for (let col = 0; col < width; col++) longitudes[col] = inverseMercator(west + (col + 0.5) * stepX, 0)[0]
  for (let row = 0; row < height; row++) {
    const lat = inverseMercator(0, north - (row + 0.5) * stepY)[1]
    cellSizeM[row] = stepX * Math.cos((lat * Math.PI) / 180)
    for (let col = 0; col < width; col++) {
      const value = source.elevationAt(longitudes[col], lat)
      values[row * width + col] = Number.isFinite(value) ? value : NaN
    }
    if ((row + 1) % GRID_ROWS_PER_STEP === 0) yield row + 1
  }
  return { width, height, values, cellSizeM }
}

/** Synchronous `sampleSheetGrid`, for tests and small grids. */
export function sampleSheetGridNow(...args: Parameters<typeof sampleSheetGrid>): SheetGrid {
  const steps = sampleSheetGrid(...args)
  let next = steps.next()
  while (!next.done) next = steps.next()
  return next.value
}

export const slopePercentFromDegrees = (degrees: number) => Math.tan((degrees * Math.PI) / 180) * 100

/**
 * East and north gradients at each cell: a central difference where both neighbours exist, a
 * one-sided one where only one does. A missing centre stays missing; no gap is bridged.
 */
function gradients(grid: SheetGrid, visit: (index: number, zx: number, zy: number) => void) {
  const { width, height, values, cellSizeM } = grid
  for (let row = 0; row < height; row++) {
    const d = cellSizeM[row]
    for (let col = 0; col < width; col++) {
      const index = row * width + col,
        value = values[index]
      if (!Number.isFinite(value)) continue
      const difference = (before: number, after: number, hasBefore: boolean, hasAfter: boolean) => {
        const b = hasBefore && Number.isFinite(before),
          a = hasAfter && Number.isFinite(after)
        if (a && b) return (after - before) / (2 * d)
        if (a) return (after - value) / d
        if (b) return (value - before) / d
        return NaN
      }
      const zx = difference(values[index - 1], values[index + 1], col > 0, col < width - 1)
      // Rows run south, so north is the row above.
      const zy = difference(values[index + width], values[index - width], row < height - 1, row > 0)
      if (Number.isFinite(zx) && Number.isFinite(zy)) visit(index, zx, zy)
    }
  }
}

/** Slope in percent (rise over run × 100) at each cell; NaN where it cannot be measured. */
export function slopePercentGrid(grid: SheetGrid): Float32Array {
  const out = new Float32Array(grid.width * grid.height).fill(NaN)
  gradients(grid, (index, zx, zy) => {
    out[index] = Math.hypot(zx, zy) * 100
  })
  return out
}

/** The class a value falls in (`min < value <= max`), or -1 for NaN. */
export function classIndex(value: number, classes: readonly RasterClass[]): number {
  if (!Number.isFinite(value)) return -1
  for (let i = 0; i < classes.length; i++) {
    const entry = classes[i]
    if ((entry.min === undefined || value > entry.min) && (entry.max === undefined || value <= entry.max)) return i
  }
  return -1
}

/**
 * RGBA for classed values: each coloured class at `opacity`, clear classes and missing values
 * transparent, and values above `overlay.min` in the overlay colour instead.
 */
export function classifyRgba(
  values: ArrayLike<number>,
  classes: readonly RasterClass[],
  opacity: number,
  overlay?: { min: number; color: string; opacity: number },
): Uint8ClampedArray {
  const palette = classes.map((entry) => (entry.color ? classRgba(entry.color, opacity) : null))
  const top = overlay ? classRgba(overlay.color, overlay.opacity) : null
  const out = new Uint8ClampedArray(values.length * 4)
  for (let i = 0; i < values.length; i++) {
    const value = values[i]
    const color = top && overlay && value > overlay.min ? top : palette[classIndex(value, classes)]
    if (color) out.set(color, i * 4)
  }
  return out
}

/** The LiDAR design slope layer: slope classes at 0.85 opacity with the 95 % + overlay. */
export const slopeClassRgba = (grid: SheetGrid) =>
  classifyRgba(slopePercentGrid(grid), SLOPE_CLASSES, SLOPE_CLASS_OPACITY, SLOPE_STEEP_OVERLAY)

/**
 * Greyscale hillshade, opaque, transparent only where the ground is missing:
 * 255 × (cos zenith · cos slope + sin zenith · sin slope · cos(azimuth − aspect)).
 */
export function hillshadeRgba(grid: SheetGrid, preset = HILLSHADE_PRESET): Uint8ClampedArray {
  const out = new Uint8ClampedArray(grid.width * grid.height * 4)
  const zenith = ((90 - preset.altitudeDeg) * Math.PI) / 180
  // Azimuth clockwise from north to a direction vector (east, north) toward the sun.
  const azimuth = (preset.azimuthDeg * Math.PI) / 180
  const sunEast = Math.sin(azimuth),
    sunNorth = Math.cos(azimuth)
  gradients(grid, (index, zx, zy) => {
    const gx = zx * preset.zFactor,
      gy = zy * preset.zFactor
    const slope = Math.atan(Math.hypot(gx, gy))
    // Cosine of the angle between the downslope-facing direction and the sun, from the gradient.
    const facing = Math.hypot(gx, gy) > 0 ? (-gx * sunEast - gy * sunNorth) / Math.hypot(gx, gy) : 0
    const shade = Math.cos(zenith) * Math.cos(slope) + Math.sin(zenith) * Math.sin(slope) * facing
    const grey = Math.max(0, Math.min(255, Math.round(255 * shade)))
    out.set([grey, grey, grey, 255], index * 4)
  })
  return out
}

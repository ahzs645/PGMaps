/**
 * Standing timber as a screening surface.
 *
 * Bare-earth terrain is only half of what hides a cutblock: a stand of mature
 * timber between the road and the block blocks the view just as a ridge does,
 * and a block seen over the top of one reads very differently from the same
 * block on open ground. BC's Vegetation Resource Inventory publishes a
 * projected stand height per polygon, which is enough to carry that into the
 * sightline.
 *
 * The heights are rasterised into a grid in the same normalised Mercator space
 * the sightline already walks, so adding screening costs one array lookup per
 * profile step rather than a polygon search.
 */

import { lngLatToMercator, mercatorToLngLat } from './terrain'
import { pointInPolygon, polygonBounds, type PolygonGeometry } from './visibility'

/** Metres of vegetation standing on the ground at a point. */
export interface CanopySource {
  heightAtMercator(x: number, y: number): number
}

export type CanopyStand = {
  /** Projected stand height, in metres (`PROJ_HEIGHT_1`). */
  heightMeters: number
  /** Crown closure as a percentage, or null where the inventory has none. */
  crownClosurePercent: number | null
  /**
   * Leading species code as the inventory spells it — `PL`, `SX`, `BL`, `AT`.
   * Optional: screening does not care what the trees are, only how tall.
   */
  speciesCode?: string | null
  /** Live stems per hectare, for drawing only; screening does not use it. */
  stemsPerHa?: number | null
  geometry: PolygonGeometry
}

export type CanopyOptions = {
  /**
   * Stands more open than this do not screen. A thin canopy lets a cutblock
   * show through it, and the inventory carries no transmission model, so this
   * is a stated planning assumption rather than a published figure.
   */
  minCrownClosurePercent?: number
  /** Grid cell size in metres. Canopy is constant within a stand, so this is coarse. */
  resolutionMeters?: number
}

export const DEFAULT_CANOPY_OPTIONS = {
  minCrownClosurePercent: 30,
  resolutionMeters: 25,
} satisfies Required<CanopyOptions>

/** Metres per degree of latitude, for sizing the grid. */
const METERS_PER_DEGREE_LAT = 111320

export type Bounds = [number, number, number, number]

export class CanopyGrid implements CanopySource {
  readonly columns: number

  readonly rows: number

  private readonly originX: number

  private readonly originY: number

  private readonly spanX: number

  private readonly spanY: number

  private readonly heights: Float32Array

  constructor(bounds: Bounds, resolutionMeters: number) {
    const [minLng, minLat, maxLng, maxLat] = bounds
    const topLeft = lngLatToMercator(minLng, maxLat)
    const bottomRight = lngLatToMercator(maxLng, minLat)

    this.originX = topLeft[0]
    this.originY = topLeft[1]
    this.spanX = Math.max(1e-12, bottomRight[0] - topLeft[0])
    this.spanY = Math.max(1e-12, bottomRight[1] - topLeft[1])

    // Size the grid from ground distance so cells stay roughly square.
    const heightMeters = Math.max(1, (maxLat - minLat) * METERS_PER_DEGREE_LAT)
    const widthMeters = Math.max(
      1,
      (maxLng - minLng) * METERS_PER_DEGREE_LAT * Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180),
    )
    this.columns = Math.max(1, Math.min(4096, Math.ceil(widthMeters / resolutionMeters)))
    this.rows = Math.max(1, Math.min(4096, Math.ceil(heightMeters / resolutionMeters)))
    this.heights = new Float32Array(this.columns * this.rows)
  }

  /** Centre of a cell, in longitude and latitude. */
  private cellCentre(column: number, row: number): [number, number] {
    return mercatorToLngLat(
      this.originX + ((column + 0.5) / this.columns) * this.spanX,
      this.originY + ((row + 0.5) / this.rows) * this.spanY,
    )
  }

  /** Cell range a polygon's bounding box covers, clamped to the grid. */
  private cellRange(geometry: PolygonGeometry) {
    const [minLng, minLat, maxLng, maxLat] = polygonBounds(geometry)
    const topLeft = lngLatToMercator(minLng, maxLat)
    const bottomRight = lngLatToMercator(maxLng, minLat)

    const toColumn = (x: number) => Math.floor(((x - this.originX) / this.spanX) * this.columns)
    const toRow = (y: number) => Math.floor(((y - this.originY) / this.spanY) * this.rows)

    return {
      minColumn: Math.max(0, toColumn(topLeft[0])),
      maxColumn: Math.min(this.columns - 1, toColumn(bottomRight[0])),
      minRow: Math.max(0, toRow(topLeft[1])),
      maxRow: Math.min(this.rows - 1, toRow(bottomRight[1])),
    }
  }

  /**
   * Paints a stand's height into every cell whose centre falls inside it.
   * Overlapping stands keep the taller height — the view is blocked by whatever
   * stands highest.
   */
  paint(geometry: PolygonGeometry, heightMeters: number): void {
    if (!Number.isFinite(heightMeters) || heightMeters <= 0) return
    const { minColumn, maxColumn, minRow, maxRow } = this.cellRange(geometry)

    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1) {
        const [lng, lat] = this.cellCentre(column, row)
        if (!pointInPolygon(geometry, lng, lat)) continue
        const index = row * this.columns + column
        if (heightMeters > this.heights[index]) this.heights[index] = heightMeters
      }
    }
  }

  /** Removes canopy inside a polygon — harvested ground has nothing standing on it. */
  clear(geometry: PolygonGeometry): void {
    const { minColumn, maxColumn, minRow, maxRow } = this.cellRange(geometry)

    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1) {
        const [lng, lat] = this.cellCentre(column, row)
        if (pointInPolygon(geometry, lng, lat)) this.heights[row * this.columns + column] = 0
      }
    }
  }

  heightAtMercator(x: number, y: number): number {
    const column = Math.floor(((x - this.originX) / this.spanX) * this.columns)
    const row = Math.floor(((y - this.originY) / this.spanY) * this.rows)
    if (column < 0 || row < 0 || column >= this.columns || row >= this.rows) return 0
    return this.heights[row * this.columns + column]
  }

  heightAt(lng: number, lat: number): number {
    const [x, y] = lngLatToMercator(lng, lat)
    return this.heightAtMercator(x, y)
  }

  /** Share of cells carrying any canopy, for reporting how much of a run is screened. */
  coverageFraction(): number {
    let covered = 0
    for (let index = 0; index < this.heights.length; index += 1) {
      if (this.heights[index] > 0) covered += 1
    }
    return this.heights.length > 0 ? covered / this.heights.length : 0
  }
}

/**
 * Builds a canopy grid from inventory stands, then clears the ground that has
 * been or is about to be harvested.
 */
export function buildCanopyGrid(
  stands: CanopyStand[],
  bounds: Bounds,
  clearedGeometries: PolygonGeometry[] = [],
  options: CanopyOptions = {},
): CanopyGrid {
  const { minCrownClosurePercent, resolutionMeters } = { ...DEFAULT_CANOPY_OPTIONS, ...options }
  const grid = new CanopyGrid(bounds, resolutionMeters)

  for (const stand of stands) {
    // A stand with no crown closure recorded is taken at face value rather than
    // dropped: missing inventory is not evidence of open ground.
    if (stand.crownClosurePercent !== null && stand.crownClosurePercent < minCrownClosurePercent) continue
    grid.paint(stand.geometry, stand.heightMeters)
  }

  for (const geometry of clearedGeometries) grid.clear(geometry)
  return grid
}

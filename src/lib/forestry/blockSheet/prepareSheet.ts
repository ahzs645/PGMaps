/**
 * Builds a sheet's terrain products on its own frame: the classed slope, canopy height or hillshade
 * raster, and the fixed-interval contours. A generator, so a page can run it in slices and cancel
 * it. No DOM or network access.
 */
import { gridContours, type ContourResult } from '@/lib/mapSheet/contours'
import type { RasterImage } from '@/lib/mapSheet/drawOps'
import type { Rect } from '@/lib/mapSheet/layout'
import { inverseMercator } from '@/lib/mapSheet/scale'
import type { ClassSymbol } from '@/lib/mapSheet/symbols'
import {
  classifyRgba,
  GRID_ROWS_PER_STEP,
  hillshadeRgba,
  MAX_SHEET_GRID_CELLS,
  sampleSheetGrid,
  slopeClassRgba,
  type HeightSource,
} from './classedRasters'
import type { ComposeInput, SheetFrame } from './composeSheet'
import {
  CANOPY_HEIGHT_CLASSES,
  CANOPY_HEIGHT_OPACITY,
  classLegend,
  CONTOUR_INDEX_EVERY,
  CONTOUR_INTERVAL_M,
  SLOPE_CLASS_OPACITY,
  SLOPE_CLASSES,
  SLOPE_STEEP_OVERLAY,
} from './styles'

/** Resolution of a sheet's terrain raster, dots per inch on paper. */
export const SHEET_RASTER_DPI = 150
/** Contours are traced on a grid with one sample per this many points of paper. */
export const CONTOUR_GRID_PT = 2.5

/** Pixel size of a raster covering `frame` at `dpi`, coarsened to stay within `MAX_SHEET_GRID_CELLS`. */
export function sheetRasterSize(frame: Rect, dpi = SHEET_RASTER_DPI) {
  let width = Math.max(2, Math.round((frame.w / 72) * dpi)),
    height = Math.max(2, Math.round((frame.h / 72) * dpi))
  if (width * height > MAX_SHEET_GRID_CELLS) {
    const shrink = Math.sqrt(MAX_SHEET_GRID_CELLS / (width * height))
    width = Math.max(2, Math.floor(width * shrink))
    height = Math.max(2, Math.floor(height * shrink))
  }
  return { width, height }
}

/** The sheet bases a published raster can stand in for. */
export type PublishedBase = 'slope' | 'hillshade' | 'canopy-height'

/**
 * A raster someone already published for this ground: the slope or canopy classes, or the
 * hillshade picture, of a company map sheet. Drawn as it is in place of one worked out from heights,
 * so a sheet can show LiDAR products where the tool holds no LiDAR terrain.
 */
export interface PublishedRaster {
  /**
   * Writes the straight RGBA at a WGS84 point into `out` at `offset` and returns true, or returns
   * false where the source holds nothing. A clear class is written as four zeros and still counts.
   */
  sample(lng: number, lat: number, out: Uint8ClampedArray, offset: number): boolean
  /** Where it came from, for the sheet's source bar: one short line, which the bar cuts to fit. */
  source: string
  /** The class legend a classed raster prints. */
  legend?: ClassSymbol[]
}

export interface SheetTerrainSources {
  /** Ground elevations. */
  terrain?: HeightSource
  /** Canopy heights above ground, for the canopy height sheet. */
  canopy?: HeightSource
  /** Ground elevations covering the whole frame, for contours where `terrain` covers less of it. */
  contourTerrain?: HeightSource
  /** Published rasters, by the base each replaces. One given here is drawn instead of `terrain` or `canopy`. */
  published?: Partial<Record<PublishedBase, PublishedRaster>>
}

export type SheetTerrainProducts = Pick<ComposeInput, 'base' | 'contours'> & {
  /** Why a product the preset wanted could not be made. */
  missing: string[]
  /** The published raster the base was drawn from, and the share of the frame it covers (0–1). */
  published?: { source: string; coveredShare: number }
}

/** Paints `raster` on a `width` × `height` grid over a Web Mercator box; yields rows done, as `sampleSheetGrid` does. */
export function* paintPublishedRaster(
  raster: PublishedRaster,
  mercatorBox: [number, number, number, number],
  width: number,
  height: number,
): Generator<number, { data: Uint8ClampedArray; coveredShare: number }> {
  if (!(width >= 2 && height >= 2) || width * height > MAX_SHEET_GRID_CELLS)
    throw Error(`A sheet raster holds 4 to ${MAX_SHEET_GRID_CELLS.toLocaleString('en-US')} cells.`)
  const [west, south, east, north] = mercatorBox
  const stepX = (east - west) / width,
    stepY = (north - south) / height
  const data = new Uint8ClampedArray(width * height * 4)
  const longitudes = new Float64Array(width)
  for (let col = 0; col < width; col++) longitudes[col] = inverseMercator(west + (col + 0.5) * stepX, 0)[0]
  let covered = 0
  for (let row = 0; row < height; row++) {
    const lat = inverseMercator(0, north - (row + 0.5) * stepY)[1]
    for (let col = 0; col < width; col++)
      if (raster.sample(longitudes[col], lat, data, (row * width + col) * 4)) covered++
    if ((row + 1) % GRID_ROWS_PER_STEP === 0) yield row + 1
  }
  return { data, coveredShare: covered / (width * height) }
}

/** Progress is the share of grid rows sampled so far, 0–1. */
export function* prepareSheetTerrain(
  frame: SheetFrame,
  sources: SheetTerrainSources,
  dpi = SHEET_RASTER_DPI,
): Generator<number, SheetTerrainProducts> {
  const { preset, projection } = frame
  const box = projection.mercatorBox
  const missing: string[] = []
  const raster = sheetRasterSize(projection.frame, dpi)
  const contourSize = {
    width: Math.max(2, Math.round(projection.frame.w / CONTOUR_GRID_PT)),
    height: Math.max(2, Math.round(projection.frame.h / CONTOUR_GRID_PT)),
  }
  const needsRaster = preset.base === 'slope' || preset.base === 'hillshade' || preset.base === 'canopy-height'
  const publishedSource = needsRaster ? sources.published?.[preset.base as PublishedBase] : undefined
  const rasterSource = preset.base === 'canopy-height' ? sources.canopy : sources.terrain
  const contourSource = sources.contourTerrain ?? sources.terrain
  const total =
    (needsRaster && (publishedSource || rasterSource) ? raster.height : 0) +
    (preset.contours && contourSource ? contourSize.height : 0)
  let done = 0
  let base: SheetTerrainProducts['base']
  let published: SheetTerrainProducts['published']
  if (publishedSource) {
    const steps = paintPublishedRaster(publishedSource, box, raster.width, raster.height)
    let next = steps.next()
    while (!next.done) {
      yield (done + next.value) / Math.max(1, total)
      next = steps.next()
    }
    done += raster.height
    base = {
      image: { kind: 'rgba', data: next.value.data, width: raster.width, height: raster.height },
      ...(publishedSource.legend ? { legend: publishedSource.legend } : {}),
    }
    published = { source: publishedSource.source, coveredShare: next.value.coveredShare }
    const covered = next.value.coveredShare
    if (!covered) missing.push('The imported sheet holds nothing inside the map frame.')
    else if (covered < 0.995)
      missing.push(
        `The imported sheet covers ${Math.round(covered * 100)}% of the map frame; the rest of the frame prints without it.`,
      )
  } else if (needsRaster) {
    if (!rasterSource)
      missing.push(preset.base === 'canopy-height' ? 'No canopy height grid is loaded.' : 'No terrain is loaded.')
    else {
      const steps = sampleSheetGrid(rasterSource, box, raster.width, raster.height)
      let next = steps.next()
      while (!next.done) {
        yield (done + next.value) / Math.max(1, total)
        next = steps.next()
      }
      done += raster.height
      const grid = next.value
      let image: RasterImage
      if (preset.base === 'slope') {
        image = { kind: 'rgba', data: slopeClassRgba(grid), width: grid.width, height: grid.height }
        base = { image, legend: classLegend(SLOPE_CLASSES, SLOPE_CLASS_OPACITY, SLOPE_STEEP_OVERLAY) }
      } else if (preset.base === 'hillshade') {
        image = { kind: 'rgba', data: hillshadeRgba(grid), width: grid.width, height: grid.height }
        base = { image }
      } else {
        image = {
          kind: 'rgba',
          data: classifyRgba(grid.values, CANOPY_HEIGHT_CLASSES, CANOPY_HEIGHT_OPACITY),
          width: grid.width,
          height: grid.height,
        }
        base = { image, legend: classLegend(CANOPY_HEIGHT_CLASSES, CANOPY_HEIGHT_OPACITY) }
      }
      if (!grid.values.some(Number.isFinite)) missing.push('The terrain has no data inside the map frame.')
    }
  }
  let contours: SheetTerrainProducts['contours']
  if (preset.contours) {
    if (!contourSource) missing.push('No terrain is loaded, so the sheet has no contours.')
    else {
      const steps = sampleSheetGrid(contourSource, box, contourSize.width, contourSize.height)
      let next = steps.next()
      while (!next.done) {
        yield (done + next.value) / Math.max(1, total)
        next = steps.next()
      }
      const result: ContourResult = gridContours(
        next.value,
        preset.contourIntervalM ?? CONTOUR_INTERVAL_M,
        preset.contourIndexEvery ?? CONTOUR_INDEX_EVERY,
      )
      contours = { result, gridWidth: contourSize.width, gridHeight: contourSize.height }
    }
  }
  return { base, contours, missing, ...(published ? { published } : {}) }
}

/** Synchronous `prepareSheetTerrain`, for tests and scripts. */
export function prepareSheetTerrainNow(...args: Parameters<typeof prepareSheetTerrain>): SheetTerrainProducts {
  const steps = prepareSheetTerrain(...args)
  let next = steps.next()
  while (!next.done) next = steps.next()
  return next.value
}

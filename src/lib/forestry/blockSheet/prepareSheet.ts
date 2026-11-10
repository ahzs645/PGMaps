/**
 * Builds a sheet's terrain products on its own frame: the classed slope, canopy height or hillshade
 * raster, and the fixed-interval contours. A generator, so a page can run it in slices and cancel
 * it. No DOM or network access.
 */
import { gridContours, type ContourResult } from '@/lib/mapSheet/contours'
import type { RasterImage } from '@/lib/mapSheet/drawOps'
import type { Rect } from '@/lib/mapSheet/layout'
import {
  classifyRgba,
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

export interface SheetTerrainSources {
  /** Ground elevations. */
  terrain?: HeightSource
  /** Canopy heights above ground, for the canopy height sheet. */
  canopy?: HeightSource
}

export type SheetTerrainProducts = Pick<ComposeInput, 'base' | 'contours'> & {
  /** Why a product the preset wanted could not be made. */
  missing: string[]
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
  const rasterSource = preset.base === 'canopy-height' ? sources.canopy : sources.terrain
  const total =
    (needsRaster && rasterSource ? raster.height : 0) + (preset.contours && sources.terrain ? contourSize.height : 0)
  let done = 0
  let base: SheetTerrainProducts['base']
  if (needsRaster) {
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
    if (!sources.terrain) missing.push('No terrain is loaded, so the sheet has no contours.')
    else {
      const steps = sampleSheetGrid(sources.terrain, box, contourSize.width, contourSize.height)
      let next = steps.next()
      while (!next.done) {
        yield (done + next.value) / Math.max(1, total)
        next = steps.next()
      }
      const result: ContourResult = gridContours(next.value, CONTOUR_INTERVAL_M, CONTOUR_INDEX_EVERY)
      contours = { result, gridWidth: contourSize.width, gridHeight: contourSize.height }
    }
  }
  return { base, contours, missing }
}

/** Synchronous `prepareSheetTerrain`, for tests and scripts. */
export function prepareSheetTerrainNow(...args: Parameters<typeof prepareSheetTerrain>): SheetTerrainProducts {
  const steps = prepareSheetTerrain(...args)
  let next = steps.next()
  while (!next.done) next = steps.next()
  return next.value
}

/**
 * Block map sheets drawn from an imported company sheet's rasters: its slope or canopy classes and
 * its hillshade picture, in place of the ones worked out from the project's terrain. Where no LiDAR
 * terrain is loaded these are the only LiDAR-derived products the project holds
 * (docs/forestry-block-map-sheets.md, **Rasters from an imported map sheet**).
 *
 * A class raster is used only when its printed ranges are the sheet's own, class for class, so the
 * sheet's legend stays true: nothing is re-binned. No DOM or network access; the hillshade's pixels
 * are decoded by `pdfMosaicPixels.ts` and passed in.
 */
import { displayCells, ESTIMATE_DISPLAY_CELL_M, gridProjection, invertMatrix } from '@/lib/geoPdf/classGrid'
import { mosaicSampler } from '@/lib/geoPdf/imageMosaic'
import type { PdfClassGrid, PdfImageMosaic } from '@/lib/geoPdf/types'
import type { PublishedBase, PublishedRaster } from '@/lib/forestry/blockSheet/prepareSheet'
import {
  CANOPY_HEIGHT_CLASSES,
  CANOPY_HEIGHT_OPACITY,
  classLegend,
  classRgba,
  SLOPE_CLASS_OPACITY,
  SLOPE_CLASSES,
  SLOPE_STEEP_OVERLAY,
} from '@/lib/forestry/blockSheet/styles'
import { isContourTerrain } from './contourTerrain'
import type { ReferenceFeature } from './referenceFeatures'
import type { RoadProject } from './types'

/** Where a sheet's raster comes from: chosen by `publishedByDefault`, the project's terrain, or the imported sheet. */
export type SheetRasterChoice = 'auto' | 'terrain' | 'sheet'
export const SHEET_RASTER_CHOICES: readonly SheetRasterChoice[] = ['auto', 'terrain', 'sheet']

/** Opacity of a JPEG-estimated class against an exact one, on a printed sheet. */
export const ESTIMATE_SHEET_OPACITY = 0.6
/** The class colour the legend's "paler" key is drawn in: a middle class of each sheet. */
const ESTIMATE_KEY_COLOUR = { slope: '#ffaa00', canopy: '#00a9e6' } as const

const fileName = (feature: Pick<ReferenceFeature, 'pdfSource' | 'name'>) =>
  feature.pdfSource?.file.split('/').at(-1) ?? feature.name

/** The sheet colour of each legend entry, or why the grid cannot be printed under the sheet's legend. */
function sheetColours(grid: PdfClassGrid): { colours: [number, number, number, number][] } | { reason: string } {
  const classes = grid.kind === 'slope' ? SLOPE_CLASSES : CANOPY_HEIGHT_CLASSES
  const opacity = grid.kind === 'slope' ? SLOPE_CLASS_OPACITY : CANOPY_HEIGHT_OPACITY
  const overlay = grid.kind === 'slope' ? SLOPE_STEEP_OVERLAY : undefined
  const clear = classes.find((entry) => !entry.color)
  if (!grid.undrawn) return { reason: 'it was imported before the not-drawn class was recorded: import the PDF again' }
  if (!clear || clear.max !== grid.undrawn.maximum)
    return { reason: `its lowest printed class starts at ${grid.undrawn.maximum} ${grid.unit}, not the sheet's` }
  const colours: [number, number, number, number][] = []
  for (const range of grid.legend) {
    const match = classes.find(
      (entry) => entry.color && entry.min === range.minimum && (entry.max ?? null) === range.maximum,
    )
    if (match?.color) colours.push(classRgba(match.color, opacity))
    else if (overlay && overlay.min === range.minimum && range.maximum === null)
      colours.push(classRgba(overlay.color, overlay.opacity))
    else return { reason: `its ${range.label} ${grid.unit} class is not one of the sheet's classes` }
  }
  return { colours }
}

/** A class grid as a sheet's base raster, or the reason it cannot be one. */
export function publishedClassRaster(
  grid: PdfClassGrid,
  file: string,
): { raster: PublishedRaster } | { reason: string } {
  const matched = sheetColours(grid)
  if ('reason' in matched) return matched
  const exact = matched.colours
  const estimated = exact.map(
    ([r, g, b, a]) => [r, g, b, Math.round(a * ESTIMATE_SHEET_OPACITY)] as [number, number, number, number],
  )
  const inverse = invertMatrix(grid.transform),
    projection = gridProjection(grid)
  const classes = grid.legend.length
  let cells: Uint8Array | undefined
  const anyEstimate = grid.counts.some((count, code) => count > 0 && code > 64 && code <= 64 + classes)
  return {
    raster: {
      sample(lng, lat, out, offset) {
        const [x, y] = projection.forward([lng, lat])
        const col = Math.floor(inverse[0] * x + inverse[2] * y + inverse[4]),
          row = Math.floor(inverse[1] * x + inverse[3] * y + inverse[5])
        if (!(col >= 0 && row >= 0 && col < grid.width && row < grid.height)) return false
        // The cells as the plan draws them: an estimate is its 10 m cell's commonest class.
        cells ??= displayCells(grid)
        const code = cells[row * grid.width + col]
        // Not drawn on the source sheet: the clear class below the lowest printed range.
        if (code === 0) return true
        const colour =
          code <= classes ? exact[code - 1] : code > 64 && code <= 64 + classes ? estimated[code - 65] : null
        if (!colour) return false
        out[offset] = colour[0]
        out[offset + 1] = colour[1]
        out[offset + 2] = colour[2]
        out[offset + 3] = colour[3]
        return true
      },
      source: `${grid.kind === 'slope' ? 'Slope' : 'Canopy height'} classes as published on ${file}`,
      legend: [
        ...(grid.kind === 'slope'
          ? classLegend(SLOPE_CLASSES, SLOPE_CLASS_OPACITY, SLOPE_STEEP_OVERLAY)
          : classLegend(CANOPY_HEIGHT_CLASSES, CANOPY_HEIGHT_OPACITY)),
        // The key to the paler colours: one swatch stands for every class drawn that way.
        ...(anyEstimate
          ? [
              {
                kind: 'class' as const,
                label: `Paler: estimated, per ${ESTIMATE_DISPLAY_CELL_M} m`,
                color: ESTIMATE_KEY_COLOUR[grid.kind],
                opacity: (grid.kind === 'slope' ? SLOPE_CLASS_OPACITY : CANOPY_HEIGHT_OPACITY) * ESTIMATE_SHEET_OPACITY,
              },
            ]
          : []),
      ],
    },
  }
}

/**
 * A hillshade image layer as a sheet's base raster. `pixels` are its decoded tiles, in
 * `mosaic.tiles` order: one grey byte or four RGBA bytes a pixel, or null for a tile that did not decode.
 */
export function publishedHillshade(
  mosaic: PdfImageMosaic,
  pixels: readonly (Uint8Array | Uint8ClampedArray | null)[],
  file: string,
): PublishedRaster {
  return {
    sample: mosaicSampler(mosaic, pixels),
    source: `Hillshade as published on ${file}`,
  }
}

export interface PublishedOffer {
  base: PublishedBase
  feature: ReferenceFeature
  file: string
  /** Why the sheet cannot print it, when it cannot. */
  reason?: string
}

/** The imported rasters a block sheet could be drawn from, the first of each kind in the project. */
export function publishedOffers(reference: readonly ReferenceFeature[] = []): PublishedOffer[] {
  const offers: PublishedOffer[] = []
  const add = (base: PublishedBase, feature: ReferenceFeature, reason?: string) => {
    if (!offers.some((offer) => offer.base === base && !offer.reason))
      offers.push({ base, feature, file: fileName(feature), ...(reason ? { reason } : {}) })
  }
  for (const feature of reference) {
    if (feature.classGrid) {
      const made = publishedClassRaster(feature.classGrid, fileName(feature))
      add(
        feature.classGrid.kind === 'slope' ? 'slope' : 'canopy-height',
        feature,
        'reason' in made ? made.reason : undefined,
      )
    } else if (feature.imageMosaic?.kind === 'hillshade') add('hillshade', feature)
  }
  // A usable offer of a base hides the unusable ones of the same base.
  return offers.filter((offer) => !offer.reason || !offers.some((other) => other.base === offer.base && !other.reason))
}

/**
 * Whether the imported sheet is drawn when the choice is left to PGMaps: always for canopy height
 * when no canopy surface is loaded, and for slope and hillshade unless the project's terrain is a
 * detailed one of its own. Regional terrain (about 22 m) and a surface built from a sheet's contours
 * are coarser than the LiDAR the company's sheet was drawn from.
 */
export function publishedByDefault(
  base: PublishedBase,
  terrain: Pick<RoadProject['terrain'], 'kind' | 'raster' | 'fill'> | null | undefined,
  hasCanopySurface: boolean,
): boolean {
  if (base === 'canopy-height') return !hasCanopySurface
  if (!terrain || terrain.kind === 'regional' || terrain.kind === 'demo') return true
  return isContourTerrain(terrain.raster) || !!terrain.fill
}

/** The offer a sheet of `base` is drawn from under `choice`, or null for the project's own terrain. */
export function publishedChoice(
  base: string,
  choice: SheetRasterChoice,
  offers: readonly PublishedOffer[],
  terrain: Parameters<typeof publishedByDefault>[1],
  hasCanopySurface: boolean,
): PublishedOffer | null {
  const offer = offers.find((entry) => entry.base === base && !entry.reason)
  if (!offer || choice === 'terrain') return null
  return choice === 'sheet' || publishedByDefault(offer.base, terrain, hasCanopySurface) ? offer : null
}

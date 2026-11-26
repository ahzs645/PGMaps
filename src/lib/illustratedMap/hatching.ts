/**
 * The illustrated map's forest hatch. The generator lives in the toolkit
 * (`@pgmaps/geo-toolkit/patterns`), where map sheets, MapLibre layers and other projects share it;
 * these names keep the illustration's own vocabulary. The output is unchanged: the same seed and
 * options give the same strokes, byte for byte.
 */
import {
  DEFAULT_ORGANIC_HATCH,
  DEFAULT_PATCH_HATCH,
  organicHatchSvgGroup,
  organicHatchSwatchSvg,
  patchHatchSvgGroup,
  type OrganicHatchOptions,
  type PatchHatchOptions,
} from '@pgmaps/geo-toolkit/patterns'

export type HatchOptions = OrganicHatchOptions

export const DEFAULT_HATCH_OPTIONS: Readonly<HatchOptions> = DEFAULT_ORGANIC_HATCH

/**
 * Returns explicit cubic strokes in a color-inheriting SVG group.
 * The caller clips to land intersected with forest and applies any illustration
 * clearances. Labels can use independent halos. Coordinates share origin (0,0).
 * Non-positive/non-finite extents return an empty group; finite extents cap at
 * 4096. Excessive requests increase spacing throughout the field, reported in
 * data-effective-spacing/data-budget-limited, without truncating bottom rows.
 */
export const buildHatchPaths = (width: number, height: number, input: Partial<HatchOptions> = {}): string =>
  organicHatchSvgGroup(width, height, input)

/** A standalone 600 x 360 vector sample in the map's source-reproduction color. */
export const buildHatchSwatchSvg = (options: Partial<HatchOptions> = {}): string => organicHatchSwatchSvg(options)

/**
 * The page 8 reference's own hatch: the field drawn patch by patch, fitted to the brand
 * guidelines' northern hatch at this artboard's scale (see `@pgmaps/geo-toolkit/patterns`).
 */
export type PatchHatchStyleOptions = PatchHatchOptions
export const DEFAULT_PAGE8_HATCH_OPTIONS: Readonly<PatchHatchOptions> = DEFAULT_PATCH_HATCH

/** The page 8 patch field over a `width` × `height` artboard, as a colour-inheriting SVG group. */
export const buildPatchHatchPaths = (width: number, height: number, input: Partial<PatchHatchOptions> = {}): string =>
  patchHatchSvgGroup(width, height, input)

/** A standalone 600 × 360 sample of the page 8 patch field. */
export function buildPatchHatchSwatchSvg(options: Partial<PatchHatchOptions> = {}): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="360" viewBox="0 0 600 360" color="#BCC454">' +
    '<title>Page 8 patch hatching</title>' +
    '<desc>Short strokes on stacked, waving ribbons, drawn patch by patch with each patch leaning its own way; fitted to the northern hatch of the brand guidelines, page 8. Authored geometry, not a raster trace.</desc>' +
    '<rect width="600" height="360" fill="white"/>' +
    patchHatchSvgGroup(600, 360, options) +
    '</svg>'
  )
}

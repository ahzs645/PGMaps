/**
 * The illustrated map's forest hatch. The generator lives in the toolkit
 * (`@pgmaps/geo-toolkit/patterns`), where map sheets, MapLibre layers and other projects share it;
 * these names keep the illustration's own vocabulary. The output is unchanged: the same seed and
 * options give the same strokes, byte for byte.
 */
import {
  DEFAULT_ORGANIC_HATCH,
  organicHatchSvgGroup,
  organicHatchSwatchSvg,
  type OrganicHatchOptions,
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

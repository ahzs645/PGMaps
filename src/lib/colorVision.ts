/**
 * Colour-vision-deficiency simulation for the colour-vision preview. Each mode is a 3×3 matrix on
 * linear RGB, drawn as an SVG `feColorMatrix` filter that CSS applies to the page. No DOM access.
 *
 * Protanopia, deuteranopia and tritanopia use the full-severity (1.0) matrices of Machado,
 * Oliveira and Fernandes, "A Physiologically-based Model for Simulation of Color Vision
 * Deficiency", IEEE TVCG 15(6), 2009, doi:10.1109/TVCG.2009.113. Machado's model covers
 * dichromacy, so achromatopsia is relative luminance with the ITU-R BT.709 weights. The filter
 * keeps `color-interpolation-filters="linearRGB"`, so the browser linearizes sRGB before the
 * matrix and re-encodes after it.
 *
 * Adapted from GeoLibre's `cvd-simulation.ts` (MIT, © 2026 Qiusheng Wu).
 */

export const COLOR_VISION_MODES = ['protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia'] as const
export type ColorVisionMode = (typeof COLOR_VISION_MODES)[number]

export const COLOR_VISION_LABELS: Readonly<Record<ColorVisionMode, { label: string; description: string }>> = {
  protanopia: { label: 'Protanopia', description: 'No red cones; reds look dark and close to greens' },
  deuteranopia: { label: 'Deuteranopia', description: 'No green cones; the most common, reds and greens merge' },
  tritanopia: { label: 'Tritanopia', description: 'No blue cones; blues and greens merge, yellows fade to pink' },
  achromatopsia: { label: 'Greyscale', description: 'No colour at all; only lightness is left' },
}

export type RgbMatrix = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
]

const BT709_LUMA = [0.2126, 0.7152, 0.0722] as const

export const COLOR_VISION_MATRICES: Readonly<Record<ColorVisionMode, RgbMatrix>> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
  achromatopsia: [BT709_LUMA, BT709_LUMA, BT709_LUMA],
}

export function isColorVisionMode(value: unknown): value is ColorVisionMode {
  return typeof value === 'string' && (COLOR_VISION_MODES as readonly string[]).includes(value)
}

/** The 20 values of an `feColorMatrix type="matrix"`: RGB rows with no offset, alpha unchanged. */
export function colorMatrixValues(matrix: RgbMatrix): string {
  const rows = matrix.map((row) => [...row, 0, 0])
  rows.push([0, 0, 0, 1, 0])
  return rows.map((row) => row.join(' ')).join(' ')
}

/** The DOM id of a mode's SVG filter, referenced from CSS as `filter: url(#…)`. */
export function colorVisionFilterId(mode: ColorVisionMode): string {
  return `pgmaps-color-vision-${mode}`
}

/** One linear-RGB colour through a matrix (unclamped); the tests use it to check the matrices. */
export function applyRgbMatrix(matrix: RgbMatrix, rgb: readonly [number, number, number]): [number, number, number] {
  const [r, g, b] = rgb
  return matrix.map((row) => row[0] * r + row[1] * g + row[2] * b) as [number, number, number]
}

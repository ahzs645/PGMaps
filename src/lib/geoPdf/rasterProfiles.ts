import type { PdfRasterClass } from './types'

export interface RasterProfile {
  kind: 'canopy' | 'slope'
  unit: 'm' | '%'
  layer: string
  heading: string
  alpha: number
  classes: Omit<PdfRasterClass, 'color'>[]
  /**
   * What the sheet leaves transparent inside the raster: the unpainted class below the lowest
   * printed range (the canopy layer is named "9 Category" but prints 8). The soft mask is stored
   * losslessly even in JPEG tiles, so drawn/not drawn is exact wherever the raster covers.
   */
  undrawn: { label: string; maximum: number }
  /** The separate black overlay corresponds to the separately printed 95+ swatch. */
  overlay?: { layer: string; label: string; base: string }
}
export const CANFOR_RASTERS: RasterProfile[] = [
  {
    kind: 'canopy',
    unit: 'm',
    layer: 'Canopy Height - 9 Category',
    heading: 'Canopy Height (m)',
    alpha: 255,
    undrawn: { label: 'Under 5', maximum: 5 },
    classes: [
      { label: '5-10', minimum: 5, maximum: 10 },
      { label: '10 -15', minimum: 10, maximum: 15 },
      { label: '15 - 20', minimum: 15, maximum: 20 },
      { label: '20- 25', minimum: 20, maximum: 25 },
      { label: '25 - 30', minimum: 25, maximum: 30 },
      { label: '30 - 35', minimum: 30, maximum: 35 },
      { label: '35- 40', minimum: 35, maximum: 40 },
      { label: '40+', minimum: 40, maximum: null },
    ],
  },
  {
    kind: 'slope',
    unit: '%',
    layer: 'Slope Class - Smoothed',
    heading: 'Slope Class (%)',
    alpha: 216,
    undrawn: { label: 'Under 20', maximum: 20 },
    classes: [
      { label: '20 - 30', minimum: 20, maximum: 30 },
      { label: '30 - 35', minimum: 30, maximum: 35 },
      { label: '35 - 40', minimum: 35, maximum: 40 },
      { label: '40 - 50', minimum: 40, maximum: 50 },
      { label: '50 - 60', minimum: 50, maximum: 60 },
      { label: '60 - 85', minimum: 60, maximum: 85 },
      // Preserve the legend literally. Do not silently rewrite this overlapping printed range.
      { label: '85 +', minimum: 85, maximum: null, aliases: [[255, 0, 0]] },
      { label: '95 +', minimum: 95, maximum: null },
    ],
    overlay: { layer: 'Slope Breaks', label: '95 +', base: '85 +' },
  },
]

export const normalizeLegend = (text: string) => text.replace(/[–−]/g, '-').replace(/\s/g, '').toLowerCase()

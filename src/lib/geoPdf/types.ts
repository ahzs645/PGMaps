/** Browser import budgets, independent of the road model's feature/vertex budgets. */
export const PDF_LIMITS = {
  bytes: 64_000_000,
  pages: 8,
  operators: 750_000,
  vertices: 250_000,
  /** Contour vertices collected for a terrain surface, separate from the drawing budget. */
  contourVertices: 3_000_000,
  previewSide: 1400,
  /** Longer side of a class raster's display image: its native pixels up to this, sampled beyond it. */
  classDisplaySide: 4096,
  /** A stored sheet or class display image, as base64 characters. */
  sheetImageChars: 12_000_000,
  registrationErrorM: 3,
  /** A fit residual above this is named in the import notes: positions carry about that much doubt. */
  registrationNoticeM: 0.5,
  rasterCells: 16_777_216,
  rasterImages: 32,
  rasterCompressedBytes: 8_000_000,
  /** All the tiles of one native image layer, as stored bytes. */
  mosaicBytes: 12_000_000,
  /**
   * Share of a losslessly stored tile's drawn pixels that may miss every legend colour before the
   * tile is read as compressed-then-stored: its classes become colour-match estimates.
   */
  damagedTileShare: 0.25,
  losslessColorDistance: 2,
  lossyColorDistance: 24,
  colorSeparation: 12,
} as const

export type XY = [number, number]
export type Box = [number, number, number, number]
export type Matrix = [number, number, number, number, number, number]
export type SourceAttributes = Record<string, string | number | boolean | null>
export interface PdfSource {
  file: string
  sha256: string
  page: number
  layer: string
  profile: string
  /** Fit residual of the embedded control points, not positional accuracy. */
  registrationErrorM: number
}
export interface PdfSheet {
  /** Bounded JPEG sheet or PNG class preview; analysis reads the separate class grid. */
  image: string
  corners: [XY, XY, XY, XY]
}
export interface PdfRasterClass {
  label: string
  minimum: number
  maximum: number | null
  color: [number, number, number]
  /** Template-specific raster colours when the printed swatch differs from the raster. */
  aliases?: [number, number, number][]
}
export interface PdfClassGrid {
  version: 1
  kind: 'canopy' | 'slope'
  unit: 'm' | '%'
  legend: PdfRasterClass[]
  /** The unpainted class below the lowest printed range; absent on grids saved before it was recorded. */
  undrawn?: { label: string; maximum: number }
  width: number
  height: number
  /** Native PDF image pixel corners to the declared projected CRS, in metres. */
  transform: Matrix
  wkt: string
  /** Zlib-compressed row-major bytes: 1..32 matched, 65..96 JPEG estimates, 0/240+ unknown. */
  cells: string
  checksum: string
  counts: number[]
  sourceImages: { reference: string; width: number; height: number; lossy: boolean; layer: string }[]
  notes: string[]
}
/**
 * An image layer of the sheet at its own pixels: the tiles exactly as the PDF stores them (a JPEG
 * file, or a PNG of lossless pixels), placed by their common pixel grid. A picture, never a measurement.
 */
export interface PdfImageMosaic {
  version: 1
  kind: 'hillshade' | 'imagery'
  width: number
  height: number
  /** Native PDF image pixel corners to the declared projected CRS, in metres. */
  transform: Matrix
  wkt: string
  tiles: PdfMosaicTile[]
}
export interface PdfMosaicTile {
  /** `data:image/jpeg` or `data:image/png`, base64. */
  image: string
  col: number
  row: number
  width: number
  height: number
  reference: string
  /** Stored as JPEG in the PDF; false for a PNG written from lossless pixels. */
  lossy: boolean
}
export interface PdfLayer {
  name: string
  source: PdfSource
  features: GeoJSON.Feature[]
  suggestedRole: 'reference' | 'proposed-road' | 'planned-block' | 'terrain'
  selected: boolean
  note: string
  sheet?: PdfSheet
  classGrid?: PdfClassGrid
  /** An image layer at its native pixels (hillshade, ortho imagery). */
  imageMosaic?: PdfImageMosaic
  /**
   * The image layer's decoded tiles in `imageMosaic.tiles` order, one grey byte a pixel, when the
   * reader was asked for them (`PdfReadOptions.mosaicPixels`): scripts and tests, where no browser
   * decodes the stored tiles. Never saved.
   */
  mosaicPixels?: Uint8Array[]
  /** Terrain grid built from the sheet's labelled contours; offered as terrain, never a reference drawing. */
  contourSurface?: import('./contours').PdfContourSurface
}
export interface PdfImport {
  sha256: string
  layers: PdfLayer[]
  notices: string[]
}

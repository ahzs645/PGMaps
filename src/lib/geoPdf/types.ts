/** Browser import budgets, independent of the road model's feature/vertex budgets. */
export const PDF_LIMITS = {
  bytes: 64_000_000,
  pages: 8,
  operators: 750_000,
  vertices: 250_000,
  /** Contour vertices collected for a terrain surface, separate from the drawing budget. */
  contourVertices: 3_000_000,
  previewSide: 1400,
  registrationErrorM: 3,
  rasterCells: 16_777_216,
  rasterImages: 32,
  rasterCompressedBytes: 8_000_000,
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
export interface PdfLayer {
  name: string
  source: PdfSource
  features: GeoJSON.Feature[]
  suggestedRole: 'reference' | 'proposed-road' | 'planned-block' | 'terrain'
  selected: boolean
  note: string
  sheet?: PdfSheet
  classGrid?: PdfClassGrid
  /** Terrain grid built from the sheet's labelled contours; offered as terrain, never a reference drawing. */
  contourSurface?: import('./contours').PdfContourSurface
}
export interface PdfImport {
  sha256: string
  layers: PdfLayer[]
  notices: string[]
}

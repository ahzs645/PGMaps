/**
 * The files a composed sheet can be written as (PDF, SVG, PNG) and the one function that writes
 * each. PDF is drawn by jsPDF (`renderPdf.ts`); SVG is the standalone file of `renderSvg.ts`, for
 * Inkscape and Illustrator; PNG is that SVG drawn at `SHEET_PNG_DPI`. Every raster is encoded as
 * PNG first (`encodeSheetImages`). No DOM or network access: jsPDF and the PNG rasteriser are
 * passed in (`browserSheetFileDeps`, `sheetFileDeps.ts`, gives the browser's).
 */
import type { jsPDF as JsPdf } from 'jspdf'
import type { DrawOp } from './drawOps'
import { encodeSheetImages } from './png'
import { createSheetPdf, drawSheetPdf, type JsPdfModule, type SheetPdfFonts } from './renderPdf'
import { standaloneSheetSvg } from './renderSvg'

export type SheetFormat = 'pdf' | 'svg' | 'png'
export const SHEET_FORMATS: readonly SheetFormat[] = ['pdf', 'svg', 'png']

/** Resolution of a PNG sheet, dots per inch of paper; `MAX_SHEET_PNG_SIDE` may lower it. */
export const SHEET_PNG_DPI = 150
/** PNG pixels per PDF point at `SHEET_PNG_DPI`. */
export const SHEET_PNG_PIXELS_PER_POINT = SHEET_PNG_DPI / 72

export interface SheetFormatInfo {
  label: string
  extension: string
  mime: string
  /** One sentence for the form: what the file is for and what it holds. */
  description: string
}

export const SHEET_FORMAT_INFO: Record<SheetFormat, SheetFormatInfo> = {
  pdf: {
    label: 'PDF',
    extension: 'pdf',
    mime: 'application/pdf',
    description: 'For printing: lines, symbols and text stay vector; the terrain base and imagery are pictures.',
  },
  svg: {
    label: 'SVG (editable)',
    extension: 'svg',
    mime: 'image/svg+xml',
    description:
      'Opens in Inkscape or Illustrator to edit: text stays text and lines and fills stay paths; the terrain base and imagery are embedded pictures.',
  },
  png: {
    label: 'PNG image',
    extension: 'png',
    mime: 'image/png',
    description: `One picture of the whole sheet at ${SHEET_PNG_DPI} dpi, for a document or a message.`,
  },
}

export const isSheetFormat = (value: unknown): value is SheetFormat => SHEET_FORMATS.includes(value as SheetFormat)

/** A drawn sheet: a `ComposedSheet` or anything with its size in points and its operations. */
export interface SheetPicture {
  width: number
  height: number
  ops: readonly DrawOp[]
}

/** What writing a format needs from the page; only the chosen format's part is read. */
export interface SheetFileDeps {
  /** The jsPDF module, for PDF. */
  jspdf?: JsPdfModule
  /** Called once on each new PDF document, e.g. `configurePdfBrand`; its fonts draw the text. */
  configurePdf?: (pdf: JsPdf) => SheetPdfFonts | undefined
  /** Draws an SVG as a PNG at `pixelsPerPoint` (`sheetPngBlob`), for PNG. */
  rasterise?: (svg: string, width: number, height: number, pixelsPerPoint: number) => Promise<Blob>
}

export interface SheetFileOptions {
  /** The SVG's `<title>`, e.g. the block's name. */
  title?: string
  signal?: AbortSignal
}

function cancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Sheet export cancelled.', 'AbortError')
}

/** Draws already encoded operations into a new PDF. */
export function sheetPdfBytes(sheet: SheetPicture, deps: SheetFileDeps): ArrayBuffer {
  if (!deps.jspdf) throw Error('PDF output needs jsPDF.')
  const pdf = createSheetPdf(deps.jspdf, sheet.width, sheet.height)
  const fonts = deps.configurePdf?.(pdf)
  drawSheetPdf(pdf, deps.jspdf, sheet.ops, fonts)
  return pdf.output('arraybuffer')
}

/**
 * The sheet as a file of `format`. Raw rasters are encoded here, so a `ComposedSheet` goes in as
 * `buildSheet` returned it. PDF needs `deps.jspdf`, PNG `deps.rasterise`; SVG needs neither.
 */
export async function sheetFile(
  sheet: SheetPicture,
  format: SheetFormat,
  deps: SheetFileDeps,
  options: SheetFileOptions = {},
): Promise<Blob> {
  const ops = await encodeSheetImages(sheet.ops)
  cancelled(options.signal)
  const encoded = { width: sheet.width, height: sheet.height, ops }
  const { mime } = SHEET_FORMAT_INFO[format]
  if (format === 'pdf') return new Blob([sheetPdfBytes(encoded, deps)], { type: mime })
  const svg = standaloneSheetSvg(ops, sheet.width, sheet.height, { title: options.title })
  if (format === 'svg') return new Blob([svg], { type: mime })
  if (!deps.rasterise) throw Error('PNG output needs a rasteriser.')
  const png = await deps.rasterise(svg, sheet.width, sheet.height, SHEET_PNG_PIXELS_PER_POINT)
  cancelled(options.signal)
  return png.type === mime ? png : new Blob([png], { type: mime })
}

/** `name` with the format's extension, replacing a sheet extension it already has. */
export function withSheetExtension(name: string, format: SheetFormat | 'zip') {
  const extension = format === 'zip' ? 'zip' : SHEET_FORMAT_INFO[format].extension
  return `${name.replace(/\.(pdf|svg|png|zip)$/i, '')}.${extension}`
}

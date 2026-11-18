/**
 * The browser's half of `sheetFormats.ts`: loads jsPDF for a PDF and supplies the canvas
 * rasteriser (`sheetPngBlob`) for a PNG, only when that format is written. Browser only.
 */
import type { jsPDF as JsPdf } from 'jspdf'
import type { SheetPdfFonts } from './renderPdf'
import type { SheetFileDeps, SheetFormat } from './sheetFormats'

export async function browserSheetFileDeps(
  formats: SheetFormat | readonly SheetFormat[],
  options: { configurePdf?: (pdf: JsPdf) => SheetPdfFonts | undefined } = {},
): Promise<SheetFileDeps> {
  const wanted = new Set(typeof formats === 'string' ? [formats] : formats)
  const [jspdf, png] = await Promise.all([
    wanted.has('pdf') ? import('jspdf') : null,
    wanted.has('png') ? import('./sheetPng') : null,
  ])
  return {
    ...(jspdf ? { jspdf, configurePdf: options.configurePdf } : {}),
    ...(png ? { rasterise: png.sheetPngBlob } : {}),
  }
}

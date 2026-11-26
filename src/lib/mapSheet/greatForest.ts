/**
 * The Great Forest faces in a sheet PDF: registers the committed TTFs with jsPDF (Identity-H, so
 * every glyph they have prints) and returns the family names `drawSheetPdf` takes. The fonts'
 * bytes are passed in, so the module reads nothing itself: the browser fetches them from
 * `GREAT_FOREST_FILES`, a Node script reads them from `public/`. No DOM or network access.
 */
import type { jsPDF as JsPdf } from 'jspdf'
import type { SheetPdfFonts } from './renderPdf'

/** The committed files, under `public/illustrated-map/fonts/great-forest/`. */
export const GREAT_FOREST_FILES = {
  'great-forest': {
    ttf: 'GreatForest-SmallCaps-v1.000-VancouverIslandNorth.decompressed.ttf',
    woff: 'GreatForest-SmallCaps-v1.000-VancouverIslandNorth.original.woff',
  },
  'great-forest-display': {
    ttf: 'GreatForest-Simplified-v1.000-VancouverIslandNorth.decompressed.ttf',
    woff: 'GreatForest-Simplified-v1.000-VancouverIslandNorth.original.woff',
  },
} as const
export const GREAT_FOREST_DIRECTORY = 'illustrated-map/fonts/great-forest'

const PDF_NAMES = { 'great-forest': 'GreatForestSmallCaps', 'great-forest-display': 'GreatForestSimplified' } as const

const base64 = (bytes: Uint8Array) => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/**
 * Adds the faces whose TTF bytes are given to `pdf` and returns the `families` entry of
 * `SheetPdfFonts` that sets text in them.
 */
export function registerGreatForestPdf(
  pdf: JsPdf,
  ttf: Partial<Record<keyof typeof PDF_NAMES, Uint8Array>>,
): NonNullable<SheetPdfFonts['families']> {
  const families: NonNullable<SheetPdfFonts['families']> = {}
  for (const family of Object.keys(PDF_NAMES) as (keyof typeof PDF_NAMES)[]) {
    const bytes = ttf[family]
    if (!bytes) continue
    const file = GREAT_FOREST_FILES[family].ttf
    pdf.addFileToVFS(file, base64(bytes))
    pdf.addFont(file, PDF_NAMES[family], 'normal', 'Identity-H')
    families[family] = PDF_NAMES[family]
  }
  return families
}

/** A WOFF as a `data:` URL, to embed in a standalone SVG. */
export const woffDataUrl = (bytes: Uint8Array) => `data:font/woff;base64,${base64(bytes)}`

/**
 * The VIA report's Word outputs in the browser (Save & export's *Word* and *PDF from the Word layout*, and the Word
 * file's preview): the report built through document-kit's recipe engine from its JSON recipe
 * (`viaReport/recipeRoute.ts`), placed on the PDF's pages by `viaReport/word.ts` and written by the kit's Word writer,
 * and that same file laid out by the kit to a PDF or to page pictures. Every part of the kit, the recipes and the
 * fonts is loaded here on demand, never with the page. The layout reaches the network only for the fonts this build
 * serves (`viaReportWordFonts.ts`).
 */
import type { RecipeRouteInput } from './viaReport/recipeRoute'

export const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/**
 * The report as a Word file, through the recipe engine. `created` pins the file's dates, so the same report writes
 * the same bytes. The direct route (`reportDocx`) writes the same bytes and stays as the test oracle
 * (`viaReport/recipeRoute.test.ts`).
 */
export async function viaReportDocx(input: Omit<RecipeRouteInput, 'options'>, created: string): Promise<Uint8Array> {
  const [kit, { writeDocx }, recipe, { recipeReportDocx }] = await Promise.all([
    import('document-kit'),
    import('document-kit/docx'),
    import('document-kit/recipe'),
    import('./viaReport/recipeRoute'),
  ])
  return recipeReportDocx({ recipe, imageInfo: kit.imageInfo, writeDocx }, { ...input, options: { created } })
}

/** Each font file's bytes, fetched once a session. */
const fontBytes = new Map<string, Promise<Uint8Array>>()

async function wordFonts() {
  const [{ createFontProvider }, { WORD_FONT_URLS }] = await Promise.all([
    import('document-kit/layout'),
    import('./viaReportWordFonts'),
  ])
  return createFontProvider(({ file }) => {
    const url = WORD_FONT_URLS[file]
    // A face this build does not serve is drawn in Arimo and reported as a loss, never fetched from elsewhere.
    if (!url) return undefined
    let bytes = fontBytes.get(file)
    if (!bytes) {
      bytes = fetch(url).then(async (response) => {
        if (!response.ok) throw new Error(`The font ${file} did not load (${response.status}).`)
        return new Uint8Array(await response.arrayBuffer())
      })
      bytes.catch(() => fontBytes.delete(file))
      fontBytes.set(file, bytes)
    }
    return bytes
  })
}

/** What the layout could not draw as the Word file has it, beyond drawing Arial in its stand-in, in a sentence. */
function layoutNotes(losses: ReadonlyArray<{ severity: string; detail: string }>): string | undefined {
  const notes = losses
    .filter((loss) => loss.severity === 'dropped')
    .map((loss) => `Not drawn: ${loss.detail.replace(/\.$/, '')}.`)
  return notes.length ? notes.join(' ') : undefined
}

/** The Word file laid out to a PDF by the kit, so its pages are the Word file's pages. */
export async function viaReportWordPdf(docx: Uint8Array): Promise<{ bytes: Uint8Array; notes?: string }> {
  const [{ docxToPdf }, fonts] = await Promise.all([import('document-kit/layout'), wordFonts()])
  const pdf = await docxToPdf(docx, { fonts })
  return { bytes: pdf.bytes, notes: layoutNotes(pdf.losses) }
}

/** The Word file's pages as pictures in one HTML page: the preview of the very bytes the download saves. */
export async function viaReportWordPagesHtml(docx: Uint8Array): Promise<string> {
  const [{ docxToPages }, fonts] = await Promise.all([import('document-kit/layout'), wordFonts()])
  const { pages, pageSizes } = await docxToPages(docx, { fonts })
  const body = pages
    .map(
      (svg, i) =>
        `<figure style="max-width:${pageSizes[i]?.widthPt ?? 612}pt">${svg.replace(/^<\?xml[^>]*>\s*/, '')}<figcaption>Page ${i + 1} of ${pages.length}</figcaption></figure>`,
    )
    .join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Word pages</title><style>body{margin:0;padding:12px;background:#e2e8f0;font:11px system-ui,sans-serif;color:#475569}figure{margin:0 auto 14px}figure svg{display:block;width:100%;height:auto;box-shadow:0 1px 3px rgba(15,23,42,.25)}figcaption{text-align:center;margin-top:3px}</style></head><body>${body}</body></html>`
}

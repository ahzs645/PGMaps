import type * as PdfJs from 'pdfjs-dist'

let runtime: Promise<typeof PdfJs> | null = null

/**
 * pdf.js on the page's thread, for drawing a PDF's pages into the app's own viewer
 * (`PdfPages`, `src/components/ui/pdf-pages.tsx`). Loaded on first use only, so neither it nor its
 * worker joins the shell. A failed load is tried again on the next call.
 */
export function loadPdfJs(): Promise<typeof PdfJs> {
  runtime ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
    .then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default
      return pdfjs
    })
    .catch((error: unknown) => {
      runtime = null
      throw error
    })
  return runtime
}

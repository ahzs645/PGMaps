/**
 * The plot book as a PDF: each sheet of `plotBookHtml` drawn as vector graphics on one page of the
 * book's paper, so text stays selectable and lines stay sharp at any zoom. Browser only: svg2pdf.js
 * lays the sheets out through the DOM.
 */

import { pdfText } from '@/lib/mapSheet/renderPdf'
import { REPORT_PAPERS, type ReportPaper } from './reportSettings'
import type { ExportBrand } from '@/branding/model'
import { configurePdfBrand } from '@/branding/pdf'

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Plot book PDF cancelled.', 'AbortError')
}

/**
 * Readies a sheet for jsPDF's standard fonts, which are WinAnsi Helvetica in two weights: every label
 * is folded the way the other sheets' PDFs fold theirs, and a numeric weight becomes normal or bold.
 * svg2pdf finds no Helvetica at weight 600 and falls back to Times for it.
 */
export function prepareSheetText(svg: SVGSVGElement) {
  const walker = svg.ownerDocument.createTreeWalker(svg, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    if (node.nodeValue) node.nodeValue = pdfText(node.nodeValue)
  for (const element of [svg, ...svg.querySelectorAll('[font-weight]')]) {
    const weight = Number(element.getAttribute('font-weight'))
    if (Number.isFinite(weight) && weight > 0) element.setAttribute('font-weight', weight >= 600 ? 'bold' : 'normal')
  }
}

export async function plotBookPdf(
  html: string,
  paper: ReportPaper,
  signal?: AbortSignal,
  branding?: ExportBrand,
): Promise<Blob> {
  const size = REPORT_PAPERS[paper]
  const sheets = [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('section.sheet > svg')]
  if (!sheets.length) throw Error('The plot book has no sheets to print.')
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js')])
  throwIfAborted(signal)
  const pdf = new jsPDF({ unit: 'mm', format: [size.widthMm, size.heightMm], orientation: 'landscape', compress: true })
  const fonts = configurePdfBrand(pdf, branding)
  // svg2pdf measures text through the DOM, so each sheet is laid out off screen while it is drawn.
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'position:fixed;left:-100000px;top:0;width:0;height:0;overflow:hidden;visibility:hidden'
  document.body.append(host)
  try {
    for (const [index, source] of sheets.entries()) {
      throwIfAborted(signal)
      const svg = document.importNode(source, true) as SVGSVGElement
      prepareSheetText(svg)
      if (branding)
        for (const text of svg.querySelectorAll('text')) {
          const heading = text.getAttribute('font-weight') === 'bold'
          text.setAttribute('font-family', heading ? fonts.heading : fonts.body)
          if (fonts.custom) text.setAttribute('font-weight', 'normal')
        }
      host.replaceChildren(svg)
      if (index) pdf.addPage([size.widthMm, size.heightMm], 'landscape')
      await svg2pdf(svg, pdf, { x: 0, y: 0, width: size.widthMm, height: size.heightMm })
      // Let a cancel and the page breathe between sheets of a long book.
      await new Promise((resolve) => setTimeout(resolve))
    }
  } finally {
    host.remove()
  }
  throwIfAborted(signal)
  return pdf.output('blob')
}

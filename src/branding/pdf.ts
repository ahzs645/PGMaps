import type { jsPDF } from 'jspdf'
import { pdfFontProblem, type ExportBrand } from './model'

export type PdfBrandFonts = { body: string; heading: string; custom: boolean }
export function configurePdfBrand(pdf: jsPDF, selected?: ExportBrand): PdfBrandFonts {
  if (selected)
    pdf.setProperties({
      subject: selected.brand.profile.provenance.status,
      creator: 'PGMaps / Brandkit ' + selected.brand.profile.id,
    })
  if (!selected?.pdfFonts) return { body: 'helvetica', heading: 'helvetica', custom: false }
  const problem = pdfFontProblem(selected.brand)
  if (problem) throw Error(problem + ' Turn off PDF brand fonts in Branding to use standard fonts.')
  for (const role of ['body', 'heading'] as const) {
    const face = selected.brand.profile.typography[role]
    const font = selected.brand.fonts.find(
      (f) => f.family === face.family && f.weight === face.weight && f.style === face.style,
    )!
    const name = 'pgmaps-brand-' + role
    pdf.addFileToVFS(name + '.ttf', font.dataUrl.split(',')[1])
    pdf.addFont(name + '.ttf', name, 'normal')
  }
  return { body: 'pgmaps-brand-body', heading: 'pgmaps-brand-heading', custom: true }
}
export function setPdfBrandFont(pdf: jsPDF, fonts: PdfBrandFonts, heading = false) {
  pdf.setFont(heading ? fonts.heading : fonts.body, fonts.custom ? 'normal' : heading ? 'bold' : 'normal')
}

/** Preserve complete outlined artwork; PDF does not need to embed fonts to print the logo. */
export async function drawPdfBrandLogo(
  pdf: jsPDF,
  selected: ExportBrand | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  if (!selected) return
  const { profile } = selected.brand,
    logo = profile.logos.primary
  const ratio = logo.viewBox[2] / logo.viewBox[3]
  const space = profile.identity?.logo?.clearSpaceRatio ?? 0
  const artWidth = Math.min(width / (1 + 2 * space), height / (1 / ratio + 2 * space))
  const minimum = ((profile.identity?.minimumLogoWidthMm ?? 0) * 72) / 25.4 / pdf.internal.scaleFactor
  if (artWidth < minimum)
    throw Error('This logo needs more room for its minimum size. Use a larger sheet or turn export branding off.')
  const doc = new DOMParser().parseFromString(logo.svg, 'image/svg+xml')
  const svg = document.importNode(doc.documentElement, true) as unknown as SVGSVGElement
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden'
  host.append(svg)
  document.body.append(host)
  try {
    const { svg2pdf } = await import('svg2pdf.js')
    await svg2pdf(svg, pdf, {
      x: x + artWidth * space,
      y: y + artWidth * space,
      width: artWidth,
      height: artWidth / ratio,
    })
  } finally {
    host.remove()
  }
}

/**
 * Assembles one file of the report package: a cover (or an appendix's title page) whose contents
 * give the page each part starts on, followed by the parts' PDFs, merged with pdf-lib. Text goes
 * through `pdfText`, as on the sheets, because the standard Helvetica cannot encode every character.
 * No DOM or network access: pdf-lib runs in Node, which is what lets the tests open the result.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { pdfText } from '@/lib/mapSheet/renderPdf'

export interface PackageEntry {
  /** As it reads in the contents, e.g. "TPY003.1000 · report". */
  label: string
  pdf: Uint8Array
}

export interface PackageCover {
  /** Small line above the title, e.g. "PGMaps forest road design · report package". */
  eyebrow: string
  title: string
  /** Under the title: roads and what this file is. */
  subtitle: string
  /** Issue stamp line and the planning caveat, printed as given. */
  stamp: string[]
  /** What this file holds, in words (`describeFile`). */
  holds: string[]
  /** The package's other files, for the main file's cover; an appendix names its package instead. */
  appendices: { filename: string; title: string }[]
  /** Parts left out of the whole package. */
  omitted: string[]
}

const A4 = { width: 595.28, height: 841.89 }
const MARGIN = 50

interface Fonts {
  regular: PDFFont
  bold: PDFFont
}

/** Lays out the cover; returns its page count. With `pages` absent the contents numbers are placeholders. */
function drawCover(doc: PDFDocument, fonts: Fonts, cover: PackageCover, contents: { label: string; page: number }[]) {
  let page: PDFPage = doc.addPage([A4.width, A4.height])
  let y = A4.height - MARGIN
  let count = 1
  const width = A4.width - 2 * MARGIN
  const newPage = () => {
    page = doc.addPage([A4.width, A4.height])
    y = A4.height - MARGIN
    count++
  }
  const wrap = (text: string, font: PDFFont, size: number, max: number) => {
    const words = pdfText(text).split(/\s+/).filter(Boolean)
    const lines: string[] = []
    let line = ''
    for (const word of words) {
      const next = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(next, size) <= max || !line) line = next
      else {
        lines.push(line)
        line = word
      }
    }
    if (line) lines.push(line)
    return lines
  }
  const write = (
    text: string,
    { size = 10, bold = false, gap = 4, color = rgb(0.11, 0.14, 0.16), indent = 0 } = {},
  ) => {
    const font = bold ? fonts.bold : fonts.regular
    for (const line of wrap(text, font, size, width - indent)) {
      if (y - size < MARGIN) newPage()
      y -= size * 1.25
      page.drawText(line, { x: MARGIN + indent, y, size, font, color })
    }
    y -= gap
  }
  const heading = (text: string) => {
    if (y - 40 < MARGIN) newPage()
    y -= 8
    write(text, { size: 13, bold: true, gap: 6 })
  }
  write(cover.eyebrow, { size: 8.5, color: rgb(0.36, 0.4, 0.44) })
  write(cover.title, { size: 22, bold: true, gap: 2 })
  write(cover.subtitle, { size: 11, gap: 10 })
  for (const line of cover.stamp) write(line, { size: 9.5, color: rgb(0.7, 0.15, 0.12), gap: 2 })
  y -= 8
  if (cover.holds.length) {
    heading('This file holds')
    for (const line of cover.holds) write(`- ${line}`, { size: 10, indent: 6 })
  }
  heading('Contents')
  for (const entry of contents) {
    const label = wrap(entry.label, fonts.regular, 10, width - 60)
    const number = `p. ${entry.page}`
    label.forEach((line, i) => {
      if (y - 10 < MARGIN) newPage()
      y -= 12.5
      page.drawText(line, { x: MARGIN, y, size: 10, font: fonts.regular, color: rgb(0.11, 0.14, 0.16) })
      if (i === 0)
        page.drawText(number, {
          x: A4.width - MARGIN - fonts.regular.widthOfTextAtSize(number, 10),
          y,
          size: 10,
          font: fonts.regular,
          color: rgb(0.36, 0.4, 0.44),
        })
    })
    y -= 2
  }
  if (cover.appendices.length) {
    heading('Appendices (separate PDFs)')
    for (const a of cover.appendices) write(`- ${a.filename}: ${a.title}`, { size: 10, indent: 6 })
  }
  if (cover.omitted.length) {
    heading('Left out of this package')
    write(cover.omitted.join(', '), { size: 9.5, color: rgb(0.36, 0.4, 0.44) })
  }
  return count
}

/** The page count of a PDF. */
export async function pdfPageCount(pdf: Uint8Array): Promise<number> {
  return (await PDFDocument.load(pdf, { ignoreEncryption: true })).getPageCount()
}

/**
 * The file: cover first, then each entry in order. Returns the bytes and where each entry starts,
 * which is also what the cover's contents print.
 */
export async function assemblePackageFile(
  cover: PackageCover,
  entries: readonly PackageEntry[],
  meta: { title: string; subject?: string } = { title: cover.title },
): Promise<{ bytes: Uint8Array; pages: number; starts: { label: string; page: number }[] }> {
  const loaded = await Promise.all(entries.map((e) => PDFDocument.load(e.pdf, { ignoreEncryption: true })))
  // The cover's length moves every number after it: lay it out once with placeholders to count it.
  const probe = await PDFDocument.create()
  const probeFonts = {
    regular: await probe.embedFont(StandardFonts.Helvetica),
    bold: await probe.embedFont(StandardFonts.HelveticaBold),
  }
  const placeholder = entries.map((e) => ({ label: e.label, page: 9999 }))
  const coverPages = drawCover(probe, probeFonts, cover, placeholder)
  const starts: { label: string; page: number }[] = []
  let next = coverPages + 1
  entries.forEach((entry, i) => {
    starts.push({ label: entry.label, page: next })
    next += loaded[i].getPageCount()
  })
  const doc = await PDFDocument.create()
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  }
  const drawn = drawCover(doc, fonts, cover, starts)
  if (drawn !== coverPages) throw Error('The package cover changed length between its two layouts.')
  for (const source of loaded) {
    const pages = await doc.copyPages(source, source.getPageIndices())
    for (const p of pages) doc.addPage(p)
  }
  // Metadata is stored as UTF-16, so it keeps characters the cover's standard font folds.
  doc.setTitle(meta.title)
  if (meta.subject) doc.setSubject(meta.subject)
  doc.setCreator('PGMaps forest road design')
  const bytes = await doc.save()
  return { bytes, pages: doc.getPageCount(), starts }
}

/**
 * The file with a front of its own (the summary page) in place of the drawn cover: the front's
 * pages, then each entry. Returns where each entry starts, counted from the front's length.
 */
export async function mergePackageFile(
  front: Uint8Array,
  entries: readonly PackageEntry[],
  meta: { title: string; subject?: string },
): Promise<{ bytes: Uint8Array; pages: number; starts: { label: string; page: number }[] }> {
  const doc = await PDFDocument.create()
  const sources = [front, ...entries.map((e) => e.pdf)]
  const starts: { label: string; page: number }[] = []
  for (const [i, pdf] of sources.entries()) {
    const source = await PDFDocument.load(pdf, { ignoreEncryption: true })
    if (i > 0) starts.push({ label: entries[i - 1].label, page: doc.getPageCount() + 1 })
    for (const page of await doc.copyPages(source, source.getPageIndices())) doc.addPage(page)
  }
  doc.setTitle(meta.title)
  if (meta.subject) doc.setSubject(meta.subject)
  doc.setCreator('PGMaps forest road design')
  return { bytes: await doc.save(), pages: doc.getPageCount(), starts }
}

/** Where each entry would start after a front of `frontPages` pages. */
export async function entryStarts(frontPages: number, entries: readonly PackageEntry[]) {
  const starts: { label: string; page: number }[] = []
  let next = frontPages + 1
  for (const entry of entries) {
    starts.push({ label: entry.label, page: next })
    next += await pdfPageCount(entry.pdf)
  }
  return starts
}

/**
 * Draws a sheet's operations into a jsPDF document as vectors: frames, symbols, hatches, text with
 * halos. Rasters (imagery, classed slope or canopy height, hillshade) are the only images. Takes the
 * jsPDF module as an argument so callers import it lazily and tests run it in Node. No DOM access.
 */
import type { GState as GStateClass, jsPDF as JsPdf } from 'jspdf'
import { glyphsAlongPath, type CurvePart, type DrawOp, type Point, type StrokeStyle } from './drawOps'

/** The parts of the jsPDF module the renderer uses; callers import it lazily and pass it in. */
export type JsPdfModule = { jsPDF: typeof JsPdf; GState: typeof GStateClass }

/** Fonts a brand puts in the PDF (`configurePdfBrand`); without them the sheet prints Helvetica. */
export type SheetPdfFonts = { body: string; heading: string; custom: boolean }

/** Characters jsPDF's standard fonts print besides printable ASCII and Latin-1: WinAnsi's extras. */
const WIN_ANSI_EXTRAS = 'ŒœŠšŽžŸ€ƒ‰•™†‡ˆ˜‹›'
/** Letters with no decomposition, written as the letter they are read as. */
const LETTER_FOLDS: Record<string, string> = {
  ł: 'l',
  Ł: 'L',
  đ: 'd',
  Đ: 'D',
  ħ: 'h',
  Ħ: 'H',
  ı: 'i',
  ŧ: 't',
  Ŧ: 'T',
  ʼ: "'",
  ʻ: "'",
}
const COMBINING = /\p{M}/gu
const isCombining = (c: string) => /^\p{M}$/u.test(c)
const printable = (c: string) => {
  const code = c.codePointAt(0)!
  return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRAS.includes(c)
}

/**
 * One character the standard fonts cannot print: a letter as itself without its accents
 * (ḵ to k, ŵ to w), a few letters by the letter they are read as (ł to l), a lone accent left
 * out, anything else "?".
 */
function foldCharacter(c: string): string {
  if (LETTER_FOLDS[c]) return LETTER_FOLDS[c]
  if (isCombining(c)) return ''
  const bare = c.normalize('NFD').replace(COMBINING, '')
  return bare && [...bare].every(printable) ? bare : '?'
}

/**
 * jsPDF's standard fonts are WinAnsi: fold the characters a sheet commonly carries into it. Latin-1
 * and WinAnsi letters (é, ü, ñ, Å, œ, Š) print as they are, so do place names in most European
 * languages; letters beyond it lose only their accents, so a name stays readable.
 */
export function pdfText(value: string, { unicodeLetters = false }: { unicodeLetters?: boolean } = {}): string {
  return value
    .normalize('NFC')
    .replace(/[−‒]/g, '-')
    .replace(/[–—]/g, ' - ')
    .replace(/→/g, ' to ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/ · /g, ' - ')
    .replace(/·/g, '-')
    .replace(/[≥]/g, '>=')
    .replace(/[≤]/g, '<=')
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (c) => String('⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(c)))
    .replace(/÷/g, '/')
    .replace(/≈/g, '~')
    .replace(/√/g, 'sqrt')
    .replace(/[^\x20-\x7e]/gu, (c) =>
      printable(c) || (unicodeLetters && /^[\p{L}\p{M}]$/u.test(c)) ? c : foldCharacter(c),
    )
}

/** The characters `pdfText` cannot fold and would print as "?", for tests over a sheet's text. */
export function pdfTextUnfolded(value: string): string[] {
  const folded = pdfText(value)
  const kept = (value.match(/\?/g) ?? []).length
  if ((folded.match(/\?/g) ?? []).length === kept) return []
  return [...new Set([...value].filter((c) => pdfText(c).includes('?') && c !== '?'))]
}

export function createSheetPdf(module: JsPdfModule, width: number, height: number): JsPdf {
  return new module.jsPDF({
    unit: 'pt',
    format: [width, height],
    orientation: width >= height ? 'landscape' : 'portrait',
    compress: true,
  })
}

/**
 * Starts the next page of a multi-page sheet PDF, `width` × `height` points: each page carries its
 * own size, so a series can mix papers. Draw it with `drawSheetPdf`, which draws on the current page.
 */
export function addSheetPage(pdf: JsPdf, width: number, height: number) {
  pdf.addPage([width, height], width >= height ? 'landscape' : 'portrait')
}

/** Draws `ops` onto the current page of `pdf`. */
let formCount = 0
/** Half Helvetica's cap height, in ems: how far below a line a `middle` baseline sits. */
const PDF_MIDDLE_BASELINE_EM = 0.358

export function drawSheetPdf(pdf: JsPdf, module: JsPdfModule, ops: readonly DrawOp[], fonts?: SheetPdfFonts) {
  const opacity = (fill?: number, stroke?: number) => {
    pdf.setGState(
      new module.GState({
        opacity: fill ?? 1,
        'stroke-opacity': stroke ?? 1,
      }),
    )
  }
  const applyStroke = (stroke: StrokeStyle) => {
    pdf.setDrawColor(stroke.color)
    pdf.setLineWidth(stroke.width)
    pdf.setLineDashPattern(stroke.dash ?? [], 0)
    pdf.setLineCap(stroke.cap ?? 'butt')
    pdf.setLineJoin(stroke.join ?? 'miter')
  }
  const trace = (parts: Point[][], closed: boolean) => {
    for (const part of parts) {
      if (part.length < 2) continue
      pdf.moveTo(part[0][0], part[0][1])
      for (let i = 1; i < part.length; i++) pdf.lineTo(part[i][0], part[i][1])
      if (closed) pdf.close()
    }
  }
  const traceCurves = (parts: readonly CurvePart[], closed: boolean) => {
    for (const part of parts) {
      if (!part.segments.length) continue
      pdf.moveTo(part.start[0], part.start[1])
      for (const [c1, c2, end] of part.segments) pdf.curveTo(c1[0], c1[1], c2[0], c2[1], end[0], end[1])
      if (closed) pdf.close()
    }
  }
  // Symbols are form XObjects; their keys are unique in the document, whatever their ids.
  const forms = new Map<string, string>()
  const draw = (list: readonly DrawOp[]) => {
    for (const op of list) {
      switch (op.op) {
        case 'rect':
        case 'path':
        case 'curves':
        case 'circle': {
          const translucent = (op.op !== 'circle' && op.fillOpacity !== undefined) || op.stroke?.opacity !== undefined
          if (translucent) {
            pdf.saveGraphicsState()
            opacity(op.op !== 'circle' ? op.fillOpacity : undefined, op.stroke?.opacity)
          }
          if (op.fill) pdf.setFillColor(op.fill)
          if (op.stroke) applyStroke(op.stroke)
          const mode = op.fill && op.stroke ? 'FD' : op.fill ? 'F' : op.stroke ? 'S' : null
          if (mode) {
            if (op.op === 'rect') pdf.rect(op.x, op.y, op.w, op.h, mode)
            else if (op.op === 'circle') pdf.circle(op.x, op.y, op.r, mode)
            else {
              if (op.op === 'curves') traceCurves(op.parts, op.closed)
              else trace(op.parts, op.closed)
              if (mode === 'FD') pdf.fillStrokeEvenOdd()
              else if (mode === 'F') pdf.fillEvenOdd()
              else pdf.stroke()
            }
          }
          if (translucent) pdf.restoreGraphicsState()
          break
        }
        case 'text': {
          pdf.setFont(
            fonts ? (op.style === 'bold' ? fonts.heading : fonts.body) : (op.family ?? 'helvetica'),
            fonts?.custom ? 'normal' : (op.style ?? 'normal'),
          )
          pdf.setFontSize(op.size)
          const options = {
            align: op.align ?? 'left',
            baseline: op.baseline === 'middle' ? ('middle' as const) : ('alphabetic' as const),
            ...(op.angle ? { angle: op.angle } : {}),
          }
          // A brand font is embedded with its own Unicode map, so every letter it has prints as written.
          const value = pdfText(op.text, { unicodeLetters: fonts?.custom === true })
          if (op.halo) {
            pdf.saveGraphicsState()
            pdf.setDrawColor(op.halo.color)
            pdf.setLineWidth(op.halo.width)
            pdf.setLineDashPattern([], 0)
            pdf.setLineJoin('round')
            pdf.setTextColor(op.halo.color)
            pdf.text(value, op.x, op.y, { ...options, renderingMode: 'fillThenStroke' })
            pdf.restoreGraphicsState()
          }
          pdf.setTextColor(op.color)
          pdf.text(value, op.x, op.y, options)
          break
        }
        case 'image':
          if (op.image.kind === 'rgba')
            pdf.addImage(
              { data: op.image.data, width: op.image.width, height: op.image.height } as never,
              'RGBA',
              op.x,
              op.y,
              op.w,
              op.h,
              undefined,
              'FAST',
            )
          else pdf.addImage(op.image.url, op.image.format, op.x, op.y, op.w, op.h, undefined, 'FAST')
          break
        case 'clip':
          pdf.saveGraphicsState()
          trace(op.parts, true)
          pdf.clipEvenOdd()
          pdf.discardPath()
          break
        case 'restore':
          pdf.restoreGraphicsState()
          break
        // jsPDF cannot write optional content groups, so a PDF keeps a group's drawing order only;
        // the SVG carries named layers.
        case 'group':
        case 'endGroup':
          break
        case 'symbol': {
          const key = `sheet-symbol-${++formCount}`
          forms.set(op.id, key)
          const { x, y, w, h } = op.bounds
          pdf.advancedAPI((advanced) => {
            advanced.beginFormObject(x, y, w, h, advanced.unitMatrix)
            draw(op.ops)
            advanced.endFormObject(key)
          })
          break
        }
        case 'use': {
          const key = forms.get(op.id)
          if (!key) throw Error(`The sheet places symbol "${op.id}" before defining it.`)
          const a = ((op.rotation ?? 0) * Math.PI) / 180
          const k = op.scale ?? 1
          // Counter-clockwise on paper, where y runs down, as `iconOps` turns icons.
          pdf.advancedAPI((advanced) =>
            advanced.doFormObject(
              key,
              advanced.Matrix(Math.cos(a) * k, -Math.sin(a) * k, Math.sin(a) * k, Math.cos(a) * k, op.x, op.y),
            ),
          )
          break
        }
        case 'textPath': {
          // Glyph by glyph along the line, every halo first so none covers a neighbour's letter.
          const value = pdfText(op.text, { unicodeLetters: fonts?.custom === true })
          const drop = op.baseline === 'middle' ? op.size * PDF_MIDDLE_BASELINE_EM : 0
          const glyphs = glyphsAlongPath(op.path, value, op.size, op.style, op.align, op.offset, drop)
          const glyph = (
            g: (typeof glyphs)[number],
            color: string,
            halo?: { color: string; width: number },
          ): DrawOp => ({
            op: 'text',
            x: g.x,
            y: g.y,
            text: g.char,
            size: op.size,
            color,
            ...(op.style ? { style: op.style } : {}),
            ...(op.family ? { family: op.family } : {}),
            ...(g.angle ? { angle: g.angle } : {}),
            ...(halo ? { halo } : {}),
          })
          if (op.halo) draw(glyphs.map((g) => glyph(g, op.halo!.color, op.halo)))
          draw(glyphs.map((g) => glyph(g, op.color)))
          break
        }
      }
    }
  }
  draw(ops)
  // Leave the next caller with jsPDF's defaults.
  pdf.setLineDashPattern([], 0)
}

/**
 * Draws a sheet's operations into a jsPDF document as vectors: frames, symbols, hatches, text with
 * halos. Rasters (imagery, classed slope or canopy height, hillshade) are the only images. Takes the
 * jsPDF module as an argument so callers import it lazily and tests run it in Node. No DOM access.
 */
import type { GState as GStateClass, jsPDF as JsPdf } from 'jspdf'
import type { DrawOp, Point, StrokeStyle } from './drawOps'

type JsPdfModule = { jsPDF: typeof JsPdf; GState: typeof GStateClass }

/** jsPDF's standard fonts are WinAnsi: fold the characters a sheet commonly carries into it. */
export function pdfText(value: string): string {
  return value
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
    .replace(/[³]/g, '3')
    .replace(/[²]/g, '2')
    .replace(/÷/g, '/')
    .replace(/≈/g, '~')
    .replace(/√/g, 'sqrt')
    .replace(/[^\x20-\x7e°±×é]/g, '?')
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

/** Draws `ops` onto the current page of `pdf`. */
export function drawSheetPdf(pdf: JsPdf, module: JsPdfModule, ops: readonly DrawOp[]) {
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
  for (const op of ops) {
    switch (op.op) {
      case 'rect':
      case 'path':
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
            trace(op.parts, op.closed)
            if (mode === 'FD') pdf.fillStrokeEvenOdd()
            else if (mode === 'F') pdf.fillEvenOdd()
            else pdf.stroke()
          }
        }
        if (translucent) pdf.restoreGraphicsState()
        break
      }
      case 'text': {
        pdf.setFont(op.family ?? 'helvetica', op.style ?? 'normal')
        pdf.setFontSize(op.size)
        const options = {
          align: op.align ?? 'left',
          baseline: op.baseline === 'middle' ? ('middle' as const) : ('alphabetic' as const),
          ...(op.angle ? { angle: op.angle } : {}),
        }
        const value = pdfText(op.text)
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
    }
  }
  // Leave the next caller with jsPDF's defaults.
  pdf.setLineDashPattern([], 0)
}

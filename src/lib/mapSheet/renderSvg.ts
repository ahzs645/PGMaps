/**
 * Draws a sheet's operations as an SVG document, for the export preview. It shows the same list of
 * operations the PDF prints. Raw RGBA rasters need `encodeRgba` (a canvas in the browser); without
 * it they show as a grey box. No DOM or network access.
 */
import type { DrawOp, Point, StrokeStyle } from './drawOps'

const escapeXml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const n = (value: number) => (Math.round(value * 100) / 100).toString()

function strokeAttributes(stroke?: StrokeStyle) {
  if (!stroke) return ' stroke="none"'
  return [
    ` stroke="${stroke.color}" stroke-width="${n(stroke.width)}"`,
    stroke.dash?.length ? ` stroke-dasharray="${stroke.dash.map(n).join(' ')}"` : '',
    stroke.cap && stroke.cap !== 'butt' ? ` stroke-linecap="${stroke.cap}"` : '',
    stroke.join && stroke.join !== 'miter' ? ` stroke-linejoin="${stroke.join}"` : '',
    stroke.opacity !== undefined ? ` stroke-opacity="${n(stroke.opacity)}"` : '',
  ].join('')
}

const pathData = (parts: Point[][], closed: boolean) =>
  parts
    .filter((part) => part.length > 1)
    .map((part) => `M${part.map(([x, y]) => `${n(x)} ${n(y)}`).join('L')}${closed ? 'Z' : ''}`)
    .join('')

export function sheetSvg(
  ops: readonly DrawOp[],
  width: number,
  height: number,
  encodeRgba?: (image: { data: Uint8ClampedArray; width: number; height: number }) => string,
  /** Page colour behind everything; null leaves it transparent. */
  background: string | null = '#ffffff',
): string {
  const body: string[] = []
  const defs: string[] = []
  let clips = 0,
    open = 0
  for (const op of ops) {
    switch (op.op) {
      case 'rect':
        body.push(
          `<rect x="${n(op.x)}" y="${n(op.y)}" width="${n(op.w)}" height="${n(op.h)}" fill="${op.fill ?? 'none'}"${
            op.fillOpacity !== undefined ? ` fill-opacity="${n(op.fillOpacity)}"` : ''
          }${strokeAttributes(op.stroke)}/>`,
        )
        break
      case 'path':
        body.push(
          `<path d="${pathData(op.parts, op.closed)}" fill="${op.fill ?? 'none'}" fill-rule="evenodd"${
            op.fillOpacity !== undefined ? ` fill-opacity="${n(op.fillOpacity)}"` : ''
          }${strokeAttributes(op.stroke)}/>`,
        )
        break
      case 'circle':
        body.push(
          `<circle cx="${n(op.x)}" cy="${n(op.y)}" r="${n(op.r)}" fill="${op.fill ?? 'none'}"${strokeAttributes(op.stroke)}/>`,
        )
        break
      case 'text': {
        const anchor = op.align === 'center' ? 'middle' : op.align === 'right' ? 'end' : 'start'
        const family = op.family === 'times' ? 'Times New Roman,Times,serif' : 'Helvetica,Arial,sans-serif'
        const weight = op.style === 'bold' ? ' font-weight="bold"' : ''
        const italic = op.style === 'italic' ? ' font-style="italic"' : ''
        const rotate = op.angle ? ` transform="rotate(${n(-op.angle)} ${n(op.x)} ${n(op.y)})"` : ''
        const baseline = op.baseline === 'middle' ? ' dominant-baseline="central"' : ''
        const common = `x="${n(op.x)}" y="${n(op.y)}" font-family="${family}" font-size="${n(op.size)}" text-anchor="${anchor}"${weight}${italic}${baseline}${rotate}`
        const text = escapeXml(op.text)
        if (op.halo)
          body.push(
            `<text ${common} fill="${op.halo.color}" stroke="${op.halo.color}" stroke-width="${n(op.halo.width)}" stroke-linejoin="round">${text}</text>`,
          )
        body.push(`<text ${common} fill="${op.color}">${text}</text>`)
        break
      }
      case 'image': {
        const href = op.image.kind === 'url' ? op.image.url : encodeRgba ? encodeRgba(op.image) : null
        if (href)
          body.push(
            `<image x="${n(op.x)}" y="${n(op.y)}" width="${n(op.w)}" height="${n(op.h)}" preserveAspectRatio="none" href="${escapeXml(href)}"/>`,
          )
        else body.push(`<rect x="${n(op.x)}" y="${n(op.y)}" width="${n(op.w)}" height="${n(op.h)}" fill="#e5e7eb"/>`)
        break
      }
      case 'clip':
        clips++
        defs.push(
          `<clipPath id="sheet-clip-${clips}"><path d="${pathData(op.parts, true)}" clip-rule="evenodd"/></clipPath>`,
        )
        body.push(`<g clip-path="url(#sheet-clip-${clips})">`)
        open++
        break
      case 'restore':
        if (open > 0) {
          body.push('</g>')
          open--
        }
        break
    }
  }
  while (open-- > 0) body.push('</g>')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(width)} ${n(height)}" width="${n(width)}" height="${n(height)}">${background ? `<rect width="100%" height="100%" fill="${background}"/>` : ''}<defs>${defs.join('')}</defs>${body.join('')}</svg>`
}

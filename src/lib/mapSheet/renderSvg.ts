/**
 * Draws a sheet's operations as an SVG document. It shows the same list of operations the PDF
 * prints. `sheetSvg` is the in-app preview: raw RGBA rasters need `encodeRgba` (a canvas in the
 * browser); without it they show as a grey box. `standaloneSheetSvg` is the downloaded file, made to
 * open in Inkscape or Illustrator: an XML declaration, the physical size in points, text kept as
 * text, every raster embedded as a data URL and nothing referenced outside the file.
 * No DOM or network access.
 */
import type { CurvePart, DrawOp, Point, StrokeStyle } from './drawOps'

const escapeXml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
/** Characters XML 1.0 does not allow in a document at all, even escaped. */
// eslint-disable-next-line no-control-regex
const XML_FORBIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g
const n = (value: number) => (Math.round(value * 100) / 100).toString()

/**
 * Where a `middle` baseline puts the alphabetic baseline, in ems below `y`: half Helvetica's cap
 * height (0.717 em). The standalone file shifts the text by it rather than relying on
 * `dominant-baseline`, which Illustrator ignores on import.
 */
export const SVG_MIDDLE_BASELINE_EM = 0.358

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

const curveData = (parts: readonly CurvePart[], closed: boolean) =>
  parts
    .filter((part) => part.segments.length)
    .map(
      (part) =>
        `M${n(part.start[0])} ${n(part.start[1])}${part.segments
          .map(([c1, c2, end]) => `C${n(c1[0])} ${n(c1[1])} ${n(c2[0])} ${n(c2[1])} ${n(end[0])} ${n(end[1])}`)
          .join('')}${closed ? 'Z' : ''}`,
    )
    .join('')

type EncodeRgba = (image: { data: Uint8ClampedArray; width: number; height: number }) => string

/** The `<defs>` and drawing of `ops`; `standalone` writes them for a file opened outside the app. */
function svgParts(ops: readonly DrawOp[], encodeRgba: EncodeRgba | undefined, standalone: boolean) {
  const body: string[] = []
  const defs: string[] = []
  const text = (value: string) => escapeXml(standalone ? value.replace(XML_FORBIDDEN, '') : value)
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
      case 'curves':
        body.push(
          `<path d="${curveData(op.parts, op.closed)}" fill="${op.fill ?? 'none'}" fill-rule="evenodd"${
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
        const family =
          op.family === 'times'
            ? standalone
              ? "'Times New Roman', Times, serif"
              : 'Times New Roman,Times,serif'
            : standalone
              ? 'Helvetica, Arial, sans-serif'
              : 'Helvetica,Arial,sans-serif'
        const weight = op.style === 'bold' || op.style === 'bolditalic' ? ' font-weight="bold"' : ''
        const italic = op.style === 'italic' || op.style === 'bolditalic' ? ' font-style="italic"' : ''
        const rotate = op.angle ? ` transform="rotate(${n(-op.angle)} ${n(op.x)} ${n(op.y)})"` : ''
        const middle = op.baseline === 'middle'
        // Rotation stays about the anchor, so the shift runs across the rotated baseline.
        const y = middle && standalone ? op.y + op.size * SVG_MIDDLE_BASELINE_EM : op.y
        const baseline = middle && !standalone ? ' dominant-baseline="central"' : ''
        const common = `x="${n(op.x)}" y="${n(y)}" font-family="${escapeXml(family)}" font-size="${n(op.size)}" text-anchor="${anchor}"${weight}${italic}${baseline}${rotate}`
        const content = text(op.text)
        if (op.halo)
          body.push(
            `<text ${common} fill="${op.halo.color}" stroke="${op.halo.color}" stroke-width="${n(op.halo.width)}" stroke-linejoin="round">${content}</text>`,
          )
        body.push(`<text ${common} fill="${op.color}">${content}</text>`)
        break
      }
      case 'image': {
        const href = op.image.kind === 'url' ? op.image.url : encodeRgba ? encodeRgba(op.image) : null
        if (standalone) {
          if (!href || !href.startsWith('data:'))
            throw Error('An image on the sheet is not embedded; encode the sheet images before writing the SVG.')
          body.push(
            `<image x="${n(op.x)}" y="${n(op.y)}" width="${n(op.w)}" height="${n(op.h)}" preserveAspectRatio="none" xlink:href="${escapeXml(href)}"/>`,
          )
        } else if (href)
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
  return { defs: defs.join(''), body: body.join('') }
}

export function sheetSvg(
  ops: readonly DrawOp[],
  width: number,
  height: number,
  encodeRgba?: EncodeRgba,
  /** Page colour behind everything; null leaves it transparent. */
  background: string | null = '#ffffff',
): string {
  const { defs, body } = svgParts(ops, encodeRgba, false)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(width)} ${n(height)}" width="${n(width)}" height="${n(height)}">${background ? `<rect width="100%" height="100%" fill="${background}"/>` : ''}<defs>${defs}</defs>${body}</svg>`
}

/**
 * The sheet as a standalone SVG file: XML declaration, `width`/`height` in points with a matching
 * `viewBox` (one unit a point), `xml:space="preserve"`, text as `<text>`, lines and fills as paths
 * and every raster as an embedded data URL. Every image must already be encoded
 * (`encodeSheetImages`); one that is not is refused rather than written as a reference.
 */
export function standaloneSheetSvg(
  ops: readonly DrawOp[],
  width: number,
  height: number,
  { background = '#ffffff', title }: { background?: string | null; title?: string } = {},
): string {
  const { defs, body } = svgParts(ops, undefined, true)
  const heading = title ? `<title>${escapeXml(title.replace(XML_FORBIDDEN, ''))}</title>` : ''
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n',
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1"`,
    ` width="${n(width)}pt" height="${n(height)}pt" viewBox="0 0 ${n(width)} ${n(height)}" xml:space="preserve">`,
    heading,
    background ? `<rect x="0" y="0" width="${n(width)}" height="${n(height)}" fill="${background}"/>` : '',
    defs ? `<defs>${defs}</defs>` : '',
    body,
    '</svg>\n',
  ].join('')
}

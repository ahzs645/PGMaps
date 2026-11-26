/**
 * Draws a sheet's operations as an SVG document. It shows the same list of operations the PDF
 * prints. `sheetSvg` is the in-app preview: raw RGBA rasters need `encodeRgba` (a canvas in the
 * browser); without it they show as a grey box. `standaloneSheetSvg` is the downloaded file, made to
 * open in Inkscape or Illustrator: an XML declaration, the physical size in points, text kept as
 * text, every raster embedded as a data URL and nothing referenced outside the file.
 * No DOM or network access.
 */
import { readingPath, textPathStart, type CurvePart, type DrawOp, type Point, type StrokeStyle } from './drawOps'
import type { SheetFontFamily, SheetFontStyle } from './textMetrics'

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
/** An id usable in a document: letters, digits, `-`, `_` and `.`, never starting with a digit. */
const safeId = (id: string) => {
  const cleaned = id.replace(/[^A-Za-z0-9_.-]+/g, '-')
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `id-${cleaned}`
}
/** The CSS family names of the embedded Great Forest faces. */
export const GREAT_FOREST_CSS: Record<'great-forest' | 'great-forest-display', string> = {
  'great-forest': 'Great Forest Small Caps',
  'great-forest-display': 'Great Forest Simplified',
}
const fontFamily = (family: SheetFontFamily | undefined, standalone: boolean) =>
  family === 'great-forest' || family === 'great-forest-display'
    ? `'${GREAT_FOREST_CSS[family]}', ${standalone ? 'Helvetica, Arial, sans-serif' : 'Helvetica,Arial,sans-serif'}`
    : family === 'times'
      ? standalone
        ? "'Times New Roman', Times, serif"
        : 'Times New Roman,Times,serif'
      : standalone
        ? 'Helvetica, Arial, sans-serif'
        : 'Helvetica,Arial,sans-serif'
const fontAttributes = (style?: SheetFontStyle) =>
  (style === 'bold' || style === 'bolditalic' ? ' font-weight="bold"' : '') +
  (style === 'italic' || style === 'bolditalic' ? ' font-style="italic"' : '')

function svgParts(ops: readonly DrawOp[], encodeRgba: EncodeRgba | undefined, standalone: boolean) {
  const defs: string[] = []
  const counters = { clips: 0, textPaths: 0 }
  const body = drawSvg(ops, encodeRgba, standalone, defs, counters)
  return { defs: defs.join(''), body }
}

/** The body of `ops`, adding what it defines to `defs`; symbols recurse with the same counters. */
function drawSvg(
  ops: readonly DrawOp[],
  encodeRgba: EncodeRgba | undefined,
  standalone: boolean,
  defs: string[],
  counters: { clips: number; textPaths: number },
): string {
  const body: string[] = []
  const text = (value: string) => escapeXml(standalone ? value.replace(XML_FORBIDDEN, '') : value)
  const href = (id: string) => (standalone ? `xlink:href="#${id}"` : `href="#${id}"`)
  let open = 0,
    groups = 0
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
        const family = fontFamily(op.family, standalone)
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
      case 'clip': {
        const clip = ++counters.clips
        defs.push(
          `<clipPath id="sheet-clip-${clip}"><path d="${pathData(op.parts, true)}" clip-rule="evenodd"/></clipPath>`,
        )
        body.push(`<g clip-path="url(#sheet-clip-${clip})">`)
        open++
        break
      }
      case 'restore':
        if (open > 0) {
          body.push('</g>')
          open--
        }
        break
      case 'group': {
        const name = op.label ? ` data-name="${escapeXml(op.label)}"` : ''
        const layer = op.layer ? ` inkscape:groupmode="layer" inkscape:label="${escapeXml(op.label ?? op.id)}"` : ''
        body.push(`<g id="${safeId(op.id)}"${name}${layer}>`)
        groups++
        break
      }
      case 'endGroup':
        if (groups > 0) {
          body.push('</g>')
          groups--
        }
        break
      case 'symbol': {
        const name = op.label ? ` data-name="${escapeXml(op.label)}"` : ''
        defs.push(
          `<g id="${safeId(`symbol-${op.id}`)}"${name}>${drawSvg(op.ops, encodeRgba, standalone, defs, counters)}</g>`,
        )
        break
      }
      case 'use': {
        const transform = [
          `translate(${n(op.x)} ${n(op.y)})`,
          op.rotation ? `rotate(${n(-op.rotation)})` : '',
          op.scale !== undefined && op.scale !== 1 ? `scale(${n(op.scale)})` : '',
        ]
          .filter(Boolean)
          .join(' ')
        body.push(`<use ${href(safeId(`symbol-${op.id}`))} transform="${transform}"/>`)
        break
      }
      case 'textPath': {
        const id = `sheet-text-path-${++counters.textPaths}`
        const line = readingPath(op.path)
        defs.push(`<path id="${id}" d="${pathData([line], false)}" fill="none"/>`)
        const start = textPathStart(line, op.text, op.size, op.style, op.align, op.offset, op.family)
        const common = `font-family="${escapeXml(fontFamily(op.family, standalone))}" font-size="${n(op.size)}"${fontAttributes(op.style)}`
        const drop = op.baseline === 'middle' ? ` dy="${n(op.size * SVG_MIDDLE_BASELINE_EM)}"` : ''
        const content = `<textPath ${href(id)} startOffset="${n(start)}">${text(op.text)}</textPath>`
        if (op.halo)
          body.push(
            `<text ${common}${drop} fill="${op.halo.color}" stroke="${op.halo.color}" stroke-width="${n(op.halo.width)}" stroke-linejoin="round">${content}</text>`,
          )
        body.push(`<text ${common}${drop} fill="${op.color}">${content}</text>`)
        break
      }
    }
  }
  while (open-- > 0) body.push('</g>')
  while (groups-- > 0) body.push('</g>')
  return body.join('')
}

/** Where a sheet's Great Forest faces load from: a served URL, or a `data:` URL to embed them. */
export type SheetFontSources = Partial<Record<'great-forest' | 'great-forest-display', string>>

/** `@font-face` rules for the faces given, WOFF. */
function fontFaces(fonts: SheetFontSources | undefined): string {
  const rules = Object.entries(fonts ?? {})
    .filter((entry): entry is [keyof typeof GREAT_FOREST_CSS, string] => !!entry[1])
    .map(
      ([family, url]) =>
        `@font-face{font-family:'${GREAT_FOREST_CSS[family]}';src:url(${escapeXml(url)}) format('woff');}`,
    )
  return rules.length ? `<style>${rules.join('')}</style>` : ''
}

export function sheetSvg(
  ops: readonly DrawOp[],
  width: number,
  height: number,
  encodeRgba?: EncodeRgba,
  /** Page colour behind everything; null leaves it transparent. */
  background: string | null = '#ffffff',
  /** The Great Forest faces the text uses, if any. */
  fonts?: SheetFontSources,
): string {
  const parts = svgParts(ops, encodeRgba, false)
  const { body } = parts
  const defs = fontFaces(fonts) + parts.defs
  const inkscape = ops.some((op) => op.op === 'group' && op.layer)
    ? ' xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"'
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg"${inkscape} viewBox="0 0 ${n(width)} ${n(height)}" width="${n(width)}" height="${n(height)}">${background ? `<rect width="100%" height="100%" fill="${background}"/>` : ''}<defs>${defs}</defs>${body}</svg>`
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
  {
    background = '#ffffff',
    title,
    fonts,
  }: {
    background?: string | null
    title?: string
    /** Great Forest faces as `data:` URLs, embedded so the file shows its lettering anywhere. */
    fonts?: SheetFontSources
  } = {},
): string {
  const parts = svgParts(ops, undefined, true)
  const { body } = parts
  const defs = fontFaces(fonts) + parts.defs
  const heading = title ? `<title>${escapeXml(title.replace(XML_FORBIDDEN, ''))}</title>` : ''
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n',
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"${
      ops.some((op) => op.op === 'group' && op.layer)
        ? ' xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"'
        : ''
    } version="1.1"`,
    ` width="${n(width)}pt" height="${n(height)}pt" viewBox="0 0 ${n(width)} ${n(height)}" xml:space="preserve">`,
    heading,
    background ? `<rect x="0" y="0" width="${n(width)}" height="${n(height)}" fill="${background}"/>` : '',
    defs ? `<defs>${defs}</defs>` : '',
    body,
    '</svg>\n',
  ].join('')
}

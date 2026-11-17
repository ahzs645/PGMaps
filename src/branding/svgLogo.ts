/**
 * An SVG logo is kept as a PNG drawn from it when it is added (`readLogoFile`), so every sheet, report and PDF prints
 * it as it prints any other logo. This file holds the sizing: free of DOM and network access.
 */

/** The longer side of the PNG an SVG logo becomes: about 660 dpi across the widest logo box a sheet prints (46 mm). */
export const SVG_LOGO_RASTER_PX = 1200

const length = (value: string | undefined) => {
  if (!value) return null
  // Only absolute lengths: a percentage or an em says nothing about the drawing's own shape.
  const match = /^\s*([0-9]*\.?[0-9]+(?:e[-+]?\d+)?)\s*(px|pt|mm|cm|in)?\s*$/i.exec(value)
  if (!match) return null
  const scale = { px: 1, pt: 4 / 3, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 }[(match[2] ?? 'px').toLowerCase() as 'px']
  const result = Number(match[1]) * scale
  return Number.isFinite(result) && result > 0 ? result : null
}

const attribute = (tag: string, name: string) => new RegExp(`\\s${name}\\s*=\\s*(["'])([^"']*)\\1`, 'i').exec(tag)?.[2]

/**
 * The drawing's own width and height from its root `<svg>`: `width` and `height` when both are absolute lengths, else
 * the `viewBox`'s. Null when neither says, since the image could then be drawn at any shape.
 */
export function svgIntrinsicSize(svg: string): { width: number; height: number } | null {
  const tag = /<svg\b[^>]*>/i.exec(svg)?.[0]
  if (!tag) return null
  const width = length(attribute(tag, 'width')),
    height = length(attribute(tag, 'height'))
  const box = attribute(tag, 'viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)
  const boxSize = box?.length === 4 && box[2] > 0 && box[3] > 0 ? { width: box[2], height: box[3] } : null
  if (width && height) return { width, height }
  // One stated side and the viewBox's shape fix the other.
  if (boxSize && width) return { width, height: (width * boxSize.height) / boxSize.width }
  if (boxSize && height) return { width: (height * boxSize.width) / boxSize.height, height }
  return boxSize
}

/** The PNG's size: the drawing's shape with its longer side at `SVG_LOGO_RASTER_PX`, never under 1 px. */
export function svgRasterSize(size: { width: number; height: number }, longSide = SVG_LOGO_RASTER_PX) {
  const scale = longSide / Math.max(size.width, size.height)
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  }
}

/**
 * The title and source caption a composed recording burns into every frame. DOM-free: the
 * drawing takes a 2D context (or anything with the same few methods), so the layout is tested
 * with a stand-in.
 *
 * Text drawn with the 2D API keeps the recording canvas origin-clean; rasterised HTML would
 * not. Adapted from GeoLibre (MIT), `apps/geolibre-desktop/src/lib/map-recorder.ts`
 * (`captionMetrics`, `captionBoxOrigin`, `roundRectPath`, `drawCaptionOverlay`).
 */

export type RecordingCaptionPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'

export const RECORDING_CAPTION_POSITIONS: readonly RecordingCaptionPosition[] = [
  'top-left',
  'top-center',
  'top-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
]

/** Longest caption line kept, characters; the rest is cut with an ellipsis. */
export const MAX_CAPTION_LINE_LENGTH = 160

export type RecordingCaption = {
  /** Bold first line, e.g. the block and road. Blank hides it. */
  title?: string
  /** Smaller second line, e.g. "PGMaps road view · terrain: LidarBC 1 m". Blank hides it. */
  source?: string
  /** Default `bottom-left`. */
  position?: RecordingCaptionPosition
}

/** The caption's lines as they print: trimmed, one line each, cut to `MAX_CAPTION_LINE_LENGTH`. */
export function captionLines(caption: RecordingCaption | null | undefined): { title: string; source: string } {
  const clean = (text: string | undefined) => {
    const line = (text ?? '').replace(/\s+/g, ' ').trim()
    return line.length > MAX_CAPTION_LINE_LENGTH ? `${line.slice(0, MAX_CAPTION_LINE_LENGTH - 1)}…` : line
  }
  return { title: clean(caption?.title), source: clean(caption?.source) }
}

export function hasCaptionText(caption: RecordingCaption | null | undefined): boolean {
  const { title, source } = captionLines(caption)
  return Boolean(title || source)
}

export type CaptionMetrics = {
  titlePx: number
  sourcePx: number
  padX: number
  padY: number
  lineGap: number
  margin: number
  radius: number
}

/** Font sizes and spacing in device pixels, scaled to the frame height so a caption reads the same at any size. */
export function captionMetrics(frameHeight: number): CaptionMetrics {
  const titlePx = Math.round(Math.min(48, Math.max(14, frameHeight * 0.034)))
  return {
    titlePx,
    sourcePx: Math.round(titlePx * 0.66),
    padX: Math.round(titlePx * 0.6),
    padY: Math.round(titlePx * 0.45),
    lineGap: Math.round(titlePx * 0.28),
    margin: Math.round(titlePx * 0.7),
    radius: Math.round(titlePx * 0.3),
  }
}

/** Top-left corner of a caption box at `position`, kept inside the frame's margin on the near edge. */
export function captionBoxOrigin(
  position: RecordingCaptionPosition,
  boxWidth: number,
  boxHeight: number,
  frameWidth: number,
  frameHeight: number,
  margin: number,
): { x: number; y: number } {
  const [vertical, horizontal] = position.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right']
  let x =
    horizontal === 'left'
      ? margin
      : horizontal === 'right'
        ? frameWidth - margin - boxWidth
        : (frameWidth - boxWidth) / 2
  let y = vertical === 'top' ? margin : frameHeight - margin - boxHeight
  x = Math.max(margin, Math.min(x, Math.max(margin, frameWidth - margin - boxWidth)))
  y = Math.max(margin, Math.min(y, Math.max(margin, frameHeight - margin - boxHeight)))
  return { x: Math.round(x), y: Math.round(y) }
}

/** The members of `CanvasRenderingContext2D` the caption uses. */
export type CaptionContext = Pick<
  CanvasRenderingContext2D,
  | 'save'
  | 'restore'
  | 'beginPath'
  | 'moveTo'
  | 'arcTo'
  | 'closePath'
  | 'fill'
  | 'fillText'
  | 'measureText'
  | 'font'
  | 'fillStyle'
  | 'textAlign'
  | 'textBaseline'
>

const CAPTION_FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

function roundedRect(ctx: CaptionContext, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/**
 * Draw the caption onto a frame. Returns the box drawn, or null when there was nothing to draw.
 * Cheap enough for every frame: it measures two lines and fills one path.
 */
export function drawRecordingCaption(
  ctx: CaptionContext,
  caption: RecordingCaption | null | undefined,
  frameWidth: number,
  frameHeight: number,
): { x: number; y: number; width: number; height: number } | null {
  const { title, source } = captionLines(caption)
  if ((!title && !source) || frameWidth < 2 || frameHeight < 2) return null
  const m = captionMetrics(frameHeight)
  const titleFont = `600 ${m.titlePx}px ${CAPTION_FONT_FAMILY}`
  const sourceFont = `400 ${m.sourcePx}px ${CAPTION_FONT_FAMILY}`
  let textWidth = 0
  if (title) {
    ctx.font = titleFont
    textWidth = Math.max(textWidth, ctx.measureText(title).width)
  }
  if (source) {
    ctx.font = sourceFont
    textWidth = Math.max(textWidth, ctx.measureText(source).width)
  }
  const lineHeight = (px: number) => Math.round(px * 1.2)
  const titleHeight = title ? lineHeight(m.titlePx) : 0
  const sourceHeight = source ? lineHeight(m.sourcePx) : 0
  const gap = title && source ? m.lineGap : 0
  const maxBoxWidth = Math.max(m.padX * 2 + 8, frameWidth - m.margin * 2)
  const width = Math.min(Math.round(textWidth) + m.padX * 2, maxBoxWidth)
  const height = titleHeight + gap + sourceHeight + m.padY * 2
  const { x, y } = captionBoxOrigin(
    caption?.position ?? 'bottom-left',
    width,
    height,
    frameWidth,
    frameHeight,
    m.margin,
  )
  ctx.save()
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
  roundedRect(ctx, x, y, width, height, m.radius)
  ctx.fill()
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  const maxTextWidth = width - m.padX * 2
  let textY = y + m.padY
  if (title) {
    ctx.font = titleFont
    ctx.fillStyle = '#ffffff'
    ctx.fillText(title, x + m.padX, textY, maxTextWidth)
    textY += titleHeight + gap
  }
  if (source) {
    ctx.font = sourceFont
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
    ctx.fillText(source, x + m.padX, textY, maxTextWidth)
  }
  ctx.restore()
  return { x, y, width, height }
}

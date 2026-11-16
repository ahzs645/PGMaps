/**
 * The VIA report's draft on the PDF's own pages: the draft's report with each stand-in (an SVG, which the PDF writer
 * cannot embed) drawn to a PNG, so `reportPdf` lays the draft out exactly as it lays out the file. Browser only.
 */
import { STAND_IN_PREFIX } from './viaReport/draftPictures'
import type { AssembledReport } from './viaReport/model'

/** A stand-in is drawn no wider than this, pixels: it is a dashed box with two lines of text. */
const STAND_IN_RASTER_WIDTH = 900

async function rasterise(url: string): Promise<string> {
  const image = new Image()
  image.decoding = 'async'
  image.src = url
  await image.decode()
  const scale = Math.min(1, STAND_IN_RASTER_WIDTH / Math.max(1, image.naturalWidth))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('The draft’s pages could not be drawn: no canvas.')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png')
}

/**
 * A copy of `report` with every stand-in picture as a PNG. Pictures keep their stated sizes, so the layout is the
 * draft's. `cloneOf` gives each copied object for its original, so a block of the draft can be found in the copy.
 */
export async function withRasterStandIns(
  report: AssembledReport,
): Promise<{ report: AssembledReport; cloneOf: Map<object, object> }> {
  const urls = new Set<string>()
  const find = (value: unknown): void => {
    if (typeof value === 'string') {
      if (value.startsWith(STAND_IN_PREFIX)) urls.add(value)
    } else if (Array.isArray(value)) value.forEach(find)
    else if (value && typeof value === 'object') Object.values(value).forEach(find)
  }
  find(report.blocks)
  const drawn = new Map<string, string>()
  await Promise.all([...urls].map(async (url) => drawn.set(url, await rasterise(url))))
  const cloneOf = new Map<object, object>()
  const copy = (value: unknown): unknown => {
    if (typeof value === 'string') return drawn.get(value) ?? value
    if (!value || typeof value !== 'object') return value
    const known = cloneOf.get(value)
    if (known) return known
    if (Array.isArray(value)) {
      const out: unknown[] = []
      cloneOf.set(value, out)
      for (const entry of value) out.push(copy(entry))
      return out
    }
    const out: Record<string, unknown> = {}
    cloneOf.set(value, out)
    for (const [key, entry] of Object.entries(value)) out[key] = copy(entry)
    return out
  }
  return { report: { ...report, blocks: copy(report.blocks) as AssembledReport['blocks'] }, cloneOf }
}

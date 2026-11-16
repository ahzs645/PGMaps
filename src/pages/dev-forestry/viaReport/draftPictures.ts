/**
 * The VIA report's draft: the report laid out as its file will be, with a stand-in where a picture is not drawn yet.
 * A stand-in is a plain SVG at the picture's own size, so the draft's pages break where the file's will, and it says
 * what goes there and how it is drawn. Each carries its picture group (`data-draw`), which the draft reads back from the
 * page to draw that group alone: the plan map's maps, one view's before picture, the overhead and oblique renders, or
 * another engine's renders. Pictures already drawn (a view's own figure and simulation, a lined-up photo, a group drawn
 * earlier) are the real ones. Nothing here is printed in a downloaded file. No DOM or network access.
 */
import type { OverviewSheetStyle } from '../reportMaps'
import { FIGURE_PAGE_MAP_ASPECT, overviewSheetAspect, REPORT_MAP_ASPECT } from '../reportMaps'
import type { ReportFigure } from './model'
import type { ReportImages } from './parts'

/** A picture group the draft can draw on its own. `before:<saved view id>` is one view's before picture. */
export type DraftPictureId = 'maps' | 'renders' | 'engine' | `before:${string}`

/** How a stand-in's `src` starts: an SVG data URL, which a PDF cannot embed (`reportDraftPages.ts` rasterises it). */
export const STAND_IN_PREFIX = 'data:image/svg+xml;charset=utf-8,'
/** Stand-in widths, pixels: the pictures' sizes, so the draft lays out as the file does. */
const STAND_IN_WIDTH = 1200

const escapeXml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Lines of at most `width` characters, at word breaks. */
function wrap(value: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of value.split(/\s+/)) {
    if (line && line.length + word.length + 1 > width) {
      lines.push(line)
      line = word
    } else line = line ? `${line} ${word}` : word
  }
  if (line) lines.push(line)
  return lines
}

/** The stand-in's picture: a dashed frame with what goes there and how it is drawn, tagged with its group. */
export function standInUrl(group: DraftPictureId, title: string, line: string, width: number, height: number) {
  const size = Math.max(14, Math.round(Math.min(width, height) / 18))
  const chars = Math.max(16, Math.floor((width * 0.8) / (size * 0.55)))
  const titleLines = wrap(title, chars)
  const noteLines = wrap(line, Math.floor(chars * 1.3))
  const lineHeight = size * 1.3
  const total = titleLines.length * lineHeight + noteLines.length * lineHeight * 0.8 + size
  let y = height / 2 - total / 2 + size
  const rows: string[] = []
  for (const value of titleLines) {
    rows.push(
      `<text x="${width / 2}" y="${y.toFixed(1)}" font-size="${size}" font-weight="600" fill="#475569">${escapeXml(value)}</text>`,
    )
    y += lineHeight
  }
  y += size * 0.4
  for (const value of noteLines) {
    rows.push(
      `<text x="${width / 2}" y="${y.toFixed(1)}" font-size="${(size * 0.75).toFixed(1)}" fill="#64748b">${escapeXml(value)}</text>`,
    )
    y += lineHeight * 0.8
  }
  const inset = Math.max(4, size / 3)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" data-draw="${escapeXml(group)}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#f1f5f9"/><rect x="${inset}" y="${inset}" width="${width - 2 * inset}" height="${height - 2 * inset}" fill="none" stroke="#94a3b8" stroke-width="${Math.max(2, size / 8)}" stroke-dasharray="${size} ${size / 2}"/><g font-family="system-ui,sans-serif" text-anchor="middle">${rows.join('')}</g></svg>`
  return `${STAND_IN_PREFIX}${encodeURIComponent(svg)}`
}

/** The picture group of a stand-in from its `src`, or null for a real picture. */
export function drawGroupOf(src: string): DraftPictureId | null {
  if (!src.startsWith(STAND_IN_PREFIX)) return null
  const match = /data-draw="([^"]+)"/.exec(decodeURIComponent(src.slice(STAND_IN_PREFIX.length)))
  return match ? (match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&') as DraftPictureId) : null
}

/** Every picture group a draft's page shows a stand-in for, in page order, once each. */
export function standInGroups(html: string): DraftPictureId[] {
  const out: DraftPictureId[] = []
  const at = /data-draw%3D%22([^%]*(?:%[0-9A-F]{2}[^%]*)*?)%22/g
  for (const match of html.matchAll(at)) {
    const group = decodeURIComponent(match[1]) as DraftPictureId
    if (!out.includes(group)) out.push(group)
  }
  return out
}

/** A stand-in figure `aspect` wide for its height, in `group`, saying how it is drawn. */
export function standIn(
  group: DraftPictureId,
  view: string,
  title: string,
  how: string,
  aspect: number,
  extra: Partial<ReportFigure> = {},
): ReportFigure {
  const width = STAND_IN_WIDTH
  const height = Math.round(width / aspect)
  return { view, caption: title, dataUrl: standInUrl(group, title, how, width, height), width, height, ...extra }
}

/** How each group is drawn, for the stand-in's second line. */
export const DRAW_HOW: Record<'maps' | 'renders' | 'engine' | 'before', string> = {
  maps: 'Drawn from the plan map. Click to draw the maps now, or they are drawn on Download.',
  renders: 'Rendered in the road view. Click to render now, or it is rendered on Download.',
  engine: 'Drawn by the chosen engine at final quality. Click to queue its renders, or they are drawn on Download.',
  before: 'Rendered before harvest in the road view. Click to render it now, or it is rendered on Download.',
}

export interface StandInInput {
  /** The pictures drawn so far; a missing one is stood in for. */
  images: ReportImages
  /** The report's views by name, each with the saved view's id and its picture's aspect. */
  views: ReadonlyArray<{ id: string; name: string; aspect: number }>
  /** The proposed blocks' names: the oblique renders, one per block (up to four, as the capture takes). */
  blocks: readonly string[]
  sheetStyle: OverviewSheetStyle
  /** The report prints 26's figure page, which takes its own maps. */
  figurePageMaps: boolean
  /** Before pictures come from another engine (`engine`), else from the road view per view (`before:<id>`). */
  beforeBy: 'pgmaps' | 'engine'
}

/** At most this many obliques, as `captureReportImages` takes. */
const MAX_OBLIQUES = 4

/**
 * `images` with a stand-in for every picture not drawn: the maps (overview, 11 × 17 sheet, regional, a location map
 * per view, the figure page's when the report prints one), each view's before picture, and the overhead and oblique
 * renders. Drawn pictures stay as they are.
 */
export function withStandIns(input: StandInInput): ReportImages {
  const { images, views } = input
  const map = (title: string, aspect: number, extra: Partial<ReportFigure> = {}) =>
    standIn('maps', 'map', title, DRAW_HOW.maps, aspect, extra)
  const sheetAspect = overviewSheetAspect(input.sheetStyle)
  const locationMaps: Record<string, ReportFigure> = { ...(images.locationMaps ?? {}) }
  for (const view of views)
    locationMaps[view.name] ??= map(`${view.name}: location map with its field of view`, REPORT_MAP_ASPECT.location)
  const before: NonNullable<ReportImages['before']> = { ...(images.before ?? {}) }
  for (const view of views)
    if (!before[view.name])
      (before as Record<string, ReportFigure & { source: 'render' }>)[view.name] = {
        ...standIn(
          input.beforeBy === 'engine' ? 'engine' : `before:${view.id}`,
          view.name,
          `${view.name}: before harvest`,
          input.beforeBy === 'engine' ? DRAW_HOW.engine : DRAW_HOW.before,
          view.aspect,
        ),
        source: 'render',
      }
  const overhead = images.overhead?.length
    ? images.overhead
    : [
        standIn('renders', 'overhead', 'Overhead render of the blocks', DRAW_HOW.renders, 4 / 3),
        ...input.blocks
          .slice(0, MAX_OBLIQUES)
          .map((name) => standIn('renders', name, `Oblique render: ${name} after harvest`, DRAW_HOW.renders, 4 / 3)),
      ]
  const figurePageMaps =
    images.figurePageMaps ??
    (input.figurePageMaps
      ? {
          location: Object.fromEntries(
            views.map((view) => [view.name, map(`${view.name}: location map and viewpoint`, FIGURE_PAGE_MAP_ASPECT)]),
          ),
          regional: map('Regional map', FIGURE_PAGE_MAP_ASPECT),
        }
      : null)
  return {
    ...images,
    overviewMap:
      images.overviewMap ?? map('Overview map: blocks, viewpoints and visual inventory', REPORT_MAP_ASPECT.overview),
    overviewSheet:
      images.overviewSheet ??
      // Printed full-size on its own page, as the drawn sheet is.
      map('Overview sheet (11 × 17)', sheetAspect, { map: { inPicture: true } }),
    regionalMap: images.regionalMap ?? map('Regional map', REPORT_MAP_ASPECT.regional),
    locationMaps,
    figurePageMaps,
    before,
    overhead,
  }
}

/**
 * The plot book's optional additions to a plan-and-profile sheet's profile: the numeric bands under
 * it (`profileBands.ts`) and the curve-point labels on its design line (`profileAnnotations.ts`).
 * Strings only, with no DOM access, like `plotBook.ts`; each is drawn only when its subview is on, so a
 * sheet printed without them is unchanged.
 */
import {
  curvePointLabel,
  curvePointPriority,
  curvePoints,
  isGradeTrouble,
  placeLabels,
  tangentGrades,
  type ProfileGradeLimits,
} from './profileAnnotations'
import { profileValueBands } from './profileBands'
import type { Alignment, RoadAnalysis } from './types'

const html = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Sheet pixels per band row and for the curvature diagram. */
export const SHEET_BAND_ROW_PX = 17
export const SHEET_CURVATURE_PX = 30
/** Sheet pixels between band values: wider than on screen for the larger print font. */
export const SHEET_BAND_VALUE_GAP_PX = 60
/** Sheet pixels between rotated curve-point labels. */
export const SHEET_LABEL_GAP_PX = 15
/** The bands' height on a sheet, rows and curvature diagram together. */
export const SHEET_BANDS_HEIGHT = 6 * SHEET_BAND_ROW_PX + SHEET_CURVATURE_PX

/**
 * The bands as SVG under a profile drawn with `sx` between `left` and `left + width`, starting at
 * sheet y `top` and `SHEET_BANDS_HEIGHT` tall. Titles sit in the margin left of `left`.
 */
export function sheetBandsSvg({
  analysis,
  alignment,
  start,
  end,
  sx,
  left,
  width,
  top,
}: {
  analysis: RoadAnalysis
  alignment: Alignment
  start: number
  end: number
  sx: (chainage: number) => number
  left: number
  width: number
  top: number
}): string {
  const pxPerM = Math.abs(sx(end) - sx(start)) / Math.max(1e-9, end - start)
  const bands = profileValueBands(analysis, alignment, {
    start,
    end,
    minSpacingM: SHEET_BAND_VALUE_GAP_PX / Math.max(1e-9, pxPerM),
  })
  const color = { cut: '#b45309', fill: '#1d4ed8', unknown: '#9ca3af', super: '#111827' } as const
  const rows = bands.rows
    .map((row, index) => {
      const y = top + index * SHEET_BAND_ROW_PX
      const values = row.values
        .map(
          (v) =>
            `<text x="${sx(v.chainage).toFixed(1)}" y="${y + 12}" font-size="10" text-anchor="middle"${v.tone ? ` fill="${color[v.tone]}"` : ''}${v.tone === 'super' ? ' font-weight="700"' : ''}>${html(v.text)}</text>`,
        )
        .join('')
      return `<g data-role="band-${row.key}"><line x1="${left}" x2="${left + width}" y1="${y + SHEET_BAND_ROW_PX}" y2="${y + SHEET_BAND_ROW_PX}" stroke="#d1d5db"/><text x="${left - 8}" y="${y + 12}" font-size="10" text-anchor="end" fill="#374151">${html(row.title)}</text>${values}</g>`
    })
    .join('')
  const curveTop = top + bands.rows.length * SHEET_BAND_ROW_PX
  const zero = curveTop + SHEET_CURVATURE_PX / 2
  const scale = bands.maxCurvaturePerKm > 0 ? (SHEET_CURVATURE_PX / 2 - 3) / bands.maxCurvaturePerKm : 0
  const path = bands.curvature
    .map((v, i) => `${i ? 'L' : 'M'}${sx(v.chainage).toFixed(1)},${(zero - v.perKm * scale).toFixed(1)}`)
    .join(' ')
  const labels = bands.curvatureLabels
    .filter((label) => sx(label.end) - sx(label.start) > label.text.length * 6 + 6)
    .map(
      (label) =>
        `<text x="${sx(label.chainage).toFixed(1)}" y="${(label.direction === 'right' ? zero + 12 : zero - 4).toFixed(1)}" font-size="10" text-anchor="middle" fill="#0369a1">${html(label.text)}</text>`,
    )
    .join('')
  const curvature = `<g data-role="band-curvature"><text x="${left - 8}" y="${zero + 4}" font-size="10" text-anchor="end" fill="#374151">Curvature</text><line x1="${left}" x2="${left + width}" y1="${zero}" y2="${zero}" stroke="#d1d5db"/>${path ? `<path d="${path}" fill="none" stroke="#0369a1" stroke-width="1.4"/>` : ''}${labels}</g>`
  return `<g data-role="profile-bands" font-family="system-ui,sans-serif"><rect x="${left}" y="${top}" width="${width}" height="${SHEET_BANDS_HEIGHT}" fill="none" stroke="#111827"/>${rows}${curvature}<text x="${left + width}" y="${top + SHEET_BANDS_HEIGHT + 12}" font-size="9" text-anchor="end" fill="#4b5563">Bands at calculated stations · C cut, F fill (m) · crossfall + falls away from centreline, bold superelevated · curvature right turns up · — unknown</text></g>`
}

/**
 * BVC/EVC, crest high and sag low points as rotated "name station · elevation" labels on the design
 * line, thinned so none overlaps; tangents over a grade limit drawn red over the design line.
 */
export function sheetProfileLabelsSvg({
  analysis,
  alignment,
  start,
  end,
  sx,
  sy,
  top,
  limits,
}: {
  analysis: RoadAnalysis
  alignment: Alignment
  start: number
  end: number
  sx: (chainage: number) => number
  sy: (elevation: number) => number
  /** Sheet y of the profile frame's top, so a label that would cross it goes below the line. */
  top: number
  limits?: ProfileGradeLimits
}): string {
  const culverts = analysis.engineering?.culverts ?? []
  const points = curvePoints(alignment, analysis.length, culverts).filter(
    (p) => p.chainage >= start - 1e-6 && p.chainage <= end + 1e-6,
  )
  const placed = placeLabels(
    points.map((point) => ({ point, x: sx(point.chainage), priority: curvePointPriority(point) })),
    SHEET_LABEL_GAP_PX,
  )
  const labels = placed
    .map(({ point, x }) => {
      const y = sy(point.elevation)
      const text = curvePointLabel(point)
      const color = point.noCulvert ? '#dc2626' : point.kind === 'bvc' || point.kind === 'evc' ? '#6d28d9' : '#0f766e'
      const above = y - 10 - text.length * 5.6 >= top
      const labelY = above ? y - 10 : y + 10
      const mark =
        point.kind === 'high'
          ? `<path d="M${(x - 5).toFixed(1)},${(y + 1).toFixed(1)} L${(x + 5).toFixed(1)},${(y + 1).toFixed(1)} L${x.toFixed(1)},${(y - 7).toFixed(1)} Z" fill="${color}"/>`
          : point.kind === 'low'
            ? `<path d="M${(x - 5).toFixed(1)},${(y - 1).toFixed(1)} L${(x + 5).toFixed(1)},${(y - 1).toFixed(1)} L${x.toFixed(1)},${(y + 7).toFixed(1)} Z" fill="${color}"/>`
            : `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${(y - 6).toFixed(1)}" y2="${(y + 6).toFixed(1)}" stroke="${color}" stroke-width="1.6"/>`
      return `<g data-role="curve-point" data-kind="${point.kind}"${point.noCulvert ? ' data-no-culvert="true"' : ''}>${mark}<text x="${(x + 3).toFixed(1)}" y="${labelY.toFixed(1)}" transform="rotate(-90 ${(x + 3).toFixed(1)} ${labelY.toFixed(1)})" font-size="10" text-anchor="${above ? 'start' : 'end'}" fill="${color}" stroke="#fff" stroke-width="2.5" paint-order="stroke">${html(text)}</text></g>`
    })
    .join('')
  const trouble = tangentGrades(alignment, analysis.length, limits)
    .filter((t) => isGradeTrouble(t) && t.end >= start - 1e-6 && t.start <= end + 1e-6)
    .map((t) => {
      let pen = false
      const d = analysis.stations
        .filter((s) => s.chainage >= Math.max(start, t.start) - 1e-6 && s.chainage <= Math.min(end, t.end) + 1e-6)
        .map((s) => {
          if (s.designElevation === null || !Number.isFinite(s.designElevation)) {
            pen = false
            return ''
          }
          const out = `${pen ? 'L' : 'M'}${sx(s.chainage).toFixed(1)},${sy(s.designElevation).toFixed(1)}`
          pen = true
          return out
        })
        .join(' ')
      return d.trim()
        ? `<path d="${d}" fill="none" stroke="#dc2626" stroke-width="3.2" data-role="grade-trouble"><title>${html(t.message)}</title></path>`
        : ''
    })
    .join('')
  return `<g data-role="profile-labels" font-family="system-ui,sans-serif">${trouble}${labels}</g>`
}

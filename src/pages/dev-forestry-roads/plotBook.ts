/**
 * A printable plot book in the RoadEng multi-plot shape: chapter 1 is plan-and-profile sheets
 * with a mass-haul strip, one sheet per window of road; chapter 2 is cross-section sheets at a
 * fixed interval. Every sheet is an A3 landscape SVG with a title block. Pure: strings only.
 */
import { sectionStations, type ToGrid } from './designExports'
import { horizontalCurveSummary } from './engine'
import {
  createRoadReportSettings,
  formatDrawingLabel,
  MAX_REPORT_SHEETS,
  parseRoadReportSettings,
  type ReportChapter,
  type ReportColumn,
  type RoadReportSettings,
} from './reportSettings'
import type { Alignment, MaterialQuantity, RoadAnalysis, RoadStation, TerrainMetadata } from './types'

const formatRoadStation = (value: number) => {
  const rounded = Math.round(Math.max(0, value) * 10) / 10
  return `${Math.floor(rounded / 1000)}+${(rounded % 1000).toFixed(1).padStart(5, '0')}`
}
const W = 1587,
  H = 1123
const html = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const fmt = (n: number | null | undefined, d = 1) =>
  n == null || !Number.isFinite(n)
    ? '—'
    : n.toLocaleString('en-CA', { minimumFractionDigits: d, maximumFractionDigits: d })
const niceStep = (span: number, target: number) => {
  const raw = span / Math.max(1, target),
    power = 10 ** Math.floor(Math.log10(raw))
  return ([1, 2, 2.5, 5, 10].find((s) => s * power >= raw) ?? 10) * power
}

type Sheet = { title: string; body: string; scale?: string }
type Contours = GeoJSON.FeatureCollection<GeoJSON.MultiLineString>

/**
 * The note printed above each plan: the contour interval (and index interval and sample
 * spacing, where the contour layer records them), or a visible "Contours unavailable" when the
 * book was made without contours.
 */
function contourNote(contours: Contours | undefined) {
  const features = contours?.features ?? []
  if (!features.length) return { text: 'Contours unavailable', available: false }
  const recorded = (key: string) =>
    features.map((f) => Number(f.properties?.[key])).find((v) => Number.isFinite(v) && v > 0)
  const interval = recorded('interval_m'),
    spacing = recorded('preview_resolution_m')
  if (interval === undefined) return { text: 'Contours · interval not recorded', available: true }
  const metres = (v: number) => `${Number(v.toFixed(2))} m`
  const index = features.some((f) => f.properties?.index !== undefined) ? ` (index ${metres(interval * 5)})` : ''
  return {
    text: `Contours ${metres(interval)}${index}${spacing === undefined ? '' : ` · from a ${fmt(spacing, 1)} m sample grid`}`,
    available: true,
  }
}

function titleBlock(
  project: string,
  road: string,
  terrain: TerrainMetadata,
  sheet: string,
  number: number,
  total: number,
  scale: string,
) {
  const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)
  const x = W - 640,
    y = H - 132,
    split = x + 470
  return `<g font-family="system-ui,sans-serif" fill="#111827"><rect x="${x}" y="${y}" width="620" height="114" fill="#fff" stroke="#111827"/><line x1="${x}" x2="${x + 620}" y1="${y + 30}" y2="${y + 30}" stroke="#111827"/><line x1="${split}" x2="${split}" y1="${y + 30}" y2="${y + 114}" stroke="#111827"/><text x="${x + 10}" y="${y + 21}" font-size="16" font-weight="700">${html(clip(project, 60))}</text><text x="${x + 10}" y="${y + 48}" font-size="12">${html(clip(road, 62))}</text><text x="${x + 10}" y="${y + 66}" font-size="12" font-weight="600">${html(clip(sheet, 62))}</text><text x="${x + 10}" y="${y + 84}" font-size="10" fill="#4b5563">${html(clip(`${terrain.name} · ${terrain.verticalReference}`, 84))}</text><text x="${x + 10}" y="${y + 104}" font-size="10" fill="#b45309">Preliminary planning geometry · not for construction</text><text x="${split + 10}" y="${y + 50}" font-size="12" font-weight="600">Sheet ${number} of ${total}</text><text x="${split + 10}" y="${y + 70}" font-size="10">${html(clip(scale, 24))}</text><text x="${split + 10}" y="${y + 104}" font-size="10" fill="#4b5563">PG Maps road design</text></g>`
}

/** One plan-and-profile sheet for the stations between `start` and `end`. */
function planProfileSheet(
  analysis: RoadAnalysis,
  start: number,
  end: number,
  toGrid: ToGrid,
  contours: Contours | undefined,
  settings: RoadReportSettings,
  chapter: ReportChapter,
  projectName: string,
  alignment: Alignment,
) {
  const inWindow = analysis.stations.filter((s) => s.chainage >= start - 1e-6 && s.chainage <= end + 1e-6)
  if (inWindow.length < 2) return ''
  // Plan: projected metres, rotated so the window runs left to right.
  const grid = inWindow.map((s) => toGrid(s.coordinate))
  const [x0, y0] = grid[0],
    [x1, y1] = grid[grid.length - 1]
  const angle = Math.atan2(y1 - y0, x1 - x0)
  const rotate = ([x, y]: [number, number]): [number, number] => {
    const dx = x - x0,
      dy = y - y0
    return [dx * Math.cos(-angle) - dy * Math.sin(-angle), dx * Math.sin(-angle) + dy * Math.cos(-angle)]
  }
  const offsetPoint = (s: RoadStation, offset: number) => {
    const bearing = ((s.bearing + 90) * Math.PI) / 180,
      R = 6371008.8,
      lat = (s.coordinate[1] * Math.PI) / 180
    return toGrid([
      s.coordinate[0] + ((Math.sin(bearing) * offset) / (R * Math.cos(lat))) * (180 / Math.PI),
      s.coordinate[1] + ((Math.cos(bearing) * offset) / R) * (180 / Math.PI),
    ])
  }
  const local = grid.map(rotate)
  const reach =
    Math.max(
      ...inWindow.map((s) =>
        Math.max(Math.abs(s.leftDaylightM ?? s.leftWidth), Math.abs(s.rightDaylightM ?? s.rightWidth)),
      ),
      15,
    ) + 15
  const minX = Math.min(...local.map((p) => p[0])),
    maxX = Math.max(...local.map((p) => p[0]))
  const minY = Math.min(...local.map((p) => p[1])) - reach,
    maxY = Math.max(...local.map((p) => p[1])) + reach
  const plan = { left: 60, top: 40, width: W - 120, height: 380 }
  const physicalScale =
    chapter.horizontalScale === null
      ? null
      : (1000 / chapter.horizontalScale) * (W / (settings.paper === 'A3' ? 420 : 297))
  const scale = physicalScale ?? Math.min(plan.width / Math.max(1, maxX - minX), plan.height / Math.max(1, maxY - minY))
  const px = ([x, y]: [number, number]) =>
    [
      plan.left + (x - minX) * scale + (plan.width - (maxX - minX) * scale) / 2,
      plan.top + plan.height / 2 - (y - (minY + maxY) / 2) * scale,
    ] as const
  const line = (points: [number, number][]) =>
    points
      .map(
        (p, i) =>
          `${i ? 'L' : 'M'}${px(rotate(p))
            .map((v) => v.toFixed(1))
            .join(',')}`,
      )
      .join(' ')
  const side = (key: 'width' | 'daylight', sign: number) =>
    line(
      inWindow.map((s) => {
        const offset =
          key === 'width'
            ? sign * (sign < 0 ? s.leftWidth : s.rightWidth)
            : sign *
              Math.abs((sign < 0 ? s.leftDaylightM : s.rightDaylightM) ?? (sign < 0 ? s.leftWidth : s.rightWidth))
        return offsetPoint(s, offset)
      }),
    )
  const clipId = `plan-${Math.round(start)}`
  const contourPaths = (settings.subviews.contours ? (contours?.features ?? []) : [])
    .map((feature) => {
      const index = feature.properties?.index
      const d = feature.geometry.coordinates.map((part) => line(part.map((c) => toGrid([c[0], c[1]])))).join(' ')
      return `<path d="${d}" fill="none" stroke="${index ? '#9ca3af' : '#d1d5db'}" stroke-width="${index ? 0.9 : 0.5}"/>`
    })
    .join('')
  const note = settings.subviews.contours ? contourNote(contours) : { text: 'Contours hidden', available: true }
  const noteSvg = `<text x="${plan.left + plan.width}" y="${plan.top - 10}" font-size="12" text-anchor="end"${note.available ? ' fill="#4b5563"' : ' fill="#b45309" font-weight="700"'}>${html(note.text)}</text>`
  const tickEvery = niceStep(end - start, 12)
  const ticks = inWindow
    .filter(
      (s) =>
        Math.abs(s.chainage / tickEvery - Math.round(s.chainage / tickEvery)) < 1e-6 ||
        s === inWindow[0] ||
        s === inWindow[inWindow.length - 1],
    )
    .map((s) => {
      const a = px(rotate(offsetPoint(s, -6))),
        b = px(rotate(offsetPoint(s, 6))),
        label = px(rotate(offsetPoint(s, 10)))
      const text = formatDrawingLabel(settings.stationLabel, {
        station: formatRoadStation(s.chainage).replace(/\.0$/, ''),
        grade: s.gradePercent,
        ground: s.groundElevation,
        design: s.designElevation,
        radius: s.curveRadiusM,
        road: alignment.name,
        project: projectName,
      })
      return `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="#111827"/><text x="${(label[0] + settings.labelOffsetX).toFixed(1)}" y="${(label[1] + settings.labelOffsetY).toFixed(1)}" font-size="11" text-anchor="middle">${html(text)}</text>`
    })
    .join('')
  const north = (-angle * 180) / Math.PI
  const bar = niceStep((plan.width / scale) * 0.25, 1)
  const planSvg = `<clipPath id="${clipId}"><rect x="${plan.left}" y="${plan.top}" width="${plan.width}" height="${plan.height}"/></clipPath><rect x="${plan.left}" y="${plan.top}" width="${plan.width}" height="${plan.height}" fill="none" stroke="#111827"/><g clip-path="url(#${clipId})">${contourPaths}<path d="${side('daylight', -1)}" fill="none" stroke="#a16207" stroke-dasharray="6 4"/><path d="${side('daylight', 1)}" fill="none" stroke="#a16207" stroke-dasharray="6 4"/><path d="${side('width', -1)}" fill="none" stroke="#4b5563"/><path d="${side('width', 1)}" fill="none" stroke="#4b5563"/><path d="${line(grid)}" fill="none" stroke="#c026d3" stroke-width="2"/>${ticks}</g><g transform="translate(${plan.left + 40} ${plan.top + 50}) rotate(${north.toFixed(1)})"><path d="M0,-22 L7,8 L0,3 L-7,8 Z" fill="#111827"/><text y="-26" font-size="12" text-anchor="middle">N</text></g><g transform="translate(${plan.left + 20} ${plan.top + plan.height - 20})"><rect width="${(bar * scale).toFixed(1)}" height="6" fill="#111827"/><text y="-4" font-size="11">${bar} m</text></g><text x="${plan.left}" y="${plan.top - 10}" font-size="14" font-weight="600">Plan · ${formatRoadStation(start)} to ${formatRoadStation(end)}</text>${noteSvg}`

  // Profile with a mass-haul strip, sharing the station scale.
  const profile = { left: 90, top: 470, width: W - 150, height: 330 }
  const mass = { left: 90, top: 830, width: W - 150, height: 130 }
  const prepared = inWindow.map((s) => s.section.find((p) => Math.abs(p.offset) < 1e-7)?.preparedGround ?? null)
  const zs = inWindow
    .flatMap((s, i) => [s.groundElevation, s.designElevation, prepared[i]])
    .filter((v): v is number => v !== null)
  const zLow = Math.min(...zs) - 2,
    zHigh = Math.max(...zs) + 2
  const sx = (c: number) => profile.left + (c - start) * (physicalScale ?? profile.width / Math.max(1, end - start))
  const verticalScale = (physicalScale ?? profile.height / Math.max(1, zHigh - zLow)) * chapter.verticalExaggeration
  const sy = (z: number) => profile.top + profile.height / 2 - (z - (zLow + zHigh) / 2) * verticalScale
  const pathOf = (values: (number | null)[], y: (v: number) => number) => {
    let pen = false
    return inWindow
      .map((s, i) => {
        const v = values[i]
        if (v === null || !Number.isFinite(v)) {
          pen = false
          return ''
        }
        const out = `${pen ? 'L' : 'M'}${sx(s.chainage).toFixed(1)},${y(v).toFixed(1)}`
        pen = true
        return out
      })
      .join(' ')
  }
  const zStep = niceStep(zHigh - zLow, 6)
  const zGrid = Array.from(
    { length: Math.floor((zHigh - zLow) / zStep) + 2 },
    (_, i) => Math.ceil(zLow / zStep) * zStep + i * zStep,
  )
    .filter((z) => z <= zHigh)
    .map(
      (z) =>
        `<line x1="${profile.left}" x2="${profile.left + profile.width}" y1="${sy(z).toFixed(1)}" y2="${sy(z).toFixed(1)}" stroke="#e5e7eb"/><text x="${profile.left - 8}" y="${(sy(z) + 4).toFixed(1)}" font-size="11" text-anchor="end">${fmt(z, zStep < 1 ? 1 : 0)}</text>`,
    )
    .join('')
  const sGrid = Array.from(
    { length: Math.floor((end - start) / tickEvery) + 2 },
    (_, i) => Math.ceil(start / tickEvery) * tickEvery + i * tickEvery,
  )
    .filter((c) => c <= end + 1e-6)
    .map(
      (c) =>
        `<line x1="${sx(c).toFixed(1)}" x2="${sx(c).toFixed(1)}" y1="${profile.top}" y2="${settings.subviews.mass ? mass.top + mass.height : profile.top + profile.height}" stroke="#e5e7eb"/><text x="${sx(c).toFixed(1)}" y="${profile.top + profile.height + 16}" font-size="11" text-anchor="middle">${formatRoadStation(c).replace(/\.0$/, '')}</text>`,
    )
    .join('')
  const masses = inWindow.map((s) => s.massM3)
  const known = masses.filter((v): v is number => v !== null)
  const mLow = Math.min(0, ...known),
    mHigh = Math.max(0, ...known)
  const my = (m: number) => mass.top + mass.height - ((m - mLow) / Math.max(1, mHigh - mLow)) * mass.height
  const grades = inWindow
    .slice(1)
    .filter((s, i) => i % Math.max(1, Math.round(inWindow.length / 10)) === 0 && s.gradePercent !== null)
    .map(
      (s) =>
        `<text x="${(sx(s.chainage) + settings.labelOffsetX).toFixed(1)}" y="${(sy(s.designElevation ?? s.groundElevation ?? zLow) - 8 + settings.labelOffsetY).toFixed(1)}" font-size="10" text-anchor="middle" fill="#0f766e">${html(formatDrawingLabel(settings.gradeLabel, { grade: s.gradePercent, station: formatRoadStation(s.chainage), ground: s.groundElevation, design: s.designElevation, radius: s.curveRadiusM, road: alignment.name, project: projectName }))}</text>`,
    )
    .join('')
  const preparedLine = prepared.some((z) => z !== null)
    ? `<path d="${pathOf(prepared, sy)}" fill="none" stroke="#d97706" stroke-dasharray="4 3" stroke-width="1.5" data-role="prepared-ground"/>`
    : ''
  const profileSvg = `<text x="${profile.left}" y="${profile.top - 10}" font-size="14" font-weight="600">Profile · ground (brown), design (teal)</text><rect x="${profile.left}" y="${profile.top}" width="${profile.width}" height="${profile.height}" fill="none" stroke="#111827"/>${zGrid}${sGrid}<path d="${pathOf(
    inWindow.map((s) => s.groundElevation),
    sy,
  )}" fill="none" stroke="#a07845" stroke-width="1.6"/><path d="${pathOf(
    inWindow.map((s) => s.designElevation),
    sy,
  )}" fill="none" stroke="#0d9488" stroke-width="2.2"/>${preparedLine}${grades}<text x="${profile.left - 70}" y="${profile.top + profile.height / 2}" font-size="11" transform="rotate(-90 ${profile.left - 70} ${profile.top + profile.height / 2})" text-anchor="middle">Elevation (m)</text><text x="${mass.left}" y="${mass.top - 8}" font-size="12" font-weight="600">Mass haul (m³)</text><rect x="${mass.left}" y="${mass.top}" width="${mass.width}" height="${mass.height}" fill="none" stroke="#111827"/><line x1="${mass.left}" x2="${mass.left + mass.width}" y1="${my(0).toFixed(1)}" y2="${my(0).toFixed(1)}" stroke="#9ca3af"/><path d="${pathOf(masses, my)}" fill="none" stroke="#7c3aed" stroke-width="1.6"/><text x="${mass.left - 8}" y="${mass.top + 10}" font-size="10" text-anchor="end">${fmt(mHigh, 0)}</text><text x="${mass.left - 8}" y="${mass.top + mass.height}" font-size="10" text-anchor="end">${fmt(mLow, 0)}</text>`
  const massStart = profileSvg.indexOf(`<text x="${mass.left}" y="${mass.top - 8}"`)
  const profileOnly = profileSvg.slice(0, massStart)
  const massOnly = profileSvg.slice(massStart)
  const curves =
    settings.curveTablePosition === 'plan-sheet' && settings.subviews.plan ? curveInset(alignment, start, end) : ''
  const legend = settings.subviews.legend
    ? '<text x="60" y="982" font-size="11" fill="#4b5563">Legend: centreline magenta · formation grey · catch lines dashed brown · ground brown · design teal · mass purple</text>'
    : ''
  const scaleNote = chapter.horizontalScale === null ? 'Auto-fit' : `Horizontal 1:${chapter.horizontalScale}`
  return `${settings.subviews.plan ? planSvg + curves : ''}<clipPath id="profile-${clipId}"><rect x="0" y="${profile.top - 32}" width="${W}" height="${profile.height + 58}"/></clipPath>${settings.subviews.profile ? `<g clip-path="url(#profile-${clipId})">${profileOnly}</g>` : ''}${settings.subviews.mass ? massOnly : ''}${legend}<text x="60" y="1000" font-size="10">${html(scaleNote)} · profile vertical exaggeration ${chapter.verticalExaggeration}×${chapter.horizontalScale !== null || chapter.verticalExaggeration !== 1 ? ' · plots clipped to their frames' : ''}</text>`
}

function sectionSheet(
  stations: RoadStation[],
  settings: RoadReportSettings,
  chapter: ReportChapter,
  projectName: string,
  roadName: string,
) {
  const columns = 4,
    rows = 3,
    cellW = (W - 120) / columns,
    cellH = (H - 200) / rows
  return stations
    .map((s, index) => {
      const ox = 60 + (index % columns) * cellW,
        oy = 40 + Math.floor(index / columns) * cellH
      const values = s.section
        .flatMap((p) => [p.ground, p.design, p.preparedGround ?? null])
        .filter((v): v is number => v !== null && Number.isFinite(v))
      if (!values.length) return ''
      const half = Math.max(...s.section.map((p) => Math.abs(p.offset)), 1)
      const low = Math.min(...values) - 1,
        high = Math.max(...values) + 1
      // One scale for both axes inside the cell, so the batters keep their true slope.
      const scale =
        chapter.horizontalScale === null
          ? Math.min((cellW - 30) / (2 * half), (cellH - 60) / Math.max(1, high - low))
          : (1000 / chapter.horizontalScale) * (W / (settings.paper === 'A3' ? 420 : 297))
      const x = (o: number) => ox + cellW / 2 + o * scale,
        y = (z: number) => oy + cellH - 30 - (z - low) * scale
      const pathOf = (key: 'ground' | 'design' | 'preparedGround') => {
        let pen = false
        return s.section
          .map((p) => {
            const z = p[key]
            if (z == null || !Number.isFinite(z)) {
              pen = false
              return ''
            }
            const out = `${pen ? 'L' : 'M'}${x(p.offset).toFixed(1)},${y(z).toFixed(1)}`
            pen = true
            return out
          })
          .join(' ')
      }
      return `<g><rect x="${ox + 4}" y="${oy + 4}" width="${cellW - 8}" height="${cellH - 8}" fill="none" stroke="#d1d5db"/><text x="${ox + cellW / 2}" y="${oy + 22}" font-size="13" font-weight="600" text-anchor="middle">${html(formatDrawingLabel(settings.stationLabel, { station: formatRoadStation(s.chainage), grade: s.gradePercent, ground: s.groundElevation, design: s.designElevation, radius: s.curveRadiusM, road: roadName, project: projectName }))}</text><clipPath id="section-${index}"><rect x="${ox + 8}" y="${oy + 28}" width="${cellW - 16}" height="${cellH - 54}"/></clipPath><g clip-path="url(#section-${index})"><line x1="${x(0)}" x2="${x(0)}" y1="${oy + 28}" y2="${oy + cellH - 26}" stroke="#e11d48" stroke-dasharray="4 3"/><path d="${pathOf('ground')}" fill="none" stroke="#6b7280" stroke-width="1.3"/><path d="${pathOf('design')}" fill="none" stroke="#0d9488" stroke-width="2"/>${s.section.some((p) => p.preparedGround !== undefined) ? `<path d="${pathOf('preparedGround')}" fill="none" stroke="#d97706" stroke-dasharray="4 3" stroke-width="1.3" data-role="prepared-ground"/>` : ''}</g><text x="${ox + 12}" y="${oy + cellH - 12}" font-size="10">L · cut ${fmt(s.cutAreaM2)} m² · fill ${fmt(s.fillAreaM2)} m² · CL ${fmt(s.designElevation, 2)}</text><text x="${ox + cellW - 12}" y="${oy + cellH - 12}" font-size="10" text-anchor="end">R</text></g>`
    })
    .join('')
}

function curveRows(alignment: Alignment, start = 0, end = Infinity): string[][] {
  return horizontalCurveSummary(alignment)
    .filter((c) => c.end >= start && c.start <= end)
    .map((c, i) => [
      `H${i + 1}`,
      formatRoadStation(c.start),
      formatRoadStation(c.end),
      fmt(c.radius, 2),
      fmt(c.length, 2),
    ])
}
function curveInset(alignment: Alignment, start: number, end: number) {
  const rows = curveRows(alignment, start, end)
  if (!rows.length) return ''
  const x = W - 530,
    y = 65,
    width = 450,
    height = 50 + Math.min(8, rows.length) * 22
  const headers = ['Curve', 'BC', 'EC', 'R (m)', 'L (m)']
  return `<g><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#fff" fill-opacity="0.95" stroke="#9ca3af"/><text x="${x + 8}" y="${y + 18}" font-size="12" font-weight="600">Horizontal curves${rows.length > 8 ? ' · first 8 in this window' : ''}</text>${[headers, ...rows.slice(0, 8)].map((row, i) => row.map((cell, j) => `<text x="${x + 8 + j * 88}" y="${y + 38 + i * 22}" font-size="10">${html(cell)}</text>`).join('')).join('')}</g>`
}
function tableSheets(title: string, headers: string[], rows: string[][], note: string): Sheet[] {
  const result: Sheet[] = []
  const width = (W - 120) / headers.length
  const fontSize = headers.length > 8 ? 9 : 11
  const chars = Math.max(10, Math.floor((width - 16) / (fontSize * 0.58)))
  const wrap = (text: string): string[] => {
    if (!text.length) return ['']
    const lines: string[] = []
    for (let offset = 0; offset < text.length; offset += chars) lines.push(text.slice(offset, offset + chars))
    return lines
  }
  const headerLines = headers.map(wrap)
  const rowHeight = (cells: string[][]) => Math.max(...cells.map((c) => c.length), 1) * 13 + 10
  const drawRow = (cells: string[][], top: number, height: number, heading: boolean, rowIndex: number) =>
    `<g><rect x="60" y="${top}" width="${W - 120}" height="${height}" fill="${heading ? '#e5e7eb' : rowIndex % 2 ? '#fff' : '#f9fafb'}" stroke="#d1d5db"/>${cells.map((lines, j) => `<text x="${68 + j * width}" y="${top + 17}" font-size="${fontSize}"${heading ? ' font-weight="600"' : ''}>${lines.map((line, k) => `<tspan x="${68 + j * width}" dy="${k ? 13 : 0}">${html(line)}</tspan>`).join('')}</text>`).join('')}</g>`
  const headingHeight = rowHeight(headerLines)
  let y = 120 + headingHeight
  let table = drawRow(headerLines, 120, headingHeight, true, 0)
  const finish = () => {
    if (result.length >= MAX_REPORT_SHEETS)
      throw Error('The report table exceeds the sheet budget; increase its interval or shorten the range.')
    result.push({
      title,
      body: `<text x="60" y="65" font-size="20" font-weight="600">${html(title)}</text><text x="60" y="90" font-size="11" fill="#4b5563">${html(note)}</text>${table}`,
      scale: 'Tabulated engineering values',
    })
    table = drawRow(headerLines, 120, headingHeight, true, 0)
    y = 120 + headingHeight
  }
  if (!rows.length) table += '<text x="68" y="175" font-size="12">No available records in this range.</text>'
  for (const [rowIndex, row] of rows.entries()) {
    const cells = row.map(wrap)
    const count = Math.max(...cells.map((c) => c.length), 1)
    // Very long review text continues on another sheet, retaining all text rather than clipping it.
    for (let offset = 0; offset < count; offset += 50) {
      const fragment = cells.map((lines) => lines.slice(offset, offset + 50))
      const height = rowHeight(fragment)
      if (y + height > H - 170) finish()
      table += drawRow(fragment, y, height, false, rowIndex)
      y += height
    }
  }
  finish()
  if (result.length > 1)
    result.forEach((sheet, i) => {
      sheet.title = `${title} · ${i + 1}/${result.length}`
    })
  return result
}
const SCHEDULE_COLUMNS: Record<ReportColumn, { title: string; value: (s: RoadStation) => string }> = {
  station: { title: 'Station (m)', value: (s) => formatRoadStation(s.chainage) },
  ground: { title: 'Ground (m)', value: (s) => fmt(s.groundElevation, 2) },
  design: { title: 'Design (m)', value: (s) => fmt(s.designElevation, 2) },
  grade: { title: 'Grade (%)', value: (s) => fmt(s.gradePercent, 2) },
  cutArea: { title: 'Cut (m²)', value: (s) => fmt(s.cutAreaM2, 2) },
  fillArea: { title: 'Fill (m²)', value: (s) => fmt(s.fillAreaM2, 2) },
  cutVolume: { title: 'Interval cut (m³)', value: (s) => fmt(s.cutVolumeM3, 2) },
  fillVolume: { title: 'Interval fill (m³)', value: (s) => fmt(s.fillVolumeM3, 2) },
  mass: { title: 'Mass (m³)', value: (s) => fmt(s.massM3, 2) },
  flags: { title: 'Flags', value: (s) => s.flags.join('; ') || '—' },
}

/** Same linear average-end-area rule as the engine, clipped analytically at report boundaries. */
export function rangedMaterialQuantities(analysis: RoadAnalysis, startM: number, endM: number): MaterialQuantity[] {
  const engineering = analysis.engineering
  if (!engineering) return []
  return engineering.materials.map((material) => {
    let bank = 0
    for (let i = 1; i < analysis.stations.length; i++) {
      const a = analysis.stations[i - 1],
        b = analysis.stations[i]
      const start = Math.max(a.chainage, startM),
        end = Math.min(b.chainage, endM)
      if (!a.complete || !b.complete || end <= start || b.chainage <= a.chainage) continue
      const left = engineering.stations[i - 1]?.materialAreas.find(
        (row) => row.materialId === material.materialId,
      )?.cutAreaM2
      const right = engineering.stations[i]?.materialAreas.find(
        (row) => row.materialId === material.materialId,
      )?.cutAreaM2
      if (left == null || right == null) continue
      const preparation = (station: RoadStation) =>
        (station.preparationAreas ?? [])
          .filter((row) => (row.materialId ?? '__unclassified') === material.materialId)
          .reduce((sum, row) => sum + row.areaM2, 0)
      const areaA = left + preparation(a),
        areaB = right + preparation(b)
      const fractionA = (start - a.chainage) / (b.chainage - a.chainage),
        fractionB = (end - a.chainage) / (b.chainage - a.chainage)
      bank += ((areaA + (areaB - areaA) * fractionA + areaA + (areaB - areaA) * fractionB) / 2) * (end - start)
    }
    const ratio = material.bankCutM3 > 0 ? bank / material.bankCutM3 : 0
    return {
      ...material,
      bankCutM3: bank,
      usableCompactedM3: material.usableCompactedM3 * ratio,
      unusableBankM3: material.unusableBankM3 * ratio,
      excavationCost: material.excavationCost * ratio,
    }
  })
}

export function plotBookHtml({
  projectName,
  alignment,
  analysis,
  terrain,
  toGrid,
  contours,
  sheetLengthM = 250,
  sectionIntervalM = 20,
  settings: rawSettings,
}: {
  projectName: string
  alignment: Alignment
  analysis: RoadAnalysis
  terrain: TerrainMetadata
  toGrid: ToGrid
  /** Missing or empty prints "Contours unavailable" on every plan. */
  contours?: Contours
  sheetLengthM?: number
  sectionIntervalM?: number
  settings?: RoadReportSettings
}): string {
  const settings = parseRoadReportSettings(rawSettings)
  // Preserve the original function's interval arguments for existing callers without settings.
  if (rawSettings === undefined)
    for (const chapter of settings.chapters) {
      chapter.sheetLengthM = sheetLengthM
      chapter.sectionIntervalM = sectionIntervalM
    }
  parseRoadReportSettings(settings)
  const sheets: Sheet[] = []
  const add = (...next: Sheet[]) => {
    if (sheets.length + next.length > MAX_REPORT_SHEETS)
      throw Error(`The report exceeds ${MAX_REPORT_SHEETS} sheets; shorten ranges or increase intervals.`)
    sheets.push(...next)
  }
  const chapters = [...settings.chapters]
  if (settings.curveTablePosition === 'chapter' && !chapters.some((c) => c.kind === 'curves'))
    chapters.push({
      ...createRoadReportSettings().chapters[0],
      id: 'curve-table',
      title: 'Horizontal curves',
      kind: 'curves',
    })
  for (const chapter of chapters) {
    const rangeStart = Math.min(analysis.length, chapter.startM ?? 0)
    const rangeEnd = Math.min(analysis.length, chapter.endM ?? analysis.length)
    if (rangeEnd < rangeStart) throw Error(`Chapter ${chapter.title} starts after the road end.`)
    if (chapter.kind === 'plan-profile') {
      // Width available to the shared profile station scale, converted from paper millimetres.
      const physicalWindow =
        chapter.horizontalScale === null
          ? Infinity
          : (((W - 150) / W) * (settings.paper === 'A3' ? 420 : 297) * chapter.horizontalScale) / 1000
      const window = Math.min(chapter.sheetLengthM, physicalWindow)
      if (Math.ceil((rangeEnd - rangeStart) / window) > MAX_REPORT_SHEETS - sheets.length)
        throw Error(`The report exceeds ${MAX_REPORT_SHEETS} sheets; shorten ranges or increase intervals.`)
      for (let start = rangeStart; start < rangeEnd - 1e-6; start += window) {
        const end = Math.min(rangeEnd, start + window)
        const body = planProfileSheet(analysis, start, end, toGrid, contours, settings, chapter, projectName, alignment)
        if (body)
          add({
            title: `${chapter.title} ${formatRoadStation(start)}–${formatRoadStation(end)}`,
            body,
            scale:
              chapter.horizontalScale === null
                ? `${Number(window.toFixed(1))} m per sheet`
                : `H 1:${chapter.horizontalScale}, V×${chapter.verticalExaggeration}`,
          })
      }
    } else if (chapter.kind === 'sections' || chapter.kind === 'schedule') {
      const sections = sectionStations(analysis, chapter.sectionIntervalM).filter(
        (s) => s.chainage >= rangeStart - 1e-6 && s.chainage <= rangeEnd + 1e-6,
      )
      if (chapter.kind === 'sections') {
        for (let i = 0; i < sections.length; i += 12)
          add({
            title: `${chapter.title} ${formatRoadStation(sections[i].chainage)}–${formatRoadStation(sections[Math.min(sections.length, i + 12) - 1].chainage)}`,
            body: sectionSheet(sections.slice(i, i + 12), settings, chapter, projectName, alignment.name),
            scale: `Sections @ ${chapter.sectionIntervalM} m, ${chapter.horizontalScale === null ? '1:1 axes' : `1:${chapter.horizontalScale}`}`,
          })
      } else
        add(
          ...tableSheets(
            chapter.title,
            chapter.columns.map((c) => SCHEDULE_COLUMNS[c].title),
            sections.map((s) => chapter.columns.map((c) => SCHEDULE_COLUMNS[c].value(s))),
            'Reporting interval selects existing analytical stations; interval volumes retain their calculation interval. Unknown values remain —.',
          ),
        )
    } else if (chapter.kind === 'curves') {
      add(
        ...tableSheets(
          chapter.title,
          ['Curve', 'BC', 'EC', 'Radius (m)', 'Arc (m)'],
          curveRows(alignment, rangeStart, rangeEnd),
          'Fitted horizontal arcs intersecting the selected range. BC/EC refer to the circular portion of spiralled curves.',
        ),
      )
    } else if (chapter.kind === 'structures') {
      const rows = (analysis.engineering?.culverts ?? [])
        .filter((c) => c.chainage >= rangeStart && c.chainage <= rangeEnd)
        .map((c) => [
          c.name,
          formatRoadStation(c.chainage),
          fmt(c.barrelLengthM, 2),
          fmt(c.coverM, 2),
          fmt(c.gradePercent, 2),
          fmt(c.installedCost, 2),
          c.warnings.join('; ') || '—',
        ])
      add(
        ...tableSheets(
          chapter.title,
          ['Structure', 'Station', 'Length (m)', 'Cover (m)', 'Grade (%)', 'Cost (CAD)', 'Review'],
          rows,
          'Entered structures; geometric cover and grade are not hydraulic or structural approval.',
        ),
      )
    } else if (chapter.kind === 'materials') {
      add(
        ...tableSheets(
          chapter.title,
          ['Material', 'Purpose', 'Bank cut (m³)', 'Usable (m³)', 'Waste (bank m³)', 'Excavation (CAD)'],
          rangedMaterialQuantities(analysis, rangeStart, rangeEnd).map((m) => [
            m.name,
            m.purpose,
            fmt(m.bankCutM3, 2),
            fmt(m.usableCompactedM3, 2),
            fmt(m.unusableBankM3, 2),
            fmt(m.excavationCost, 2),
          ]),
          `Material quantities ${formatRoadStation(rangeStart)}–${formatRoadStation(rangeEnd)} over supported sections; includes separately removed site preparation.`,
        ),
      )
    }
  }
  const pages = sheets
    .map(
      (sheet, i) =>
        `<section class="sheet"><svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="system-ui,sans-serif" role="img" aria-label="${html(sheet.title)}"><rect width="${W}" height="${H}" fill="#fff"/><rect x="20" y="16" width="${W - 40}" height="${H - 32}" fill="none" stroke="#111827" stroke-width="1.5"/>${sheet.body}${titleBlock(projectName, alignment.name, terrain, sheet.title, i + 1, sheets.length, sheet.scale ?? 'Tabulated values')}</svg></section>`,
    )
    .join('')
  const paper = settings.paper === 'A3' ? { width: 420, height: 297 } : { width: 297, height: 210 }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${html(projectName)} · plot book</title><style>@page{size:${settings.paper} landscape;margin:0}body{margin:0;background:#e5e7eb}.sheet{width:${paper.width}mm;height:${paper.height}mm;margin:12px auto;background:#fff;break-after:page}.sheet svg{width:100%;height:100%;display:block}@media print{body{background:none}.sheet{margin:0}}</style></head><body>${pages}</body></html>`
}

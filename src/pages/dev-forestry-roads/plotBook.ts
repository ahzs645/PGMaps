/**
 * A printable plot book in the RoadEng multi-plot shape: chapter 1 is plan-and-profile sheets
 * with a mass-haul strip, one sheet per window of road; chapter 2 is cross-section sheets at a
 * fixed interval. Every sheet is an A3 landscape SVG with a title block. Pure: strings only.
 */
import { sectionStations, type ToGrid } from './designExports'
import type { Alignment, RoadAnalysis, RoadStation, TerrainMetadata } from './types'

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

type Sheet = { title: string; body: string }
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
  const scale = Math.min(plan.width / Math.max(1, maxX - minX), plan.height / Math.max(1, maxY - minY))
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
  const contourPaths = (contours?.features ?? [])
    .map((feature) => {
      const index = feature.properties?.index
      const d = feature.geometry.coordinates.map((part) => line(part.map((c) => toGrid([c[0], c[1]])))).join(' ')
      return `<path d="${d}" fill="none" stroke="${index ? '#9ca3af' : '#d1d5db'}" stroke-width="${index ? 0.9 : 0.5}"/>`
    })
    .join('')
  const note = contourNote(contours)
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
      return `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="#111827"/><text x="${label[0].toFixed(1)}" y="${label[1].toFixed(1)}" font-size="11" text-anchor="middle">${formatRoadStation(s.chainage).replace(/\.0$/, '')}</text>`
    })
    .join('')
  const north = (-angle * 180) / Math.PI
  const bar = niceStep((plan.width / scale) * 0.25, 1)
  const planSvg = `<clipPath id="${clipId}"><rect x="${plan.left}" y="${plan.top}" width="${plan.width}" height="${plan.height}"/></clipPath><rect x="${plan.left}" y="${plan.top}" width="${plan.width}" height="${plan.height}" fill="none" stroke="#111827"/><g clip-path="url(#${clipId})">${contourPaths}<path d="${side('daylight', -1)}" fill="none" stroke="#a16207" stroke-dasharray="6 4"/><path d="${side('daylight', 1)}" fill="none" stroke="#a16207" stroke-dasharray="6 4"/><path d="${side('width', -1)}" fill="none" stroke="#4b5563"/><path d="${side('width', 1)}" fill="none" stroke="#4b5563"/><path d="${line(grid)}" fill="none" stroke="#c026d3" stroke-width="2"/>${ticks}</g><g transform="translate(${plan.left + 40} ${plan.top + 50}) rotate(${north.toFixed(1)})"><path d="M0,-22 L7,8 L0,3 L-7,8 Z" fill="#111827"/><text y="-26" font-size="12" text-anchor="middle">N</text></g><g transform="translate(${plan.left + 20} ${plan.top + plan.height - 20})"><rect width="${(bar * scale).toFixed(1)}" height="6" fill="#111827"/><text y="-4" font-size="11">${bar} m</text></g><text x="${plan.left}" y="${plan.top - 10}" font-size="14" font-weight="600">Plan · ${formatRoadStation(start)} to ${formatRoadStation(end)}</text>${noteSvg}`

  // Profile with a mass-haul strip, sharing the station scale.
  const profile = { left: 90, top: 470, width: W - 150, height: 330 }
  const mass = { left: 90, top: 830, width: W - 150, height: 130 }
  const zs = inWindow.flatMap((s) => [s.groundElevation, s.designElevation]).filter((v): v is number => v !== null)
  const zLow = Math.min(...zs) - 2,
    zHigh = Math.max(...zs) + 2
  const sx = (c: number) => profile.left + ((c - start) / Math.max(1, end - start)) * profile.width
  const sy = (z: number) => profile.top + profile.height - ((z - zLow) / Math.max(1, zHigh - zLow)) * profile.height
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
        `<line x1="${sx(c).toFixed(1)}" x2="${sx(c).toFixed(1)}" y1="${profile.top}" y2="${mass.top + mass.height}" stroke="#e5e7eb"/><text x="${sx(c).toFixed(1)}" y="${profile.top + profile.height + 16}" font-size="11" text-anchor="middle">${formatRoadStation(c).replace(/\.0$/, '')}</text>`,
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
        `<text x="${sx(s.chainage).toFixed(1)}" y="${(sy(s.designElevation ?? s.groundElevation ?? zLow) - 8).toFixed(1)}" font-size="10" text-anchor="middle" fill="#0f766e">${fmt(s.gradePercent)}%</text>`,
    )
    .join('')
  const profileSvg = `<text x="${profile.left}" y="${profile.top - 10}" font-size="14" font-weight="600">Profile · ground (brown), design (teal)</text><rect x="${profile.left}" y="${profile.top}" width="${profile.width}" height="${profile.height}" fill="none" stroke="#111827"/>${zGrid}${sGrid}<path d="${pathOf(
    inWindow.map((s) => s.groundElevation),
    sy,
  )}" fill="none" stroke="#a07845" stroke-width="1.6"/><path d="${pathOf(
    inWindow.map((s) => s.designElevation),
    sy,
  )}" fill="none" stroke="#0d9488" stroke-width="2.2"/>${grades}<text x="${profile.left - 70}" y="${profile.top + profile.height / 2}" font-size="11" transform="rotate(-90 ${profile.left - 70} ${profile.top + profile.height / 2})" text-anchor="middle">Elevation (m)</text><text x="${mass.left}" y="${mass.top - 8}" font-size="12" font-weight="600">Mass haul (m³)</text><rect x="${mass.left}" y="${mass.top}" width="${mass.width}" height="${mass.height}" fill="none" stroke="#111827"/><line x1="${mass.left}" x2="${mass.left + mass.width}" y1="${my(0).toFixed(1)}" y2="${my(0).toFixed(1)}" stroke="#9ca3af"/><path d="${pathOf(masses, my)}" fill="none" stroke="#7c3aed" stroke-width="1.6"/><text x="${mass.left - 8}" y="${mass.top + 10}" font-size="10" text-anchor="end">${fmt(mHigh, 0)}</text><text x="${mass.left - 8}" y="${mass.top + mass.height}" font-size="10" text-anchor="end">${fmt(mLow, 0)}</text>`
  return planSvg + profileSvg
}

function sectionSheet(stations: RoadStation[]) {
  const columns = 4,
    rows = 3,
    cellW = (W - 120) / columns,
    cellH = (H - 200) / rows
  return stations
    .map((s, index) => {
      const ox = 60 + (index % columns) * cellW,
        oy = 40 + Math.floor(index / columns) * cellH
      const values = s.section
        .flatMap((p) => [p.ground, p.design])
        .filter((v): v is number => v !== null && Number.isFinite(v))
      if (!values.length) return ''
      const half = Math.max(...s.section.map((p) => Math.abs(p.offset)), 1)
      const low = Math.min(...values) - 1,
        high = Math.max(...values) + 1
      // One scale for both axes inside the cell, so the batters keep their true slope.
      const scale = Math.min((cellW - 30) / (2 * half), (cellH - 60) / Math.max(1, high - low))
      const x = (o: number) => ox + cellW / 2 + o * scale,
        y = (z: number) => oy + cellH - 30 - (z - low) * scale
      const pathOf = (key: 'ground' | 'design') => {
        let pen = false
        return s.section
          .map((p) => {
            const z = p[key]
            if (z === null || !Number.isFinite(z)) {
              pen = false
              return ''
            }
            const out = `${pen ? 'L' : 'M'}${x(p.offset).toFixed(1)},${y(z).toFixed(1)}`
            pen = true
            return out
          })
          .join(' ')
      }
      return `<g><rect x="${ox + 4}" y="${oy + 4}" width="${cellW - 8}" height="${cellH - 8}" fill="none" stroke="#d1d5db"/><text x="${ox + cellW / 2}" y="${oy + 22}" font-size="13" font-weight="600" text-anchor="middle">${formatRoadStation(s.chainage)}</text><line x1="${x(0)}" x2="${x(0)}" y1="${oy + 28}" y2="${oy + cellH - 26}" stroke="#e11d48" stroke-dasharray="4 3"/><path d="${pathOf('ground')}" fill="none" stroke="#6b7280" stroke-width="1.3"/><path d="${pathOf('design')}" fill="none" stroke="#0d9488" stroke-width="2"/><text x="${ox + 12}" y="${oy + cellH - 12}" font-size="10">L · cut ${fmt(s.cutAreaM2)} m² · fill ${fmt(s.fillAreaM2)} m² · CL ${fmt(s.designElevation, 2)}</text><text x="${ox + cellW - 12}" y="${oy + cellH - 12}" font-size="10" text-anchor="end">R</text></g>`
    })
    .join('')
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
}): string {
  const sheets: Sheet[] = []
  for (let start = 0; start < analysis.length - 1e-6; start += sheetLengthM) {
    const end = Math.min(analysis.length, start + sheetLengthM)
    const body = planProfileSheet(analysis, start, end, toGrid, contours)
    if (body) sheets.push({ title: `Plan & profile ${formatRoadStation(start)}–${formatRoadStation(end)}`, body })
  }
  const sections = sectionStations(analysis, sectionIntervalM)
  for (let i = 0; i < sections.length; i += 12)
    sheets.push({
      title: `Cross-sections ${formatRoadStation(sections[i].chainage)}–${formatRoadStation(sections[Math.min(sections.length, i + 12) - 1].chainage)}`,
      body: sectionSheet(sections.slice(i, i + 12)),
    })
  const pages = sheets
    .map(
      (sheet, i) =>
        `<section class="sheet"><svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="system-ui,sans-serif" role="img" aria-label="${html(sheet.title)}"><rect width="${W}" height="${H}" fill="#fff"/><rect x="20" y="16" width="${W - 40}" height="${H - 32}" fill="none" stroke="#111827" stroke-width="1.5"/>${sheet.body}${titleBlock(projectName, alignment.name, terrain, sheet.title, i + 1, sheets.length, i < sheets.length - Math.ceil(sections.length / 12) ? `${sheetLengthM} m per sheet` : `Sections @ ${sectionIntervalM} m, 1:1`)}</svg></section>`,
    )
    .join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${html(projectName)} · plot book</title><style>@page{size:A3 landscape;margin:0}body{margin:0;background:#e5e7eb}.sheet{width:420mm;height:297mm;margin:12px auto;background:#fff;break-after:page}.sheet svg{width:100%;height:100%;display:block}@media print{body{background:none}.sheet{margin:0}}</style></head><body>${pages}</body></html>`
}

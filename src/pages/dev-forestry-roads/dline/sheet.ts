/**
 * A printable D-line sheet as drawing operations (`src/lib/mapSheet/drawOps.ts`): a header with the
 * issue stamp, the profile from the yarder with the ground (and the terrain under a field profile),
 * the loaded carriage path, the empty skyline and the supports; a north-up plan strip with the
 * terrain's contours; the support and stake-out table; forces and angles; the limits in their three
 * states; the rigging; and the assumptions. One page, tabloid landscape by default.
 *
 * Pure: no DOM or network access. jsPDF and the PNG encoder are applied by `sheetExport.ts`.
 */
import { gridContours } from '@/lib/mapSheet/contours'
import type { DrawOp, Point } from '@/lib/mapSheet/drawOps'
import { paperSize, PAPER_SIZES, type PaperId } from '@/lib/mapSheet/layout'
import { fitText, textWidth, wrapText } from '@/lib/mapSheet/textMetrics'
import type { LayoutLimitRow } from '../cableLayout/limits'
import { CABLE_GEOMETRY_ASSUMPTIONS, CABLE_MECHANICS_ASSUMPTIONS } from '../profileOutputs'
import type { CableAnalysis, CableLine, Coordinate, TerrainSource } from '../types'
import { dLineFrame } from './frame'
import { STAKEOUT_NOTE, type DLineExtras } from './outputs'
import { SHOWN_LAYOUT_TEXT } from './supports'

/** Samples across the plan strip's width for its contours. */
export const PLAN_STRIP_SAMPLES = 160
/** Plan strip scales tried, smallest first. */
export const PLAN_STRIP_SCALES = [500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000] as const
/** Contour intervals tried, m: the first giving at most this many levels across the strip is used. */
export const PLAN_CONTOUR_INTERVALS = [1, 2, 5, 10, 20, 25, 50, 100] as const
export const MAX_PLAN_CONTOUR_LEVELS = 30

const POINTS_PER_METRE_OF_PAPER = 72 / 0.0254
const RAD = Math.PI / 180
const EARTH_RADIUS_M = 6371008.8

const COLORS = {
  ink: '#1f2937',
  muted: '#6b7280',
  rule: '#d1d5db',
  band: '#eef2ef',
  ground: '#7c5c3b',
  terrain: '#9ca3af',
  load: '#dc2626',
  empty: '#2563eb',
  support: '#6d28d9',
  contour: '#d6c7b4',
  contourIndex: '#a8957e',
  met: '#047857',
  notMet: '#b91c1c',
  unknown: '#6b7280',
}

export interface DLineSheetInput {
  brandName?: string
  projectName: string
  line: CableLine
  /** The profile on the line's own ground. */
  analysis: CableAnalysis
  extras: DLineExtras
  /** The support layout's limit rows, when a layout result is current. */
  limits: LayoutLimitRow[] | null
  /** The terrain itself, for the plan strip's contours. */
  terrain: TerrainSource
  terrainName: string
  verticalReference: string
  issue: { preparedBy: string; organisation: string; revision: string; date: string }
  /** Printed in red across the header when the sheet leaves something out. */
  stamp?: string
  caveat: string
  paper?: PaperId
}

export interface DLineSheet {
  width: number
  height: number
  ops: DrawOp[]
  /** Rows a table could not fit, by table. */
  truncated: { stakeout: number; forces: number }
}

type Box = { x: number; y: number; w: number; h: number }
const f = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? '–' : v.toFixed(digits)

function text(
  ops: DrawOp[],
  x: number,
  y: number,
  value: string,
  size: number,
  options: Partial<Extract<DrawOp, { op: 'text' }>> = {},
) {
  ops.push({ op: 'text', x, y, text: value, size, color: COLORS.ink, ...options })
}

/** A nice tick step giving about `count` ticks over `span`. */
function tickStep(span: number, count: number) {
  const raw = span / Math.max(1, count)
  const power = 10 ** Math.floor(Math.log10(raw))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * power >= raw) return m * power
  return 10 * power
}

/** The largest 1, 2 or 5 × 10ⁿ at or below `value`. */
function niceBelow(value: number) {
  const power = 10 ** Math.floor(Math.log10(value))
  for (const m of [5, 2, 1]) if (m * power <= value) return m * power
  return power
}

/** Splits a polyline at unknown values. */
function polylines(points: { x: number; y: number | null }[]): Point[][] {
  const out: Point[][] = []
  let current: Point[] = []
  for (const p of points) {
    if (p.y === null || !Number.isFinite(p.y)) {
      if (current.length > 1) out.push(current)
      current = []
    } else current.push([p.x, p.y])
  }
  if (current.length > 1) out.push(current)
  return out
}

function profilePanel(ops: DrawOp[], box: Box, input: DLineSheetInput) {
  const { analysis, extras, line } = input
  const length = Math.max(1, analysis.length)
  const yarderAtEnd = (line.yarderAt ?? 'start') === 'end'
  const station = (d: number) => (yarderAtEnd ? length - d : d)
  const ground = analysis.samples.map((s) => ({ s: station(s.distance), z: s.ground }))
  const terrain = extras.field
    ? analysis.samples.map((s, i) => ({ s: station(s.distance), z: extras.field!.terrainM[i] }))
    : []
  const mechanics = analysis.mechanics?.span ? analysis.mechanics : null
  const load = extras.layout
    ? extras.layout.samples.map((p) => ({ s: p.stationM, z: p.loadM }))
    : analysis.samples.map((s, i) => ({
        s: station(s.distance),
        z: mechanics ? mechanics.samples[i].loadPath : s.cable,
      }))
  const empty = extras.layout
    ? extras.layout.samples.map((p) => ({ s: p.stationM, z: p.emptyM }))
    : mechanics
      ? analysis.samples.map((s, i) => ({ s: station(s.distance), z: mechanics.samples[i].emptyRope }))
      : []
  const supports = extras.supports?.rows ?? []
  const zs = [...ground, ...terrain, ...load, ...empty]
    .map((p) => p.z)
    .concat(supports.flatMap((r) => [r.groundM, r.saddleM]))
    .filter((z): z is number => z !== null && Number.isFinite(z))
  const sMin = Math.min(0, ...supports.map((r) => r.stationM)),
    sMax = Math.max(length, ...supports.map((r) => r.stationM))
  const inner: Box = { x: box.x + 40, y: box.y + 18, w: box.w - 52, h: box.h - 46 }
  ops.push({ op: 'rect', x: box.x, y: box.y, w: box.w, h: box.h, stroke: { color: COLORS.rule, width: 0.6 } })
  text(ops, box.x + 6, box.y + 11, 'PROFILE FROM THE YARDER', 7, { style: 'bold' })
  if (!zs.length) {
    text(ops, inner.x + inner.w / 2, inner.y + inner.h / 2, 'No known elevations to draw.', 8, {
      align: 'center',
      color: COLORS.muted,
    })
    return
  }
  let zMin = Math.min(...zs),
    zMax = Math.max(...zs)
  const pad = Math.max(2, (zMax - zMin) * 0.08)
  zMin -= pad
  zMax += pad
  const X = (s: number) => inner.x + ((s - sMin) / Math.max(1e-6, sMax - sMin)) * inner.w
  const Y = (z: number) => inner.y + inner.h - ((z - zMin) / Math.max(1e-6, zMax - zMin)) * inner.h
  // Grid and axes.
  const sStep = tickStep(sMax - sMin, 10),
    zStep = tickStep(zMax - zMin, 6)
  for (let s = Math.ceil(sMin / sStep) * sStep; s <= sMax + 1e-6; s += sStep) {
    ops.push({
      op: 'path',
      parts: [
        [
          [X(s), inner.y],
          [X(s), inner.y + inner.h],
        ],
      ],
      closed: false,
      stroke: { color: COLORS.band, width: 0.4 },
    })
    text(ops, X(s), inner.y + inner.h + 9, s.toFixed(0), 6, { align: 'center', color: COLORS.muted })
  }
  for (let z = Math.ceil(zMin / zStep) * zStep; z <= zMax + 1e-6; z += zStep) {
    ops.push({
      op: 'path',
      parts: [
        [
          [inner.x, Y(z)],
          [inner.x + inner.w, Y(z)],
        ],
      ],
      closed: false,
      stroke: { color: COLORS.band, width: 0.4 },
    })
    text(ops, inner.x - 3, Y(z), z.toFixed(0), 6, { align: 'right', baseline: 'middle', color: COLORS.muted })
  }
  ops.push({ op: 'rect', x: inner.x, y: inner.y, w: inner.w, h: inner.h, stroke: { color: COLORS.muted, width: 0.5 } })
  const pts = (list: { s: number; z: number | null }[]) =>
    polylines([...list].sort((a, b) => a.s - b.s).map((p) => ({ x: X(p.s), y: p.z === null ? null : Y(p.z) })))
  if (terrain.length)
    ops.push({
      op: 'path',
      parts: pts(terrain),
      closed: false,
      stroke: { color: COLORS.terrain, width: 0.8, dash: [3, 2] },
    })
  ops.push({
    op: 'path',
    parts: pts(ground),
    closed: false,
    stroke: { color: COLORS.ground, width: 1.2, join: 'round' },
  })
  if (empty.length)
    ops.push({
      op: 'path',
      parts: pts(empty),
      closed: false,
      stroke: { color: COLORS.empty, width: 0.7, dash: [4, 2] },
    })
  ops.push({ op: 'path', parts: pts(load), closed: false, stroke: { color: COLORS.load, width: 1, join: 'round' } })
  for (const r of supports) {
    if (r.groundM === null) continue
    const x = X(r.stationM)
    if (r.kind === 'anchor' || r.kind === 'ground-anchor') {
      ops.push({
        op: 'path',
        parts: [
          [
            [x - 3, Y(r.groundM) + 4],
            [x + 3, Y(r.groundM) + 4],
            [x, Y(r.groundM)],
          ],
        ],
        closed: true,
        fill: COLORS.support,
      })
    } else {
      const top = Y(r.saddleM ?? r.groundM)
      ops.push({
        op: 'path',
        parts: [
          [
            [x, Y(r.groundM)],
            [x, top],
          ],
        ],
        closed: false,
        stroke: { color: COLORS.support, width: 1.6 },
      })
      ops.push({ op: 'circle', x, y: top, r: 1.8, fill: COLORS.support })
    }
    text(ops, x, Y(r.saddleM ?? r.groundM) - 5, r.label, 6.5, {
      align: 'center',
      style: 'bold',
      color: COLORS.support,
      halo: { color: '#ffffff', width: 2 },
    })
  }
  const ve = inner.h / Math.max(1e-6, zMax - zMin) / (inner.w / Math.max(1e-6, sMax - sMin))
  text(
    ops,
    inner.x + inner.w / 2,
    box.y + box.h - 6,
    `Station from the yarder (m) · vertical exaggeration ×${ve.toFixed(1)}`,
    6.5,
    {
      align: 'center',
      color: COLORS.muted,
    },
  )
  text(ops, box.x + 8, inner.y + inner.h / 2, 'Elevation (m)', 6.5, { angle: 90, align: 'center', color: COLORS.muted })
  // Legend.
  const legend: [string, string, number[] | undefined][] = [
    [extras.field ? 'Ground (field shots)' : 'Ground', COLORS.ground, undefined],
    ...(extras.field ? ([['Terrain', COLORS.terrain, [3, 2]]] as [string, string, number[]][]) : []),
    [
      extras.layout ? 'Loaded carriage path' : mechanics ? 'Loaded carriage path (one span)' : 'Assumed cable',
      COLORS.load,
      undefined,
    ],
    ...(empty.length ? ([['Empty skyline', COLORS.empty, [4, 2]]] as [string, string, number[]][]) : []),
  ]
  let lx = box.x + box.w - 8
  for (const [label, color, dash] of [...legend].reverse()) {
    const w = textWidth(label, 6.5) + 18
    lx -= w
    ops.push({
      op: 'path',
      parts: [
        [
          [lx, box.y + 9],
          [lx + 12, box.y + 9],
        ],
      ],
      closed: false,
      stroke: { color, width: 1.2, dash },
    })
    text(ops, lx + 15, box.y + 11, label, 6.5, { color: COLORS.muted })
  }
}

function planStrip(ops: DrawOp[], box: Box, input: DLineSheetInput) {
  ops.push({ op: 'rect', x: box.x, y: box.y, w: box.w, h: box.h, stroke: { color: COLORS.rule, width: 0.6 } })
  text(ops, box.x + 6, box.y + 11, 'PLAN', 7, { style: 'bold' })
  const frame = dLineFrame(input.line)
  if (!frame) return
  const rows = input.extras.supports?.rows ?? []
  const points: Coordinate[] = [frame.yarder, frame.far, ...rows.map((r) => r.coordinate)]
  const centre: Coordinate = [
    (Math.min(...points.map((p) => p[0])) + Math.max(...points.map((p) => p[0]))) / 2,
    (Math.min(...points.map((p) => p[1])) + Math.max(...points.map((p) => p[1]))) / 2,
  ]
  const cosLat = Math.cos(centre[1] * RAD)
  const toLocal = ([lng, lat]: Coordinate): [number, number] => [
    (lng - centre[0]) * RAD * EARTH_RADIUS_M * cosLat,
    (lat - centre[1]) * RAD * EARTH_RADIUS_M,
  ]
  const toLonLat = ([x, y]: [number, number]): Coordinate => [
    centre[0] + x / (RAD * EARTH_RADIUS_M * cosLat),
    centre[1] + y / (RAD * EARTH_RADIUS_M),
  ]
  const local = points.map(toLocal)
  const spanX = Math.max(1, ...local.map((p) => Math.abs(p[0]) * 2)),
    spanY = Math.max(1, ...local.map((p) => Math.abs(p[1]) * 2))
  const inner: Box = { x: box.x + 6, y: box.y + 16, w: box.w - 12, h: box.h - 34 }
  const scale =
    PLAN_STRIP_SCALES.find((s) => {
      const mpp = s / POINTS_PER_METRE_OF_PAPER
      return spanX / mpp <= inner.w * 0.88 && spanY / mpp <= inner.h * 0.8
    }) ?? PLAN_STRIP_SCALES.at(-1)!
  const mpp = scale / POINTS_PER_METRE_OF_PAPER
  const cx = inner.x + inner.w / 2,
    cy = inner.y + inner.h / 2
  const paper = (c: Coordinate): Point => {
    const [x, y] = toLocal(c)
    return [cx + x / mpp, cy - y / mpp]
  }
  // Contours from the terrain on a grid over the strip.
  const cols = PLAN_STRIP_SAMPLES,
    rowsN = Math.max(8, Math.round((PLAN_STRIP_SAMPLES * inner.h) / inner.w))
  const values = new Float64Array(cols * rowsN)
  for (let r = 0; r < rowsN; r++)
    for (let c = 0; c < cols; c++) {
      const px = inner.x + (c / (cols - 1)) * inner.w,
        py = inner.y + (r / (rowsN - 1)) * inner.h
      const z = input.terrain.elevationAt(...toLonLat([(px - cx) * mpp, (cy - py) * mpp]))
      values[r * cols + c] = Number.isFinite(z) ? z : NaN
    }
  const known = [...values].filter(Number.isFinite)
  let contourText = 'No terrain under the strip.'
  if (known.length > 4) {
    const range = Math.max(...known) - Math.min(...known)
    const interval = PLAN_CONTOUR_INTERVALS.find((i) => range / i <= MAX_PLAN_CONTOUR_LEVELS) ?? 100
    const result = gridContours({ width: cols, height: rowsN, values }, interval, 5)
    ops.push({
      op: 'clip',
      parts: [
        [
          [inner.x, inner.y],
          [inner.x + inner.w, inner.y],
          [inner.x + inner.w, inner.y + inner.h],
          [inner.x, inner.y + inner.h],
        ],
      ],
    })
    for (const level of result.levels)
      ops.push({
        op: 'path',
        parts: level.lines.map((l) =>
          l.map(([c, r]): Point => [inner.x + (c / (cols - 1)) * inner.w, inner.y + (r / (rowsN - 1)) * inner.h]),
        ),
        closed: false,
        stroke: { color: level.index ? COLORS.contourIndex : COLORS.contour, width: level.index ? 0.6 : 0.35 },
      })
    ops.push({ op: 'restore' })
    contourText = `Contours ${result.interval} m, index ${result.interval * 5} m, from ${input.terrainName}`
  }
  const [ya, fa] = [paper(frame.yarder), paper(frame.far)]
  ops.push({ op: 'path', parts: [[ya, fa]], closed: false, stroke: { color: COLORS.support, width: 1.2 } })
  for (const r of rows) {
    const [x, y] = paper(r.coordinate)
    if (r.kind === 'anchor' || r.kind === 'ground-anchor')
      ops.push({
        op: 'path',
        parts: [
          [
            [x - 3, y + 2.5],
            [x + 3, y + 2.5],
            [x, y - 3],
          ],
        ],
        closed: true,
        fill: COLORS.support,
      })
    else ops.push({ op: 'circle', x, y, r: 2.4, fill: '#ffffff', stroke: { color: COLORS.support, width: 1 } })
    text(ops, x, y - 5, r.label, 6.5, {
      align: 'center',
      style: 'bold',
      color: COLORS.support,
      halo: { color: '#ffffff', width: 2 },
    })
  }
  if (!rows.length) {
    text(ops, ya[0], ya[1] - 5, 'Yarder', 6.5, {
      align: 'center',
      color: COLORS.support,
      halo: { color: '#ffffff', width: 2 },
    })
    text(ops, fa[0], fa[1] - 5, 'Tail', 6.5, {
      align: 'center',
      color: COLORS.support,
      halo: { color: '#ffffff', width: 2 },
    })
  }
  // North arrow and scale bar.
  const nx = inner.x + inner.w - 12,
    ny = inner.y + 6
  ops.push({
    op: 'path',
    parts: [
      [
        [nx, ny],
        [nx - 4, ny + 12],
        [nx, ny + 9],
        [nx + 4, ny + 12],
      ],
    ],
    closed: true,
    fill: COLORS.ink,
  })
  text(ops, nx, ny + 20, 'N', 6.5, { align: 'center', style: 'bold' })
  const barM = niceBelow(inner.w * 0.25 * mpp)
  const barPt = barM / mpp
  const bx = inner.x + 4,
    by = box.y + box.h - 12
  ops.push({ op: 'rect', x: bx, y: by, w: barPt, h: 3, fill: COLORS.ink })
  text(
    ops,
    bx + barPt + 4,
    by + 3,
    `${barM.toLocaleString('en-US')} m · 1:${scale.toLocaleString('en-US')} at this paper size`,
    6,
    { color: COLORS.muted },
  )
  text(ops, box.x + box.w - 6, by + 3, fitText(contourText, 6, box.w / 2), 6, { align: 'right', color: COLORS.muted })
}

interface Column {
  label: string
  width: number
  align?: 'left' | 'right'
}

/** A table that stops at `maxY`; returns where it ended and how many rows it left out. */
function table(
  ops: DrawOp[],
  x: number,
  y: number,
  title: string,
  columns: Column[],
  rows: string[][],
  maxY: number,
  rowColor?: (row: number) => string | undefined,
): { y: number; left: number } {
  const size = 6.5,
    rowH = 9.5
  text(ops, x, y + 8, title, 7, { style: 'bold' })
  y += 12
  const width = columns.reduce((s, c) => s + c.width, 0)
  ops.push({ op: 'rect', x, y, w: width, h: rowH, fill: COLORS.band })
  let cx = x
  for (const c of columns) {
    text(
      ops,
      c.align === 'left' ? cx + 2 : cx + c.width - 2,
      y + 6.8,
      fitText(c.label, size, c.width - 3, 'bold'),
      size,
      {
        style: 'bold',
        align: c.align === 'left' ? 'left' : 'right',
      },
    )
    cx += c.width
  }
  y += rowH
  let shown = 0
  for (const [i, row] of rows.entries()) {
    if (y + rowH > maxY - (i < rows.length - 1 ? rowH : 0)) break
    cx = x
    for (const [j, c] of columns.entries()) {
      text(
        ops,
        c.align === 'left' ? cx + 2 : cx + c.width - 2,
        y + 6.8,
        fitText(row[j] ?? '', size, c.width - 3),
        size,
        {
          align: c.align === 'left' ? 'left' : 'right',
          color: rowColor?.(i) ?? COLORS.ink,
        },
      )
      cx += c.width
    }
    ops.push({
      op: 'path',
      parts: [
        [
          [x, y + rowH],
          [x + width, y + rowH],
        ],
      ],
      closed: false,
      stroke: { color: COLORS.band, width: 0.4 },
    })
    y += rowH
    shown++
  }
  const left = rows.length - shown
  if (left > 0) {
    text(ops, x, y + 7, `+${left} more rows: see the D-line report or CSV.`, 6, { color: COLORS.muted })
    y += 9
  }
  return { y: y + 6, left }
}

const scaled = (columns: Column[], factor: number): Column[] => columns.map((c) => ({ ...c, width: c.width * factor }))

const STATE_TEXT = { met: 'Met', 'not-met': 'NOT MET', 'not-assessed': 'Not assessed' } as const

/** The sheet's drawing operations. */
export function buildDLineSheet(input: DLineSheetInput): DLineSheet {
  const paperId = input.paper ?? 'tabloid'
  if (!PAPER_SIZES[paperId]) throw Error('Choose a paper size.')
  const { width, height } = paperSize(paperId, 'landscape')
  const ops: DrawOp[] = [{ op: 'rect', x: 0, y: 0, w: width, h: height, fill: '#ffffff' }]
  const m = 28
  const right = Math.min(400, width * 0.33)
  const leftW = width - 2 * m - right - 14
  const { line, extras } = input
  // Header.
  text(ops, input.brandName ? m + 185 : m, m + 6, `${input.brandName ?? 'DDC Access'} · D-line sheet`, 6.5, {
    color: COLORS.muted,
    style: 'bold',
  })
  text(ops, m, m + 24, fitText(line.name, 16, leftW), 16, { style: 'bold' })
  text(ops, m, m + 36, fitText(input.projectName, 8, leftW), 8, { color: COLORS.muted })
  const stampLines = [
    `Prepared by: ${[input.issue.preparedBy, input.issue.organisation].filter(Boolean).join(', ') || 'Not recorded'}`,
    `Revision: ${input.issue.revision || 'Not recorded'} · Date: ${input.issue.date}`,
    `Terrain: ${input.terrainName} · ${input.verticalReference}`,
  ]
  stampLines.forEach((l, i) =>
    text(ops, width - m, m + 8 + i * 10, fitText(l, 7, right), 7, { align: 'right', color: COLORS.muted }),
  )
  if (input.stamp)
    text(ops, m + leftW, m + 36, fitText(input.stamp, 7, leftW / 2, 'bold'), 7, {
      align: 'right',
      style: 'bold',
      color: COLORS.notMet,
    })
  ops.push({
    op: 'path',
    parts: [
      [
        [m, m + 44],
        [width - m, m + 44],
      ],
    ],
    closed: false,
    stroke: { color: COLORS.ink, width: 0.8 },
  })
  // Left column: profile, plan, assumptions.
  const top = m + 52
  const assumptionsH = 92
  const avail = height - m - top - assumptionsH - 16
  const profileBox: Box = { x: m, y: top, w: leftW, h: avail * 0.58 }
  const planBox: Box = { x: m, y: top + avail * 0.58 + 8, w: leftW, h: avail * 0.42 - 8 }
  profilePanel(ops, profileBox, input)
  planStrip(ops, planBox, input)
  const assumptions = [
    line.sagModel === 'mechanics' ? CABLE_MECHANICS_ASSUMPTIONS : CABLE_GEOMETRY_ASSUMPTIONS,
    extras.supports?.layout === 'edited'
      ? 'Supports: the layout edited by hand and open on the D-line, not the found one.'
      : '',
    extras.layout
      ? 'Supports: a static multi-span layout at one pre-tension, the carriage moved along every span. No dynamic loads, lateral yarding, anchors, trees or equipment ratings.'
      : extras.supports
        ? 'Supports: the layout saved on the D-line, not checked against it as it is now; no forces or angles are given.'
        : '',
    extras.supports ? STAKEOUT_NOTE : '',
    extras.field
      ? `Ground: field shots from ${f(extras.field.comparison.coveredFromM)} to ${f(extras.field.comparison.coveredToM)} m replace the terrain along the line${line.fieldProfile?.note ? ` (${line.fieldProfile.note})` : ''}; the dashed line is the terrain. Largest field − terrain ${f(extras.field.comparison.largestDifferenceM, 2)} m.`
      : '',
    input.caveat,
  ]
    .filter(Boolean)
    .join(' ')
  const ay = height - m - assumptionsH
  text(ops, m, ay + 8, 'ASSUMPTIONS', 7, { style: 'bold' })
  wrapText(assumptions, 6.3, leftW)
    .slice(0, Math.floor((assumptionsH - 12) / 8))
    .forEach((l, i) => text(ops, m, ay + 18 + i * 8, l, 6.3, { color: COLORS.ink }))
  // Right column: tables.
  const rx = width - m - right
  let y = top
  const supports = extras.supports
  const summary = [
    supports
      ? `${SHOWN_LAYOUT_TEXT[supports.layout]}${supports.status === 'complete' ? '' : ', partial'} · ${supports.intermediate} intermediate support${supports.intermediate === 1 ? '' : 's'} · pre-tension ${f(supports.preTensionKN, 0)} kN`
      : line.sagModel === 'mechanics'
        ? 'Single span (no intermediate supports saved)'
        : `Assumed sag ${f(line.deflectionPercent)} % of span`,
    `Span ${f(input.analysis.length)} m · yarder ${f(line.startHeight)} m · tail ${f(line.endHeight)} m · yarder at the ${line.yarderAt ?? 'start'}`,
    ...(extras.layout
      ? [
          `Rope ${f(extras.layout.ropeLengthM, 0)} m between end supports · max tension ${f(extras.layout.maxTensionKN, 0)} of ${f(extras.layout.allowableKN, 0)} kN`,
        ]
      : []),
  ]
  summary.forEach((l, i) =>
    text(ops, rx, y + 8 + i * 9, fitText(l, 7, right), 7, { style: i === 0 ? 'bold' : 'normal' }),
  )
  y += summary.length * 9 + 6
  let truncatedStake = 0,
    truncatedForces = 0
  const bottom = height - m
  if (extras.stakeout) {
    const r = table(
      ops,
      rx,
      y,
      `SUPPORTS AND STAKE-OUT · EPSG:${extras.stakeout.epsg}`,
      scaled(
        [
          { label: 'Pt', width: 18, align: 'left' },
          { label: 'Support', width: 72, align: 'left' },
          { label: 'Sta m', width: 36 },
          { label: 'Easting', width: 56 },
          { label: 'Northing', width: 60 },
          { label: 'Ground', width: 44 },
          { label: 'Ht m', width: 32 },
          { label: 'Saddle', width: 44 },
        ],
        right / 362,
      ),
      extras.stakeout.rows.map((s) => [
        String(s.point),
        `${s.label} ${s.supportName ?? s.name}`,
        f(s.stationM),
        f(s.easting, 1),
        f(s.northing, 1),
        f(s.groundM),
        f(s.heightM),
        f(s.saddleM),
      ]),
      bottom - 240,
    )
    y = r.y
    truncatedStake = r.left
  }
  if (supports && extras.layout) {
    const r = table(
      ops,
      rx,
      y,
      'FORCES AND ANGLES',
      scaled(
        [
          { label: 'Support', width: 92, align: 'left' },
          { label: 'Break empty °', width: 70 },
          { label: 'Break loaded °', width: 74 },
          { label: 'Max force kN', width: 66 },
          { label: 'Fixed', width: 40 },
        ],
        right / 342,
      ),
      supports.rows.map((s) => [
        `${s.label} ${s.supportName ?? s.name}`,
        f(s.emptyBreakDeg),
        f(s.loadedBreakDeg),
        f(s.maxForceKN),
        s.fixed ? 'yes' : '',
      ]),
      bottom - 150,
    )
    y = r.y
    truncatedForces = r.left
  }
  if (input.limits?.length) {
    const r = table(
      ops,
      rx,
      y,
      'LIMITS',
      scaled(
        [
          { label: 'Check', width: 150, align: 'left' },
          { label: 'Limit', width: 80 },
          { label: 'Layout', width: 70 },
          { label: 'State', width: 62 },
        ],
        right / 362,
      ),
      input.limits.map((row) => [row.label, row.limit, row.value, STATE_TEXT[row.state]]),
      bottom - 60,
      (i) =>
        input.limits![i].state === 'not-met'
          ? COLORS.notMet
          : input.limits![i].state === 'not-assessed'
            ? COLORS.unknown
            : undefined,
    )
    y = r.y
  } else if (line.sagModel === 'mechanics') {
    text(ops, rx, y + 8, 'LIMITS', 7, { style: 'bold' })
    text(ops, rx, y + 18, 'Not assessed: find supports or check the saved layout first.', 6.5, {
      color: COLORS.unknown,
    })
    y += 26
  }
  // Rigging.
  const rig = line.sagModel === 'mechanics' ? line.rigging : undefined
  const rigLines = rig
    ? [
        `Rigging${extras.riggingSet ? `: ${extras.riggingSet}` : ''} · ${f(rig.ropeDiameterMm)} mm skyline, ${f(rig.ropeMassKgPerM, 2)} kg/m, MBF ${f(rig.breakingForceKN, 0)} kN, safety factor ${f(rig.safetyFactor, 2)}`,
        `Load ${f(rig.payloadKg, 0)} kg + carriage ${f(rig.carriageKg, 0)} kg · running lines ${f(rig.runningLinesKgPerM, 2)} kg/m · clearance ${f(rig.minClearanceM)} m`,
      ]
    : ['Assumed sag: no rope, load or tension is calculated.']
  rigLines.forEach((l, i) => text(ops, rx, Math.min(y, bottom - 20) + 8 + i * 9, fitText(l, 6.5, right), 6.5))
  return { width, height, ops, truncated: { stakeout: truncatedStake, forces: truncatedForces } }
}

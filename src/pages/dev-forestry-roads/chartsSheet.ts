/**
 * The plot book's "Profile, grade & mass haul" sheet: the whole road (or a chapter's station range) as
 * three stacked charts on one station axis, for printing and for use outside the designer. The
 * plan-and-profile sheets show 250 m at a time; this one shows the road's long section, its grade
 * against the project's limits and its mass-haul curve together.
 *
 * Grade limits come from `gradeRule` (the same rule Review judges), labels from the plot book's own
 * profile labels (`sheetProfileLabelsSvg`), and unknown earthwork is shaded as on the plan sheets
 * (`unknownEarthworkSpans`). The chapter's `ChartsOptions` choose the panels, the station-axis
 * spacing, the grade axis, and the legend and statistics printed beside the title block. Free of DOM
 * access: it returns SVG markup for `plotBook.ts`.
 */
import { unknownEarthworkSpans } from './massHaul'
import { sheetProfileLabelsSvg } from './plotBookProfile'
import type { ProfileGradeLimits } from './profileAnnotations'
import { DEFAULT_CHARTS_OPTIONS, type ChartPanel, type ChartsOptions } from './chartsOptions'
import { textWidth } from '@/lib/mapSheet/textMetrics'
import type { Alignment, RoadAnalysis, RoadStation } from './types'
import { gradeSide, sustainedLimit, type GradeRule } from './designStandards'

const formatRoadStation = (value: number) => {
  const rounded = Math.round(Math.max(0, value) * 10) / 10
  return `${Math.floor(rounded / 1000)}+${(rounded % 1000).toFixed(1).padStart(5, '0')}`
}
const fmt = (n: number, d = 0) => n.toLocaleString('en-CA', { minimumFractionDigits: d, maximumFractionDigits: d })
/** The smallest 1, 2, 2.5 or 5 × 10ⁿ step that gives no more than `target` + 1 intervals over `span`. */
const niceStep = (span: number, target: number) => {
  const raw = span / Math.max(1, target),
    power = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)))
  const candidates = [0.1, 1, 10, 100].flatMap((p) => [1, 2, 2.5, 5].map((m) => m * p * power))
  return candidates.find((step) => span / step <= target + 1 + 1e-9) ?? candidates[candidates.length - 1]
}

/**
 * A value axis for a panel `height` units tall: about one labelled line every 55 units (at least
 * five), with both ends on a tick, so the gaps above the top line and below the bottom one match the
 * rest.
 */
export function valueAxis(low: number, high: number, height: number) {
  const target = Math.max(5, Math.round(height / 55))
  const step = niceStep(Math.max(1e-9, high - low), target)
  const lo = Math.floor(low / step + 1e-9) * step
  let hi = Math.ceil(high / step - 1e-9) * step
  if (hi <= lo) hi = lo + step
  const ticks: number[] = []
  for (let k = 0; lo + k * step <= hi + step * 1e-6; k++) ticks.push(Math.round((lo + k * step) / step) * step)
  return { low: lo, high: hi, step, ticks }
}

type Box = { left: number; width: number; top: number; height: number }

/** Where panels may go: below the sheet title, above the station labels and the bottom strip. */
const PANELS_TOP = 52,
  PANELS_BOTTOM = 925,
  PANEL_GAP = 46
/** The interval band's rows, each `BAND_ROW` units tall, attached under the lowest chart. */
const BAND_ROWS = ['Stations', 'Average grade', 'Steepest grade', 'Rise (m)', 'Ground grade', 'Cut (m³)', 'Fill (m³)']
const BAND_ROW = 14
/** Space between the lowest chart and the band, so the chart's bottom value label stays clear of it. */
const BAND_GAP = 10
const PANEL_WEIGHT: Record<ChartPanel, number> = { profile: 2, grade: 1, mass: 1 }

/** Panel boxes on a sheet `W` units wide, stacked in `CHART_PANELS` order and sharing the height. */
export function chartPanels(
  W: number,
  panels: readonly ChartPanel[] = DEFAULT_CHARTS_OPTIONS.panels,
  /** Height kept under the lowest chart for the interval band. */
  reserve = 0,
) {
  const left = 100,
    width = W - 160
  const total = panels.reduce((sum, p) => sum + PANEL_WEIGHT[p], 0)
  const room = PANELS_BOTTOM - reserve - PANELS_TOP - PANEL_GAP * (panels.length - 1)
  const boxes: Partial<Record<ChartPanel, Box>> = {}
  let top = PANELS_TOP
  for (const panel of panels) {
    const height = Math.round((room * PANEL_WEIGHT[panel]) / total)
    boxes[panel] = { left, width, top, height }
    top += height + PANEL_GAP
  }
  return boxes
}

export interface ChartStats {
  lengthM: number
  startElevation: number | null
  endElevation: number | null
  climbM: number
  descentM: number
  /** Net rise over the length, signed: positive climbs up-station. */
  averageGradePercent: number | null
  /** Climb plus descent over the length: how steep the road is in either direction. */
  meanAbsoluteGradePercent: number | null
  steepestClimbPercent: number | null
  steepestDescentPercent: number | null
  /**
   * Length whose design grade is past its sustained limit: with a loaded direction, the adverse
   * limit where loaded trucks climb and the favourable one where they descend (`sustainedLimit`).
   */
  overLimitM: number | null
  cutM3: number
  fillM3: number
  /** Share of the intervals with known earthwork, by length. */
  earthworkKnownShare: number
}

/** A grade past the limit it is held to: its direction's, when loaded trucks travel one way. */
const overSustained = (rule: GradeRule, signedGradePercent: number) =>
  Math.abs(signedGradePercent) > sustainedLimit(rule, signedGradePercent) + 1e-9

/** The figures the statistics block prints, for the stations of one sheet. */
export function chartStats(stations: readonly RoadStation[], rule?: GradeRule): ChartStats {
  const designed = stations.filter((s) => s.designElevation !== null && Number.isFinite(s.designElevation))
  const lengthM = stations.length > 1 ? stations[stations.length - 1].chainage - stations[0].chainage : 0
  let climbM = 0,
    descentM = 0,
    overLimitM = 0,
    knownM = 0,
    cutM3 = 0,
    fillM3 = 0
  for (let i = 1; i < stations.length; i++) {
    const a = stations[i - 1],
      b = stations[i]
    const run = b.chainage - a.chainage
    if (a.designElevation !== null && b.designElevation !== null) {
      const rise = b.designElevation - a.designElevation
      if (rise > 0) climbM += rise
      else descentM -= rise
      if (rule && run > 0 && overSustained(rule, (100 * rise) / run)) overLimitM += run
    }
    if (b.cutVolumeM3 !== null && b.fillVolumeM3 !== null) {
      knownM += run
      cutM3 += b.cutVolumeM3
      fillM3 += b.fillVolumeM3
    }
  }
  const grades = stations.map((s) => s.gradePercent).filter((g): g is number => g !== null && Number.isFinite(g))
  const first = designed[0]?.designElevation ?? null,
    last = designed[designed.length - 1]?.designElevation ?? null
  return {
    lengthM,
    startElevation: first,
    endElevation: last,
    climbM,
    descentM,
    averageGradePercent: lengthM > 0 && first !== null && last !== null ? (100 * (last - first)) / lengthM : null,
    meanAbsoluteGradePercent: lengthM > 0 && designed.length > 1 ? (100 * (climbM + descentM)) / lengthM : null,
    steepestClimbPercent: grades.length ? Math.max(0, ...grades) : null,
    steepestDescentPercent: grades.length ? Math.min(0, ...grades) : null,
    overLimitM: rule ? overLimitM : null,
    cutM3,
    fillM3,
    earthworkKnownShare: lengthM > 0 ? knownM / lengthM : 0,
  }
}

/** Grade axis: the fixed range, or the data's own extent rounded out to 5 % (at most ±100 %). */
export function gradeAxis(values: readonly number[], rangePercent: number | null) {
  if (rangePercent !== null) return { low: -rangePercent, high: rangePercent }
  const high = Math.min(100, Math.max(5, Math.ceil((Math.max(0, ...values) + 1) / 5) * 5))
  const low = Math.max(-100, Math.min(-5, Math.floor((Math.min(0, ...values) - 1) / 5) * 5))
  return { low, high }
}

export interface IntervalStats {
  from: number
  to: number
  /** Net design rise over the interval's stations, divided by their distance; positive climbs. */
  averageGradePercent: number | null
  /** The design grade of largest size at the interval's stations, with its sign. */
  steepestGradePercent: number | null
  riseM: number | null
  /** The ground's net grade over the same stations, for comparison. */
  groundGradePercent: number | null
  /** Earthwork of the station intervals ending inside it; null when none is known. */
  cutM3: number | null
  fillM3: number | null
  /** Its steepest design grade is past the sustained limit. */
  overLimit: boolean
  /** The design's first and last points in the interval: the average-grade line runs between them. */
  chord: { fromM: number; fromZ: number; toM: number; toZ: number } | null
  /** The same for the ground. */
  groundChord: { fromM: number; fromZ: number; toM: number; toZ: number } | null
}

/** The band's figures: one column per `step` metres from `start`, the last one cut at `end`. */
export function intervalStats(
  stations: readonly RoadStation[],
  start: number,
  end: number,
  step: number,
  rule?: GradeRule,
): IntervalStats[] {
  const out: IntervalStats[] = []
  for (let from = start; from < end - 1e-6; ) {
    const to = Math.min(end, (Math.floor(from / step + 1e-9) + 1) * step)
    const inside = stations.filter((s) => s.chainage >= from - 1e-6 && s.chainage <= to + 1e-6)
    const net = (pick: (s: RoadStation) => number | null) => {
      const known = inside.filter((s) => pick(s) !== null && Number.isFinite(pick(s)!))
      if (known.length < 2) return null
      const a = known[0],
        b = known[known.length - 1]
      const run = b.chainage - a.chainage
      return run > 0.5
        ? {
            rise: pick(b)! - pick(a)!,
            grade: (100 * (pick(b)! - pick(a)!)) / run,
            chord: { fromM: a.chainage, fromZ: pick(a)!, toM: b.chainage, toZ: pick(b)! },
          }
        : null
    }
    const design = net((s) => s.designElevation),
      ground = net((s) => s.groundElevation)
    const grades = inside.map((s) => s.gradePercent).filter((g): g is number => g !== null && Number.isFinite(g))
    const steepest = grades.length ? grades.reduce((m, g) => (Math.abs(g) > Math.abs(m) ? g : m)) : null
    const ending = inside.filter((s) => s.chainage > from + 1e-6 && s.cutVolumeM3 !== null && s.fillVolumeM3 !== null)
    out.push({
      from,
      to,
      averageGradePercent: design?.grade ?? null,
      steepestGradePercent: steepest,
      riseM: design?.rise ?? null,
      groundGradePercent: ground?.grade ?? null,
      cutM3: ending.length ? ending.reduce((t, s) => t + s.cutVolumeM3!, 0) : null,
      fillM3: ending.length ? ending.reduce((t, s) => t + s.fillVolumeM3!, 0) : null,
      // Past its direction's limit anywhere in the interval, not just at the steepest grade.
      overLimit: !!rule && grades.some((g) => overSustained(rule, g)),
      chord: design?.chord ?? null,
      groundChord: ground?.chord ?? null,
    })
    from = to
  }
  return out
}

const INTERVAL_LINE = '#1d4ed8'
/** Text and dashed-line colours for the design's and the ground's figures: the lines' own hues, darker to read as text. */
const DESIGN_TEXT = '#0f766e',
  GROUND_TEXT = '#8a5a2b'
const OVER_LIMIT = '#b91c1c'
/** Height kept clear for the top or bottom interval boxes: rows of up to 10-unit type plus margins. */
const intervalBoxPx = (rows: number) => Math.ceil(rows * 10 * 1.15 + 6 + 6)

type Row = { text: string; colour: string; bold?: boolean }

/**
 * Interval statistics drawn on the profile: a dashed line at every interval boundary, and each
 * interval's average grade (with its steepest grade, red past the sustained limit) at the top or
 * bottom of the interval, or along a dashed line at the interval's average grade. With `both`, the
 * ground's average grade prints beside the design's, each in its line's colour. Labels sit on a
 * white backing and shrink to their interval's width; nothing is drawn past the panel.
 */
function profileIntervalsSvg({
  box,
  columns,
  style,
  both,
  sx,
  sy,
}: {
  box: Box
  columns: IntervalStats[]
  style: Exclude<ChartsOptions['intervalStyle'], 'band' | undefined>
  both: boolean
  sx: (c: number) => number
  sy: (z: number) => number
}): string {
  const pct = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${fmt(v, 1).replace('-', '−')}%`)
  const designColour = both ? DESIGN_TEXT : style === 'line' ? INTERVAL_LINE : '#111827'
  const boundaries = columns
    .slice(0, -1)
    .map(
      (c) =>
        `<line x1="${sx(c.to).toFixed(1)}" x2="${sx(c.to).toFixed(1)}" y1="${box.top}" y2="${box.top + box.height}" stroke="#6b7280" stroke-width="0.9" stroke-dasharray="4 3" data-role="interval-boundary"/>`,
    )
    .join('')
  // A stack of text rows on a white backing, centred on (0, 0) and growing away from it.
  // With two lines drawn, a lighter backing keeps the other line visible through a label.
  const backing = both && style === 'line' ? 0.55 : 0.85
  const stack = (rows: Row[], size: number, direction: 1 | -1, offset: number) => {
    const pitch = size * 1.15
    const width = Math.max(...rows.map((r) => textWidth(r.text, size, r.bold ? 'bold' : 'normal'))) + 6
    const height = rows.length * pitch + 3
    const top = direction === 1 ? offset : -offset - height
    return (
      `<rect x="${(-width / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" fill="#ffffff" fill-opacity="${backing}"/>` +
      rows
        .map(
          (r, k) =>
            `<text x="0" y="${(top + (k + 1) * pitch - 1).toFixed(1)}" font-size="${size.toFixed(1)}"${r.bold ? ' font-weight="700"' : ''} text-anchor="middle" fill="${r.colour}">${r.text}</text>`,
        )
        .join('')
    )
  }
  const fit = (rows: Row[], room: number) =>
    Math.max(
      6.5,
      Math.min(10, ...rows.map((r) => room / Math.max(0.01, textWidth(r.text, 1, r.bold ? 'bold' : 'normal')))),
    )
  const labels = columns
    .map((c) => {
      const x0 = sx(c.from),
        x1 = sx(c.to),
        room = x1 - x0 - 8
      const design: Row = { text: pct(c.averageGradePercent), colour: designColour, bold: true }
      const ground: Row = { text: `ground ${pct(c.groundGradePercent)}`, colour: GROUND_TEXT }
      const steepest: Row = {
        text: `max ${pct(c.steepestGradePercent).replace('+', '')}`,
        colour: c.overLimit ? OVER_LIMIT : '#374151',
      }
      if (style === 'line') {
        // One dashed line per series at its average grade, labelled along it: the design's above
        // (below where the panel's top leaves no room), the ground's on the other side.
        const series = [
          {
            chord: c.chord,
            rows: [design, ...(c.overLimit ? [steepest] : [])],
            colour: both ? DESIGN_TEXT : INTERVAL_LINE,
          },
          ...(both
            ? [
                {
                  chord: c.groundChord,
                  rows: [{ ...ground, text: pct(c.groundGradePercent), bold: true }],
                  colour: GROUND_TEXT,
                },
              ]
            : []),
        ]
        let designAbove = true,
          designDepth = 0
        return series
          .map((item, k) => {
            if (!item.chord) return ''
            const ax = sx(item.chord.fromM),
              ay = sy(item.chord.fromZ),
              bx = sx(item.chord.toM),
              by = sy(item.chord.toZ)
            const angle = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI
            const size = fit(item.rows, room * 0.8)
            const mx = (ax + bx) / 2,
              my = (ay + by) / 2
            const depth = item.rows.length * size * 1.15 + 3
            const roomAbove = my - depth - 8 >= box.top + 2
            // The design's label goes above its line when it fits; the ground's on the other side,
            // or, where that side is the panel's top with no room, under the design's label.
            let above = roomAbove,
              offset = 3
            if (k === 0) {
              designAbove = roomAbove
              designDepth = depth
            } else {
              above = !designAbove && roomAbove
              if (!designAbove && !above) offset = 3 + designDepth + 2
            }
            return (
              `<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="${item.colour}" stroke-width="1.3" stroke-dasharray="6 3" data-role="${k === 0 ? 'interval-average' : 'interval-ground-average'}"/>` +
              `<g transform="translate(${mx.toFixed(1)} ${my.toFixed(1)}) rotate(${angle.toFixed(2)})" data-role="interval-label">${stack(item.rows, size, above ? -1 : 1, offset)}</g>`
            )
          })
          .join('')
      }
      // Top or bottom of the interval: the design's average, the ground's under it, then the steepest.
      const rows = [design, ...(both ? [ground] : []), steepest]
      const size = fit(rows, room)
      const height = rows.length * size * 1.15 + 3
      const mid = (x0 + x1) / 2
      const y = style === 'top' ? box.top + 4 : box.top + box.height - 4 - height
      return `<g transform="translate(${mid.toFixed(1)} ${y.toFixed(1)})" data-role="interval-label">${stack(rows, size, 1, 0)}</g>`
    })
    .join('')
  return `<g data-role="interval-profile">${boundaries}${labels}</g>`
}

export function chartsSheetBody({
  analysis,
  alignment,
  start,
  end,
  W,
  limits,
  profileLabels = true,
  options = DEFAULT_CHARTS_OPTIONS,
  strip,
}: {
  analysis: RoadAnalysis
  alignment: Alignment
  start: number
  end: number
  W: number
  limits?: ProfileGradeLimits
  profileLabels?: boolean
  options?: ChartsOptions
  /** The free strip left of the title block, for the legend and the statistics. */
  strip?: Box
}): string {
  const stations = analysis.stations.filter((s) => s.chainage >= start - 1e-6 && s.chainage <= end + 1e-6)
  if (stations.length < 2) return ''
  const interval = options.intervalM ?? null
  // Statistics drawn on the profile need a profile; without one they fall back to the table.
  const onProfile = !!interval && (options.intervalStyle ?? 'band') !== 'band' && options.panels.includes('profile')
  const band = !!interval && !onProfile
  const bandHeight = band ? BAND_ROWS.length * BAND_ROW : 0
  const boxes = chartPanels(W, options.panels, band ? bandHeight + BAND_GAP : 0)
  const any = Object.values(boxes)[0]!
  const sx = (c: number) => any.left + ((c - start) / Math.max(1, end - start)) * any.width
  const path = (values: (number | null)[], y: (v: number) => number) => {
    let pen = false
    return stations
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

  // Station axis, shared by every panel and labelled under the lowest.
  const tickEvery = options.stationTickM ?? niceStep(end - start, 10)
  const ticks = Array.from(
    { length: Math.floor((end - start) / tickEvery) + 2 },
    (_, i) => Math.ceil(start / tickEvery - 1e-9) * tickEvery + i * tickEvery,
  ).filter((c) => c <= end + 1e-6)
  // Label every tick that leaves room for "10+000"; a dense axis labels every second or fifth tick.
  const spacing = (any.width * tickEvery) / Math.max(1, end - start)
  const labelEvery = [1, 2, 5, 10, 20].find((k) => spacing * k >= 46) ?? 50
  const lowest = options.panels[options.panels.length - 1]
  // With the interval band, the station labels move under it.
  const labelled = (panel: ChartPanel) => lowest === panel && !band
  const stationGrid = (box: Box, labels: boolean) =>
    ticks
      .map((c) => {
        const x = sx(c).toFixed(1)
        const n = Math.round(c / tickEvery)
        return `<line x1="${x}" x2="${x}" y1="${box.top}" y2="${box.top + box.height}" stroke="${n % labelEvery === 0 ? '#d1d5db' : '#eef0f2'}"/>${labels && n % labelEvery === 0 ? `<text x="${x}" y="${box.top + box.height + 15}" font-size="11" text-anchor="middle">${formatRoadStation(c).replace(/\.0$/, '')}</text>` : ''}`
      })
      .join('')
  // Each panel's widest value label, so its axis title sits just outside the labels.
  const labelWidth = new Map<Box, number>()
  const valueGrid = (box: Box, axis: ReturnType<typeof valueAxis>, y: (v: number) => number, unit: string) => {
    const digits = axis.step < 1 ? 1 : 0
    const labels = axis.ticks.map((v) => `${fmt(v, digits).replace('-', '−')}${unit}`)
    labelWidth.set(box, Math.max(...labels.map((l) => l.length)) * 6)
    return axis.ticks
      .map(
        (v, i) =>
          `<line x1="${box.left}" x2="${box.left + box.width}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="#e5e7eb"/><text x="${box.left - 8}" y="${(y(v) + 4).toFixed(1)}" font-size="10.5" text-anchor="end">${labels[i]}</text>`,
      )
      .join('')
  }
  const frame = (box: Box) =>
    `<rect x="${box.left}" y="${box.top}" width="${box.width}" height="${box.height}" fill="none" stroke="#111827"/>`
  const title = (box: Box, text: string) =>
    `<text x="${box.left}" y="${box.top - 10}" font-size="14" font-weight="600">${text}</text>`
  const yTitle = (box: Box, text: string) => {
    const x = Math.max(28, box.left - 8 - (labelWidth.get(box) ?? 40) - 12),
      y = box.top + box.height / 2
    return `<text x="${x}" y="${y}" font-size="11" transform="rotate(-90 ${x} ${y})" text-anchor="middle" data-role="y-axis-title">${text}</text>`
  }
  const xTitle = (box: Box) =>
    `<text x="${box.left + box.width / 2}" y="${box.top + box.height + 32}" font-size="11" text-anchor="middle">Station (m)</text>`

  const legend: { label: string; swatch: string }[] = []
  const line = (color: string, width = 2, dash = '') =>
    `<line x1="0" x2="22" y1="0" y2="0" stroke="${color}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`
  const shade = (color: string, opacity: number) =>
    `<rect x="0" y="-6" width="22" height="12" fill="${color}" fill-opacity="${opacity}" stroke="${color}" stroke-opacity="0.4"/>`
  const panelsSvg: string[] = []

  // 1. Profile.
  const prepared = stations.map((s) => s.section.find((p) => Math.abs(p.offset) < 1e-7)?.preparedGround ?? null)
  const profile = boxes.profile
  if (profile) {
    const zs = stations
      .flatMap((s, i) => [s.groundElevation, s.designElevation, prepared[i]])
      .filter((v): v is number => v !== null && Number.isFinite(v))
    // Boxes at the top or bottom of each interval get clear space on that side, so they never
    // cover the profile: the axis is stretched by the box's height before it is rounded to ticks.
    const boxStyle = onProfile && (options.intervalStyle === 'top' || options.intervalStyle === 'bottom')
    const reservePx = boxStyle ? intervalBoxPx(options.intervalLines === 'both' ? 3 : 2) : 0
    const zMin = Math.min(...zs),
      zMax = Math.max(...zs)
    const extra = reservePx ? ((zMax - zMin) * reservePx) / Math.max(1, profile.height - reservePx) : 0
    const zAxis = valueAxis(
      options.intervalStyle === 'bottom' ? zMin - extra : zMin,
      options.intervalStyle === 'top' && boxStyle ? zMax + extra : zMax,
      profile.height,
    )
    const zLow = zAxis.low,
      zHigh = zAxis.high
    const sy = (z: number) => profile.top + profile.height - ((z - zLow) / Math.max(1, zHigh - zLow)) * profile.height
    const exaggeration = profile.height / Math.max(1, zHigh - zLow) / (profile.width / Math.max(1, end - start))
    legend.push({ label: 'Ground', swatch: line('#a07845', 1.6) }, { label: 'Design', swatch: line('#0d9488', 2.2) })
    if (onProfile && interval) {
      legend.push({ label: `Interval boundary, every ${fmt(interval)} m`, swatch: line('#6b7280', 0.9, '4 3') })
      const both = options.intervalLines === 'both'
      if (options.intervalStyle === 'line')
        legend.push({
          label: both ? 'Design average grade over the interval' : 'Average grade over the interval',
          swatch: line(both ? DESIGN_TEXT : INTERVAL_LINE, 1.3, '6 3'),
        })
      if (options.intervalStyle === 'line' && both)
        legend.push({ label: 'Ground average grade over the interval', swatch: line(GROUND_TEXT, 1.3, '6 3') })
    }
    if (prepared.some((z) => z !== null)) legend.push({ label: 'Prepared ground', swatch: line('#d97706', 1.4, '4 3') })
    panelsSvg.push(
      title(profile, `Profile · vertical exaggeration ${exaggeration.toFixed(1)}×`) +
        valueGrid(profile, zAxis, sy, '') +
        stationGrid(profile, labelled('profile')) +
        frame(profile) +
        `<path d="${path(
          stations.map((s) => s.groundElevation),
          sy,
        )}" fill="none" stroke="#a07845" stroke-width="1.6" data-role="ground"/>` +
        (prepared.some((z) => z !== null)
          ? `<path d="${path(prepared, sy)}" fill="none" stroke="#d97706" stroke-dasharray="4 3" stroke-width="1.4" data-role="prepared-ground"/>`
          : '') +
        `<path d="${path(
          stations.map((s) => s.designElevation),
          sy,
        )}" fill="none" stroke="#0d9488" stroke-width="2.2" data-role="design"/>` +
        (profileLabels
          ? sheetProfileLabelsSvg({ analysis, alignment, start, end, sx, sy, top: profile.top, limits })
          : '') +
        (onProfile && interval
          ? profileIntervalsSvg({
              box: profile,
              columns: intervalStats(stations, start, end, interval, limits?.rule),
              style: options.intervalStyle as Exclude<ChartsOptions['intervalStyle'], 'band' | undefined>,
              both: options.intervalLines === 'both',
              sx,
              sy,
            })
          : '') +
        yTitle(profile, 'Elevation (m)') +
        (labelled('profile') ? xTitle(profile) : ''),
    )
  }

  // 2. Grade: design grade per station, the ground's grade for comparison, and the project's limits.
  const rule = limits?.rule
  const grade = boxes.grade
  if (grade) {
    const designGrades = stations.map((s) =>
      s.gradePercent !== null && Number.isFinite(s.gradePercent) ? s.gradePercent : null,
    )
    const groundGrades = stations.map((s, i) => {
      if (s.groundGradePercent !== null && Number.isFinite(s.groundGradePercent)) return s.groundGradePercent
      const prev = stations[i - 1]
      if (!prev || s.groundElevation === null || prev.groundElevation === null) return null
      const run = s.chainage - prev.chainage
      return run > 0.5 ? (100 * (s.groundElevation - prev.groundElevation)) / run : null
    })
    const limitLines: { value: number; label: string; dash: string; color: string }[] = []
    if (rule) {
      const same = Math.abs(rule.favourablePercent - rule.adversePercent) < 1e-9
      if (same)
        for (const sign of [1, -1])
          limitLines.push({
            value: sign * rule.favourablePercent,
            label: `limit ${fmt(rule.favourablePercent, 1)}%`,
            dash: '6 4',
            color: '#b91c1c',
          })
      else
        for (const sign of [1, -1]) {
          const side = gradeSide(rule, sign)
          limitLines.push({
            value: sign * sustainedLimit(rule, sign),
            label: `${side} ${fmt(sustainedLimit(rule, sign), 1)}%`,
            dash: side === 'adverse' ? '2 3' : '6 4',
            color: '#b91c1c',
          })
        }
      if (rule.shortPitch)
        for (const sign of [1, -1])
          limitLines.push({
            value: sign * rule.shortPitch.gradePercent,
            label: `short pitch ${fmt(rule.shortPitch.gradePercent, 1)}% ≤ ${fmt(rule.shortPitch.maxLengthM)} m`,
            dash: '1 3',
            color: '#9a3412',
          })
    }
    const values = [...designGrades, ...groundGrades, ...limitLines.map((l) => l.value)].filter(
      (v): v is number => v !== null && Number.isFinite(v),
    )
    const fitted = gradeAxis(values, options.gradeRangePercent)
    // A fixed range keeps its own ends; a fitted one ends on its outer ticks.
    const snapped = valueAxis(fitted.low, fitted.high, grade.height)
    const gAxis =
      options.gradeRangePercent === null
        ? snapped
        : {
            ...snapped,
            low: fitted.low,
            high: fitted.high,
            ticks: snapped.ticks.filter((v) => v >= fitted.low - 1e-9 && v <= fitted.high + 1e-9),
          }
    const gLow = gAxis.low,
      gHigh = gAxis.high
    const clipped = values.some((v) => v > gHigh || v < gLow)
    const gy = (g: number) =>
      grade.top +
      grade.height -
      ((Math.max(gLow, Math.min(gHigh, g)) - gLow) / Math.max(1, gHigh - gLow)) * grade.height
    const over = (g: number | null) => (g !== null && rule ? overSustained(rule, g) : false)
    const overMarks = stations
      .map((s, i) =>
        over(designGrades[i]) && i > 0
          ? `<rect x="${sx(stations[i - 1].chainage).toFixed(1)}" y="${grade.top}" width="${Math.max(1, sx(s.chainage) - sx(stations[i - 1].chainage)).toFixed(1)}" height="${grade.height}" fill="#dc2626" fill-opacity="0.12" data-role="over-limit"/>`
          : '',
      )
      .join('')
    if (!profile)
      legend.push({ label: 'Ground', swatch: line('#a07845', 1) }, { label: 'Design', swatch: line('#0d9488', 1.8) })
    if (limitLines.some((l) => l.dash !== '1 3'))
      legend.push({ label: 'Sustained grade limit', swatch: line('#b91c1c', 1, '6 4') })
    if (rule?.shortPitch) legend.push({ label: 'Short-pitch limit', swatch: line('#9a3412', 1, '1 3') })
    if (overMarks) legend.push({ label: 'Design over the sustained limit', swatch: shade('#dc2626', 0.12) })
    panelsSvg.push(
      title(
        grade,
        `Grade · positive climbs up-station${clipped ? ` · grades past ${fmt(gLow)}% to ${fmt(gHigh)}% drawn at the edge` : ''}`,
      ) +
        overMarks +
        valueGrid(grade, gAxis, gy, '%') +
        stationGrid(grade, labelled('grade')) +
        `<line x1="${grade.left}" x2="${grade.left + grade.width}" y1="${gy(0).toFixed(1)}" y2="${gy(0).toFixed(1)}" stroke="#6b7280"/>` +
        limitLines
          .map(
            (l) =>
              `<line x1="${grade.left}" x2="${grade.left + grade.width}" y1="${gy(l.value).toFixed(1)}" y2="${gy(l.value).toFixed(1)}" stroke="${l.color}" stroke-dasharray="${l.dash}" data-role="grade-limit"/><text x="${grade.left + grade.width - 4}" y="${(gy(l.value) - 3).toFixed(1)}" font-size="9.5" text-anchor="end" fill="${l.color}">${l.value > 0 ? '+' : '−'}${l.label}</text>`,
          )
          .join('') +
        frame(grade) +
        `<path d="${path(groundGrades, gy)}" fill="none" stroke="#a07845" stroke-width="0.8" opacity="0.8" data-role="ground-grade"/>` +
        `<path d="${path(designGrades, gy)}" fill="none" stroke="#0d9488" stroke-width="1.8" data-role="design-grade"/>` +
        yTitle(grade, 'Grade (%)') +
        (labelled('grade') ? xTitle(grade) : ''),
    )
  }

  // 3. Mass haul.
  const mass = boxes.mass
  if (mass) {
    const masses = stations.map((s) => s.massM3)
    const known = masses.filter((v): v is number => v !== null && Number.isFinite(v))
    const mAxis = valueAxis(Math.min(0, ...known), Math.max(0, ...known), mass.height)
    const my = (m: number) =>
      mass.top + mass.height - ((m - mAxis.low) / Math.max(1, mAxis.high - mAxis.low)) * mass.height
    const unknown = unknownEarthworkSpans(stations)
    legend.push({ label: 'Mass haul ordinate', swatch: line('#7c3aed', 1.8) })
    if (unknown.length)
      legend.push({ label: 'Earthwork unknown, balance carried across', swatch: shade('#b45309', 0.2) })
    panelsSvg.push(
      title(mass, 'Mass haul · above zero: usable cut ahead of fill') +
        unknown
          .map(
            (span) =>
              `<rect x="${sx(span.start).toFixed(1)}" y="${mass.top}" width="${Math.max(1.5, sx(span.end) - sx(span.start)).toFixed(1)}" height="${mass.height}" fill="#b45309" fill-opacity="0.2" data-role="unknown-earthwork"/>`,
          )
          .join('') +
        valueGrid(mass, mAxis, my, '') +
        stationGrid(mass, labelled('mass')) +
        `<line x1="${mass.left}" x2="${mass.left + mass.width}" y1="${my(0).toFixed(1)}" y2="${my(0).toFixed(1)}" stroke="#6b7280"/>` +
        frame(mass) +
        `<path d="${path(masses, my)}" fill="none" stroke="#7c3aed" stroke-width="1.8" data-role="mass"/>` +
        yTitle(mass, 'Mass (m³)') +
        (labelled('mass') ? xTitle(mass) : ''),
    )
  }

  // The interval band: one column per interval, under the lowest chart, then the station labels.
  if (band && interval) {
    const above = boxes[lowest]!
    const band: Box = {
      left: above.left,
      width: above.width,
      top: above.top + above.height + BAND_GAP,
      height: bandHeight,
    }
    const columns = intervalStats(stations, start, end, interval, rule)
    const pct = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${fmt(v, 1).replace('-', '−')}%`)
    const num = (v: number | null, signed = false) =>
      v === null ? '—' : `${signed && v > 0 ? '+' : ''}${fmt(v, Math.abs(v) < 100 && signed ? 1 : 0).replace('-', '−')}`
    const cells = (c: IntervalStats): [string, boolean][] => [
      [`${formatRoadStation(c.from).replace(/\.0$/, '')}`, false],
      [pct(c.averageGradePercent), false],
      [pct(c.steepestGradePercent), c.overLimit],
      [num(c.riseM, true), false],
      [pct(c.groundGradePercent), false],
      [num(c.cutM3), false],
      [num(c.fillM3), false],
    ]
    const narrowest = Math.min(...columns.map((c) => sx(c.to) - sx(c.from)))
    const size = Math.max(6.5, Math.min(10, narrowest / 5.4))
    panelsSvg.push(
      `<g data-role="interval-band">` +
        `<rect x="${band.left}" y="${band.top}" width="${band.width}" height="${BAND_ROW}" fill="#eef2f5"/>` +
        BAND_ROWS.map(
          (label, r) =>
            `<text x="${band.left - 6}" y="${band.top + r * BAND_ROW + 10}" font-size="9.5" text-anchor="end" fill="#374151">${r === 0 ? `Every ${fmt(interval)} m` : label}</text>` +
            (r > 0
              ? `<line x1="${band.left}" x2="${band.left + band.width}" y1="${band.top + r * BAND_ROW}" y2="${band.top + r * BAND_ROW}" stroke="#e5e7eb"/>`
              : ''),
        ).join('') +
        columns
          .map((c) => {
            const x0 = sx(c.from),
              x1 = sx(c.to),
              mid = (x0 + x1) / 2
            return (
              `<line x1="${x1.toFixed(1)}" x2="${x1.toFixed(1)}" y1="${band.top}" y2="${band.top + band.height}" stroke="#d1d5db"/>` +
              cells(c)
                .map(
                  ([value, alert], r) =>
                    `<text x="${mid.toFixed(1)}" y="${(band.top + r * BAND_ROW + 10).toFixed(1)}" font-size="${size.toFixed(1)}" text-anchor="middle"${r === 0 ? ' font-weight="600"' : ''} fill="${alert ? '#b91c1c' : '#111827'}">${value}</text>`,
                )
                .join('')
            )
          })
          .join('') +
        frame(band) +
        stationGrid(band, true).replace(/<line[^>]*\/>/g, '') +
        xTitle(band) +
        '</g>',
    )
  }

  return panelsSvg.join('') + (strip ? stripSvg(strip, options, legend, chartStats(stations, rule)) : '')
}

/** The legend and the statistics, side by side in the strip left of the title block. */
function stripSvg(
  strip: Box,
  options: ChartsOptions,
  legend: { label: string; swatch: string }[],
  stats: ChartStats,
): string {
  const parts: string[] = []
  const legendWidth = options.legend && options.stats ? Math.min(330, strip.width * 0.4) : strip.width
  if (options.legend && legend.length) {
    const columns = legendWidth > 500 ? 2 : 1
    const rowsPer = Math.ceil(legend.length / columns)
    const pitch = Math.min(15, (strip.height - 20) / Math.max(1, rowsPer))
    parts.push(
      `<g data-role="chart-legend"><text x="${strip.left}" y="${strip.top + 11}" font-size="11" font-weight="600">Legend</text>` +
        legend
          .map((item, i) => {
            const x = strip.left + Math.floor(i / rowsPer) * (legendWidth / columns),
              y = strip.top + 26 + (i % rowsPer) * pitch
            return `<g transform="translate(${x.toFixed(1)} ${(y - 3.5).toFixed(1)})">${item.swatch}</g><text x="${(x + 30).toFixed(1)}" y="${y.toFixed(1)}" font-size="10">${item.label}</text>`
          })
          .join('') +
        '</g>',
    )
  }
  if (options.stats) {
    const left = options.legend && legend.length ? strip.left + legendWidth + 16 : strip.left
    const width = strip.left + strip.width - left
    const pct = (v: number | null, signed = false) =>
      v === null ? '—' : `${signed && v > 0 ? '+' : ''}${fmt(v, 1).replace('-', '−')}%`
    const m = (v: number | null) => (v === null ? '—' : `${fmt(v)} m`)
    const rows: [string, string][] = [
      ['Length', m(stats.lengthM)],
      [
        'Design elevation',
        stats.startElevation === null || stats.endElevation === null
          ? '—'
          : `${fmt(stats.startElevation)} → ${fmt(stats.endElevation)} m`,
      ],
      ['Climb / descent', `${fmt(stats.climbM)} m / ${fmt(stats.descentM)} m`],
      ['Average grade (net)', pct(stats.averageGradePercent, true)],
      ['Average grade (either way)', pct(stats.meanAbsoluteGradePercent)],
      [
        'Steepest climb / descent',
        `${pct(stats.steepestClimbPercent, true)} / ${pct(stats.steepestDescentPercent, true)}`,
      ],
      [
        'Over the sustained limit',
        stats.overLimitM === null
          ? 'no limit set'
          : `${fmt(stats.overLimitM)} m (${fmt(stats.lengthM ? (100 * stats.overLimitM) / stats.lengthM : 0)}%)`,
      ],
      [
        stats.earthworkKnownShare < 0.999 ? 'Cut / fill (known part)' : 'Cut / fill',
        `${fmt(stats.cutM3)} / ${fmt(stats.fillM3)} m³`,
      ],
      ['Earthwork known', `${fmt(100 * stats.earthworkKnownShare, 1)}% of the length`],
    ]
    const columns = width > 520 ? 2 : 1
    const rowsPer = Math.ceil(rows.length / columns)
    const pitch = Math.min(15, (strip.height - 20) / rowsPer)
    const colWidth = width / columns
    parts.push(
      `<g data-role="chart-stats"><text x="${left}" y="${strip.top + 11}" font-size="11" font-weight="600">This sheet</text>` +
        rows
          .map(([label, value], i) => {
            const x = left + Math.floor(i / rowsPer) * colWidth,
              y = strip.top + 26 + (i % rowsPer) * pitch
            return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="10" fill="#4b5563">${label}</text><text x="${(x + colWidth - 12).toFixed(1)}" y="${y.toFixed(1)}" font-size="10" text-anchor="end">${value}</text>`
          })
          .join('') +
        '</g>',
    )
  }
  return parts.join('')
}

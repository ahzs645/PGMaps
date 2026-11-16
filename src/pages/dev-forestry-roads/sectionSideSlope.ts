/**
 * The ground's side slope at a station, read from its sampled cross-section: one least-squares line
 * each side of the centreline and one across both. RoadEng's section window reports the same idea as
 * Ssl/Ssr (ground side slope left and right); the BC Interior Appraisal Manual's road cost asks for
 * the representative uphill side slope. Each side is fitted from the centreline outward over
 * `SIDE_SLOPE_REACH_M` and stops at the first terrain gap, so a slope never implies ground the
 * section does not have. A fit shorter than `SIDE_SLOPE_MIN_SPAN_M` is not reported.
 *
 * Signs: a side's `percent` is the rise going outward from the centreline, so positive is the
 * uphill side and negative the downhill side. `across.percent` rises toward the road's right
 * (looking up-station). No DOM.
 */
import { INTERIOR_SIDESLOPE_LIMIT_PERCENT } from './bcInteriorCost'
import { FULL_BENCH_SIDESLOPE_PERCENT } from './sectionFixes'
import type { SectionSample } from './types'

/** How far out from the centreline each side's ground is fitted, m. */
export const SIDE_SLOPE_REACH_M = 15
/** The shortest span of known ground a side slope is reported from, m. */
export const SIDE_SLOPE_MIN_SPAN_M = 5

export interface SideSlopeLine {
  /** Fitted rise per 100 m of horizontal distance, in the direction stated by the caller. */
  percent: number
  /** Signed offsets of the fitted line's ends (left negative), and its elevation there. */
  from: { offset: number; z: number }
  to: { offset: number; z: number }
  /** Horizontal span of the known ground the line was fitted to, m. */
  spanM: number
}

export interface SectionSideSlopes {
  left: SideSlopeLine | null
  right: SideSlopeLine | null
  /** Both sides together: positive rises toward the right. */
  across: (SideSlopeLine & { uphill: 'left' | 'right' | null }) | null
}

const known = (p: SectionSample): p is SectionSample & { ground: number } =>
  p.ground !== null && Number.isFinite(p.ground)

/** The known samples from the centreline outward on one side, up to the reach or the first gap. */
function sideRun(section: readonly SectionSample[], side: 'left' | 'right', reachM: number) {
  const out = (p: SectionSample) => (side === 'left' ? -p.offset : p.offset)
  const ordered = section
    .filter((p) => Number.isFinite(p.offset) && out(p) >= -1e-9 && out(p) <= reachM + 1e-9)
    .sort((a, b) => out(a) - out(b))
  const run: Array<SectionSample & { ground: number }> = []
  for (const p of ordered) {
    if (!known(p)) break
    run.push(p)
  }
  return run
}

/** Least squares of z on x; null when fewer than two points or no horizontal spread. */
function fit(points: ReadonlyArray<{ x: number; z: number }>) {
  if (points.length < 2) return null
  const mx = points.reduce((s, p) => s + p.x, 0) / points.length,
    mz = points.reduce((s, p) => s + p.z, 0) / points.length
  const sxx = points.reduce((s, p) => s + (p.x - mx) ** 2, 0)
  if (sxx <= 1e-12) return null
  const slope = points.reduce((s, p) => s + (p.x - mx) * (p.z - mz), 0) / sxx
  return { slope, at: (x: number) => mz + slope * (x - mx) }
}

function sideLine(section: readonly SectionSample[], side: 'left' | 'right', reachM: number): SideSlopeLine | null {
  const run = sideRun(section, side, reachM)
  if (run.length < 2) return null
  const sign = side === 'left' ? -1 : 1
  const line = fit(run.map((p) => ({ x: sign * p.offset, z: p.ground })))
  if (!line) return null
  const inner = Math.abs(run[0].offset),
    outer = Math.abs(run[run.length - 1].offset)
  if (outer - inner < SIDE_SLOPE_MIN_SPAN_M) return null
  return {
    percent: line.slope * 100,
    from: { offset: sign * inner, z: line.at(inner) },
    to: { offset: sign * outer, z: line.at(outer) },
    spanM: outer - inner,
  }
}

/** The side slopes of one station's ground section. */
export function sectionSideSlopes(
  section: readonly SectionSample[],
  reachM: number = SIDE_SLOPE_REACH_M,
): SectionSideSlopes {
  const left = sideLine(section, 'left', reachM)
  const right = sideLine(section, 'right', reachM)
  // Across: both sides' runs joined at the centreline, so neither side's gap is bridged.
  const runs = [...sideRun(section, 'left', reachM), ...sideRun(section, 'right', reachM)]
  const unique = [...new Map(runs.map((p) => [p.offset, p])).values()].sort((a, b) => a.offset - b.offset)
  const line = fit(unique.map((p) => ({ x: p.offset, z: p.ground })))
  let across: SectionSideSlopes['across'] = null
  if (line && unique.length >= 2) {
    const a = unique[0].offset,
      b = unique[unique.length - 1].offset
    // Both sides are needed for a slope across the road; one side alone is that side's slope.
    if (a < 0 && b > 0 && b - a >= SIDE_SLOPE_MIN_SPAN_M) {
      const percent = line.slope * 100
      across = {
        percent,
        from: { offset: a, z: line.at(a) },
        to: { offset: b, z: line.at(b) },
        spanM: b - a,
        uphill: Math.abs(percent) < 0.5 ? null : percent > 0 ? 'right' : 'left',
      }
    }
  }
  return { left, right, across }
}

/** Where a side slope's label is drawn on the section chart: its centre and turn, in screen pixels. */
export interface SideSlopeLabelPlacement {
  x: number
  y: number
  /** Degrees clockwise, kept upright (−90° to 90°). */
  angle: number
}

/** Places along the drawn line a label tries, nearest the outer end first. */
const LABEL_PLACES = [0.7, 0.6, 0.8, 0.5, 0.4, 0.9, 0.3, 0.2]

/**
 * A side slope's label on the section chart, read along its drawn line (`x1,y1` at the centreline
 * end, `x2,y2` at the outer end) and kept inside the plot. It sits `gap` px above the line where it
 * fits there, else below it, sliding toward the centreline; where no place along the line fits (a
 * steep side slope runs its line into the plot's top or bottom corner), it is pushed back inside the
 * plot. A label clipped by the plot's edge reads as a side slope with no value.
 */
export function sideSlopeLabelPlacement(
  line: { x1: number; y1: number; x2: number; y2: number },
  label: { width: number; height: number; gap: number },
  plot: { left: number; top: number; right: number; bottom: number },
): SideSlopeLabelPlacement {
  const raw = Math.atan2(line.y2 - line.y1, line.x2 - line.x1)
  // Upright: a line drawn right to left reads left to right.
  const theta = raw > Math.PI / 2 ? raw - Math.PI : raw < -Math.PI / 2 ? raw + Math.PI : raw
  const ux = Math.cos(theta),
    uy = Math.sin(theta)
  // The label's up direction, perpendicular to the line.
  const nx = uy,
    ny = -ux
  const halfW = label.width / 2,
    halfH = label.height / 2
  // The box's half extent on screen once turned.
  const extentX = Math.abs(ux) * halfW + Math.abs(nx) * halfH
  const extentY = Math.abs(uy) * halfW + Math.abs(ny) * halfH
  const fits = (x: number, y: number) =>
    x - extentX >= plot.left && x + extentX <= plot.right && y - extentY >= plot.top && y + extentY <= plot.bottom
  const at = (t: number, side: 1 | -1) => {
    const d = side * (label.gap + halfH)
    return {
      x: line.x1 + (line.x2 - line.x1) * t + nx * d,
      y: line.y1 + (line.y2 - line.y1) * t + ny * d,
    }
  }
  const angle = (theta * 180) / Math.PI
  for (const t of LABEL_PLACES)
    for (const side of [1, -1] as const) {
      const p = at(t, side)
      if (fits(p.x, p.y)) return { ...p, angle }
    }
  // Nowhere along the line fits: the first place, moved just inside the plot.
  const p = at(LABEL_PLACES[0], 1)
  const clamp = (v: number, low: number, high: number) =>
    low > high ? (low + high) / 2 : Math.min(high, Math.max(low, v))
  return {
    x: clamp(p.x, plot.left + extentX, plot.right - extentX),
    y: clamp(p.y, plot.top + extentY, plot.bottom - extentY),
    angle,
  }
}

export type SideSlopeCheck =
  /** The ground falls away at least as steeply as the fill batter: a fill there never catches. */
  | 'fill-never-catches'
  /** The ground rises at least as steeply as the cut batter: a cut there never catches. */
  | 'cut-never-catches'
  /** The ground falls away at or past the full-bench screen. */
  | 'full-bench-screen'

/**
 * What a side's ground slope says against that side's template batters (H:V) and the full-bench
 * screen, most serious first. A batter of zero or less is not compared. Materials and components can
 * change a section's actual batters, so these are screens on the template, not the section's result.
 */
export function sideSlopeChecks(
  percent: number,
  batters: { cutHV: number; fillHV: number },
  fullBenchPercent: number,
): SideSlopeCheck[] {
  const checks: SideSlopeCheck[] = []
  const falling = -percent
  if (batters.fillHV > 0 && falling >= 100 / batters.fillHV) checks.push('fill-never-catches')
  if (batters.cutHV > 0 && percent >= 100 / batters.cutHV) checks.push('cut-never-catches')
  if (falling >= fullBenchPercent) checks.push('full-bench-screen')
  return checks
}

/**
 * Display classes for the profile's sidehill band, steepest last. 20 % and 40 % are display steps
 * only; 50 % is where the BC Interior appraisal equation stops applying
 * (`INTERIOR_SIDESLOPE_LIMIT_PERCENT`) and 60 % is the full-bench screen
 * (`FULL_BENCH_SIDESLOPE_PERCENT`).
 */
export const SIDEHILL_CLASSES = [
  { id: 'gentle', minPercent: 0, label: 'under 20%' },
  { id: 'moderate', minPercent: 20, label: '20–40%' },
  { id: 'steep', minPercent: 40, label: `40–${INTERIOR_SIDESLOPE_LIMIT_PERCENT}%` },
  {
    id: 'past-appraisal',
    minPercent: INTERIOR_SIDESLOPE_LIMIT_PERCENT,
    label: `${INTERIOR_SIDESLOPE_LIMIT_PERCENT}–${FULL_BENCH_SIDESLOPE_PERCENT}%: past the Interior appraisal equation`,
  },
  {
    id: 'full-bench',
    minPercent: FULL_BENCH_SIDESLOPE_PERCENT,
    label: `${FULL_BENCH_SIDESLOPE_PERCENT}% and over: full-bench screen`,
  },
] as const
export type SidehillClass = (typeof SIDEHILL_CLASSES)[number]['id']

export function sidehillClass(percent: number): SidehillClass {
  let found: SidehillClass = 'gentle'
  for (const c of SIDEHILL_CLASSES) if (percent >= c.minPercent) found = c.id
  return found
}

/** One station's sidehill: the across-the-road slope's magnitude and its uphill side. */
export interface StationSidehill {
  chainage: number
  /** Null where the section has too little known ground on one side or the other. */
  percent: number | null
  uphill: 'left' | 'right' | null
}

/** Each station's sidehill, in station order. */
export function roadSidehill(
  stations: ReadonlyArray<{ chainage: number; section: readonly SectionSample[] }>,
): StationSidehill[] {
  return stations.map((s) => {
    const across = sectionSideSlopes(s.section).across
    return {
      chainage: s.chainage,
      percent: across ? Math.abs(across.percent) : null,
      uphill: across?.uphill ?? null,
    }
  })
}

/**
 * The stretch of road each station stands for inside `from`–`to`: half-way to its neighbours, so a
 * curve's extra event stations do not count for more road than they are.
 */
function stationReaches(rows: readonly StationSidehill[], from: number, to: number) {
  return rows.flatMap((row, i) => {
    const start = Math.max(from, i > 0 ? (rows[i - 1].chainage + row.chainage) / 2 : row.chainage)
    const end = Math.min(to, i < rows.length - 1 ? (row.chainage + rows[i + 1].chainage) / 2 : row.chainage)
    const inside = row.chainage >= from - 1e-9 && row.chainage <= to + 1e-9
    return end > start + 1e-9 || inside ? [{ row, start, end: Math.max(start, end) }] : []
  })
}

/** A run of road in one sidehill class (null where unknown), for the profile band. */
export interface SidehillSpan {
  start: number
  end: number
  sidehillClass: SidehillClass | null
}

/** The sidehill band over `start`–`end`: consecutive stations of one class joined into one span. */
export function sidehillSpans(rows: readonly StationSidehill[], start: number, end: number): SidehillSpan[] {
  const spans: SidehillSpan[] = []
  for (const { row, start: a, end: b } of stationReaches(rows, start, end)) {
    const cls = row.percent === null ? null : sidehillClass(row.percent)
    const last = spans[spans.length - 1]
    if (last && last.sidehillClass === cls && Math.abs(last.end - a) < 1e-6) last.end = b
    else spans.push({ start: a, end: b, sidehillClass: cls })
  }
  return spans
}

export interface SidehillSummary {
  from: number
  to: number
  /** Length-weighted median of the known stations' sidehill, %. */
  medianPercent: number
  /** The road length the known stations stand for, and the whole range's. */
  knownLengthM: number
  lengthM: number
  stations: number
  knownStations: number
  /** The steepest known station's sidehill, %. */
  maxPercent: number
  /** Shares of the known length past the appraisal equation and at the full-bench screen or steeper. */
  pastAppraisalShare: number
  fullBenchShare: number
}

/** The known stations in `from`–`to`, each weighted by the road length it stands for. */
function knownReaches(rows: readonly StationSidehill[], from: number, to: number) {
  const reaches = stationReaches(rows, Math.min(from, to), Math.max(from, to))
  const known = reaches
    .filter((r): r is typeof r & { row: { percent: number } } => r.row.percent !== null)
    .map((r) => ({ percent: r.row.percent, weight: Math.max(r.end - r.start, 1e-9) }))
  return { reaches, known, knownLengthM: known.reduce((s, k) => s + k.weight, 0) }
}

/**
 * The share of the known length in `from`–`to` whose sidehill is at least `minPercent`, for a
 * screen with its own limit (the Coast manual's 150 % side slope). Null where nothing is known.
 */
export function sidehillShareAtLeast(
  rows: readonly StationSidehill[],
  from: number,
  to: number,
  minPercent: number,
): number | null {
  const { known, knownLengthM } = knownReaches(rows, from, to)
  if (!known.length) return null
  return known.filter((k) => k.percent >= minPercent).reduce((s, k) => s + k.weight, 0) / knownLengthM
}

/**
 * The road's sidehill over `from`–`to`, as a suggestion for an appraisal's representative side
 * slope: the length-weighted median, so a few steep stations or event stations do not move it. Null
 * where no station in the range has a known sidehill.
 */
export function sidehillSummary(rows: readonly StationSidehill[], from: number, to: number): SidehillSummary | null {
  const { reaches, known, knownLengthM } = knownReaches(rows, from, to)
  if (!known.length) return null
  const sorted = [...known].sort((a, b) => a.percent - b.percent)
  let running = 0,
    medianPercent = sorted[sorted.length - 1].percent
  for (const k of sorted) {
    running += k.weight
    if (running >= knownLengthM / 2 - 1e-9) {
      medianPercent = k.percent
      break
    }
  }
  const share = (min: number) => known.filter((k) => k.percent >= min).reduce((s, k) => s + k.weight, 0) / knownLengthM
  return {
    from: Math.min(from, to),
    to: Math.max(from, to),
    medianPercent,
    maxPercent: sorted[sorted.length - 1].percent,
    knownLengthM,
    lengthM: reaches.reduce((s, r) => s + (r.end - r.start), 0),
    stations: reaches.length,
    knownStations: known.length,
    pastAppraisalShare: share(INTERIOR_SIDESLOPE_LIMIT_PERCENT),
    fullBenchShare: share(FULL_BENCH_SIDESLOPE_PERCENT),
  }
}

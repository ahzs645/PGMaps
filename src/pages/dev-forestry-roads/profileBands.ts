/**
 * Numeric bands under a road profile, as on a printed plan-and-profile sheet: ground and design
 * elevation, centreline cut or fill depth, design grade, crossfall each side, and a horizontal
 * curvature diagram. Values come from the calculated stations only, never interpolated between them;
 * where terrain is missing a ground-dependent value is unknown, not zero. Pure, with no DOM access:
 * the screen bands (`ProfileValueBands.tsx`) and the plot book (`plotBookProfile.ts`) both read it.
 */
import { niceStep } from './chartScale'
import { curveDesignAt, horizontalCurveSummary } from './engine'
import { sectionCrossfall, templateAt } from './templates'
import {
  SIDE_SLOPE_REACH_M,
  sidehillClass,
  sidehillSpans,
  type SidehillSpan,
  type StationSidehill,
} from './sectionSideSlope'
import type { Alignment, RoadAnalysis, RoadStation } from './types'

const EPS = 1e-6
const finite = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/** Screen or paper pixels between band values, so a "1234.56" never runs into its neighbour. */
export const BAND_VALUE_MIN_GAP_PX = 46
/** The most values one band shows across a window, however wide. */
export const MAX_BAND_VALUES = 400

/**
 * Where a band value's text anchors so it stays inside the plot, between `plotLeft` and `plotRight`.
 * A value at a station on the plot's left edge starts there rather than centring over the row title
 * in the margin ("Ground749.92" on a sheet); one on the right edge ends there. `textWidth` is an
 * estimate (`bandTextWidth`), so the gap between values (`BAND_VALUE_MIN_GAP_PX`) absorbs the error.
 */
export function bandValueAnchor(
  x: number,
  textWidth: number,
  plotLeft: number,
  plotRight: number,
): { x: number; anchor: 'start' | 'middle' | 'end' } {
  const half = textWidth / 2
  if (x - half < plotLeft + 1) return { x: Math.max(x - half, plotLeft + 2), anchor: 'start' }
  if (x + half > plotRight - 1) return { x: Math.min(x + half, plotRight - 2), anchor: 'end' }
  return { x, anchor: 'middle' }
}

/** A generous width for band text: digits and signs run about 0.6 em in the UI and print fonts. */
export const bandTextWidth = (text: string, fontSize: number) => text.length * fontSize * 0.6

export type ValueBandKey =
  | 'ground'
  | 'design'
  | 'depth'
  | 'grade'
  | 'crossfallLeft'
  | 'crossfallRight'
  | 'stakeLeft'
  | 'stakeRight'
  | 'clearing'
  | 'sidehill'

export interface BandValue {
  chainage: number
  /** Null where the value is unknown (terrain missing) or does not apply. */
  value: number | null
  /** What prints: "—" for unknown. */
  text: string
  /** `appraisal` and `bench` mark a sidehill past the appraisal equation and at the full-bench screen. */
  tone?: 'cut' | 'fill' | 'unknown' | 'super' | 'appraisal' | 'bench'
}
export interface ValueBandRow {
  key: ValueBandKey
  title: string
  /** One line for a tooltip: what the row is and its sign convention. */
  detail: string
  values: BandValue[]
}
/** A vertex of the curvature diagram: signed 1/R in 1/km, right turns positive. */
export interface CurvatureVertex {
  chainage: number
  perKm: number
}
export interface CurvatureLabel {
  start: number
  end: number
  /** Centre of the circular arc, where the label sits. */
  chainage: number
  direction: 'left' | 'right'
  radiusM: number
  text: string
}
export interface ProfileValueBands {
  stations: RoadStation[]
  rows: ValueBandRow[]
  /** Piecewise-linear 1/R over the window: zero on tangents, ramping over spirals, level on arcs. */
  curvature: CurvatureVertex[]
  curvatureLabels: CurvatureLabel[]
  /** Largest |1/R| in the window, for scaling the diagram; 0 on a straight window. */
  maxCurvaturePerKm: number
  /** The sidehill row's colour runs over every station in the window; empty without `sidehill`. */
  sidehillSpans: SidehillSpan[]
}

/**
 * The calculated stations a band labels between `start` and `end`, at least `minSpacingM` apart.
 * Stations on a round multiple of the spacing (a "nice" 1–2–2.5–5 step) are taken when there are
 * any; otherwise every station far enough from the last one kept. No station is invented.
 */
export function bandStations(
  stations: readonly RoadStation[],
  start: number,
  end: number,
  minSpacingM: number,
): RoadStation[] {
  const inWindow = stations.filter((s) => s.chainage >= start - EPS && s.chainage <= end + EPS)
  if (!inWindow.length) return []
  const spacing = Math.max(minSpacingM, (end - start) / MAX_BAND_VALUES, EPS)
  const step = niceStep(spacing, 1)
  const round = inWindow.filter((s) => Math.abs(s.chainage / step - Math.round(s.chainage / step)) < 1e-6)
  if (round.length >= 2 && round.length >= Math.min(inWindow.length, (end - start) / step) * 0.5) return round
  const kept: RoadStation[] = []
  for (const s of inWindow)
    if (!kept.length || s.chainage - kept[kept.length - 1].chainage >= spacing - EPS) kept.push(s)
  return kept
}

const signed = (value: number, digits: number) =>
  `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(digits)}`
const unknown = (chainage: number): BandValue => ({ chainage, value: null, text: '—', tone: 'unknown' })

/** The curvature diagram's vertices and labels over the window, from the fitted horizontal curves. */
function curvatureOf(alignment: Alignment, start: number, end: number) {
  let curves: ReturnType<typeof horizontalCurveSummary>
  try {
    curves = horizontalCurveSummary(alignment)
  } catch {
    return { vertices: [] as CurvatureVertex[], labels: [] as CurvatureLabel[] }
  }
  const vertices: CurvatureVertex[] = [{ chainage: start, perKm: 0 }]
  const labels: CurvatureLabel[] = []
  for (const curve of curves) {
    if (curve.fullEnd < start - EPS || curve.fullStart > end + EPS) continue
    const k = (curve.direction === 'right' ? 1 : -1) * (1000 / curve.radius)
    vertices.push(
      { chainage: curve.fullStart, perKm: 0 },
      { chainage: curve.start, perKm: k },
      { chainage: curve.end, perKm: k },
      { chainage: curve.fullEnd, perKm: 0 },
    )
    labels.push({
      start: curve.fullStart,
      end: curve.fullEnd,
      chainage: (curve.start + curve.end) / 2,
      direction: curve.direction,
      radiusM: curve.radius,
      text: `R ${Math.round(curve.radius)} ${curve.direction === 'left' ? 'L' : 'R'}`,
    })
  }
  vertices.push({ chainage: end, perKm: 0 })
  // Clip to the window, interpolating where a ramp crosses its edge.
  const sorted = vertices.sort((a, b) => a.chainage - b.chainage)
  const at = (chainage: number) => {
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1],
        b = sorted[i]
      if (chainage >= a.chainage - EPS && chainage <= b.chainage + EPS)
        return b.chainage - a.chainage < EPS
          ? b.perKm
          : a.perKm + ((b.perKm - a.perKm) * (chainage - a.chainage)) / (b.chainage - a.chainage)
    }
    return 0
  }
  const clipped = [
    { chainage: start, perKm: at(start) },
    ...sorted.filter((v) => v.chainage > start + EPS && v.chainage < end - EPS),
    { chainage: end, perKm: at(end) },
  ]
  return { vertices: clipped, labels }
}

/**
 * The bands over `start`–`end`, labelled at `bandStations(…, minSpacingM)`. A terrain-only profile
 * has ground and ground grade only. Crossfall is the section's own (`sectionCrossfall`), superelevation
 * included, positive where the edge falls away from the centreline; it is a design value, so it is
 * known wherever the road is.
 */
export function profileValueBands(
  analysis: Pick<RoadAnalysis, 'stations' | 'length'>,
  alignment: Alignment,
  {
    start,
    end,
    minSpacingM,
    terrainOnly = false,
    sidehill,
    stakes = false,
  }: {
    start: number
    end: number
    minSpacingM: number
    terrainOnly?: boolean
    /**
     * Every station's sidehill (`roadSidehill`), in station order. Given, the bands end with a
     * Sidehill row; absent (the plot book), they are as before.
     */
    sidehill?: readonly StationSidehill[]
    /**
     * Add the slope-stake offsets each side and, where the road has one, the clearing width, after
     * the crossfall rows (`stakeRows`). Off (the plot book), the bands are as before.
     */
    stakes?: boolean
  },
): ProfileValueBands {
  const stations = bandStations(analysis.stations, start, end, minSpacingM)
  const sidehillRows: ValueBandRow[] = sidehill ? [sidehillRow(stations, sidehill)] : []
  const spans = sidehill ? sidehillSpans(sidehill, start, end) : []
  const ground: ValueBandRow = {
    key: 'ground',
    title: 'Ground',
    detail: 'Ground elevation at the centreline (m). — where terrain is missing.',
    values: stations.map((s) =>
      finite(s.groundElevation)
        ? { chainage: s.chainage, value: s.groundElevation, text: s.groundElevation.toFixed(2) }
        : unknown(s.chainage),
    ),
  }
  if (terrainOnly)
    return {
      stations,
      rows: [
        ground,
        {
          key: 'grade',
          title: 'Grade %',
          detail: 'Ground grade along the line (%), positive climbing up-station. — where terrain is missing.',
          values: stations.map((s) =>
            finite(s.groundGradePercent)
              ? { chainage: s.chainage, value: s.groundGradePercent, text: signed(s.groundGradePercent, 1) }
              : unknown(s.chainage),
          ),
        },
        ...sidehillRows,
      ],
      curvature: [],
      curvatureLabels: [],
      maxCurvaturePerKm: 0,
      sidehillSpans: spans,
    }
  const rows: ValueBandRow[] = [
    ground,
    {
      key: 'design',
      title: 'Design',
      detail: 'Design (formation) elevation at the centreline (m).',
      values: stations.map((s) =>
        finite(s.designElevation)
          ? { chainage: s.chainage, value: s.designElevation, text: s.designElevation.toFixed(2) }
          : unknown(s.chainage),
      ),
    },
    {
      key: 'depth',
      title: 'Cut/fill',
      detail:
        'Centreline depth (m): C cut where ground is above design, F fill where below. — where terrain is missing.',
      values: stations.map((s) => {
        if (!finite(s.groundElevation) || !finite(s.designElevation)) return unknown(s.chainage)
        const depth = s.groundElevation - s.designElevation
        return {
          chainage: s.chainage,
          value: depth,
          text: Math.abs(depth) < 0.005 ? '0.00' : `${depth > 0 ? 'C' : 'F'} ${Math.abs(depth).toFixed(2)}`,
          ...(Math.abs(depth) < 0.005 ? {} : { tone: depth > 0 ? ('cut' as const) : ('fill' as const) }),
        }
      }),
    },
    {
      key: 'grade',
      title: 'Grade %',
      detail: 'Design grade at the station (%), positive climbing up-station; it varies through vertical curves.',
      values: stations.map((s) =>
        finite(s.gradePercent)
          ? { chainage: s.chainage, value: s.gradePercent, text: signed(s.gradePercent, 1) }
          : unknown(s.chainage),
      ),
    },
  ]
  for (const side of ['left', 'right'] as const) {
    rows.push({
      key: side === 'left' ? 'crossfallLeft' : 'crossfallRight',
      title: side === 'left' ? 'X-fall L %' : 'X-fall R %',
      detail: `${side === 'left' ? 'Left' : 'Right'} crossfall of the running surface (%), positive falling away from the centreline; superelevation included and shown bold.`,
      values: stations.map((s) => {
        try {
          const curve = curveDesignAt(alignment, s.chainage)
          const value = sectionCrossfall(templateAt(alignment, s.chainage).template, side, curve)
          if (!finite(value)) return unknown(s.chainage)
          return {
            chainage: s.chainage,
            value,
            text: signed(value, 1),
            ...(curve && curve.superPercent > 0 ? { tone: 'super' as const } : {}),
          }
        } catch {
          return unknown(s.chainage)
        }
      }),
    })
  }
  if (stakes)
    rows.push(
      ...stakeRows(
        stations,
        analysis.stations.some((s) => finite(s.clearingWidthM)),
      ),
    )
  rows.push(...sidehillRows)
  const { vertices, labels } = curvatureOf(alignment, start, end)
  return {
    stations,
    rows,
    sidehillSpans: spans,
    curvature: vertices,
    curvatureLabels: labels,
    maxCurvaturePerKm: Math.max(0, ...vertices.map((v) => Math.abs(v.perKm))),
  }
}

/**
 * Slope-stake offsets (where each batter meets the ground, RoadEng's L-Ssl/L-Ssr) as signed offsets,
 * negative to the left looking up-station, and the clearing width when the road computes one. An
 * incomplete section has no stake on that side, so it reads unknown rather than its template width.
 */
export function stakeRows(stations: readonly RoadStation[], clearing: boolean): ValueBandRow[] {
  const offset = (s: RoadStation, side: 'left' | 'right'): BandValue => {
    const daylight = side === 'left' ? s.leftDaylightM : s.rightDaylightM
    if (!finite(daylight)) return unknown(s.chainage)
    const value = side === 'left' ? -daylight : daylight
    return { chainage: s.chainage, value, text: value.toFixed(1) }
  }
  const rows: ValueBandRow[] = (['left', 'right'] as const).map((side) => ({
    key: side === 'left' ? 'stakeLeft' : 'stakeRight',
    title: side === 'left' ? 'Stake L m' : 'Stake R m',
    detail: `${side === 'left' ? 'Left' : 'Right'} slope stake: the offset from the centreline where the ${side} batter meets the ground (m), negative to the left looking up-station. — where the section is incomplete on that side.`,
    values: stations.map((s) => offset(s, side)),
  }))
  // Decided over the whole road, not the window, so the row and the bands' height stay put while panning.
  if (clearing)
    rows.push({
      key: 'clearing',
      title: 'Clearing m',
      detail:
        'Clearing width across the road (m): the constructed catches plus any preparation margin. — where it is not computed.',
      values: stations.map((s) =>
        finite(s.clearingWidthM)
          ? { chainage: s.chainage, value: s.clearingWidthM, text: s.clearingWidthM.toFixed(1) }
          : unknown(s.chainage),
      ),
    })
  return rows
}

/** The Sidehill row: magnitude and uphill side at the labelled stations, "lvl" on level ground. */
function sidehillRow(stations: readonly RoadStation[], sidehill: readonly StationSidehill[]): ValueBandRow {
  const byChainage = new Map(sidehill.map((row) => [row.chainage, row]))
  return {
    key: 'sidehill',
    title: 'Sidehill %',
    detail: `Ground cross slope across the road (%) and its uphill side: one line over ${SIDE_SLOPE_REACH_M} m each side of the centreline. The band is coloured at every station; amber past the Interior appraisal equation, red at the full-bench screen. — where terrain is missing.`,
    values: stations.map((s) => {
      const row = byChainage.get(s.chainage)
      if (!row || row.percent === null) return unknown(s.chainage)
      const cls = sidehillClass(row.percent)
      return {
        chainage: s.chainage,
        value: row.percent,
        text: row.uphill ? `${Math.round(row.percent)} ${row.uphill === 'left' ? 'L' : 'R'}` : 'lvl',
        ...(cls === 'full-bench'
          ? { tone: 'bench' as const }
          : cls === 'past-appraisal'
            ? { tone: 'appraisal' as const }
            : {}),
      }
    }),
  }
}

/** One station's running-surface crossfall each side, positive falling away from the centreline. */
export interface SuperelevationVertex {
  chainage: number
  left: number | null
  right: number | null
  superelevated: boolean
}

/**
 * The superelevation diagram over `start`–`end`: each calculated station's crossfall on both sides
 * (`sectionCrossfall`, the section's own), so normal crown, runoff and full superelevation read as
 * two edge lines about the centreline. A design value, read wherever the road is.
 */
export function superelevationDiagram(
  analysis: Pick<RoadAnalysis, 'stations'>,
  alignment: Alignment,
  start: number,
  end: number,
): SuperelevationVertex[] {
  return analysis.stations
    .filter((s) => s.chainage >= start - EPS && s.chainage <= end + EPS)
    .map((s) => {
      try {
        const curve = curveDesignAt(alignment, s.chainage)
        const template = templateAt(alignment, s.chainage).template
        const left = sectionCrossfall(template, 'left', curve),
          right = sectionCrossfall(template, 'right', curve)
        return {
          chainage: s.chainage,
          left: finite(left) ? left : null,
          right: finite(right) ? right : null,
          superelevated: !!curve && curve.superPercent > 0,
        }
      } catch {
        return { chainage: s.chainage, left: null, right: null, superelevated: false }
      }
    })
}

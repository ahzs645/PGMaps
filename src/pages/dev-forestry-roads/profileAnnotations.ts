/**
 * What the road profile marks on its design line, apart from drawing it: tangents that break the
 * grade limits, the begin and end of each vertical curve, crest high and sag low points (and the sags
 * with no culvert near them), and the readout while a PVI is dragged. Pure, with no DOM access, so
 * the screen profile (`ProfileOverlays.tsx`) and the plot book (`plotBookProfile.ts`) print the
 * same points from the same numbers.
 */
import { gradeSide, sustainedLimit, type GradeRule } from './designStandards'
import { verticalCurveSummary } from './engine'
import { DEFAULT_CULVERT_SEARCH_M } from './hydrology'
import { formatStation, type VerticalStandards } from './verticalStandards'
import type { Alignment, RoadAnalysis, RoadStation } from './types'

const EPS = 1e-6
const finite = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value)
/**
 * A signed value for display with a true minus sign: "+5.05%", "−5.05%". The sign follows the rounded
 * value, so a grade that rounds to zero prints "0.0%", never "−0.0%".
 */
export function signedValue(value: number, digits = 1, unit = '%') {
  const rounded = Number(value.toFixed(digits))
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${Math.abs(rounded).toFixed(digits)}${unit}`
}
const pct = (value: number) => signedValue(value, 1)

/**
 * A culvert this far along the road from a sag low point is taken to drain it. The drainage check's
 * own distance for a culvert serving a modelled crossing or low point (`hydrology.ts`), so the
 * profile and the drainage review agree on which sags are relieved.
 */
export const SAG_CULVERT_SEARCH_M = DEFAULT_CULVERT_SEARCH_M

/** The limits a design tangent is judged on: the project's grade rule and the road's vertical standards. */
export interface ProfileGradeLimits {
  /** `gradeRule(project.settings, project.standards)`. */
  rule: GradeRule
}

export type TangentVerdict = 'ok' | 'short-pitch' | 'over-limit' | 'over-range' | 'under-range'

/** One design tangent between neighbouring PVIs, clipped to the road. */
export interface TangentGrade {
  /** `grade-<n>`, the same id `profileGradeSpans` gives the span over the same stations. */
  id: string
  start: number
  end: number
  gradePercent: number
  verdict: TangentVerdict
  /** The limit the verdict is measured against; null when the tangent is within every limit. */
  limitPercent: number | null
  /** One line naming the grade and the limit it breaks, or that it is within the limits. */
  message: string
}

/**
 * The tightest signed grade window of every range in the road's vertical standards that shares
 * length with the tangent. A range that only touches a tangent's end does not hold it.
 */
function windowOver(standards: VerticalStandards | undefined, start: number, end: number, length: number) {
  let low = -Infinity,
    high = Infinity
  for (const range of standards?.gradeRanges ?? []) {
    const from = range.start ?? 0,
      to = range.end ?? length
    if (Math.min(end, to) <= Math.max(start, from) + EPS) continue
    if (range.minGradePercent !== null) low = Math.max(low, range.minGradePercent)
    if (range.maxGradePercent !== null) high = Math.min(high, range.maxGradePercent)
  }
  return { low, high }
}

/**
 * Every design tangent's grade and whether it is within the project's grade limit (with the short-pitch
 * allowance and the loaded direction of `gradeRule`) and the signed windows of the road's vertical
 * standards. Tangents run PVI to PVI as on `profileGradeSpans`: the vertical curves between them are
 * judged by the engine's own grade checks, not here. A road with fewer than two PVIs has no tangents.
 */
export function tangentGrades(
  alignment: Pick<Alignment, 'vertical' | 'verticalStandards'>,
  length: number,
  limits?: ProfileGradeLimits,
): TangentGrade[] {
  if (!(length > 0)) return []
  const vertical = [...alignment.vertical].sort((a, b) => a.chainage - b.chainage)
  if (vertical.length < 2) return []
  const cuts = [0, ...vertical.map((p) => p.chainage).filter((s) => s > 0 && s < length), length]
  return cuts.slice(1).flatMap((end, i): TangentGrade[] => {
    const start = cuts[i]
    if (end - start < 0.001) return []
    const midpoint = (start + end) / 2
    let index = 0
    while (index < vertical.length - 2 && vertical[index + 1].chainage <= midpoint) index++
    const a = vertical[index],
      b = vertical[index + 1]
    if (!(b.chainage > a.chainage)) return []
    const grade = (100 * (b.elevation - a.elevation)) / (b.chainage - a.chainage)
    const span = `${formatStation(start)}–${formatStation(end)}`
    const base = { id: `grade-${i}`, start, end, gradePercent: grade }
    if (limits) {
      const limit = sustainedLimit(limits.rule, grade)
      if (Math.abs(grade) > limit + EPS) {
        const pitch = limits.rule.shortPitch
        const side = gradeSide(limits.rule, grade)
        const sideText = side === 'either' ? '' : ` ${side}`
        if (
          pitch &&
          pitch.gradePercent > limit + EPS &&
          Math.abs(grade) <= pitch.gradePercent + EPS &&
          end - start <= pitch.maxLengthM + EPS
        )
          return [
            {
              ...base,
              verdict: 'short-pitch' as const,
              limitPercent: limit,
              message: `Tangent ${span} at ${pct(grade)} is over the${sideText} ${limit}% limit, within the short-pitch allowance of ${pitch.gradePercent}% for ${pitch.maxLengthM} m.`,
            },
          ]
        return [
          {
            ...base,
            verdict: 'over-limit' as const,
            limitPercent: limit,
            message: `Tangent ${span} at ${pct(grade)} is over the${sideText} ${limit}% grade limit.`,
          },
        ]
      }
    }
    const window = windowOver(alignment.verticalStandards, start, end, length)
    if (grade > window.high + EPS)
      return [
        {
          ...base,
          verdict: 'over-range' as const,
          limitPercent: window.high,
          message: `Tangent ${span} at ${pct(grade)} is above the ${pct(window.high)} maximum of the road's vertical standards.`,
        },
      ]
    if (grade < window.low - EPS)
      return [
        {
          ...base,
          verdict: 'under-range' as const,
          limitPercent: window.low,
          message: `Tangent ${span} at ${pct(grade)} is below the ${pct(window.low)} minimum of the road's vertical standards.`,
        },
      ]
    return [{ ...base, verdict: 'ok' as const, limitPercent: null, message: `Tangent ${span} at ${pct(grade)}.` }]
  })
}

/** A tangent that breaks a limit: drawn red on the profile. A short pitch the allowance permits is not. */
export const isGradeTrouble = (tangent: TangentGrade) => tangent.verdict !== 'ok' && tangent.verdict !== 'short-pitch'

export type CurvePointKind = 'bvc' | 'evc' | 'high' | 'low'

/** A labelled point on the design line. */
export interface CurvePoint {
  id: string
  kind: CurvePointKind
  chainage: number
  elevation: number
  pviId: string
  /** The fitted vertical curve the point belongs to; absent at a PVI with no fitted curve. */
  curve?: { lengthM: number; k: number | null }
  /** Sag low points only: the nearest culvert's distance along the road, null with none entered. */
  nearestCulvertM?: number | null
  /** Sag low points only: no culvert within `SAG_CULVERT_SEARCH_M`. */
  noCulvert?: boolean
}

export const CURVE_POINT_NAMES: Record<CurvePointKind, string> = {
  bvc: 'BVC',
  evc: 'EVC',
  high: 'HP',
  low: 'LP',
}

/**
 * The begin (BVC) and end (EVC) of each fitted vertical curve, and the crest high and sag low points
 * where the design grade changes sign: on the curve where one is fitted, at the PVI where none is (or
 * the entered one could not be fitted). A flat tangent beside a PVI has no single high or low point,
 * so it is not marked. Sag low points carry the nearest culvert and are flagged when none is within
 * `SAG_CULVERT_SEARCH_M`. Points off the road are left out.
 */
export function curvePoints(
  alignment: Pick<Alignment, 'vertical'>,
  length: number,
  culverts: ReadonlyArray<{ chainage: number }> = [],
): CurvePoint[] {
  if (!(length > 0)) return []
  const vertical = [...alignment.vertical].sort((a, b) => a.chainage - b.chainage)
  let summary: ReturnType<typeof verticalCurveSummary>
  try {
    summary = verticalCurveSummary({ vertical } as Alignment)
  } catch {
    return []
  }
  const curves = new Map(summary.map((curve) => [curve.pviId, curve]))
  const points: CurvePoint[] = []
  const nearestCulvert = (chainage: number) =>
    culverts.length ? Math.min(...culverts.map((c) => Math.abs(c.chainage - chainage))) : null
  vertical.forEach((pvi, i) => {
    if (i === 0 || i === vertical.length - 1) return
    const before = vertical[i - 1],
      after = vertical[i + 1]
    const g1 = ((pvi.elevation - before.elevation) / (pvi.chainage - before.chainage)) * 100
    const g2 = ((after.elevation - pvi.elevation) / (after.chainage - pvi.chainage)) * 100
    const curve = curves.get(pvi.id)
    const fitted = curve?.valid ? curve : undefined
    const meta = fitted ? { lengthM: fitted.length, k: fitted.k } : undefined
    if (fitted) {
      const half = fitted.length / 2
      points.push(
        {
          id: `${pvi.id}-bvc`,
          kind: 'bvc',
          chainage: fitted.start,
          elevation: pvi.elevation - (g1 / 100) * half,
          pviId: pvi.id,
          curve: meta,
        },
        {
          id: `${pvi.id}-evc`,
          kind: 'evc',
          chainage: fitted.end,
          elevation: pvi.elevation + (g2 / 100) * half,
          pviId: pvi.id,
          curve: meta,
        },
      )
    }
    const kind = g1 > EPS && g2 < -EPS ? 'high' : g1 < -EPS && g2 > EPS ? 'low' : null
    if (!kind) return
    let chainage = pvi.chainage,
      elevation = pvi.elevation
    if (fitted) {
      // On y = z + g1·x + (g2 − g1)·x² / 2L the grade is zero at x = −g1·L / (g2 − g1).
      const a = g1 / 100,
        b = g2 / 100,
        L = fitted.length
      const x = (-a * L) / (b - a)
      const z = pvi.elevation - (a * L) / 2
      chainage = fitted.start + x
      elevation = z + a * x + ((b - a) * x * x) / (2 * L)
    }
    const point: CurvePoint = { id: `${pvi.id}-${kind}`, kind, chainage, elevation, pviId: pvi.id, curve: meta }
    if (kind === 'low') {
      const nearest = nearestCulvert(chainage)
      point.nearestCulvertM = nearest
      point.noCulvert = nearest === null || nearest > SAG_CULVERT_SEARCH_M + EPS
    }
    points.push(point)
  })
  return points
    .filter((p) => p.chainage >= -EPS && p.chainage <= length + EPS && finite(p.elevation))
    .sort((a, b) => a.chainage - b.chainage)
}

/** The label a curve point prints: name, station and elevation; a flagged sag says so. */
export function curvePointLabel(point: CurvePoint): string {
  const text = `${CURVE_POINT_NAMES[point.kind]} ${formatStation(point.chainage)} · ${point.elevation.toFixed(2)}`
  return point.noCulvert ? `${text} · no culvert` : text
}

/** The tooltip and screen-reader text for a curve point. */
export function curvePointDetail(point: CurvePoint): string {
  const name = {
    bvc: 'Begin vertical curve',
    evc: 'End vertical curve',
    high: 'Crest high point',
    low: 'Sag low point',
  }[point.kind]
  const curve = point.curve
    ? ` Curve L ${point.curve.lengthM.toFixed(1)} m${point.curve.k === null ? '' : `, K ${point.curve.k.toFixed(1)}`}.`
    : point.kind === 'high' || point.kind === 'low'
      ? ' At the PVI: no fitted vertical curve.'
      : ''
  const culvert =
    point.kind !== 'low'
      ? ''
      : point.nearestCulvertM === null || point.nearestCulvertM === undefined
        ? ` No culvert entered on this road; a sag low point needs one within ${SAG_CULVERT_SEARCH_M} m.`
        : point.noCulvert
          ? ` Nearest culvert ${point.nearestCulvertM.toFixed(1)} m away, more than the ${SAG_CULVERT_SEARCH_M} m taken to drain it.`
          : ` Culvert ${point.nearestCulvertM.toFixed(1)} m away.`
  return `${name} ${formatStation(point.chainage)}, elevation ${point.elevation.toFixed(2)} m.${curve}${culvert}`
}

/** Label importance when there is no room for all of them: a flagged sag first, curve ends last. */
export const curvePointPriority = (point: CurvePoint) =>
  point.noCulvert ? 3 : point.kind === 'low' || point.kind === 'high' ? 2 : 1

/**
 * Chooses which labels to draw and in which row, so none overlaps another. Labels are taken in order
 * of priority (then station), and each goes in the first of `rows` rows where no label already placed
 * is closer than `minGapPx`; one that fits no row is dropped. One row thins; several stagger.
 */
export function placeLabels<T extends { x: number; priority?: number }>(
  items: readonly T[],
  minGapPx: number,
  rows = 1,
): Array<T & { row: number }> {
  const placed: Array<T & { row: number }> = []
  const order = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (b.item.priority ?? 0) - (a.item.priority ?? 0) || a.item.x - b.item.x || a.index - b.index)
  for (const { item } of order) {
    if (!Number.isFinite(item.x)) continue
    for (let row = 0; row < Math.max(1, rows); row++) {
      if (placed.some((p) => p.row === row && Math.abs(p.x - item.x) < minGapPx)) continue
      placed.push({ ...item, row })
      break
    }
  }
  return placed.sort((a, b) => a.x - b.x)
}

/** The deepest centreline cut and fill on one tangent, from the analysed stations. */
export interface TangentEarthwork {
  start: number
  end: number
  gradePercent: number | null
  /** Ground above design at the centreline. */
  deepestCut: { chainage: number; depthM: number } | null
  /** Design above ground at the centreline. */
  deepestFill: { chainage: number; depthM: number } | null
  /** Stations on the tangent without ground: the deepest values may lie there, so they are a floor. */
  unknownStations: number
}

/** What the profile shows beside a PVI while it is dragged. */
export interface PviDragReadout {
  pviId: string
  chainage: number
  elevation: number
  gradeInPercent: number | null
  gradeOutPercent: number | null
  /** The tangent behind the PVI; null at the first PVI on station 0. */
  back: TangentEarthwork | null
  /** The tangent ahead of the PVI; null at the last PVI on the road end. */
  ahead: TangentEarthwork | null
}

function tangentEarthwork(
  stations: readonly RoadStation[],
  start: number,
  end: number,
  gradePercent: number | null,
): TangentEarthwork | null {
  if (!(end - start > EPS)) return null
  let deepestCut: TangentEarthwork['deepestCut'] = null,
    deepestFill: TangentEarthwork['deepestFill'] = null,
    unknownStations = 0
  for (const s of stations) {
    if (s.chainage < start - EPS || s.chainage > end + EPS) continue
    if (!finite(s.groundElevation) || !finite(s.designElevation)) {
      unknownStations++
      continue
    }
    const depth = s.groundElevation - s.designElevation
    if (depth > 0 && (!deepestCut || depth > deepestCut.depthM)) deepestCut = { chainage: s.chainage, depthM: depth }
    if (depth < 0 && (!deepestFill || -depth > deepestFill.depthM))
      deepestFill = { chainage: s.chainage, depthM: -depth }
  }
  return { start, end, gradePercent, deepestCut, deepestFill, unknownStations }
}

/**
 * The grade in and out of a PVI, and the deepest centreline cut and fill on the tangent on each side,
 * read from the analysed stations (so they follow the analysis, which may trail a fast drag by a
 * frame). A tangent runs to the neighbouring PVI, or to the road end past the last one.
 */
export function pviDragReadout(
  analysis: Pick<RoadAnalysis, 'stations' | 'length'>,
  alignment: Pick<Alignment, 'vertical'>,
  pviId: string,
): PviDragReadout | null {
  const vertical = [...alignment.vertical].sort((a, b) => a.chainage - b.chainage)
  const index = vertical.findIndex((p) => p.id === pviId)
  if (index < 0) return null
  const pvi = vertical[index],
    before = vertical[index - 1],
    after = vertical[index + 1]
  const gradeIn = before ? (100 * (pvi.elevation - before.elevation)) / (pvi.chainage - before.chainage) : null
  const gradeOut = after ? (100 * (after.elevation - pvi.elevation)) / (after.chainage - pvi.chainage) : null
  const length = analysis.length
  return {
    pviId,
    chainage: pvi.chainage,
    elevation: pvi.elevation,
    gradeInPercent: finite(gradeIn) ? gradeIn : null,
    gradeOutPercent: finite(gradeOut) ? gradeOut : null,
    back: tangentEarthwork(
      analysis.stations,
      Math.max(0, before?.chainage ?? 0),
      Math.min(length, pvi.chainage),
      finite(gradeIn) ? gradeIn : null,
    ),
    ahead: tangentEarthwork(
      analysis.stations,
      Math.max(0, pvi.chainage),
      Math.min(length, after?.chainage ?? length),
      finite(gradeOut) ? gradeOut : null,
    ),
  }
}

/** "C 2.31 @ 0+140.0" or "no cut"; a tangent with stations missing ground says the value is at least that. */
export function earthworkText(tangent: TangentEarthwork, which: 'cut' | 'fill'): string {
  const deepest = which === 'cut' ? tangent.deepestCut : tangent.deepestFill
  const tag = which === 'cut' ? 'C' : 'F'
  if (!deepest) return tangent.unknownStations ? `${tag} unknown` : `no ${which}`
  return `${tag} ${tangent.unknownStations ? '≥ ' : ''}${deepest.depthM.toFixed(2)} @ ${formatStation(deepest.chainage)}`
}

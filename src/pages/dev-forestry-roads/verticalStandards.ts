/**
 * Vertical design standards and control points, checked against a designed profile. Mirrors the
 * Standards and Control Pts. inputs of a vertical optimization dialog: signed grade limits by station
 * range, minimum K for sag and crest curves, minimum curve and tangent lengths, and control
 * elevations and grades with tolerances. Pure; unset values are never checked.
 */
export interface GradeRange {
  id: string
  /** Null or omitted means the road start / end. */
  start: number | null
  end: number | null
  /** Signed percent: e.g. −12 to 10. Null leaves that side unchecked. */
  minGradePercent: number | null
  maxGradePercent: number | null
}
export interface VerticalStandards {
  gradeRanges: GradeRange[]
  minSagK: number | null
  minCrestK: number | null
  minCurveLengthM: number | null
  minTangentLengthM: number | null
  curvatureRanges?: CurvatureRange[]
}
export interface CurvatureRange {
  id: string
  start: number | null
  end: number | null
  minSagK: number | null
  minCrestK: number | null
  /** A straight grade line is required within this range. */
  linear?: boolean
}
export interface VerticalControl {
  id: string
  chainage: number
  /** Target formation elevation; null checks grade only. */
  elevation: number | null
  toleranceAboveM: number
  toleranceBelowM: number
  /** Target grade, signed percent; null checks elevation only. */
  gradePercent: number | null
  gradeTolerancePercent: number
}
export interface VerticalCurveInfo {
  pviId: string
  chainage: number
  start: number
  end: number
  length: number
  g1: number | null
  g2: number | null
  k: number | null
  valid: boolean
}
export type VerticalCheckKind = 'grade' | 'k' | 'curve-length' | 'tangent' | 'control-elevation' | 'control-grade'
export interface VerticalCheck {
  kind: VerticalCheckKind
  /** Station the flag is attached to. */
  chainage: number
  start: number
  end: number
  message: string
}

export const EMPTY_VERTICAL_STANDARDS: VerticalStandards = {
  gradeRanges: [],
  minSagK: null,
  minCrestK: null,
  minCurveLengthM: null,
  minTangentLengthM: null,
}

const EPS = 1e-6
const stn = (value: number) => {
  const rounded = Math.round(Math.max(0, value) * 10) / 10
  return `${Math.floor(rounded / 1000)}+${(rounded % 1000).toFixed(1).padStart(5, '0')}`
}
const pct = (value: number) => `${value > 0 ? '' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(1)}%`

/** Sag when the grade increases through the PVI (concave up), crest when it decreases. */
export const curveKind = (g1: number, g2: number) => (g2 > g1 ? 'sag' : 'crest')

/** Most restrictive K over a curve's entire station extent, including range boundaries. */
export function curvatureRuleAt(standards: VerticalStandards | undefined, start: number, end: number, length: number) {
  let minSagK = standards?.minSagK ?? 0,
    minCrestK = standards?.minCrestK ?? 0,
    linear = false
  for (const range of standards?.curvatureRanges ?? []) {
    if ((range.start ?? 0) > end + 1e-6 || (range.end ?? length) < start - 1e-6) continue
    minSagK = Math.max(minSagK, range.minSagK ?? 0)
    minCrestK = Math.max(minCrestK, range.minCrestK ?? 0)
    // Merely touching the endpoint of a linear range does not put curvature inside it.
    if (range.linear && Math.min(end, range.end ?? length) > Math.max(start, range.start ?? 0) + 1e-6) linear = true
  }
  return { minSagK, minCrestK, linear }
}

/** Signed grade window at a station: the tightest of every range that covers it. */
export function gradeWindowAt(standards: VerticalStandards | undefined, chainage: number, length: number) {
  let low = -Infinity,
    high = Infinity
  for (const range of standards?.gradeRanges ?? []) {
    const start = range.start ?? 0,
      end = range.end ?? length
    if (chainage < start - EPS || chainage > end + EPS) continue
    if (range.minGradePercent !== null) low = Math.max(low, range.minGradePercent)
    if (range.maxGradePercent !== null) high = Math.min(high, range.maxGradePercent)
  }
  return { low, high }
}

export function checkVerticalDesign({
  standards,
  controls,
  curves,
  pvis,
  stations,
  length,
  valueAt,
}: {
  standards?: VerticalStandards
  controls?: VerticalControl[]
  curves: VerticalCurveInfo[]
  pvis: { id: string; chainage: number; curveLength: number }[]
  stations: { chainage: number; gradePercent: number | null }[]
  length: number
  valueAt: (chainage: number) => { elevation: number; grade: number } | null
}): VerticalCheck[] {
  const checks: VerticalCheck[] = []
  if (standards) {
    // Grade windows: one flag per run of consecutive out-of-window stations.
    let run: { start: number; end: number; worst: number; low: number; high: number } | null = null
    const close = () => {
      if (!run) return
      const window = `${Number.isFinite(run.low) ? pct(run.low) : '−∞'}…${Number.isFinite(run.high) ? pct(run.high) : '∞'}`
      checks.push({
        kind: 'grade',
        chainage: run.start,
        start: run.start,
        end: run.end,
        message: `Grade ${pct(run.worst)} outside ${window} for ${stn(run.start)}–${stn(run.end)}`,
      })
      run = null
    }
    for (const s of stations) {
      if (s.gradePercent === null) {
        close()
        continue
      }
      const { low, high } = gradeWindowAt(standards, s.chainage, length)
      const outside = s.gradePercent < low - EPS || s.gradePercent > high + EPS
      if (!outside) {
        close()
        continue
      }
      const excess = (g: number) => Math.max(low - g, g - high)
      if (run && run.low === low && run.high === high) {
        run.end = s.chainage
        if (excess(s.gradePercent) > excess(run.worst)) run.worst = s.gradePercent
      } else {
        close()
        run = { start: s.chainage, end: s.chainage, worst: s.gradePercent, low, high }
      }
    }
    close()

    for (const curve of curves) {
      if (curve.g1 === null || curve.g2 === null || Math.abs(curve.g2 - curve.g1) < EPS) continue
      const kind = curveKind(curve.g1, curve.g2)
      const rule = curvatureRuleAt(standards, curve.start, curve.end, length)
      const minimum = kind === 'sag' ? rule.minSagK : rule.minCrestK
      if (rule.linear && curve.length > 0)
        checks.push({
          kind: 'k',
          chainage: curve.chainage,
          start: curve.start,
          end: curve.end,
          message: `Curvature enters a linear-only range at ${stn(curve.chainage)}`,
        })
      if (minimum !== null && curve.k !== null && curve.k < minimum - EPS)
        checks.push({
          kind: 'k',
          chainage: curve.chainage,
          start: curve.start,
          end: curve.end,
          message: `K ${curve.k.toFixed(1)} below ${kind} minimum ${minimum.toFixed(1)} at ${stn(curve.chainage)} (needs ${(minimum * Math.abs(curve.g2 - curve.g1)).toFixed(0)} m)`,
        })
      if (standards.minCurveLengthM !== null && curve.length < standards.minCurveLengthM - EPS)
        checks.push({
          kind: 'curve-length',
          chainage: curve.chainage,
          start: curve.start,
          end: curve.end,
          message: `Vertical curve ${curve.length.toFixed(0)} m shorter than ${standards.minCurveLengthM.toFixed(0)} m at ${stn(curve.chainage)}`,
        })
    }
    // A grade break with no curve still needs K: an unrounded break has K = 0.
    for (let i = 1; i < pvis.length - 1; i++) {
      const p = pvis[i]
      if (p.curveLength > 0) continue
      const before = valueAt(p.chainage - 0.01),
        after = valueAt(p.chainage + 0.01)
      if (!before || !after || Math.abs(after.grade - before.grade) < 0.05) continue
      const kind = curveKind(before.grade, after.grade)
      const rule = curvatureRuleAt(standards, p.chainage - 0.00001, p.chainage + 0.00001, length)
      const minimum = kind === 'sag' ? rule.minSagK : rule.minCrestK
      if (rule.linear)
        checks.push({
          kind: 'k',
          chainage: p.chainage,
          start: p.chainage,
          end: p.chainage,
          message: `Grade break enters a linear-only range at ${stn(p.chainage)}`,
        })
      if (minimum !== null && minimum > 0)
        checks.push({
          kind: 'k',
          chainage: p.chainage,
          start: p.chainage,
          end: p.chainage,
          message: `Unrounded ${kind} grade break at ${stn(p.chainage)}; ${kind} minimum K ${minimum.toFixed(1)} needs a ${(minimum * Math.abs(after.grade - before.grade)).toFixed(0)} m curve`,
        })
    }
    if (standards.minTangentLengthM !== null) {
      const ends = [
        0,
        ...pvis.slice(1, -1).flatMap((p) => {
          const c = curves.find((x) => x.pviId === p.id && x.valid)
          return c ? [c.start, c.end] : [p.chainage, p.chainage]
        }),
        pvis.length ? pvis[pvis.length - 1].chainage : length,
      ]
      for (let i = 0; i + 1 < ends.length; i += 2) {
        const start = ends[i],
          end = ends[i + 1],
          tangent = end - start
        // The first and last tangents run to the road ends and are not limited.
        if (i === 0 || i + 2 >= ends.length) continue
        if (tangent < standards.minTangentLengthM - EPS)
          checks.push({
            kind: 'tangent',
            chainage: (start + end) / 2,
            start,
            end,
            message: `Tangent ${Math.max(0, tangent).toFixed(0)} m shorter than ${standards.minTangentLengthM.toFixed(0)} m between ${stn(start)} and ${stn(end)}`,
          })
      }
    }
  }
  for (const control of controls ?? []) {
    if (control.chainage < -EPS || control.chainage > length + EPS) continue
    const at = valueAt(control.chainage)
    if (!at) continue
    if (control.elevation !== null) {
      const difference = at.elevation - control.elevation
      if (difference > control.toleranceAboveM + EPS || difference < -control.toleranceBelowM - EPS)
        checks.push({
          kind: 'control-elevation',
          chainage: control.chainage,
          start: control.chainage,
          end: control.chainage,
          message: `Elevation ${at.elevation.toFixed(2)} is ${Math.abs(difference).toFixed(2)} m ${difference > 0 ? 'above' : 'below'} control ${control.elevation.toFixed(2)} at ${stn(control.chainage)} (tolerance +${control.toleranceAboveM.toFixed(2)}/−${control.toleranceBelowM.toFixed(2)} m)`,
        })
    }
    if (
      control.gradePercent !== null &&
      Math.abs(at.grade - control.gradePercent) > control.gradeTolerancePercent + EPS
    )
      checks.push({
        kind: 'control-grade',
        chainage: control.chainage,
        start: control.chainage,
        end: control.chainage,
        message: `Grade ${pct(at.grade)} misses control ${pct(control.gradePercent)} ±${control.gradeTolerancePercent.toFixed(1)}% at ${stn(control.chainage)}`,
      })
  }
  return checks
}

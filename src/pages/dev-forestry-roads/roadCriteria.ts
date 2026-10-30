/** Explicit user/sourced road criteria. Pure; no standard is inferred from a template name. */
import type { CurveDesign } from './types'

export const MAX_WIDENING_TABLE_ENTRIES = 400
export function validateCurveCriteria(design: CurveDesign): void {
  const bounded = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max
  if (
    !bounded(design.designSpeedKmh, 1, 150) ||
    !bounded(design.maxSuperelevationPercent, 0, 20) ||
    !bounded(design.sideFrictionFactor, 0, 1) ||
    !bounded(design.runoffLengthM, 0, 1000) ||
    (design.wideningVehicleLengthM !== null && !bounded(design.wideningVehicleLengthM, 0, 50))
  )
    throw Error('Curve speed, superelevation, friction, runoff or vehicle length is outside its supported range.')
  for (const [value, max] of [
    [design.insideWideningM ?? 0, 50],
    [design.outsideWideningM ?? 0, 50],
  ])
    if (!Number.isFinite(value) || value < 0 || value > max) throw Error('Curve widening must be between 0 and 50 m.')
  if ((design.criteriaName?.length ?? 0) > 200 || (design.criteriaSource?.length ?? 0) > 2000)
    throw Error('Criteria name/source is too long.')
  const rows = design.wideningTable
  if (!rows?.length) return
  if (rows.length > MAX_WIDENING_TABLE_ENTRIES) throw Error('Widening tables support at most 400 entries.')
  const keys = new Set<string>()
  for (const row of rows) {
    if (
      ![row.radiusM, row.deflectionDegrees, row.insideM, row.outsideM].every(Number.isFinite) ||
      row.radiusM <= 0 ||
      row.radiusM > 10000 ||
      row.deflectionDegrees < 0 ||
      row.deflectionDegrees > 180 ||
      row.insideM < 0 ||
      row.insideM > 50 ||
      row.outsideM < 0 ||
      row.outsideM > 50
    )
      throw Error('Widening entries need radius (0–10,000 m), deflection (0–180°), and side widths (0–50 m).')
    const key = `${row.radiusM}:${row.deflectionDegrees}`
    if (keys.has(key)) throw Error('Widening table has a duplicate radius/deflection entry.')
    keys.add(key)
  }
  const radii = new Set(rows.map((r) => r.radiusM)),
    angles = new Set(rows.map((r) => r.deflectionDegrees))
  if (radii.size * angles.size !== rows.length)
    throw Error('Widening table must contain every radius/deflection combination.')
}

/** Linear interpolation with bounded edge values; caller receives an out-of-range warning. */
export function evaluateCurveCriteria(design: CurveDesign, radiusM: number, deflectionDegrees = 0) {
  validateCurveCriteria(design)
  const requiredSuperelevationPercent = 100 * (design.designSpeedKmh ** 2 / (127 * radiusM) - design.sideFrictionFactor)
  const appliedSuperelevationPercent = Math.max(
    0,
    Math.min(requiredSuperelevationPercent, design.maxSuperelevationPercent),
  )
  const warnings: string[] = []
  if (requiredSuperelevationPercent > design.maxSuperelevationPercent + 1e-6)
    warnings.push(
      `Design speed ${design.designSpeedKmh} km/h at radius ${radiusM.toFixed(1)} m requires ${requiredSuperelevationPercent.toFixed(2)}% superelevation; maximum is ${design.maxSuperelevationPercent.toFixed(2)}%.`,
    )
  let insideWideningM = design.wideningVehicleLengthM ? design.wideningVehicleLengthM ** 2 / (2 * radiusM) : 0
  let outsideWideningM = 0
  if (design.wideningTable?.length) {
    const rows = design.wideningTable
    const radii = [...new Set(rows.map((r) => r.radiusM))].sort((a, b) => a - b)
    const angles = [...new Set(rows.map((r) => r.deflectionDegrees))].sort((a, b) => a - b)
    const bracket = (values: number[], value: number) => {
      const bounded = Math.max(values[0], Math.min(values.at(-1)!, value))
      const hi = values.find((v) => v >= bounded)!,
        lo = [...values].reverse().find((v) => v <= bounded)!
      return { lo, hi, t: hi === lo ? 0 : (bounded - lo) / (hi - lo) }
    }
    const r = bracket(radii, radiusM),
      a = bracket(angles, deflectionDegrees)
    const interpolate = (field: 'insideM' | 'outsideM') => {
      const pick = (radius: number, angle: number) =>
        rows.find((v) => v.radiusM === radius && v.deflectionDegrees === angle)![field]
      const low = pick(r.lo, a.lo) + (pick(r.hi, a.lo) - pick(r.lo, a.lo)) * r.t
      const high = pick(r.lo, a.hi) + (pick(r.hi, a.hi) - pick(r.lo, a.hi)) * r.t
      return low + (high - low) * a.t
    }
    insideWideningM = interpolate('insideM')
    outsideWideningM = interpolate('outsideM')
    if (
      radiusM < radii[0] ||
      radiusM > radii.at(-1)! ||
      deflectionDegrees < angles[0] ||
      deflectionDegrees > angles.at(-1)!
    )
      warnings.push('Curve falls outside the widening table; edge values were used. Review widening.')
  }
  insideWideningM += design.insideWideningM ?? 0
  outsideWideningM += design.outsideWideningM ?? 0
  const denominator = 127 * (design.maxSuperelevationPercent / 100 + design.sideFrictionFactor)
  return {
    requiredSuperelevationPercent,
    appliedSuperelevationPercent,
    insideWideningM,
    outsideWideningM,
    minimumSpeedRadiusM: denominator > 0 ? design.designSpeedKmh ** 2 / denominator : Infinity,
    warnings,
  }
}

export function parseWideningTableCsv(text: string): NonNullable<CurveDesign['wideningTable']> {
  const rows = text
    .trim()
    .split(/\r?\n/)
    .filter((v) => v.trim())
    .map((line, i) => {
      const values = line.split(',').map((v) => Number(v.trim()))
      if (values.length !== 4 || !values.every(Number.isFinite))
        throw Error(`Widening row ${i + 1}: use radius, deflection, inside, outside numbers.`)
      return { radiusM: values[0], deflectionDegrees: values[1], insideM: values[2], outsideM: values[3] }
    })
  validateCurveCriteria({
    designSpeedKmh: 1,
    maxSuperelevationPercent: 0,
    sideFrictionFactor: 0,
    runoffLengthM: 0,
    wideningVehicleLengthM: null,
    wideningTable: rows,
  })
  return rows
}

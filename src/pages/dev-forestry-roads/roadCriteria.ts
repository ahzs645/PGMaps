/**
 * Explicit user/sourced road criteria. Pure; no standard is inferred from a template name.
 *
 * A curve's superelevation comes from the formula e = V²/(127 R) − f (the default), from RoadEng's
 * side friction method (Softree's help, "Auto Super-elevation Options": e / e max = f / f max with
 * (e + f) g = V²/R, g = 9.81 m/s², which Softree's bluff road designs hold to twelve digits) or, in
 * table mode, from a lookup table by radius and design speed read as Softree describes RoadEng's ("Super-elevation
 * table facts", RoadEng Civil tutorial ch. 16): linear interpolation between the rows and columns
 * around the curve, a blank cell an unsafe combination, the top of each column its largest value.
 * Softree's samples show the rest (LongRoad, the cul-de-sac design): a radius above the last row takes
 * the last row, and a curve outside the table (a speed outside the columns, a radius below the first
 * row) gets no superelevation and no runoff. A blank cell inside the table (no sample has one) gives
 * the column's largest value and a warning, the "apply anyway" of RoadEng's unsafe-curve warning;
 * that reading is inferred. Each curve's own `CurveSettings` take the place of the road's values,
 * its widening side by side: a curve's own inside or outside widening replaces the rule's (table,
 * vehicle length and the road's added widths) on that side only, RoadEng's Auto widening off there.
 */
import type { CurveDesign, CurveLookupTable, CurveSettings } from './types'

export const MAX_WIDENING_TABLE_ENTRIES = 400
/** Largest widening on one side of a curve, m: the road's rule and a curve's own value alike. */
export const MAX_CURVE_WIDENING_M = 50
/** Rows and speed columns a superelevation or runoff table may hold (RoadEng's `.tbl` limits). */
export const MAX_CURVE_TABLE_ROWS = 2000
export const MAX_CURVE_TABLE_COLUMNS = 100
/** A speed this close to a table column, km/h, is that column (a file's m/s rounds it). */
export const TABLE_SPEED_SNAP_KMH = 1e-3
/** A curve's own table-radius scale must lie within this factor of 1. */
export const MAX_TABLE_RADIUS_SCALE = 2
/** Gravity in RoadEng's side friction method, m/s² (Softree's help; its foot designs work in metres too). */
export const SIDE_FRICTION_GRAVITY = 9.81

const bounded = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max

/** Tables already checked, by identity: the engine evaluates a curve at every station. */
const checkedTables = new WeakSet<object>()

/** Checks a radius-by-speed lookup table; `valueMax` bounds its body. */
export function validateCurveLookupTable(table: CurveLookupTable, label: string, valueMax: number): void {
  if (checkedTables.has(table)) return
  if (!table || !Array.isArray(table.speedsKmh) || !Array.isArray(table.rows))
    throw Error(`The ${label} needs speed columns and radius rows.`)
  if (!table.speedsKmh.length || !table.rows.length)
    throw Error(`The ${label} needs at least one speed and one radius.`)
  if (table.speedsKmh.length > MAX_CURVE_TABLE_COLUMNS || table.rows.length > MAX_CURVE_TABLE_ROWS)
    throw Error(`The ${label} holds at most ${MAX_CURVE_TABLE_ROWS} radii and ${MAX_CURVE_TABLE_COLUMNS} speeds.`)
  if (!table.speedsKmh.every((v) => bounded(v, 0.001, 300)))
    throw Error(`The ${label}'s speeds must be between 0 and 300 km/h.`)
  if (new Set(table.speedsKmh).size !== table.speedsKmh.length) throw Error(`The ${label} repeats a speed.`)
  const radii = new Set<number>()
  for (const row of table.rows) {
    if (!bounded(row.radiusM, 0.001, 100_000)) throw Error(`The ${label}'s radii must be between 0 and 100,000 m.`)
    if (radii.has(row.radiusM)) throw Error(`The ${label} repeats the radius ${row.radiusM} m.`)
    radii.add(row.radiusM)
    if (!Array.isArray(row.values) || row.values.length !== table.speedsKmh.length)
      throw Error(`Each row of the ${label} needs one value per speed.`)
    if (!row.values.every((v) => v === null || bounded(v, 0, valueMax)))
      throw Error(`The ${label}'s values must be blank or between 0 and ${valueMax}.`)
  }
  if ((table.description?.length ?? 0) > 100 || table.description?.some((d) => typeof d !== 'string' || d.length > 500))
    throw Error(`The ${label}'s description is too long.`)
  checkedTables.add(table)
}

/** Checks one curve's own settings. */
export function validateCurveSettings(settings: CurveSettings): void {
  const checks: [unknown, number, number, string][] = [
    [settings.designSpeedKmh, 1, 150, 'design speed (1–150 km/h)'],
    [settings.maxSuperelevationPercent, 0, 20, 'maximum superelevation (0–20 %)'],
    [settings.superelevationPercent, 0, 20, 'superelevation (0–20 %)'],
    [settings.runoffInM, 0, 1000, 'runoff (0–1,000 m)'],
    [settings.runoffOutM, 0, 1000, 'runoff (0–1,000 m)'],
    [settings.transitionFraction, 0, 1, 'share of the runoff outside the curve (0–1)'],
    [settings.maxSideFriction, 0, 1, 'largest side friction (0–1)'],
    [settings.tableRadiusScale, 1 / MAX_TABLE_RADIUS_SCALE, MAX_TABLE_RADIUS_SCALE, 'table radius scale'],
    [settings.insideWideningM, 0, MAX_CURVE_WIDENING_M, `inside widening (0–${MAX_CURVE_WIDENING_M} m)`],
    [settings.outsideWideningM, 0, MAX_CURVE_WIDENING_M, `outside widening (0–${MAX_CURVE_WIDENING_M} m)`],
  ]
  for (const [value, min, max, label] of checks)
    if (value !== undefined && !bounded(value, min, max)) throw Error(`A curve's ${label} is outside its range.`)
  if (settings.useMinimumRadius !== undefined && typeof settings.useMinimumRadius !== 'boolean')
    throw Error("A curve's Use Minimum Radius is on or off.")
}

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
  if (
    design.superelevationMode !== undefined &&
    design.superelevationMode !== 'formula' &&
    design.superelevationMode !== 'table' &&
    design.superelevationMode !== 'sideFriction'
  )
    throw Error('Superelevation comes from the formula, a table or the side friction method.')
  if (design.superelevationTable) validateCurveLookupTable(design.superelevationTable, 'superelevation table', 50)
  else if (design.superelevationMode === 'table') throw Error('Table superelevation needs a superelevation table.')
  if (design.runoffTable) validateCurveLookupTable(design.runoffTable, 'runoff table', 10_000)
  if (design.sideFrictionTable) {
    const f = design.sideFrictionTable
    if (
      !Array.isArray(f.speedsKmh) ||
      !Array.isArray(f.values) ||
      !f.speedsKmh.length ||
      f.speedsKmh.length > MAX_CURVE_TABLE_COLUMNS ||
      f.values.length !== f.speedsKmh.length ||
      !f.speedsKmh.every((v) => bounded(v, 0.001, 300)) ||
      new Set(f.speedsKmh).size !== f.speedsKmh.length ||
      !f.values.every((v) => v === null || bounded(v, 0, 2))
    )
      throw Error('The side friction table needs one value (0–2, or blank) for each distinct speed.')
  }
  if (design.transitionFraction !== undefined && !bounded(design.transitionFraction, 0, 1))
    throw Error('The share of the runoff outside the curve must be between 0 and 1.')
  if (design.tangentRunout !== undefined && typeof design.tangentRunout !== 'boolean')
    throw Error('Tangent runout is on or off.')
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

/** Where a curve's superelevation was found in a lookup table: `unsafe` a blank cell, `outside` past its edges. */
export type CurveTableStatus = 'ok' | 'unsafe' | 'outside'

const sortedColumns = (speeds: readonly number[]) =>
  speeds
    .map((v, k) => ({ v, k }))
    .filter((c) => Number.isFinite(c.v))
    .sort((a, b) => a.v - b.v)

/** The two entries of a sorted list around `value`, and how far between them it lies. */
function bracket<T>(sorted: readonly T[], value: number, of: (item: T) => number) {
  const hi = sorted.findIndex((item) => of(item) >= value - 1e-9)
  const lo = of(sorted[hi]) <= value + 1e-9 ? hi : hi - 1
  const t = hi === lo ? 0 : (value - of(sorted[lo])) / (of(sorted[hi]) - of(sorted[lo]))
  return { lo, hi, t }
}

/**
 * A lookup table's value at a radius and design speed, RoadEng's way: linear between the rows and
 * columns around the point; a radius above the last row takes the last row; a speed outside the
 * columns or a radius below the first row is `outside`; a blank among the four cells is `unsafe`.
 */
export function curveTableValue(
  table: CurveLookupTable,
  radiusM: number,
  speedKmh: number,
): { value: number | null; status: CurveTableStatus } {
  const rows = [...table.rows].sort((a, b) => a.radiusM - b.radiusM)
  const columns = sortedColumns(table.speedsKmh)
  if (!rows.length || !columns.length || !Number.isFinite(radiusM) || !Number.isFinite(speedKmh))
    return { value: null, status: 'outside' }
  // A speed read from a file in m/s or ft/s lands a hair off its column: it is that column.
  speedKmh = columns.find((c) => Math.abs(c.v - speedKmh) <= TABLE_SPEED_SNAP_KMH)?.v ?? speedKmh
  if (radiusM < rows[0].radiusM - 1e-9 || speedKmh < columns[0].v - 1e-9 || speedKmh > columns.at(-1)!.v + 1e-9)
    return { value: null, status: 'outside' }
  const r = bracket(rows, Math.min(radiusM, rows.at(-1)!.radiusM), (row) => row.radiusM)
  const c = bracket(columns, speedKmh, (col) => col.v)
  const cell = (i: number, j: number) => rows[i].values[columns[j].k] ?? null
  const corners = [cell(r.lo, c.lo), cell(r.lo, c.hi), cell(r.hi, c.lo), cell(r.hi, c.hi)]
  if (corners.some((v) => v === null)) return { value: null, status: 'unsafe' }
  const [a, b, d, e] = corners as number[]
  const low = a + (b - a) * c.t,
    high = d + (e - d) * c.t
  return { value: low + (high - low) * r.t, status: 'ok' }
}

/** The largest value of the table's column at a speed (the top of the column), between columns linearly. */
export function curveTableColumnTop(table: CurveLookupTable, speedKmh: number): number | null {
  const columns = sortedColumns(table.speedsKmh)
  speedKmh = columns.find((c) => Math.abs(c.v - speedKmh) <= TABLE_SPEED_SNAP_KMH)?.v ?? speedKmh
  if (!columns.length || speedKmh < columns[0].v - 1e-9 || speedKmh > columns.at(-1)!.v + 1e-9) return null
  const top = (k: number) => {
    const values = table.rows.map((row) => row.values[k]).filter((v): v is number => v !== null && v !== undefined)
    return values.length ? Math.max(...values) : null
  }
  const c = bracket(columns, speedKmh, (col) => col.v)
  const lo = top(columns[c.lo].k),
    hi = top(columns[c.hi].k)
  if (lo === null || hi === null) return null
  return lo + (hi - lo) * c.t
}

/** The smallest radius whose table value at this speed is not blank, m; null when none is. */
export function curveTableMinimumRadius(table: CurveLookupTable, speedKmh: number): number | null {
  const radii = table.rows.map((row) => row.radiusM).sort((a, b) => a - b)
  return radii.find((radius) => curveTableValue(table, radius, speedKmh).status === 'ok') ?? null
}

/** A one-row table by speed (RoadEng's side friction table), interpolated; null outside it or on a blank. */
export function speedTableValue(table: { speedsKmh: number[]; values: (number | null)[] }, speedKmh: number) {
  const columns = sortedColumns(table.speedsKmh)
  speedKmh = columns.find((c) => Math.abs(c.v - speedKmh) <= TABLE_SPEED_SNAP_KMH)?.v ?? speedKmh
  if (!columns.length || speedKmh < columns[0].v - 1e-9 || speedKmh > columns.at(-1)!.v + 1e-9) return null
  const c = bracket(columns, speedKmh, (col) => col.v)
  const lo = table.values[columns[c.lo].k],
    hi = table.values[columns[c.hi].k]
  if (lo === null || hi === null || lo === undefined || hi === undefined) return null
  return lo + (hi - lo) * c.t
}

const fmt = (value: number, digits = 2) => value.toFixed(digits)

/**
 * A curve's criteria at its radius and deflection: the road's rule (`design`) with the curve's own
 * settings over it. With no settings and in formula mode this is exactly the road's rule.
 */
export function evaluateCurveCriteria(
  design: CurveDesign,
  radiusM: number,
  deflectionDegrees = 0,
  curve?: CurveSettings | null,
) {
  validateCurveCriteria(design)
  if (curve) validateCurveSettings(curve)
  const designSpeedKmh = curve?.designSpeedKmh ?? design.designSpeedKmh
  const maxSuperelevationPercent = curve?.maxSuperelevationPercent ?? design.maxSuperelevationPercent
  const table = design.superelevationMode === 'table' ? (design.superelevationTable ?? null) : null
  const sideFrictionMethod = design.superelevationMode === 'sideFriction'
  const tableRadiusM = radiusM * (curve?.tableRadiusScale ?? 1)
  const warnings: string[] = []
  let requiredSuperelevationPercent: number
  let tableStatus: CurveTableStatus | null = null
  // The side friction method's f max: the curve's own, else the table's at its speed, else the road's.
  const tableFriction = design.sideFrictionTable ? speedTableValue(design.sideFrictionTable, designSpeedKmh) : null
  const maxSideFriction = curve?.maxSideFriction ?? tableFriction ?? design.sideFrictionFactor
  // Lateral acceleration over g at the curve's radius in the design's grid, as RoadEng takes it.
  const lateral = (designSpeedKmh / 3.6) ** 2 / (SIDE_FRICTION_GRAVITY * tableRadiusM)
  if (sideFrictionMethod) {
    // e / e max = f / f max with e + f = V²/(g R): e = e max · V²/(g R) / (e max + f max).
    const emax = maxSuperelevationPercent / 100
    requiredSuperelevationPercent = emax + maxSideFriction > 0 ? (100 * emax * lateral) / (emax + maxSideFriction) : 0
  } else if (table) {
    const found = curveTableValue(table, tableRadiusM, designSpeedKmh)
    tableStatus = found.status
    if (found.status === 'ok') requiredSuperelevationPercent = found.value!
    else if (found.status === 'unsafe') {
      requiredSuperelevationPercent = curveTableColumnTop(table, designSpeedKmh) ?? maxSuperelevationPercent
      warnings.push(
        `Design speed ${fmt(designSpeedKmh, 1)} km/h at radius ${fmt(radiusM, 1)} m is a blank (unsafe) combination in the superelevation table; the column's largest, ${fmt(requiredSuperelevationPercent)}%, is used.`,
      )
    } else {
      requiredSuperelevationPercent = 0
      warnings.push(
        `Design speed ${fmt(designSpeedKmh, 1)} km/h at radius ${fmt(radiusM, 1)} m is outside the superelevation table; the curve gets no superelevation.`,
      )
    }
  } else requiredSuperelevationPercent = 100 * (designSpeedKmh ** 2 / (127 * radiusM) - design.sideFrictionFactor)
  const ruleSuperelevationPercent = Math.max(0, Math.min(requiredSuperelevationPercent, maxSuperelevationPercent))
  const stated = curve?.superelevationPercent
  // RoadEng's Use Minimum Radius holds the curve at its e max.
  const minimumRadius = stated === undefined && curve?.useMinimumRadius === true
  const appliedSuperelevationPercent = stated ?? (minimumRadius ? maxSuperelevationPercent : ruleSuperelevationPercent)
  const superelevationSource: 'formula' | 'table' | 'sideFriction' | 'minimumRadius' | 'stated' =
    stated !== undefined
      ? 'stated'
      : minimumRadius
        ? 'minimumRadius'
        : table
          ? 'table'
          : sideFrictionMethod
            ? 'sideFriction'
            : 'formula'
  if (requiredSuperelevationPercent > maxSuperelevationPercent + 1e-6)
    warnings.push(
      `Design speed ${designSpeedKmh} km/h at radius ${radiusM.toFixed(1)} m requires ${requiredSuperelevationPercent.toFixed(2)}% superelevation; maximum is ${maxSuperelevationPercent.toFixed(2)}%.`,
    )
  if (stated !== undefined && stated > maxSuperelevationPercent + 1e-6)
    warnings.push(
      `The curve's stated ${fmt(stated)}% superelevation is above its ${fmt(maxSuperelevationPercent)}% maximum.`,
    )
  // Runoff: the curve's own, else the runoff table (table mode), else the road's one length.
  let runoffM = design.runoffLengthM
  if (table && design.runoffTable) {
    const found = curveTableValue(design.runoffTable, tableRadiusM, designSpeedKmh)
    runoffM = found.status === 'ok' ? found.value! : appliedSuperelevationPercent > 0 ? design.runoffLengthM : 0
  } else if (table && tableStatus === 'outside' && stated === undefined) runoffM = 0
  const runoffInM = curve?.runoffInM ?? runoffM
  const runoffOutM = curve?.runoffOutM ?? runoffM
  const transitionFraction = curve?.transitionFraction ?? design.transitionFraction ?? 1
  // The side friction method's demand is RoadEng's, at g = 9.81 m/s² and the radius in its grid.
  const sideFrictionDemand = sideFrictionMethod
    ? lateral - appliedSuperelevationPercent / 100
    : designSpeedKmh ** 2 / (127 * radiusM) - appliedSuperelevationPercent / 100
  const sideFrictionLimit = sideFrictionMethod ? maxSideFriction : tableFriction
  if (sideFrictionLimit !== null && sideFrictionDemand > sideFrictionLimit + 1e-6)
    warnings.push(
      `The curve needs side friction ${fmt(sideFrictionDemand, 3)} at ${fmt(designSpeedKmh, 1)} km/h; ${sideFrictionMethod ? 'its largest is' : 'the table allows'} ${fmt(sideFrictionLimit, 3)}.`,
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
    // Read at the curve's table radius, as the other tables: a RoadEng curve's radius in its grid.
    const r = bracket(radii, tableRadiusM),
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
      tableRadiusM < radii[0] ||
      tableRadiusM > radii.at(-1)! ||
      deflectionDegrees < angles[0] ||
      deflectionDegrees > angles.at(-1)!
    )
      warnings.push('Curve falls outside the widening table; edge values were used. Review widening.')
  }
  insideWideningM += design.insideWideningM ?? 0
  outsideWideningM += design.outsideWideningM ?? 0
  // A curve's own widening on a side takes the place of the rule's there (RoadEng's Auto off).
  const wideningSource = {
    inside: curve?.insideWideningM !== undefined ? ('stated' as const) : ('rule' as const),
    outside: curve?.outsideWideningM !== undefined ? ('stated' as const) : ('rule' as const),
  }
  if (curve?.insideWideningM !== undefined) insideWideningM = curve.insideWideningM
  if (curve?.outsideWideningM !== undefined) outsideWideningM = curve.outsideWideningM
  let minimumSpeedRadiusM: number
  if (table) {
    const smallest = curveTableMinimumRadius(table, designSpeedKmh)
    minimumSpeedRadiusM = smallest === null ? Infinity : smallest / (curve?.tableRadiusScale ?? 1)
  } else if (sideFrictionMethod) {
    const denominator = SIDE_FRICTION_GRAVITY * (maxSuperelevationPercent / 100 + maxSideFriction)
    minimumSpeedRadiusM =
      denominator > 0 ? (designSpeedKmh / 3.6) ** 2 / denominator / (curve?.tableRadiusScale ?? 1) : Infinity
  } else {
    const friction = sideFrictionLimit ?? design.sideFrictionFactor
    const denominator = 127 * (maxSuperelevationPercent / 100 + friction)
    minimumSpeedRadiusM = denominator > 0 ? designSpeedKmh ** 2 / denominator : Infinity
  }
  return {
    requiredSuperelevationPercent,
    appliedSuperelevationPercent,
    insideWideningM,
    outsideWideningM,
    /** Where each side's widening comes from: the road's rule, or the curve's own value. */
    wideningSource,
    minimumSpeedRadiusM,
    warnings,
    designSpeedKmh,
    maxSuperelevationPercent,
    superelevationSource,
    /** Where the table lookup landed in table mode; null in formula mode. */
    tableStatus,
    runoffInM,
    runoffOutM,
    /** Share of each runoff outside the curve; 1 when the road states none. */
    transitionFraction,
    /**
     * Side friction the curve demands at its speed and applied superelevation, V²/(127 R) − e; in the
     * side friction method V²/(g R) − e with g = 9.81 m/s², as RoadEng gives it.
     */
    sideFrictionDemand,
    /**
     * The side friction table's limit at the curve's speed, null without a table; in the side
     * friction method the curve's f max.
     */
    sideFrictionLimit,
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

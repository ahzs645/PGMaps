/**
 * Height–age curves for the recovery timeline, read from a Castor scenario's yield table.
 *
 * `/dev/forestry/castor` grows stands on yield curves (`curveId,age,volume,height`, or
 * castordb's `yieldid`/`tvol`). The recovery timeline needs only height by age, the
 * figure green-up is tested on, so this keeps each curve's height and drops the rest.
 * A curve is kept as the source gave it: never smoothed, extended or fitted. One whose
 * height falls with age cannot say when a stand reached a height, so it is left out
 * and named. No DOM or network access: the Castor readers are passed in.
 */

export type HeightPoint = { age: number; height: number }

/** A named curve the reviewer can give a block, from a file they loaded. */
export type LibraryCurve = {
  id: string
  /** The curve's own ID in the source, e.g. `"1042"`. */
  label: string
  /** File and table it came from, printed beside every figure that uses it. */
  source: string
  points: HeightPoint[]
}

export const MAX_LIBRARY_CURVES = 60
export const MAX_CURVE_POINTS = 300
/** Castor's yield tables run to 350 years (castordb's `yields`); the typed curve field stops at 300. */
const MAX_AGE = 500
const MAX_HEIGHT = 100

/** Why a point list is not a usable height–age curve, or null when it is. */
export function heightCurveProblem(points: ReadonlyArray<HeightPoint>): string | null {
  if (points.length < 2) return 'needs at least two ages'
  if (points.length > MAX_CURVE_POINTS) return `has more than ${MAX_CURVE_POINTS} ages`
  for (const p of points)
    if (
      !Number.isFinite(p.age) ||
      !Number.isFinite(p.height) ||
      p.age < 0 ||
      p.age > MAX_AGE ||
      p.height < 0 ||
      p.height > MAX_HEIGHT
    )
      return `has an age or height out of range (ages 0–${MAX_AGE}, heights 0–${MAX_HEIGHT} m)`
  for (let i = 1; i < points.length; i++) {
    if (points[i].age === points[i - 1].age) return `repeats age ${points[i].age}`
    if (points[i].height < points[i - 1].height)
      return `falls from ${points[i - 1].height} m at age ${points[i - 1].age}`
  }
  return null
}

export type CurveRead = {
  curves: LibraryCurve[]
  /** Curves left out, each with its reason. */
  skipped: string[]
}

/** Castor yield curves (`{ id, points: [{ age, height, … }] }`) as height–age curves. */
export function heightCurvesFromYields(
  yields: ReadonlyArray<{ id: string; points: ReadonlyArray<{ age: number; height: number }> }>,
  source: string,
): CurveRead {
  const curves: LibraryCurve[] = []
  const skipped: string[] = []
  for (const curve of yields) {
    const points = curve.points
      .map((p) => ({ age: Number(p.age), height: Number(p.height) }))
      .sort((a, b) => a.age - b.age)
    const problem = heightCurveProblem(points)
    if (problem) {
      skipped.push(`Curve ${curve.id} ${problem}.`)
      continue
    }
    if (curves.length >= MAX_LIBRARY_CURVES) {
      skipped.push(`Curve ${curve.id}: only the first ${MAX_LIBRARY_CURVES} curves are kept.`)
      continue
    }
    curves.push({ id: `castor:${curve.id}`, label: curve.id, source, points })
  }
  return { curves, skipped }
}

const pick = (row: Record<string, unknown>, ...keys: string[]): unknown => {
  for (const key of keys) {
    const found = Object.keys(row).find((name) => name.trim().toLowerCase() === key.toLowerCase())
    if (found !== undefined) return row[found]
  }
  return undefined
}

/**
 * A Castor `yields.csv` (or castordb `yields` table) as height–age curves. Rows are
 * grouped by `curveId` (or `yieldid`); `age` and `height` are required on every row.
 */
export function heightCurvesFromYieldRows(rows: ReadonlyArray<Record<string, unknown>>, source: string): CurveRead {
  if (!rows.length) throw new Error('The yield table has no rows.')
  const first = rows[0]
  if (pick(first, 'curveId', 'yieldid') === undefined || pick(first, 'age') === undefined)
    throw new Error('A Castor yield table needs curveId (or yieldid) and age columns.')
  if (pick(first, 'height') === undefined)
    throw new Error('This yield table has no height column, so it cannot say when a stand greens up.')
  const grouped = new Map<string, Array<{ age: number; height: number }>>()
  rows.forEach((row, index) => {
    const id = String(pick(row, 'curveId', 'yieldid') ?? '').trim()
    const age = Number(pick(row, 'age'))
    const raw = pick(row, 'height')
    const height = raw === '' || raw === null || raw === undefined ? Number.NaN : Number(raw)
    if (!id) throw new Error(`Yield row ${index + 2} has no curve ID.`)
    const list = grouped.get(id) ?? []
    list.push({ age, height })
    grouped.set(id, list)
  })
  return heightCurvesFromYields(
    [...grouped].map(([id, points]) => ({ id, points })),
    source,
  )
}

/** The readers a file needs, passed in so this module stays free of Castor's import code. */
export type CastorReaders = {
  csvRows: (text: string) => Array<Record<string, unknown>>
  /** A Castor session or project JSON, as `/dev/forestry/castor` saves it. */
  projectYields: (text: string) => Array<{ id: string; points: Array<{ age: number; height: number }> }>
}

/** Height–age curves from a Castor `yields.csv` or a saved Castor session or project. */
export function readCastorHeightCurves(fileName: string, text: string, readers: CastorReaders): CurveRead {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.json'))
    return heightCurvesFromYields(readers.projectYields(text), `Castor project ${fileName}, yield curves`)
  if (lower.endsWith('.csv')) return heightCurvesFromYieldRows(readers.csvRows(text), `Castor yield table ${fileName}`)
  throw new Error('Load a Castor yields.csv, or a session or project JSON saved from the Castor workbench.')
}

/**
 * The first age a curve reaches `height`, by straight lines between its ages, or null when it
 * never does within its recorded ages. Never extrapolated.
 */
export function ageReaching(points: ReadonlyArray<HeightPoint>, height: number): number | null {
  if (!points.length || !Number.isFinite(height)) return null
  if (points[0].height >= height) return points[0].age
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i]
    if (b.height >= height) return a.age + ((height - a.height) * (b.age - a.age)) / (b.height - a.height)
  }
  return null
}

import type { CastorConfig, CastorConstraint, CastorConstraintRow, CastorPixel, CastorPredicate } from './types'

type Scalar = number | string | boolean | null | undefined
export function pixelValue(pixel: CastorPixel, field: string): Scalar {
  if (Object.prototype.hasOwnProperty.call(pixel, field)) {
    const value = (pixel as unknown as Record<string, unknown>)[field]
    return typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean' || value === null
      ? value
      : undefined
  }
  return Object.prototype.hasOwnProperty.call(pixel.attributes ?? {}, field) ? pixel.attributes?.[field] : undefined
}

/** Restricted expression tree; no SQL, eval, Function constructor, or coercive comparisons. */
export function matchesPredicate(pixel: CastorPixel, predicate: CastorPredicate): boolean {
  return predicateValue(pixel, predicate) === true
}

/** Preserve unknown/missing values under NOT, AND, and OR, as in SQL WHERE clauses. */
function predicateValue(pixel: CastorPixel, predicate: CastorPredicate): boolean | null {
  if ('all' in predicate) {
    let unknown = false
    for (const part of predicate.all) {
      const value = predicateValue(pixel, part)
      if (value === false) return false
      if (value === null) unknown = true
    }
    return unknown ? null : true
  }
  if ('any' in predicate) {
    let unknown = false
    for (const part of predicate.any) {
      const value = predicateValue(pixel, part)
      if (value === true) return true
      if (value === null) unknown = true
    }
    return unknown ? null : false
  }
  if ('not' in predicate) {
    const value = predicateValue(pixel, predicate.not)
    return value === null ? null : !value
  }
  const value = pixelValue(pixel, predicate.field)
  if (value === undefined || value === null) return null
  switch (predicate.op) {
    case 'eq':
      return value === predicate.value
    case 'ne':
      return value !== predicate.value
    case 'gt':
      return typeof value === 'number' && typeof predicate.value === 'number' ? value > predicate.value : null
    case 'ge':
      return typeof value === 'number' && typeof predicate.value === 'number' ? value >= predicate.value : null
    case 'lt':
      return typeof value === 'number' && typeof predicate.value === 'number' ? value < predicate.value : null
    case 'le':
      return typeof value === 'number' && typeof predicate.value === 'number' ? value <= predicate.value : null
  }
}

export function activeConstraint(constraint: CastorConstraint, elapsedYears: number): boolean {
  return elapsedYears >= (constraint.startYear ?? 0) && elapsedYears <= (constraint.stopYear ?? Infinity)
}

export function inConstraint(pixel: CastorPixel, constraint: CastorConstraint): boolean {
  return (
    pixel.owned &&
    pixel.zones[constraint.zone] === constraint.zoneId &&
    (!constraint.denominator || matchesPredicate(pixel, constraint.denominator))
  )
}

function conditionMet(pixel: CastorPixel, constraint: CastorConstraint): boolean {
  if (constraint.condition) return matchesPredicate(pixel, constraint.condition)
  const value = pixelValue(pixel, constraint.variable ?? 'age')
  return (
    typeof value === 'number' &&
    (constraint.type === 'ge' ? value >= (constraint.threshold ?? 0) : value <= (constraint.threshold ?? 0))
  )
}

const numeric = (pixel: CastorPixel, field: string): number => {
  const value = pixelValue(pixel, field)
  return typeof value === 'number' && Number.isFinite(value) ? value : -Infinity
}
const compareNumeric = (a: number, b: number): number => (a === b ? 0 : a < b ? -1 : 1)

/** Ordering mirrors forestryCastor's SQL, including its le inverse-predicate ordering. */
export function rankConstraintIndices(
  pixels: CastorPixel[],
  indices: number[],
  constraint: CastorConstraint,
  protectedMask: Uint8Array,
): number[] {
  return [...indices].sort((ai, bi) => {
    const a = pixels[ai]
    const b = pixels[bi]
    const variable = constraint.variable ?? 'age'
    if (variable !== 'eca') {
      const matchA = conditionMet(a, constraint)
      const matchB = conditionMet(b, constraint)
      if (matchA !== matchB) return constraint.type === 'ge' ? (matchA ? -1 : 1) : matchA ? 1 : -1
    }
    if (variable === 'distance' && constraint.type === 'ge')
      return compareNumeric(b.distance, a.distance) || compareNumeric(b.age, a.age) || a.id - b.id
    const landBase = compareNumeric(a.thlbHa, b.thlbHa) || protectedMask[bi] - protectedMask[ai]
    if (landBase) return landBase
    if (variable === 'eca') return compareNumeric(b.eca, a.eca) || a.id - b.id
    if (variable === 'distance') return compareNumeric(b.distance, a.distance) || a.id - b.id
    const field = constraint.condition ? 'age' : variable
    const difference = compareNumeric(numeric(a, field), numeric(b, field))
    return (constraint.type === 'ge' ? -difference : difference) || a.id - b.id
  })
}

export interface ConstraintEvaluation {
  protectedMask: Uint8Array
  protectedByConstraint: Map<string, Set<number>>
}

export function evaluateConstraints(
  pixels: CastorPixel[],
  constraints: CastorConstraint[],
  elapsedYears: number,
): ConstraintEvaluation {
  const protectedMask = new Uint8Array(pixels.length)
  const protectedByConstraint = new Map<string, Set<number>>()
  // Permanent/no-harvest constraints precede other reservations, as in the source SQL.
  const active = constraints.filter((constraint) => activeConstraint(constraint, elapsedYears))
  for (const constraint of active.filter((item) => item.type === 'nh')) {
    const selected = new Set<number>()
    pixels.forEach((pixel, i) => {
      if (inConstraint(pixel, constraint)) {
        protectedMask[i] = 1
        selected.add(i)
      }
    })
    protectedByConstraint.set(constraint.id, selected)
  }
  for (const constraint of active.filter((item) => item.type !== 'nh')) {
    const candidates: number[] = []
    let denominatorHa = 0
    let currentEca = 0
    pixels.forEach((pixel, i) => {
      if (inConstraint(pixel, constraint)) {
        candidates.push(i)
        denominatorHa += pixel.areaHa
        currentEca += pixel.eca * pixel.thlbHa
      }
    })
    const retainedFraction =
      constraint.type === 'ge' ? (constraint.percentage ?? 0) / 100 : 1 - (constraint.percentage ?? 0) / 100
    const requested =
      constraint.variable === 'eca'
        ? denominatorHa - Math.max(0, (denominatorHa * (constraint.threshold ?? 0)) / 100 - currentEca)
        : denominatorHa * retainedFraction
    const requiredHa = Math.max(0, Math.min(denominatorHa, requested))
    const selected = new Set<number>()
    let retainedHa = 0
    // Reserve whole input pixels until the area target is met. This conservatively handles
    // irregular areas; the R implementation rounds a count and assumes one-ha cells.
    for (const i of rankConstraintIndices(pixels, candidates, constraint, protectedMask)) {
      if (retainedHa + 1e-10 >= requiredHa) break
      selected.add(i)
      protectedMask[i] = 1
      retainedHa += pixels[i].areaHa
    }
    protectedByConstraint.set(constraint.id, selected)
  }
  return { protectedMask, protectedByConstraint }
}

export function constraintReports(
  pixels: CastorPixel[],
  constraints: CastorConstraint[],
  config: CastorConfig,
  period: number,
  evaluation: ConstraintEvaluation,
  phase: CastorConstraintRow['phase'],
): CastorConstraintRow[] {
  const elapsedYears = period * config.stepYears
  return constraints
    .filter((constraint) => activeConstraint(constraint, elapsedYears))
    .map((constraint) => {
      let denominatorHa = 0
      let qualifyingHa = 0
      let ecaHa = 0
      let protectedHa = 0
      const protectedIndices = evaluation.protectedByConstraint.get(constraint.id)
      pixels.forEach((pixel, i) => {
        if (!inConstraint(pixel, constraint)) return
        denominatorHa += pixel.areaHa
        if (conditionMet(pixel, constraint)) qualifyingHa += pixel.areaHa
        ecaHa += pixel.eca * pixel.thlbHa
        if (protectedIndices?.has(i)) protectedHa += pixel.areaHa
      })
      const isEca = constraint.variable === 'eca'
      const actualPercent =
        denominatorHa > 0
          ? ((constraint.type === 'nh' ? protectedHa : isEca ? ecaHa : qualifyingHa) / denominatorHa) * 100
          : 0
      const targetPercent =
        constraint.type === 'nh' ? 100 : isEca ? (constraint.threshold ?? 0) : (constraint.percentage ?? 0)
      return {
        scenario: config.scenario,
        period,
        year: config.startYear + elapsedYears,
        elapsedYears,
        phase,
        constraintId: constraint.id,
        zone: constraint.zone,
        zoneId: constraint.zoneId,
        type: constraint.type,
        variable: constraint.variable ?? (constraint.condition ? 'multi' : 'none'),
        threshold: constraint.threshold ?? null,
        targetPercent,
        actualPercent,
        denominatorHa,
        protectedHa,
        met:
          denominatorHa > 0 &&
          (constraint.type === 'le' ? actualPercent <= targetPercent + 1e-9 : actualPercent + 1e-9 >= targetPercent),
      }
    })
}

/** Guard the actual post-harvest ECA budget, in addition to the source's reservation queue. */
export function canApplyEcaChange(
  pixels: CastorPixel[],
  changes: Array<{ index: number; eca: number }>,
  constraints: CastorConstraint[],
  elapsedYears: number,
): boolean {
  return ecaChangeAllowed(pixels, changes, createEcaBudgets(pixels, constraints, elapsedYears))
}

export interface EcaBudget {
  indices: Set<number>
  current: number
  limit: number
}
export function createEcaBudgets(
  pixels: CastorPixel[],
  constraints: CastorConstraint[],
  elapsedYears: number,
): EcaBudget[] {
  return constraints
    .filter((constraint) => constraint.variable === 'eca' && activeConstraint(constraint, elapsedYears))
    .map((constraint) => {
      const indices = new Set<number>()
      let area = 0
      let current = 0
      pixels.forEach((pixel, index) => {
        if (inConstraint(pixel, constraint)) {
          indices.add(index)
          area += pixel.areaHa
          current += pixel.eca * pixel.thlbHa
        }
      })
      return { indices, current, limit: (area * (constraint.threshold ?? 0)) / 100 }
    })
}
export function ecaChangeAllowed(
  pixels: CastorPixel[],
  changes: Array<{ index: number; eca: number }>,
  budgets: EcaBudget[],
): boolean {
  return budgets.every((budget) => {
    const delta = changes.reduce(
      (sum, change) =>
        sum +
        (budget.indices.has(change.index) ? (change.eca - pixels[change.index].eca) * pixels[change.index].thlbHa : 0),
      0,
    )
    return delta <= 1e-10 || budget.current + delta <= budget.limit + 1e-9
  })
}
export function commitEcaChange(
  pixels: CastorPixel[],
  changes: Array<{ index: number; eca: number }>,
  budgets: EcaBudget[],
): void {
  for (const budget of budgets)
    for (const change of changes)
      if (budget.indices.has(change.index))
        budget.current += (change.eca - pixels[change.index].eca) * pixels[change.index].thlbHa
}

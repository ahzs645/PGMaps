import { analyzeRoad, validateRoadInputs } from './engine'
import { EngineeringInputError, invalidInputNotice, type InvalidInput } from './inputErrors'
import type { Alignment, ContextFeature, DesignInputs, RoadAnalysis, RoadSettings, TerrainSource } from './types'

/**
 * Coverage at or above this share of road length counts as complete sections: 100 % less a
 * floating-point tolerance on the summed interval lengths. The engine's coverage warning and the
 * engineering result's completeness use the same rule; compare with `hasCompleteCoverage`.
 */
export const COMPLETE_COVERAGE_PERCENT = 100 - 1e-5

export const hasCompleteCoverage = (analysis: Pick<RoadAnalysis, 'coveragePercent'>) =>
  analysis.coveragePercent >= COMPLETE_COVERAGE_PERCENT

export type { DesignInputs } from './types'

export const designInputsOf = (alignment: Alignment): DesignInputs => ({
  template: alignment.template,
  engineering: alignment.engineering,
  overrides: alignment.overrides,
  curveDesign: alignment.curveDesign,
})

/**
 * The road its results were calculated from: the road itself, or the road with its invalid inputs
 * at their last valid values. Anything that shows or prints an input beside a result reads this, so
 * a template is never printed beside quantities it did not produce.
 */
export const calculatedAlignment = (
  alignment: Alignment,
  analysis: Pick<RoadAnalysis, 'calculatedInputs'> | undefined,
): Alignment => (analysis?.calculatedInputs ? { ...alignment, ...analysis.calculatedInputs } : alignment)

const failure = (cause: unknown): InvalidInput => ({
  message: cause instanceof Error ? cause.message : 'This input cannot be calculated.',
  ...(cause instanceof EngineeringInputError ? { target: cause.target } : {}),
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const sameValue = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b)
const entryIds = (list: readonly unknown[]): string[] | null => {
  const ids = list.map((item) => (isRecord(item) && typeof item.id === 'string' ? item.id : null))
  return ids.every((id) => id !== null) && new Set(ids).size === ids.length ? (ids as string[]) : null
}
/** True when both lists hold entries with distinct ids and the shared entries keep their order. */
function matchedById(current: readonly unknown[], valid: readonly unknown[]): boolean {
  const a = entryIds(current),
    b = entryIds(valid)
  if (!a || !b) return false
  const inA = new Set(a),
    inB = new Set(b)
  const sharedB = b.filter((id) => inA.has(id))
  return a.filter((id) => inB.has(id)).every((id, i) => id === sharedB[i])
}

/**
 * `current` with the last valid value wherever `revert(path)` says so. It asks once for each
 * smallest difference: a field, or one entry of a list whose entries carry ids (an added entry is
 * left out, a removed one put back where it was). Everything else stays as entered.
 */
function blend(current: unknown, valid: unknown, path: string, revert: (path: string) => boolean): unknown {
  if (current === valid) return current
  if (isRecord(current) && isRecord(valid)) {
    const out: Record<string, unknown> = {}
    for (const key of new Set([...Object.keys(current), ...Object.keys(valid)])) {
      const inCurrent = current[key] !== undefined,
        inValid = valid[key] !== undefined
      if (inCurrent && inValid) out[key] = blend(current[key], valid[key], `${path}.${key}`, revert)
      else if (inCurrent || inValid) {
        const useValid = revert(`${path}.${key}`)
        if (useValid ? inValid : inCurrent) out[key] = (useValid ? valid : current)[key]
      }
    }
    return out
  }
  if (Array.isArray(current) && Array.isArray(valid) && matchedById(current, valid)) {
    const id = (item: unknown) => (item as { id: string }).id
    const validById = new Map(valid.map((item) => [id(item), item]))
    const currentIds = new Set(current.map(id))
    const out: unknown[] = []
    for (const item of current) {
      const before = validById.get(id(item))
      if (before !== undefined) out.push(blend(item, before, `${path}[${id(item)}]`, revert))
      else if (!revert(`${path}[${id(item)}]`)) out.push(item)
    }
    valid.forEach((item, index) => {
      if (currentIds.has(id(item)) || !revert(`${path}[${id(item)}]`)) return
      // A removed entry returns after the entry it used to follow.
      let at = 0
      for (let i = index - 1; i >= 0; i--) {
        const found = out.findIndex((other) => id(other) === id(valid[i]))
        if (found >= 0) {
          at = found + 1
          break
        }
      }
      out.splice(at, 0, item)
    })
    return out
  }
  return sameValue(current, valid) ? current : revert(path) ? valid : current
}

/** Past this many differences the search is not worth its time; the whole last valid set is used. */
const MAX_INPUT_DIFFERENCES = 500
/** Inputs that can be invalid at once and still be told apart. */
const MAX_INVALID_AT_ONCE = 8

/**
 * The current inputs with as little as possible put back to its last valid value for `check` to
 * pass, and the message of each input left out. Null when no such set is found: the current inputs
 * pass (so the failure is elsewhere), nothing differs, or too much does.
 *
 * One invalid input is the usual case and is found by trying each difference alone. With several,
 * differences are put back one at a time while the reported failure changes, then every one that
 * turns out not to be needed is restored.
 */
function withoutInvalidInputs(
  current: DesignInputs,
  lastValid: DesignInputs,
  check: (inputs: DesignInputs) => void,
): { inputs: DesignInputs; problems: InvalidInput[] } | null {
  const problemOf = (inputs: DesignInputs): InvalidInput | null => {
    try {
      check(inputs)
      return null
    } catch (cause) {
      return failure(cause)
    }
  }
  const first = problemOf(current)
  if (!first) return null
  const differences: string[] = []
  blend(current, lastValid, '', (path) => (differences.push(path), false))
  if (!differences.length || differences.length > MAX_INPUT_DIFFERENCES) return null
  const without = (left: ReadonlySet<string>) => blend(current, lastValid, '', (path) => left.has(path)) as DesignInputs

  let left = new Set<string>()
  const alone = differences.find((path) => !problemOf(without(new Set([path]))))
  if (alone) left.add(alone)
  else {
    let problem: InvalidInput | null = first
    while (problem && left.size < MAX_INVALID_AT_ONCE) {
      let next: { path: string; problem: InvalidInput | null } | null = null
      for (const path of differences) {
        if (left.has(path)) continue
        const after = problemOf(without(new Set([...left, path])))
        // Prefer the difference that clears every failure; else the first that clears this one.
        if (!after) {
          next = { path, problem: null }
          break
        }
        if (!next && after.message !== problem.message) next = { path, problem: after }
      }
      if (!next) return null
      left.add(next.path)
      problem = next.problem
    }
    if (problem) return null
    // Putting one input back can surface a failure another one hid; restore what was not needed.
    for (const path of [...left]) {
      const fewer = new Set(left)
      fewer.delete(path)
      if (!problemOf(without(fewer))) left = fewer
    }
  }
  // Each input's own message is the failure that returns when it alone is restored.
  const problems = [first]
  for (const path of left) {
    const fewer = new Set(left)
    fewer.delete(path)
    const problem = problemOf(without(fewer))
    if (problem && !problems.some((known) => known.message === problem.message)) problems.push(problem)
  }
  return { inputs: without(left), problems }
}

/**
 * Invalid intermediate edits must be reviewable without taking down the workspace. With
 * `lastValid` (the inputs of the last analysis that calculated), a failure returns the road
 * calculated on the current line with only the invalid input at its last valid value, so a valid
 * edit made after an invalid one still takes effect. `invalidInput` names what was left out,
 * `calculatedInputs` holds what was used, and the first warning says both. Where the invalid input
 * cannot be told apart, the whole last valid set is used and `invalidInput.leftOut` is `all`.
 * Without `lastValid`, or when the line itself is the problem, the result is empty and its warning
 * says why.
 */
export function safeAnalyzeRoad(
  alignment: Alignment,
  source: TerrainSource,
  settings: RoadSettings,
  context: ContextFeature[] = [],
  options: Parameters<typeof analyzeRoad>[4] = {},
  lastValid?: DesignInputs,
): RoadAnalysis {
  try {
    return analyzeRoad(alignment, source, settings, context, options)
  } catch (cause) {
    const invalidInput = failure(cause)
    if (lastValid) {
      const kept = (inputs: DesignInputs, invalid: InvalidInput): RoadAnalysis | null => {
        try {
          const result = analyzeRoad({ ...alignment, ...inputs }, source, settings, context, options)
          if (!result.stations.length) return null
          return {
            ...result,
            warnings: [invalidInputNotice(invalid), ...result.warnings],
            invalidInput: invalid,
            calculatedInputs: inputs,
          }
        } catch {
          return null
        }
      }
      const narrowed = withoutInvalidInputs(designInputsOf(alignment), lastValid, (inputs) =>
        validateRoadInputs({ ...alignment, ...inputs }, settings),
      )
      const others = narrowed?.problems.slice(1).map((problem) => problem.message) ?? []
      const result =
        (narrowed &&
          kept(narrowed.inputs, {
            ...narrowed.problems[0],
            ...(others.length ? { others } : {}),
            leftOut: 'input',
          })) ??
        // The line or the settings may be the problem, not the latest input: `kept` then fails too.
        kept(lastValid, { ...invalidInput, leftOut: 'all' })
      if (result) return result
    }
    return {
      stations: [],
      centerline: alignment.points.map((p) => p.coordinate),
      crossings: [],
      length: 0,
      cutVolumeM3: 0,
      fillVolumeM3: 0,
      balanceM3: 0,
      surfaceVolumeM3: 0,
      clearingAreaM2: 0,
      estimatedCost: 0,
      maxGradePercent: 0,
      completeLength: 0,
      coveragePercent: 0,
      warnings: [
        invalidInput.target
          ? `Correct this input before calculating: ${invalidInput.message}`
          : `Correct this alignment before calculating: ${cause instanceof Error ? cause.message : 'Invalid geometry.'}`,
      ],
      invalidInput,
    }
  }
}

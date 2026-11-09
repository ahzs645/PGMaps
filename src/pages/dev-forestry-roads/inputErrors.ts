/**
 * Validation failures that know which engineering input caused them, so the workspace can keep the
 * last valid road on screen and put the message beside that input. No DOM or network access.
 */

/** The editor list an invalid input belongs to; `template` is the road's own base section. */
export type EngineeringInputList =
  | 'template'
  | 'templates'
  | 'assignments'
  | 'materials'
  | 'strata'
  | 'culverts'
  | 'sites'
  | 'sitePreparation'
  | 'fillRequirements'
  | 'directionRanges'
  | 'sidecastRanges'
  | 'haul'

export interface EngineeringInputTarget {
  list: EngineeringInputList
  /** The entry in that list; omitted for the base template and the haul settings. */
  id?: string
  /** The property of the entry that has to change, where one field is at fault. */
  field?: string
}

export class EngineeringInputError extends Error {
  readonly target: EngineeringInputTarget
  constructor(message: string, target: EngineeringInputTarget) {
    super(message)
    this.name = 'EngineeringInputError'
    this.target = target
  }
}

/** The failure an analysis carries while it shows the last valid inputs instead of the current ones. */
export interface InvalidInput {
  message: string
  target?: EngineeringInputTarget
}

const plain = (value: number) => Number(value.toFixed(3)).toLocaleString('en-CA', { maximumFractionDigits: 3 })

/** Throws for a value outside `low`–`high`, naming the entry, the field and the allowed range. */
export function requireInRange(
  value: unknown,
  low: number,
  high: number,
  owner: string,
  label: string,
  target: EngineeringInputTarget,
): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high)
    throw new EngineeringInputError(`${owner}: ${label} must be ${plain(low)} to ${plain(high)}.`, target)
}

/** Throws unless `start`–`end` is an increasing station range inside 0–100,000 m. */
export function requireStationRange(
  start: unknown,
  end: unknown,
  owner: string,
  target: Omit<EngineeringInputTarget, 'field'>,
): void {
  requireInRange(start, 0, 100000, owner, 'start station (m)', { ...target, field: 'start' })
  requireInRange(end, 0, 100000, owner, 'end station (m)', { ...target, field: 'end' })
  if (end <= start)
    throw new EngineeringInputError(
      `${owner}: the end station (${plain(end)} m) must be greater than the start station (${plain(start)} m).`,
      { ...target, field: 'end' },
    )
}

/** The message for one field of one entry, or for the entry as a whole when no field is named. */
export function inputMessage(
  problem: InvalidInput | undefined,
  list: EngineeringInputList,
  id?: string,
  field?: string,
): string | undefined {
  const target = problem?.target
  if (!target || target.list !== list || target.id !== id) return undefined
  return target.field === field ? problem.message : undefined
}

/**
 * The first stretch of road not already covered by `taken`, for an "Add…" button's default: from
 * `preferredStart` where that is free, else the next gap after it, else the first gap on the road.
 * Null when no gap of at least `minimumM` is left. The result never overlaps an existing range.
 */
export function freeStationRange(
  taken: readonly { start: number; end: number }[],
  lengthM: number,
  preferredStart = 0,
  maximumM = Infinity,
  minimumM = 0.01,
): { start: number; end: number } | null {
  const length = Math.max(0, lengthM)
  const sorted = taken
    .filter((r) => r.end > 0 && r.start < length)
    .map((r) => ({ start: Math.max(0, r.start), end: Math.min(length, r.end) }))
    .sort((a, b) => a.start - b.start)
  const gaps: { start: number; end: number }[] = []
  let cursor = 0
  for (const range of sorted) {
    if (range.start - cursor >= minimumM) gaps.push({ start: cursor, end: range.start })
    cursor = Math.max(cursor, range.end)
  }
  if (length - cursor >= minimumM) gaps.push({ start: cursor, end: length })
  if (!gaps.length) return null
  const from = Math.min(Math.max(0, preferredStart), length)
  const containing = gaps.find((gap) => from >= gap.start && gap.end - from >= minimumM)
  const gap = containing ?? gaps.find((g) => g.start >= from) ?? gaps[0]
  const start = containing ? from : gap.start
  return { start, end: Math.min(gap.end, start + maximumM) }
}

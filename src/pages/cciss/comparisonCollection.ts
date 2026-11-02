import { parseComparisonSnapshot, type ComparisonSnapshot } from './comparison'

export const MAX_SAVED_COMPARISONS = 12

/** Validate and copy at the boundary: future form edits cannot change saved results. */
export function addComparisonSnapshot(
  snapshots: readonly ComparisonSnapshot[],
  value: unknown,
  limit = MAX_SAVED_COMPARISONS,
): readonly ComparisonSnapshot[] {
  const snapshot = parseComparisonSnapshot(value)
  if (snapshots.some((existing) => existing.id === snapshot.id))
    throw new Error('This analysis is already saved. Remove the existing entry before importing it again.')
  if (snapshots.length >= limit)
    throw new Error(`Save at most ${limit} comparisons; remove a saved analysis to add another.`)
  return Object.freeze([...snapshots, snapshot])
}

export function renameComparisonSnapshot(
  snapshots: readonly ComparisonSnapshot[],
  id: string,
  label: string,
): readonly ComparisonSnapshot[] {
  if (!snapshots.some((snapshot) => snapshot.id === id)) throw new Error('The saved analysis was removed.')
  return Object.freeze(
    snapshots.map((snapshot) =>
      snapshot.id === id ? parseComparisonSnapshot({ ...snapshot, label: label.trim() }) : snapshot,
    ),
  )
}

export function removeComparisonSnapshot(
  snapshots: readonly ComparisonSnapshot[],
  id: string,
): readonly ComparisonSnapshot[] {
  return Object.freeze(snapshots.filter((snapshot) => snapshot.id !== id))
}

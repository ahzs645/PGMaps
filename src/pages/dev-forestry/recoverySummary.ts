/**
 * The recovery timeline and the green-up sensitivity, read back as one row per run: the
 * landform's figure on each scale and whether it is inside the objective's range, exactly as
 * each run's summary recorded it (`RunSummary.scales`, from `runHeadline`). Nothing here
 * computes a figure. No DOM or network access.
 */
import type { ToolRun } from './assessmentTools'
import type { HeadlineScale } from './runRevision'
import type { AlterationBasis } from './vqo'

export type RecoveryRow = {
  id: string
  /** The year assessed (timeline) or the green-up age (sensitivity). */
  key: number
  label: string
  perspective: HeadlineScale | null
  planimetric: HeadlineScale | null
  /** The run flagged its figures as provisional, so they are withheld. */
  provisional: boolean
  /** Why the run failed, or null. */
  error: string | null
  /**
   * Partial cuts the run saw, as step 4 adds them to X (Table 6's clearcut equivalent, `via.partialCuts`):
   * null when the run had no partial cut in view, `missing` when one in view lacks its Table 6 inputs.
   */
  partialCuts: { count: number; percent: number | 'missing' } | null
}

export type RecoveryKind = 'timeline' | 'greenup'

const keyOf = (run: ToolRun, kind: RecoveryKind): number | null =>
  kind === 'timeline' ? (run.year ?? null) : (run.greenUpAgeYears ?? null)

function partialCutsOf(run: ToolRun): RecoveryRow['partialCuts'] {
  const seen = (run.summary?.via?.partialCuts ?? []).filter((cut) => cut.visible)
  if (!seen.length) return null
  if (seen.some((cut) => cut.equivalentPercent === null)) return { count: seen.length, percent: 'missing' }
  return { count: seen.length, percent: seen.reduce((sum, cut) => sum + (cut.equivalentPercent ?? 0), 0) }
}

/** The batch's rows in order of year or green-up age. Runs recorded before the scales were kept read as withheld. */
export function recoveryRows(runs: readonly ToolRun[], kind: RecoveryKind): RecoveryRow[] {
  return runs
    .filter((run) => run.kind === kind && keyOf(run, kind) != null)
    .map((run) => {
      const scale = (basis: AlterationBasis) => run.summary?.scales?.find((s) => s.basis === basis) ?? null
      return {
        id: run.id,
        key: keyOf(run, kind)!,
        label: run.name,
        perspective: scale('perspective'),
        planimetric: scale('planimetric'),
        provisional: !!run.summary && !run.summary.quality?.numericalReady,
        error: run.summary ? null : (run.error ?? 'The run did not finish.'),
        partialCuts: partialCutsOf(run),
      }
    })
    .sort((a, b) => a.key - b.key)
}

/**
 * One sentence per scale: in which years (or at which green-up ages) the landform's figure is
 * inside the objective's range. Only the runs listed are described; nothing is interpolated
 * between them.
 */
export function recoveryVerdict(rows: readonly RecoveryRow[], basis: AlterationBasis, kind: RecoveryKind): string {
  const read = rows.map((row) => ({ key: row.key, met: row[basis]?.met ?? null }))
  const known = read.filter((r) => r.met !== null)
  const scaleName = basis === 'perspective' ? 'Perspective' : 'Planimetric'
  const failed = rows.filter((row) => row.error).length
  const withheld = read.length - known.length - failed
  const notes = [withheld ? `${withheld} withheld` : '', failed ? `${failed} failed` : ''].filter(Boolean)
  const tail = notes.length ? ` (${notes.join(', ')})` : ''
  if (!known.length) return `${scaleName}: no figure in any run${tail}.`
  const within = known.filter((r) => r.met).map((r) => r.key)
  const over = known.filter((r) => !r.met).map((r) => r.key)
  const list = (keys: number[]) => keys.join(', ')
  const unit = kind === 'timeline' ? '' : ' years'
  if (!over.length)
    return `${scaleName}: within the objective in every ${kind === 'timeline' ? 'year' : 'age'} run${tail}.`
  if (!within.length)
    return `${scaleName}: over the objective in every ${kind === 'timeline' ? 'year' : 'age'} run${tail}.`
  if (kind === 'timeline') {
    // Years are listed in order; say when it first comes back within and stays there.
    const lastOver = Math.max(...over)
    if (within.every((year) => year > lastOver))
      return `${scaleName}: over the objective in ${list(over)}; within from ${Math.min(...within)}${tail}.`
  }
  return `${scaleName}: within at ${list(within)}${unit}; over at ${list(over)}${unit}${tail}.`
}

/**
 * True when a longer green-up age gives a lower figure somewhere on this scale. It happens: the
 * age also decides which openings are cleared ground, and an opening read as greened up keeps its
 * inventory canopy, which can screen part of the landform behind it.
 */
export function greenUpNotMonotonic(rows: readonly RecoveryRow[], basis: AlterationBasis): boolean {
  const known = rows.flatMap((row) => {
    const percent = row.provisional ? null : (row[basis]?.percent ?? null)
    return percent === null ? [] : [percent]
  })
  return known.some((percent, i) => i > 0 && percent < known[i - 1] - 1e-9)
}

/**
 * Which existing openings the green-up ages compared treat differently, grouped by harvest year:
 * "33 existing openings count at some of these ages and not others: 27 harvested in 2003 (23
 * years old) · 5 in 2005 (21) · 1 in 2010 (16)."
 */
export function greenUpSensitiveSentence(
  openings: ReadonlyArray<{ harvestYear: number; ageYears: number }>,
  ages: readonly number[],
): string {
  const span = `${Math.min(...ages)} and ${Math.max(...ages)} years`
  if (!openings.length)
    return `No existing opening read by age alone is between ${span} old, so the green-up age should not move the figure.`
  const byYear = new Map<number, { count: number; age: number }>()
  for (const o of openings) {
    const entry = byYear.get(o.harvestYear) ?? { count: 0, age: o.ageYears }
    entry.count++
    byYear.set(o.harvestYear, entry)
  }
  const groups = [...byYear]
    .sort((a, b) => a[0] - b[0])
    .map(([year, { count, age }], i) =>
      i === 0 ? `${count} harvested in ${year} (${age} years old)` : `${count} in ${year} (${age})`,
    )
  const n = openings.length
  return `${n} existing opening${n === 1 ? '' : 's'} count${n === 1 ? 's' : ''} at some ages between ${span} and not at others: ${groups.join(' · ')}.`
}

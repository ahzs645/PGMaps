import type { CulvertScheduleRow } from './culvertSchedule'

/** A navigation summary of existing checks, never a new engineering verdict. */
export function culvertInventoryStatus(
  row: CulvertScheduleRow | undefined,
  warnings: readonly string[] = [],
  invalid = false,
): { label: string; tone: 'danger' | 'warning' | 'neutral' | 'success' } {
  if (invalid) return { label: 'Invalid input', tone: 'danger' }
  if (!row) return { label: 'Not calculated', tone: 'neutral' }
  if (warnings.length || row.class.major || row.checks.some((check) => check.state === 'not-met'))
    return { label: 'Needs attention', tone: 'warning' }
  if (!row.checks.length || row.checks.some((check) => check.state === 'not-assessed'))
    return { label: 'Not fully assessed', tone: 'neutral' }
  return { label: 'Checks met', tone: 'success' }
}

/**
 * The limits a support layout is judged by, one row each, in the three states `readiness.ts`
 * uses: met, not met, or not assessed when the check could not be made. Pure.
 */
import type { CableLayoutResult } from './cableLayout'
import type { CableSupportLayout } from './settings'

export type LayoutLimitState = 'met' | 'not-met' | 'not-assessed'
export interface LayoutLimitRow {
  id: string
  label: string
  limit: string
  value: string
  state: LayoutLimitState
}

const f1 = (v: number) => v.toFixed(1)
const f0 = (v: number) => Math.round(v).toLocaleString('en-CA')

export function layoutLimitRows(
  result: CableLayoutResult,
  settings: CableSupportLayout,
  minClearanceM: number,
): LayoutLimitRow[] {
  const rows: LayoutLimitRow[] = []
  rows.push({
    id: 'clearance',
    label: 'Load clearance',
    limit: `≥ ${f1(minClearanceM)} m`,
    value: result.minClearanceM === null ? 'unknown' : `${f1(result.minClearanceM)} m`,
    state: !result.clearanceKnown ? 'not-assessed' : result.spans.every((s) => s.clearanceOk) ? 'met' : 'not-met',
  })
  rows.push({
    id: 'tension',
    label: 'Skyline tension',
    limit: `≤ ${f0(result.allowableKN)} kN`,
    value: result.maxTensionKN === null ? 'unsolved' : `${f0(result.maxTensionKN)} kN`,
    state: result.maxTensionKN === null ? 'not-assessed' : result.tensionOk ? 'met' : 'not-met',
  })
  rows.push(
    settings.cableSystem === 'two-cable'
      ? {
          id: 'gravity',
          label: 'Gravity carriage runs out',
          limit: `falls ≥ ${f1(settings.minGravityGradePercent)}%`,
          value: result.spans.every((s) => s.gravityOk) ? 'everywhere' : 'stops',
          state: result.spans.every((s) => s.gravityOk) ? 'met' : 'not-met',
        }
      : {
          id: 'gravity',
          label: 'Gravity carriage runs out',
          limit: 'two-cable only',
          value: 'multi-cable',
          state: 'not-assessed',
        },
  )
  const intermediate = result.supports.filter((s) => s.liftOffLimitDeg !== null)
  const ends = result.supports.filter((s) => s.liftOffLimitDeg === null && s.loadedLimitDeg !== null)
  const maxOf = (list: typeof intermediate) =>
    list.reduce<number | null>(
      (m, s) => (s.loadedBreakDeg === null ? m : Math.max(m ?? -Infinity, s.loadedBreakDeg)),
      null,
    )
  const minEmpty = intermediate.reduce<number | null>(
    (m, s) => (s.emptyBreakDeg === null ? m : Math.min(m ?? Infinity, s.emptyBreakDeg)),
    null,
  )
  const loadedMid = maxOf(intermediate)
  rows.push({
    id: 'loaded-intermediate',
    label: 'Loaded break, intermediate supports',
    limit: `≤ ${f1(settings.maxLoadedDeg)}°`,
    value: intermediate.length === 0 ? 'none' : loadedMid === null ? 'unsolved' : `${f1(loadedMid)}°`,
    state:
      intermediate.length === 0
        ? 'met'
        : loadedMid === null
          ? 'not-assessed'
          : loadedMid <= settings.maxLoadedDeg + 1e-9
            ? 'met'
            : 'not-met',
  })
  const loadedEnd = maxOf(ends)
  rows.push({
    id: 'loaded-end',
    label: 'Loaded break, end supports',
    limit: `≤ ${f1(settings.maxLoadedEndDeg)}°`,
    value: ends.length === 0 ? 'none' : loadedEnd === null ? 'unsolved' : `${f1(loadedEnd)}°`,
    state:
      ends.length === 0
        ? 'met'
        : loadedEnd === null
          ? 'not-assessed'
          : loadedEnd <= settings.maxLoadedEndDeg + 1e-9
            ? 'met'
            : 'not-met',
  })
  rows.push({
    id: 'lift-off',
    label: 'Empty break (lift-off)',
    limit: `≥ ${f1(settings.liftOffDeg)}°`,
    value: intermediate.length === 0 ? 'none' : minEmpty === null ? 'unsolved' : `${f1(minEmpty)}°`,
    state:
      intermediate.length === 0
        ? 'met'
        : minEmpty === null
          ? 'not-assessed'
          : minEmpty >= settings.liftOffDeg - 1e-9
            ? 'met'
            : 'not-met',
  })
  const lugs = intermediate.filter((s) => s.emptyBreakDeg !== null && s.emptyBreakDeg < settings.holdDownDeg)
  rows.push({
    id: 'hold-down',
    label: 'Hold-down lug',
    limit: `needed below ${f1(settings.holdDownDeg)}°`,
    value: lugs.length === 0 ? 'not needed' : `at ${lugs.map((s) => `${f0(s.stationM)} m`).join(', ')}`,
    state: lugs.length === 0 ? 'met' : 'not-met',
  })
  return rows
}

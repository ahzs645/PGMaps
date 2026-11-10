/**
 * Shared state for adjusting a D-line's support layout by hand, read by the sidebar section and
 * the D-line chart alike:
 *
 * - the re-check of the edited layout, started `EDIT_CHECK_DELAY_MS` after the last change. A newer
 *   edit cancels the pending timer and terminates a check still running, so only the latest edit's
 *   result is ever kept as current. The last finished result stays drawn while the next one runs.
 * - the row picked in the sidebar to locate on the chart and the plan.
 */
import { useSyncExternalStore } from 'react'
import type { CableLayoutInput, CableLayoutResult, LayoutToAnalyse } from './cableLayout'
import { analyzeCableLayout } from './cableLayoutClient'
import { EDIT_CHECK_DELAY_MS } from './layoutEdit'

export interface EditCheckEntry {
  /** `layoutKey` of the D-line the check was made for. */
  lineKey: string
  /** `editCheckKey` of the edit it checked. */
  checkKey: string
  status: 'pending' | 'running' | 'done' | 'error'
  result?: CableLayoutResult
  /** The latest finished result on this D-line, kept to draw while a newer check runs. */
  last?: { lineKey: string; checkKey: string; result: CableLayoutResult }
  error?: string
}

interface Job {
  timer?: ReturnType<typeof setTimeout>
  abort?: AbortController
}

const checks = new Map<string, EditCheckEntry>()
const jobs = new Map<string, Job>()
let focus: LayoutFocusRequest | null = null
let focusSeq = 0
const listeners = new Set<() => void>()
let version = 0
const emit = () => {
  version++
  for (const l of listeners) l()
}
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

function stop(cableId: string) {
  const job = jobs.get(cableId)
  if (job?.timer !== undefined) clearTimeout(job.timer)
  job?.abort?.abort()
  jobs.delete(cableId)
}

/** True when the check for this edit is already pending, running or finished. */
export function editCheckIsCurrent(cableId: string, lineKey: string, checkKey: string) {
  const entry = checks.get(cableId)
  return Boolean(entry && entry.lineKey === lineKey && entry.checkKey === checkKey)
}

/**
 * Checks the edited layout after `delayMs`, cancelling any check pending or running for an earlier
 * edit of the same D-line. Calling it again for the same edit does nothing.
 */
export function scheduleEditCheck(
  cableId: string,
  lineKey: string,
  checkKey: string,
  input: CableLayoutInput,
  layout: LayoutToAnalyse,
  delayMs = EDIT_CHECK_DELAY_MS,
) {
  if (editCheckIsCurrent(cableId, lineKey, checkKey)) return
  stop(cableId)
  const previous = checks.get(cableId)
  const last = previous?.result
    ? { lineKey: previous.lineKey, checkKey: previous.checkKey, result: previous.result }
    : previous?.last
  checks.set(cableId, { lineKey, checkKey, status: 'pending', last })
  emit()
  const job: Job = {}
  jobs.set(cableId, job)
  job.timer = setTimeout(() => {
    if (jobs.get(cableId) !== job) return
    job.timer = undefined
    const abort = (job.abort = new AbortController())
    checks.set(cableId, { lineKey, checkKey, status: 'running', last })
    emit()
    analyzeCableLayout(input, layout, { signal: abort.signal })
      .then((result) => {
        if (jobs.get(cableId) !== job) return
        jobs.delete(cableId)
        checks.set(cableId, { lineKey, checkKey, status: 'done', result, last: { lineKey, checkKey, result } })
        emit()
      })
      .catch((error: unknown) => {
        if (jobs.get(cableId) !== job) return
        jobs.delete(cableId)
        checks.set(cableId, {
          lineKey,
          checkKey,
          status: 'error',
          last,
          error: error instanceof Error ? error.message : 'The layout check failed.',
        })
        emit()
      })
  }, delayMs)
}

/** Records why the edit cannot be checked (it is not sent to the worker). */
export function setEditCheckError(cableId: string, lineKey: string, checkKey: string, error: string) {
  const entry = checks.get(cableId)
  if (entry?.lineKey === lineKey && entry.checkKey === checkKey && entry.error === error) return
  stop(cableId)
  const last = entry?.result ? { lineKey: entry.lineKey, checkKey: entry.checkKey, result: entry.result } : entry?.last
  checks.set(cableId, { lineKey, checkKey, status: 'error', error, last })
  emit()
}

/** Drops the D-line's edit check (the edit was discarded). */
export function clearEditCheck(cableId: string) {
  if (!checks.has(cableId) && !jobs.has(cableId)) return
  stop(cableId)
  checks.delete(cableId)
  if (focus?.cableId === cableId) focus = null
  emit()
}

/** The D-line's edit check now (outside React). */
export const getEditCheck = (cableId: string): EditCheckEntry | undefined => checks.get(cableId)

export function useEditCheck(cableId: string | undefined): EditCheckEntry | undefined {
  useSyncExternalStore(subscribe, () => version)
  return cableId ? checks.get(cableId) : undefined
}

/** The current check's result, else the latest finished one for the same D-line key (drawn as pending). */
export function drawnEditResult(
  entry: EditCheckEntry | undefined,
  lineKey: string,
  checkKey: string,
): { result: CableLayoutResult; pending: boolean } | null {
  if (!entry) return null
  if (entry.status === 'done' && entry.lineKey === lineKey && entry.checkKey === checkKey && entry.result)
    return { result: entry.result, pending: false }
  if (entry.last && entry.last.lineKey === lineKey) return { result: entry.last.result, pending: true }
  return null
}

// --- Locating a row -----------------------------------------------------------------------------

export interface LayoutFocusRequest {
  cableId: string
  /** A `compareLayouts` / `layoutLimitRows` row id, or `span:<index>`. */
  rowId: string
  /** Chart distance to move the D-line cursor (and so the plan cursor) to, if any. */
  x: number | null
  seq: number
}

/** Locates a row on the chart and plan; picking the same row again clears it. */
export function focusLayoutRow(cableId: string, rowId: string, x: number | null) {
  focus = focus?.cableId === cableId && focus.rowId === rowId ? null : { cableId, rowId, x, seq: ++focusSeq }
  emit()
}

export function clearLayoutFocus() {
  if (!focus) return
  focus = null
  emit()
}

/** The row located now (outside React). */
export const getLayoutFocus = (): LayoutFocusRequest | null => focus

export function useLayoutFocus(cableId: string | undefined): LayoutFocusRequest | null {
  useSyncExternalStore(subscribe, () => version)
  return cableId && focus?.cableId === cableId ? focus : null
}

/** Every focus request, for the page that moves the cursors. */
export function useAnyLayoutFocus(): LayoutFocusRequest | null {
  useSyncExternalStore(subscribe, () => version)
  return focus
}

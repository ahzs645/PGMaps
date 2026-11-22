/**
 * Captures planned views of interest (`viewsOfInterest.ts`) as saved views, without the reviewer driving the road
 * view: for each place it stands there (the page's stand-at-viewpoint path), waits for the run and the road view to
 * be ready, faces each view's bearing with its lens, and saves the view as *Save viewpoint* does, tagged with
 * `plannedViewId` and `plannedKey`. Each save is awaited to its end (the screenshot, then the framed class pass that
 * moves the eye camera) before the camera moves again. Afterwards it steps back to where the reviewer was.
 *
 * The page supplies a `ViewCaptureHost` through a ref it refreshes on every render, so each step reads the page as it
 * is now rather than as it was when the batch started. The decisions are in `viewCapturePlan.ts`.
 */
import { useCallback, useRef, useState } from 'react'
import { timed } from './exportTiming'

import {
  CAPTURE_TIMEOUTS,
  FACING_SETTLE_MS,
  RUN_CANCELLED,
  beforeMessage,
  beforeWarning,
  captureMessage,
  captureSummary,
  captureWaitingFor,
  planCapture,
  standFacing,
  waitAbandoned,
  waitFailure,
  type CaptureFacts,
  type CaptureWait,
  type CaptureWant,
} from './viewCapturePlan'
import { viewCaptureKey, type ViewOfInterest } from './viewsOfInterest'

export type ViewCaptureStatus = 'idle' | 'running' | 'done' | 'cancelled' | 'error'

export type ViewCaptureState = {
  status: ViewCaptureStatus
  /** The planned view being captured now. */
  currentViewId: string | null
  done: number
  total: number
  /**
   * Views that could not be captured, with the reason in the page's words; and, with `warning`, views saved with
   * something missing (their analysis sheet, their before-harvest render), which still count as captured here.
   */
  failures: ViewCaptureFailure[]
  /** One line for a status area: "Capturing 2 of 5: VLI 144, arrow 1…". */
  message: string | null
}

/**
 * A view not captured (`warning` absent), or saved with something missing (`warning`): its analysis sheet (`sheet`,
 * the screenshot or the class pass) or its before-harvest render (`before`).
 */
export type ViewCaptureFailure = { viewId: string; reason: string; warning?: 'sheet' | 'before' }

export type ViewCaptureReport = {
  captured: string[]
  failures: ViewCaptureFailure[]
  cancelled: boolean
}

export type ViewCaptureApi = {
  state: ViewCaptureState
  /** Captures the given planned views in list order, grouped by place; resolves when all are tried or cancelled. */
  /**
   * `before`: also take each view's before-harvest render while standing there (the page's `captureBeforeRenders`),
   * cached by saved view id in the page's `capturedBefore`, so an export can pair views away from where the reviewer
   * stands. Off when absent.
   */
  capture: (viewIds: readonly string[], options?: { before?: boolean }) => Promise<ViewCaptureReport>
  cancel: () => void
  /**
   * Stands at one planned view (run, then the road view facing it), as the finder's *Stand here* does. With
   * `roadView: false` the assessment runs from it and the road view stays closed: step 1's *Assess from a view*.
   */
  standAt: (viewId: string, options?: { roadView?: boolean }) => void
}

/** A save's end: the saved view's id once its analysis sheet is drawn (or failed, with `warning`), else why not. */
export type ViewSaveOutcome = { viewId: string; warning?: string } | { error: string }

/** What the page lends a capture. Rebuilt on every render; read through a ref at each step. */
export type ViewCaptureHost<Snapshot = unknown> = {
  views: readonly ViewOfInterest[]
  /** The page now, for `captureWaitingFor`. */
  facts: () => CaptureFacts
  /**
   * Stands at the view's place facing it, with its lens, its block and its landform active; the stand runs for the
   * returned scene key. An error when the view cannot be stood at (its block is gone).
   */
  stand: (view: ViewOfInterest, options?: { roadView?: boolean }) => { key: string } | { error: string }
  /** Turns the road view to another view at the same place, with its lens. */
  face: (view: ViewOfInterest) => void
  /** Saves the road view as *Save viewpoint* does, for the view, replacing earlier saves of it. */
  save: (view: ViewOfInterest) => Promise<ViewSaveOutcome>
  /** Ids of every saved view, shelved ones included: a save is done once the page lists it. */
  savedViewIds: () => readonly string[]
  /**
   * Takes the before-harvest render of views just saved at this place, while the road view still stands there (the
   * page's `captureBeforeRenders`), keeps them for exports, and puts the harvest phase back. Returns the saved view
   * ids it took one for, and the page's notes on the rest.
   */
  before?: (saved: ReadonlyArray<{ id: string; name: string; plannedKey: string }>) => Promise<{
    taken: readonly string[]
    notes: readonly string[]
  }>
  /** Where the reviewer stands now, and putting them back there. */
  snapshot: () => Snapshot
  restore: (snapshot: Snapshot) => void
}

export const IDLE_VIEW_CAPTURE: ViewCaptureState = {
  status: 'idle',
  currentViewId: null,
  done: 0,
  total: 0,
  failures: [],
  message: null,
}

const POLL_MS = 100
/** Readiness must hold this long, with the camera's bearing unchanged, before a view is saved. */
const STEADY_MS = 300
/** How long a run that has not started may show the previous run's error before it counts. */
const RUN_START_GRACE_MS = 2000

/** Timers a batch runs on: the browser's, or a test's. */
export type CaptureClock = { now: () => number; sleep: (ms: number) => Promise<void> }

const BROWSER_CLOCK: CaptureClock = {
  now: () => performance.now(),
  sleep: (ms) => new Promise<void>((resolve) => window.setTimeout(resolve, ms)),
}

/** How long each kind of wait may last in all at one view. */
const BUDGET: Record<Exclude<CaptureWait, null>, number> = {
  run: CAPTURE_TIMEOUTS.runMs,
  'road view': CAPTURE_TIMEOUTS.roadViewMs,
  timber: CAPTURE_TIMEOUTS.roadViewMs,
  facing: CAPTURE_TIMEOUTS.facingMs,
  lens: CAPTURE_TIMEOUTS.facingMs,
}

type WaitResult = { ok: true } | { ok: false; reason: string; place: boolean } | null

/**
 * Waits until the page can save `want`, or a step runs out of time; null when cancelled. Each kind of wait (the run,
 * the road view, the timber, the facing, the lens) has its own budget, counted only while the capture waits on it,
 * and readiness must hold `STEADY_MS` with the camera's bearing unchanged.
 */
async function waitReady<S>(
  getHost: () => ViewCaptureHost<S> | null,
  want: CaptureWant,
  cancelled: () => boolean,
  clock: CaptureClock,
): Promise<WaitResult> {
  const spent: Partial<Record<Exclude<CaptureWait, null>, number>> = {}
  let steadySince: number | null = null
  let steadyBearing: number | null = null
  let sawRunning = false
  // Since when the run wait has had nothing running or about to start (`waitAbandoned`), or null.
  let abandonedSince: number | null = null
  const started = clock.now()
  let last = started
  for (;;) {
    if (cancelled()) return null
    const host = getHost()
    if (!host) return { ok: false, reason: 'The page closed.', place: true }
    const facts = host.facts()
    const now = clock.now()
    const elapsed = now - last
    last = now
    if (facts.runRunning) sawRunning = true
    const wait = captureWaitingFor(facts, want)
    if (
      wait === 'run' &&
      facts.runError &&
      !facts.runRunning &&
      facts.key === want.key &&
      (sawRunning || now - started > RUN_START_GRACE_MS)
    )
      return { ok: false, reason: waitFailure('run', facts), place: true }
    // A run cancelled under the capture (or never started) ends with no error: nothing would finish the wait.
    if (waitAbandoned(wait, facts)) {
      abandonedSince ??= now
      if (now - abandonedSince > CAPTURE_TIMEOUTS.runAbandonMs) return { ok: false, reason: RUN_CANCELLED, place: true }
    } else abandonedSince = null
    if (wait === null) {
      if (steadySince === null || facts.poseBearing !== steadyBearing) {
        steadySince = now
        steadyBearing = facts.poseBearing
      } else if (now - steadySince >= STEADY_MS) return { ok: true }
    } else {
      steadySince = null
      spent[wait] = (spent[wait] ?? 0) + elapsed
      if (spent[wait]! > BUDGET[wait])
        return { ok: false, reason: waitFailure(wait, facts), place: wait === 'run' || wait === 'road view' }
    }
    await clock.sleep(POLL_MS)
  }
}

/**
 * One batch: stands at each place in turn, waits for the page, faces and saves each view there, waiting for each
 * save's analysis sheet before the camera moves again; then puts the reviewer back where they stood (`restore`, in
 * `finally`). `onState` hears every step. The hook below runs it with the browser's clock; tests with their own.
 */
export async function runViewCapture<S>(
  getHost: () => ViewCaptureHost<S> | null,
  viewIds: readonly string[],
  control: {
    cancelled: () => boolean
    onState: (state: ViewCaptureState) => void
    clock?: CaptureClock
    /** Also take each view's before-harvest render at its place (`ViewCaptureHost.before`). */
    before?: boolean
  },
): Promise<ViewCaptureReport> {
  const clock = control.clock ?? BROWSER_CLOCK
  const host = getHost()
  if (!host)
    return {
      captured: [],
      failures: viewIds.map((viewId) => ({ viewId, reason: 'The page is not ready.' })),
      cancelled: false,
    }
  const { places, missing } = planCapture(host.views, viewIds)
  const total = places.reduce((sum, place) => sum + place.views.length, 0)
  const failures: ViewCaptureFailure[] = missing.map((viewId) => ({
    viewId,
    reason: 'The view is no longer listed.',
  }))
  const captured: string[] = []
  if (!total) {
    control.onState({ ...IDLE_VIEW_CAPTURE, status: 'done', failures: [...failures] })
    return { captured, failures, cancelled: false }
  }
  let state: ViewCaptureState = {
    status: 'running',
    currentViewId: null,
    done: 0,
    total,
    failures: [...failures],
    message: captureMessage(0, total, places[0].views[0].name),
  }
  const update = (patch: Partial<ViewCaptureState>) => {
    state = { ...state, ...patch, failures: [...failures] }
    control.onState(state)
  }
  control.onState(state)
  let done = 0
  const fail = (view: ViewOfInterest, reason: string) => {
    failures.push({ viewId: view.id, reason })
    done += 1
    update({ done })
  }
  const snapshot = host.snapshot()
  let status: ViewCaptureStatus = 'done'
  try {
    placeLoop: for (const place of places) {
      if (control.cancelled()) break
      const first = place.views[0]
      update({ currentViewId: first.id, message: captureMessage(done, total, first.name) })
      const stood = getHost()?.stand(first) ?? { error: 'The page closed.' }
      if ('error' in stood) {
        for (const view of place.views) fail(view, stood.error)
        continue
      }
      // The views saved at this place, for their before-harvest renders once every one of them is saved.
      const savedHere: Array<{ viewId: string; id: string; name: string; plannedKey: string }> = []
      for (let index = 0; index < place.views.length; index++) {
        if (control.cancelled()) break placeLoop
        const view = place.views[index]
        update({ currentViewId: view.id, message: captureMessage(done, total, view.name) })
        if (index > 0) {
          getHost()?.face(view)
          await clock.sleep(FACING_SETTLE_MS)
        }
        const ready = await timed('view capture: stand and run', () =>
          waitReady(getHost, { key: stood.key, ...standFacing(view), lensMm: view.focalMm }, control.cancelled, clock),
        )
        if (!ready) break placeLoop
        if (!ready.ok) {
          // A place whose run or road view failed fails its other views for the same reason.
          if (ready.place) {
            for (const rest of place.views.slice(index)) fail(rest, ready.reason)
            break
          }
          fail(view, ready.reason)
          continue
        }
        const saving = getHost()?.save(view) ?? Promise.resolve<ViewSaveOutcome>({ error: 'The page closed.' })
        const outcome = await timed('view capture: save', () =>
          Promise.race([saving, clock.sleep(CAPTURE_TIMEOUTS.saveMs).then(() => 'timeout' as const)]),
        )
        if (outcome === 'timeout') {
          // The class pass may still be moving the camera: nothing more is captured, so nothing moves it under it.
          fail(view, 'Its analysis sheet did not finish drawing in time.')
          for (const rest of places.flatMap((entry) => entry.views).slice(done))
            fail(rest, 'Not captured: the view before it did not finish drawing.')
          break placeLoop
        }
        if ('error' in outcome) {
          fail(view, outcome.error)
          continue
        }
        // The next step reads the page's own lists (and moves on from them): wait until the save is in them.
        const listedBy = clock.now() + 5000
        while (!getHost()?.savedViewIds().includes(outcome.viewId) && clock.now() < listedBy) await clock.sleep(POLL_MS)
        captured.push(view.id)
        if (outcome.warning) failures.push({ viewId: view.id, reason: outcome.warning, warning: 'sheet' })
        savedHere.push({ viewId: view.id, id: outcome.viewId, name: view.name, plannedKey: viewCaptureKey(view) })
        done += 1
        update({ done })
      }
      if (control.before && savedHere.length && !control.cancelled()) {
        const before = getHost()?.before
        update({ currentViewId: savedHere[0].viewId, message: beforeMessage(savedHere.length, place.views[0].name) })
        const outcome = before
          ? await timed('view capture: before render', () =>
              Promise.race([
                before(savedHere).catch((error: unknown) => ({
                  taken: [] as string[],
                  notes: [error instanceof Error ? error.message : String(error)],
                })),
                clock.sleep(CAPTURE_TIMEOUTS.saveMs).then(() => 'timeout' as const),
              ]),
            )
          : { taken: [] as string[], notes: ['The page cannot take before-harvest renders.'] }
        const notes = outcome === 'timeout' ? ['It did not finish drawing in time.'] : outcome.notes
        const taken = new Set(outcome === 'timeout' ? [] : outcome.taken)
        for (const entry of savedHere)
          if (!taken.has(entry.id))
            failures.push({ viewId: entry.viewId, reason: beforeWarning(entry.name, notes), warning: 'before' })
        update({})
        // A render still drawing may be moving the camera: nothing more is captured under it.
        if (outcome === 'timeout') break placeLoop
      }
    }
    if (control.cancelled()) status = 'cancelled'
  } catch (error) {
    status = 'error'
    failures.push({
      viewId: state.currentViewId ?? '',
      reason: `The capture stopped: ${error instanceof Error ? error.message : String(error)}`,
    })
  } finally {
    getHost()?.restore(snapshot)
  }
  const cancelled = status === 'cancelled'
  const notCaptured = new Set(failures.filter((entry) => !captured.includes(entry.viewId)).map((f) => f.viewId))
  const warnedBy = (kind: 'sheet' | 'before') =>
    new Set(failures.filter((entry) => entry.warning === kind && captured.includes(entry.viewId)).map((f) => f.viewId))
      .size
  update({
    status,
    currentViewId: null,
    done,
    message: captureSummary(captured.length, total, notCaptured.size, cancelled, {
      sheet: warnedBy('sheet'),
      before: warnedBy('before'),
    }),
  })
  return { captured, failures, cancelled }
}

export function useViewCapture<Snapshot>(hostRef: {
  readonly current: ViewCaptureHost<Snapshot> | null
}): ViewCaptureApi {
  const [state, setState] = useState<ViewCaptureState>(IDLE_VIEW_CAPTURE)
  const runningRef = useRef(false)
  const cancelledRef = useRef(false)

  const capture = useCallback(
    async (viewIds: readonly string[], options: { before?: boolean } = {}): Promise<ViewCaptureReport> => {
      if (runningRef.current)
        return {
          captured: [],
          failures: viewIds.map((viewId) => ({ viewId, reason: 'Another capture is running.' })),
          cancelled: false,
        }
      runningRef.current = true
      cancelledRef.current = false
      try {
        return await runViewCapture(() => hostRef.current, viewIds, {
          cancelled: () => cancelledRef.current,
          onState: setState,
          before: options.before,
        })
      } finally {
        runningRef.current = false
      }
    },
    [hostRef],
  )

  const cancel = useCallback(() => {
    if (!runningRef.current) return
    cancelledRef.current = true
    setState((current) => ({ ...current, message: 'Cancelling: finishing the view being saved…' }))
  }, [])

  const standAt = useCallback(
    (viewId: string, options?: { roadView?: boolean }) => {
      if (runningRef.current) return
      const host = hostRef.current
      const view = host?.views.find((entry) => entry.id === viewId)
      if (!host || !view) return
      const stood = host.stand(view, options)
      if ('error' in stood)
        setState({ ...IDLE_VIEW_CAPTURE, failures: [{ viewId, reason: stood.error }], message: stood.error })
    },
    [hostRef],
  )

  return { state, capture, cancel, standAt }
}

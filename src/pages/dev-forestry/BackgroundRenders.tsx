/**
 * Another engine's final renders of saved views, run in the background while the page stays in use: a queue of
 * jobs, one engine page in a small frame (its live picture is the tray's thumbnail, and keeping it on screen keeps
 * the browser from throttling it), the progress of the job running and the time left for the queue
 * (`renderEstimate.ts`). The page supplies what a job does (`run`: build the view's capture scene and ask the
 * engine through the handle this host provides); the host times each phase, records finished renders in this
 * browser's history, and forgets the engine page once the queue is empty, which frees its GPU memory.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Loader2, X } from 'lucide-react'

import { TextButton } from '@/components/ui/text-button'

import type { EngineCaptureHandle } from './ExternalRoadRenderer'
import { captureTransfer, readCaptureProgress } from './engineCapture'
import {
  engineCamera,
  engineEnvironment,
  readEngineMessage,
  roadRendererInfo,
  separateSiteUrl,
  type EngineEnvironmentChoice,
} from './externalRenderers'
import {
  estimateRender,
  formatRemaining,
  parseRenderHistory,
  queueRemainingMs,
  recordRender,
  remainingMs,
  type RenderEngineId,
  type RenderEstimate,
  type RenderHistory,
  type RenderPhase,
  type RenderWork,
} from './renderEstimate'
import type { ScenePackage } from './scenePackage'

export type RenderJob = {
  /** Unique per view, engine and scene: a finished render is kept under it. */
  key: string
  viewId: string
  viewName: string
  engine: RenderEngineId
  work: RenderWork
}

export type RenderJobState = {
  job: RenderJob
  status: 'waiting' | 'running' | 'done' | 'error'
  phase: RenderPhase | null
  estimate: RenderEstimate
  startedAt: number | null
  phaseAt: number | null
  steps: { done: number; total: number; firstAt: number } | null
  error: string | null
}

/** What a job does with the engine: the host times the phases from the engine's own messages. */
export type RenderRunner = (job: RenderJob, engine: EngineCaptureHandle) => Promise<void>

const HISTORY_KEY = 'pgmaps.forestryVisuals.renderHistory'
/** An engine page that has not said hello by now is not running. */
const HELLO_TIMEOUT_MS = 30_000
/** Longest one final capture may take once the scene is ready (the engines' own watchdogs stop sooner). */
const CAPTURE_TIMEOUT_MS = 15 * 60_000
/**
 * What a capture in flight is rejected with when the bridge it was posted through is torn down (its effect re-ran:
 * a hot reload in development, or the engine page changing). The engine's `ready` then reaches the new bridge, which
 * has nothing waiting, so the capture used to sit until `CAPTURE_TIMEOUT_MS`: a job stuck at "building the scene" for
 * 15 min, on a page that had been open long enough to see a reload. The runner puts such a job back in the queue.
 */
export const BRIDGE_RESET = 'The connection to the engine page was reset.'
/** How many times a job is put back after a bridge reset before it fails. */
const RESET_RETRIES = 2

function loadHistory(): RenderHistory {
  try {
    return parseRenderHistory(JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? '[]'))
  } catch {
    return []
  }
}
function saveHistory(history: RenderHistory) {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
  } catch {
    // Storage may be blocked: the estimates then stay on the library priors.
  }
}

/** The engine page's bridge for captures only: scene, environment, a still camera, the capture and its progress. */
function useCaptureBridge(
  frame: React.RefObject<HTMLIFrameElement | null>,
  engine: RenderEngineId | null,
  url: string | null,
  environment: EngineEnvironmentChoice,
) {
  const helloRef = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null)
  const handleRef = useRef<
    (EngineCaptureHandle & { onProgress: (cb: ((p: { done: number; total: number }) => void) | null) => void }) | null
  >(null)
  const environmentRef = useRef(environment)
  useEffect(() => {
    environmentRef.current = environment
  })
  useEffect(() => {
    if (!engine || !url) return
    const info = roadRendererInfo(engine)
    const origin = new URL(url, window.location.href).origin
    let resolveHello = () => {}
    const promise = new Promise<void>((resolve) => (resolveHello = resolve))
    helloRef.current = { promise, resolve: resolveHello }
    let readyWaiter: (() => void) | null = null
    let progress: ((p: { done: number; total: number }) => void) | null = null
    const replies = new Map<string, (data: unknown) => void>()
    let failure: ((message: string) => void) | null = null
    // The capture in flight, to reject when this bridge is torn down rather than leave it waiting.
    let abandon: (() => void) | null = null
    // A handle taken before the bridge was torn down must not post into a bridge nothing listens to any more.
    let closed = false
    const post = (data: unknown, transfer: Transferable[] = []) =>
      frame.current?.contentWindow?.postMessage(data, { targetOrigin: origin, transfer })
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== origin) return
      const raw = event.data as { type?: unknown; id?: unknown } | null
      if (raw?.type === 'pgmaps-engine-capture' && typeof raw.id === 'string') {
        const reply = replies.get(raw.id)
        replies.delete(raw.id)
        reply?.(raw)
        return
      }
      const step = readCaptureProgress(event.data)
      if (step) {
        if (replies.has(step.id)) progress?.(step)
        return
      }
      const data = readEngineMessage(event.data)
      if (data?.type === 'pgmaps-engine-hello') resolveHello()
      else if (data?.type === 'pgmaps-engine-ready') readyWaiter?.()
      else if (data?.type === 'pgmaps-engine-error') failure?.(data.message ?? 'The engine stopped.')
    }
    window.addEventListener('message', onMessage)
    const capture: EngineCaptureHandle['capture'] = (scene: ScenePackage, makeRequest) =>
      new Promise((resolve, reject) => {
        if (closed) {
          reject(new Error(BRIDGE_RESET))
          return
        }
        let id: string | null = null
        const timer = window.setTimeout(() => {
          readyWaiter = null
          if (id) replies.delete(id)
          reject(new Error(`${info.label} did not finish the render in ${CAPTURE_TIMEOUT_MS / 60_000} min.`))
        }, CAPTURE_TIMEOUT_MS)
        failure = (message) => {
          window.clearTimeout(timer)
          abandon = null
          reject(new Error(`${info.label}: ${message}`))
        }
        abandon = () => {
          window.clearTimeout(timer)
          reject(new Error(BRIDGE_RESET))
        }
        readyWaiter = () => {
          readyWaiter = null
          const request = makeRequest(scene)
          id = request.id
          replies.set(request.id, (data) => {
            window.clearTimeout(timer)
            failure = null
            abandon = null
            resolve(data)
          })
          post(request, captureTransfer(request))
        }
        post(engineEnvironment(environmentRef.current, scene.origin, new Date()))
        post({ type: 'pgmaps-scene', scene })
        // A still camera at the package's eye: the engine's live picture in the tray. The capture sets its own.
        const eye = { lng: scene.origin.lng, lat: scene.origin.lat, elevationMeters: scene.camera.position[2] }
        post(
          engineCamera(scene.origin, eye, {
            bearingDegrees: scene.camera.bearingDegrees ?? 0,
            pitchDegrees: 0,
            verticalFovDegrees: 40,
            viewport: { width: 224, height: 126, pixelRatio: 1 },
          }),
        )
      })
    handleRef.current = {
      renderer: engine,
      label: info.label,
      capture,
      onProgress: (cb) => (progress = cb),
    }
    return () => {
      closed = true
      window.removeEventListener('message', onMessage)
      abandon?.()
      abandon = null
      replies.clear()
      readyWaiter = null
      handleRef.current = null
      helloRef.current = null
    }
  }, [engine, url, frame])
  return { helloRef, handleRef }
}

export function useBackgroundRenders(input: {
  urlFor: (engine: RenderEngineId) => string | null
  environment: EngineEnvironmentChoice
  run: RenderRunner
}) {
  const [jobs, setJobs] = useState<RenderJobState[]>([])
  const [history, setHistory] = useState<RenderHistory>(loadHistory)
  const [, setTick] = useState(0)
  const running = jobs.find((entry) => entry.status === 'running') ?? null
  const next = jobs.find((entry) => entry.status === 'waiting') ?? null
  // The engine page lives while its jobs do: the running one's, else the next one's.
  const engine = running?.job.engine ?? next?.job.engine ?? null
  // On a site of its own, so its long scripts run in another process and never freeze the page.
  const configured = engine ? input.urlFor(engine) : null
  const url = configured ? separateSiteUrl(configured, window.location.href).url : null
  const frame = useRef<HTMLIFrameElement>(null)
  const { helloRef, handleRef } = useCaptureBridge(frame, engine, url, input.environment)
  const runRef = useRef(input.run)
  useEffect(() => {
    runRef.current = input.run
  })
  const warmEngine = useRef<RenderEngineId | null>(null)
  // Bridge resets per job key: a job is put back after one, at most `RESET_RETRIES` times.
  const resets = useRef(new Map<string, number>())
  const historyRef = useRef(history)
  useEffect(() => {
    historyRef.current = history
  }, [history])

  const update = (key: string, patch: Partial<RenderJobState>) =>
    setJobs((current) => current.map((entry) => (entry.job.key === key ? { ...entry, ...patch } : entry)))

  // One job at a time, in order.
  const busy = useRef(false)
  useEffect(() => {
    if (busy.current || running || !next || !url) return
    busy.current = true
    const job = next.job
    const cold = warmEngine.current !== job.engine
    const started = Date.now()
    const marks: Partial<Record<RenderPhase, number>> = {}
    const enter = (phase: RenderPhase) => {
      marks[phase] = Date.now()
      update(job.key, { phase, phaseAt: marks[phase]! })
    }
    update(job.key, {
      status: 'running',
      startedAt: started,
      estimate: estimateRender(job.engine, job.work, historyRef.current, cold),
    })
    enter(cold ? 'start' : 'scene')
    void (async () => {
      try {
        if (cold) {
          const hello = helloRef.current?.promise
          const waited = await Promise.race([
            hello?.then(() => 'hello' as const),
            new Promise<'timeout'>((resolve) => window.setTimeout(() => resolve('timeout'), HELLO_TIMEOUT_MS)),
          ])
          if (waited !== 'hello')
            throw new Error(`no answer from ${roadRendererInfo(job.engine).label}. Is its page running?`)
          warmEngine.current = job.engine
          enter('scene')
        }
        const handle = handleRef.current
        if (!handle) throw new Error('The engine page closed.')
        let firstStepAt: number | null = null
        handle.onProgress((step) => {
          firstStepAt ??= Date.now()
          update(job.key, { steps: { done: step.done, total: step.total, firstAt: firstStepAt } })
        })
        // The bridge sends the request once the engine's scene is ready: the render phase starts there.
        const wrapped: EngineCaptureHandle = {
          ...handle,
          capture: (scene, make) =>
            handle
              .capture(scene, (pkg) => {
                enter('render')
                return make(pkg)
              })
              .then((reply) => {
                // The engine has answered: what is left is reading its frames back into the figure.
                enter('compose')
                return reply
              }),
        }
        await runRef.current(job, wrapped)
        handle.onProgress(null)
        const end = Date.now()
        const at = (phase: RenderPhase) => marks[phase] ?? null
        const span = (from: RenderPhase, to: RenderPhase | null) => {
          const a = at(from)
          if (a === null) return 0
          const b = to ? (at(to) ?? end) : end
          return Math.max(0, b - a)
        }
        const timing = {
          engine: job.engine,
          at: new Date(end).toISOString(),
          work: job.work,
          ms: {
            start: span('start', 'scene'),
            scene: span('scene', 'render'),
            render: span('render', 'compose'),
            compose: span('compose', null),
          },
        }
        const nextHistory = recordRender(historyRef.current, timing)
        saveHistory(nextHistory)
        setHistory(nextHistory)
        update(job.key, { status: 'done', phase: null })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const reset = resets.current.get(job.key) ?? 0
        if (message === BRIDGE_RESET && reset < RESET_RETRIES) {
          // Drawn again from the start on the new bridge: the engine page itself is still loaded and warm.
          resets.current.set(job.key, reset + 1)
          update(job.key, { status: 'waiting', phase: null, startedAt: null, phaseAt: null, steps: null })
        } else {
          update(job.key, { status: 'error', error: message })
          warmEngine.current = null
        }
      } finally {
        busy.current = false
      }
    })()
  }, [running, next, url, helloRef, handleRef])

  // A queue with nothing left to run lets the engine page go (and with it the GPU memory it holds).
  useEffect(() => {
    if (!engine) warmEngine.current = null
  }, [engine])

  // The time left is re-read once a second while anything runs.
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setTick((n) => n + 1), 1000)
    return () => window.clearInterval(timer)
  }, [running])

  const enqueue = useCallback((add: RenderJob[]) => {
    setJobs((current) => {
      const keys = new Set(current.filter((entry) => entry.status !== 'error').map((entry) => entry.job.key))
      const fresh = add.filter((job) => !keys.has(job.key))
      return [
        // A failed job asked again is tried again.
        ...current.filter((entry) => !(entry.status === 'error' && fresh.some((job) => job.key === entry.job.key))),
        ...fresh.map(
          (job): RenderJobState => ({
            job,
            status: 'waiting',
            phase: null,
            estimate: estimateRender(job.engine, job.work, historyRef.current, false),
            startedAt: null,
            phaseAt: null,
            steps: null,
            error: null,
          }),
        ),
      ]
    })
  }, [])
  /** Drops the waiting jobs; the running one finishes (an engine cannot be stopped mid-frame). */
  const cancel = useCallback(() => setJobs((current) => current.filter((entry) => entry.status !== 'waiting')), [])
  const clearFinished = useCallback(
    () => setJobs((current) => current.filter((entry) => entry.status === 'waiting' || entry.status === 'running')),
    [],
  )

  const now = Date.now()
  const runningLeft =
    running && running.phase && running.startedAt !== null
      ? remainingMs(running.estimate, {
          phase: running.phase,
          elapsedMs: now - running.startedAt,
          phaseElapsedMs: now - (running.phaseAt ?? running.startedAt),
          steps: running.steps
            ? { done: running.steps.done, total: running.steps.total, sinceFirstMs: now - running.steps.firstAt }
            : null,
        })
      : null
  const waiting = jobs.filter((entry) => entry.status === 'waiting')
  const leftMs =
    running || waiting.length
      ? queueRemainingMs(
          runningLeft,
          waiting.map((entry) => entry.estimate),
        )
      : null
  const status = useMemo(
    () => ({
      running: !!(running || waiting.length),
      done: jobs.filter((entry) => entry.status === 'done').length,
      total: jobs.length,
      failed: jobs.filter((entry) => entry.status === 'error'),
      leftMs,
      basis: (running ?? waiting[0])?.estimate.basis ?? null,
    }),
    [jobs, running, waiting, leftMs],
  )

  const label = engine ? roadRendererInfo(engine).label : null
  const phaseText: Record<RenderPhase, string> = {
    start: `starting ${label}`,
    scene: 'building the scene and the frame’s stand',
    render: running?.steps ? `rendering, step ${running.steps.done} of ${running.steps.total}` : 'rendering',
    compose: 'composing the figure',
  }
  const tray: ReactNode =
    jobs.length > 0 ? (
      <div
        role="status"
        data-testid="background-renders"
        className="fixed right-3 bottom-3 z-50 grid w-[15rem] gap-1.5 rounded-lg border bg-background/95 p-2 text-xs shadow-lg"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">
            {status.running
              ? `Rendering ${status.done + 1} of ${status.total}`
              : `${status.done} of ${status.total} rendered`}
          </span>
          {!status.running && (
            <button type="button" aria-label="Close" onClick={clearFinished} className="text-muted-foreground">
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
        {url && (
          <iframe
            ref={frame}
            src={url}
            title={`Background renders by ${label}`}
            allow="webgpu"
            className="pointer-events-none aspect-video w-full rounded-md border-0 bg-muted"
          />
        )}
        {running && (
          <>
            <span className="truncate text-muted-foreground">
              {running.job.viewName}: {running.phase ? phaseText[running.phase] : 'waiting'}
            </span>
            <div className="h-1.5 overflow-hidden rounded-sm bg-muted" aria-hidden="true">
              <div
                className="h-full bg-primary transition-[width]"
                style={{
                  width: `${Math.round(
                    100 *
                      Math.min(
                        1,
                        (Date.now() - (running.startedAt ?? Date.now())) /
                          Math.max(1, Date.now() - (running.startedAt ?? Date.now()) + (runningLeft ?? 0)),
                      ),
                  )}%`,
                }}
              />
            </div>
          </>
        )}
        {status.leftMs !== null && (
          <span className="flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            {formatRemaining(status.leftMs)} left
            <span className="text-muted-foreground">
              ({status.basis === 'measured' ? 'from your renders' : 'first estimate'})
            </span>
          </span>
        )}
        {status.failed.map((entry) => (
          <span key={entry.job.key} className="text-danger">
            {entry.job.viewName}: {entry.error}
          </span>
        ))}
        {status.running && waiting.length > 0 && <TextButton onClick={cancel}>Cancel the rest</TextButton>}
      </div>
    ) : null

  return { jobs, enqueue, cancel, status, tray, history }
}

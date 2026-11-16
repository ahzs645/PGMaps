/**
 * How long another engine's final render of a saved view will take, before it starts and while it runs.
 *
 * A render has four phases: the engine's page starting (only the first render of a session), the scene (PGMaps
 * building the package and the frame's real-density stand, the engine building it), the render itself (each frame's
 * warm-up renders, then its accumulated samples) and composing the figure. Before a render starts, each phase is
 * estimated from this browser's own finished renders of that engine (`RenderHistory`, scaled by the work: frames,
 * pixels, samples), or, with none yet, from the profiled runs of 15 November 2026 (one 2400 x 2769 frame, 24 samples
 * and a 1.46 M-stem stand on an Apple GPU: about 25 s a viewpoint for either engine, most of it building the scene
 * and the stand, not drawing samples). While it runs, an
 * engine that reports its progress (`pgmaps-capture-progress`: steps done of steps) moves the estimate toward its
 * own pace as the steps go by; one that does not is estimated from the model alone, and the estimate never reads
 * less than the time already spent says. No DOM or network access.
 */

export type RenderEngineId = 'worldgen' | 'nanite'

/** What a render is asked to draw. */
export interface RenderWork {
  frames: number
  /** One frame's size, pixels. */
  width: number
  height: number
  samples: number
}

export type RenderPhase = 'start' | 'scene' | 'render' | 'compose'

/** One finished render, as timed. */
export interface RenderTiming {
  engine: RenderEngineId
  at: string
  work: RenderWork
  /** Milliseconds per phase; `start` is 0 when the engine was already running. */
  ms: Record<RenderPhase, number>
}

export type RenderHistory = RenderTiming[]

/** Model rates: fixed costs, and the render phase per warm-up or sample render of one megapixel. */
interface Rates {
  startMs: number
  sceneMs: number
  /** Milliseconds per render of one megapixel (warm-up and samples alike). */
  renderMsPerMegapixel: number
  /** Fixed per frame: compile, stream in, shadow fit. */
  frameMs: number
  composeMs: number
}

/** Warm-up renders a final frame takes before its samples (the engines' FINAL_SETTLE_RENDERS / FINAL_WARM). */
export const WARM_RENDERS: Record<RenderEngineId, number> = { worldgen: 4, nanite: 6 }

/**
 * Library priors, from the profiled runs of 15 November 2026 (one 2400 x 2769 frame, 24 samples, a 1.46 M-stem
 * stand, Apple GPU), stage by stage:
 * - scene: PGMaps building the package and the stand (7-8 s) and the engine building the scene (worldgen 4.8 s,
 *   Nanite Forest 7.6 s);
 * - a frame's fixed cost: worldgen placing the stand's cards and its class passes (2.7 s); Nanite Forest rebuilding
 *   the stand with its impostor atlas, rasterising the class layers and its passes (9 s);
 * - a render of one megapixel: worldgen 65 ms a sample at 6.6 megapixels, Nanite Forest 41 ms.
 * The earlier priors (800-1,100 ms a megapixel-render) read a first render as about 3 min when it took 25 s.
 *
 * Later the same day both engines were made faster (worldgen adds its samples up on the GPU, 19 ms a sample; both
 * keep a scene that arrives again; Nanite Forest's class rasters, impostor bake and tree growth are cheaper), and
 * the priors follow the runs after it: scene 7-11 s through PGMaps on a busy machine (engine build 3.7 s and
 * 4.4-6.4 s); a frame's fixed cost 2-3 s for worldgen and 3.5-5 s for Nanite Forest with a new stand.
 */
export const PRIOR_RATES: Record<RenderEngineId, Rates> = {
  worldgen: { startMs: 1_000, sceneMs: 9_000, renderMsPerMegapixel: 3, frameMs: 3_000, composeMs: 1_500 },
  nanite: { startMs: 1_000, sceneMs: 9_000, renderMsPerMegapixel: 6.5, frameMs: 5_000, composeMs: 1_500 },
}

/** Renders kept per engine, newest last. */
export const HISTORY_KEEP = 12

const megapixelRenders = (engine: RenderEngineId, work: RenderWork) =>
  (work.frames * (WARM_RENDERS[engine] + Math.max(1, work.samples)) * work.width * work.height) / 1e6

/** Rates from this browser's renders of `engine`, weighted to the newest, else the library priors. */
export function engineRates(engine: RenderEngineId, history: RenderHistory): Rates & { runs: number } {
  const prior = PRIOR_RATES[engine]
  const own = history.filter((entry) => entry.engine === engine).slice(-HISTORY_KEEP)
  if (!own.length) return { ...prior, runs: 0 }
  // Exponentially weighted toward the newest render: a GPU or driver change shows within a few renders.
  let weight = 0
  const sum = { startMs: 0, sceneMs: 0, renderMsPerMegapixel: 0, frameMs: 0, composeMs: 0 }
  let starts = 0,
    startWeight = 0
  own.forEach((entry, index) => {
    const w = 0.6 ** (own.length - 1 - index)
    weight += w
    const mp = megapixelRenders(engine, entry.work)
    const fixed = prior.frameMs * entry.work.frames
    sum.sceneMs += w * entry.ms.scene
    sum.composeMs += w * entry.ms.compose
    sum.renderMsPerMegapixel += w * (mp > 0 ? Math.max(0, entry.ms.render - fixed) / mp : prior.renderMsPerMegapixel)
    if (entry.ms.start > 0) {
      starts += w * entry.ms.start
      startWeight += w
    }
  })
  return {
    startMs: startWeight ? starts / startWeight : prior.startMs,
    sceneMs: sum.sceneMs / weight,
    renderMsPerMegapixel: sum.renderMsPerMegapixel / weight,
    frameMs: prior.frameMs,
    composeMs: sum.composeMs / weight,
    runs: own.length,
  }
}

export interface RenderEstimate {
  /** Milliseconds per phase, and in all. */
  phases: Record<RenderPhase, number>
  totalMs: number
  /** `measured`: from this browser's renders; `library`: from the library runs, before any here. */
  basis: 'measured' | 'library'
  runs: number
}

/** The estimate for one render before it starts. `cold`: the engine's page is not running yet. */
export function estimateRender(
  engine: RenderEngineId,
  work: RenderWork,
  history: RenderHistory,
  cold: boolean,
): RenderEstimate {
  const rates = engineRates(engine, history)
  const phases: Record<RenderPhase, number> = {
    start: cold ? rates.startMs : 0,
    scene: rates.sceneMs,
    render: work.frames * rates.frameMs + megapixelRenders(engine, work) * rates.renderMsPerMegapixel,
    compose: rates.composeMs,
  }
  return {
    phases,
    totalMs: phases.start + phases.scene + phases.render + phases.compose,
    basis: rates.runs ? 'measured' : 'library',
    runs: rates.runs,
  }
}

/** Where a running render is: its phase, how long it has spent there, and the engine's own count if it sends one. */
export interface RenderProgress {
  phase: RenderPhase
  /** Milliseconds since the render started, and since this phase did. */
  elapsedMs: number
  phaseElapsedMs: number
  /**
   * The engine's progress through the render phase: steps done of steps, when it reports them, and the time since
   * its first step (an engine prepares its stand before its first sample, so the phase's own clock overstates the
   * pace of the steps).
   */
  steps?: { done: number; total: number; sinceFirstMs?: number } | null
}

const PHASE_ORDER: readonly RenderPhase[] = ['start', 'scene', 'render', 'compose']

/**
 * Milliseconds left for a running render. The phases after this one take their estimates; this one takes what its
 * estimate leaves, never less than a twentieth of it while it runs over. In the render phase, an engine's own
 * count is extrapolated (time spent / share done) and blended with the model by the share done, so the first steps,
 * which carry compile and streaming costs, do not swing it.
 */
export function remainingMs(estimate: RenderEstimate, progress: RenderProgress): number {
  const index = PHASE_ORDER.indexOf(progress.phase)
  const later = PHASE_ORDER.slice(index + 1).reduce((sum, phase) => sum + estimate.phases[phase], 0)
  const planned = estimate.phases[progress.phase]
  let current = Math.max(planned - progress.phaseElapsedMs, planned * 0.05)
  const steps = progress.phase === 'render' ? progress.steps : null
  // A few steps first: the first ones carry compile and streaming costs and would swing the pace.
  if (steps && steps.total > 0 && steps.done >= Math.max(2, 0.05 * steps.total)) {
    const share = Math.min(1, steps.done / steps.total)
    const paced =
      steps.sinceFirstMs !== undefined
        ? (steps.sinceFirstMs / (steps.done - 1)) * (steps.total - steps.done)
        : (progress.phaseElapsedMs / share) * (1 - share)
    current = share * paced + (1 - share) * current
  }
  return Math.max(0, current + later)
}

/** Remaining time for a queue: the running render's, then each waiting one's whole estimate. */
export function queueRemainingMs(running: number | null, waiting: readonly RenderEstimate[]): number {
  return (running ?? 0) + waiting.reduce((sum, estimate) => sum + estimate.totalMs, 0)
}

/**
 * What the renders an export still owes would add after the queue, before it has asked for them: each job not already
 * waiting or running (`queued`, by key), the first of them cold when the engine is not running anything. A VIA report
 * passes its figures and its before pictures together, the other outputs their figures alone.
 */
export function notQueuedMs(
  jobs: ReadonlyArray<{ key: string; engine: RenderEngineId; work: RenderWork }>,
  queued: ReadonlySet<string>,
  history: RenderHistory,
  engineRunning: boolean,
): number {
  return jobs
    .filter((job) => !queued.has(job.key))
    .reduce(
      (sum, job, index) => sum + estimateRender(job.engine, job.work, history, index === 0 && !engineRunning).totalMs,
      0,
    )
}

/** A remaining time as people say it: "about 40 s", "about 2 min", "under 10 s". */
export function formatRemaining(ms: number): string {
  if (!Number.isFinite(ms)) return 'unknown'
  const s = ms / 1000
  if (s < 10) return 'under 10 s'
  if (s < 55) return `about ${Math.round(s / 5) * 5} s`
  const min = s / 60
  if (min < 1.5) return 'about 1 min'
  if (min < 10) return `about ${Math.round(min)} min`
  return `about ${Math.round(min / 5) * 5} min`
}

/** Adds a finished render, keeping the newest `HISTORY_KEEP` per engine. */
export function recordRender(history: RenderHistory, timing: RenderTiming): RenderHistory {
  const next = [...history, timing]
  const keep = new Map<RenderEngineId, number>()
  return next
    .slice()
    .reverse()
    .filter((entry) => {
      const n = keep.get(entry.engine) ?? 0
      keep.set(entry.engine, n + 1)
      return n < HISTORY_KEEP
    })
    .reverse()
}

const finite = (value: unknown, min = 0): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min

/** A stored history, keeping only well-formed entries (it lives in this browser's storage). */
export function parseRenderHistory(raw: unknown): RenderHistory {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry): RenderTiming[] => {
    if (!entry || typeof entry !== 'object') return []
    const e = entry as Record<string, unknown>
    const work = e.work as Record<string, unknown> | undefined
    const ms = e.ms as Record<string, unknown> | undefined
    if (e.engine !== 'worldgen' && e.engine !== 'nanite') return []
    if (
      !work ||
      !finite(work.frames, 1) ||
      !finite(work.width, 1) ||
      !finite(work.height, 1) ||
      !finite(work.samples, 1)
    )
      return []
    if (!ms || !PHASE_ORDER.every((phase) => finite(ms[phase]))) return []
    return [
      {
        engine: e.engine,
        at: typeof e.at === 'string' ? e.at : '',
        work: { frames: work.frames, width: work.width, height: work.height, samples: work.samples },
        ms: {
          start: ms.start as number,
          scene: ms.scene as number,
          render: ms.render as number,
          compose: ms.compose as number,
        },
      },
    ]
  })
}

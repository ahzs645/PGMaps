/**
 * Runs a long search in slices on the page's own thread. The searches take terrain as a function,
 * which cannot be sent to a worker, so they are written as generators and driven here: after each
 * slice the page gets a turn, which is what lets Cancel and the progress line work.
 *
 * Turns are handed over with a message rather than a timer. A browser holds timers in a hidden
 * tab to one a second or slower, and never lets a chain of them run faster than 4 ms apart; a
 * search that waited on one every few milliseconds of work spent most of its time waiting.
 *
 * Pure: no DOM or network access.
 */
export interface CooperativeControl<Progress> {
  signal?: AbortSignal
  /** Called once per slice with the latest progress the search reported. */
  onProgress?: (progress: Progress) => void
  /** Longest stretch of work before the page gets a turn, ms. */
  sliceMs?: number
}

/** Long enough to get work done, short enough that a click is answered within a frame or two. */
export const COOPERATIVE_SLICE_MS = 12

const now = () => (typeof performance === 'undefined' ? Date.now() : performance.now())

let channel: MessageChannel | null = null
const waiting: (() => void)[] = []

/** Resolves after the host has had a turn to handle input and paint. */
export function yieldToHost(): Promise<void> {
  return new Promise((resolve) => {
    // Node (the unit tests): an open message port would keep the process alive.
    if (typeof setImmediate === 'function') setImmediate(resolve)
    else if (typeof MessageChannel === 'function') {
      if (!channel) {
        channel = new MessageChannel()
        channel.port1.onmessage = () => waiting.shift()?.()
      }
      waiting.push(resolve)
      channel.port2.postMessage(null)
    } else setTimeout(resolve, 0)
  })
}

export const cancelled = (message = 'Cancelled.') => new DOMException(message, 'AbortError')

/** Drives `steps` to its result, yielding to the host between slices and stopping when `signal` aborts. */
export async function runCooperatively<Progress, Result>(
  steps: Generator<Progress, Result>,
  control: CooperativeControl<Progress> = {},
  cancelMessage?: string,
): Promise<Result> {
  const { signal, onProgress, sliceMs = COOPERATIVE_SLICE_MS } = control
  const check = () => {
    if (signal?.aborted) throw cancelled(cancelMessage)
  }
  check()
  let started = now()
  let next = steps.next()
  while (!next.done) {
    if (now() - started >= sliceMs) {
      onProgress?.(next.value)
      await yieldToHost()
      check()
      started = now()
    }
    next = steps.next()
  }
  check()
  return next.value
}

/** Drives `steps` to its result in one go, for callers that cannot wait. */
export function runToCompletion<Progress, Result>(steps: Generator<Progress, Result>): Result {
  let next = steps.next()
  while (!next.done) next = steps.next()
  return next.value
}

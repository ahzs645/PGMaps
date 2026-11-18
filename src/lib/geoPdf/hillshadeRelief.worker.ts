/// <reference lib="webworker" />
import { refineWithHillshade, type ReliefInput } from './hillshadeRelief'

/** Runs the refinement off the page's thread, reporting its progress a few times a second. */
self.onmessage = (event: MessageEvent<{ input?: ReliefInput }>) => {
  const input = event.data?.input
  if (!input) return
  try {
    const steps = refineWithHillshade(input)
    let next = steps.next(),
      reported = 0
    while (!next.done) {
      const now = performance.now()
      if (now - reported > 150) {
        reported = now
        self.postMessage({ type: 'relief-progress', progress: next.value })
      }
      next = steps.next()
    }
    self.postMessage({ type: 'relief-result', result: next.value }, [next.value.values.buffer])
  } catch (error) {
    self.postMessage({ type: 'relief-result', error: error instanceof Error ? error.message : String(error) })
  }
}

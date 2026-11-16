/**
 * Named timings for Save & export's slow steps (views captured, the run waited for, each picture group, each harvest
 * phase shown), as `performance.measure` entries: DevTools' Timings track shows them beside a recorded trace, and a
 * browser check reads them with `performance.getEntriesByName`. They record only how long a step took; nothing reads
 * them to decide anything. Every name starts with `EXPORT_TIMING_PREFIX`.
 */
export const EXPORT_TIMING_PREFIX = 'pgmaps-export:'

/** Runs `step`, recording how long it took as `pgmaps-export:<name>`, failed or not. */
export async function timed<T>(name: string, step: () => Promise<T>): Promise<T> {
  const start = performance.now()
  try {
    return await step()
  } finally {
    try {
      performance.measure(`${EXPORT_TIMING_PREFIX}${name}`, { start, end: performance.now() })
    } catch {
      // A browser without measure options keeps working without the timing.
    }
  }
}

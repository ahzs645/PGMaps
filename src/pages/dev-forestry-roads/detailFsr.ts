import { loadBcExistingRoads } from './existingRoads'
import { createReadQueue } from './sentinel/readQueue'
import type { DemBox } from './hrdem'
import type { LonLatBounds } from './sentinel/stac'

/** Coalesce overlapping local requests; never query the huge envelope between scattered blocks. */
export function nearbyFsrBounds(boxes: readonly DemBox[]): LonLatBounds[] {
  const bounds = boxes.map(({ window }) => {
    const b = window.bounds,
      lat = (b[1] + b[3]) / 2
    const dy = 1000 / 111320,
      dx = dy / Math.cos((lat * Math.PI) / 180)
    return [b[0] - dx, b[1] - dy, b[2] + dx, b[3] + dy] as LonLatBounds
  })
  for (let i = 0; i < bounds.length; i++)
    for (let j = i + 1; j < bounds.length; ) {
      const a = bounds[i],
        b = bounds[j]
      const merged: LonLatBounds = [
        Math.min(a[0], b[0]),
        Math.min(a[1], b[1]),
        Math.max(a[2], b[2]),
        Math.max(a[3], b[3]),
      ]
      if (
        a[0] <= b[2] &&
        b[0] <= a[2] &&
        a[1] <= b[3] &&
        b[1] <= a[3] &&
        merged[2] - merged[0] <= 0.2 &&
        merged[3] - merged[1] <= 0.2
      ) {
        bounds[i] = merged
        bounds.splice(j, 1)
        j = i + 1
      } else j++
    }
  return bounds
}

/** At most two bounded FSR queries at once, and source IDs deduplicate overlapping boxes. */
export async function loadDetailFsrs(boxes: readonly DemBox[], signal: AbortSignal, read = loadBcExistingRoads) {
  const queued = createReadQueue(2)
  const results = await Promise.allSettled(
    nearbyFsrBounds(boxes).map((bounds) =>
      queued(() => read(bounds, signal, { fsrOnly: true, activeOnly: true }), signal),
    ),
  )
  signal.throwIfAborted()
  const roads = new Map<string, Awaited<ReturnType<typeof read>>[number]>()
  const failures: string[] = []
  for (const result of results) {
    if (result.status === 'fulfilled') for (const road of result.value) roads.set(road.id, road)
    else failures.push(result.reason instanceof Error ? result.reason.message : 'FSR records not read.')
  }
  return { roads: [...roads.values()], failures }
}

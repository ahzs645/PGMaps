/**
 * Structural sharing after a rebuild. `parseProject` returns a fresh object for every part of the
 * project, changed or not, and the undo history names a step by which parts changed identity
 * (`projectChangeLabel.ts`). A typed grade that went through it read as "horizontal points and 3 other
 * changes; 5 other changes". `shareUnchanged` keeps each part of `next` that equals the same part of
 * `previous` as `previous`'s own object, so only what really changed is new. No DOM or network access.
 */

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** `next` with every part equal to `previous`'s replaced by `previous`'s object; `previous` when all equal. */
export function shareUnchanged<T>(previous: unknown, next: T): T {
  if (Object.is(previous, next)) return previous as T
  if (Array.isArray(previous) && Array.isArray(next)) {
    let same = previous.length === next.length
    const shared = next.map((item, i) => {
      const kept = shareUnchanged(previous[i], item)
      if (kept !== previous[i]) same = false
      return kept
    })
    return (same ? previous : shared) as T
  }
  if (isPlainObject(previous) && isPlainObject(next)) {
    const keys = Object.keys(next)
    let same = keys.length === Object.keys(previous).length
    const shared: Record<string, unknown> = {}
    for (const key of keys) {
      const had = Object.prototype.hasOwnProperty.call(previous, key)
      const kept = had ? shareUnchanged(previous[key], next[key]) : next[key]
      if (!had || kept !== previous[key]) same = false
      shared[key] = kept
    }
    return (same ? previous : shared) as T
  }
  // Primitives that differ, typed arrays, maps and other class instances: the new value stands.
  return next
}

/** A patch cache entry is immutable until replaced by the placement code. */
export type ForestPatchBatch<T> = {
  parts: ReadonlyMap<string, readonly T[]>
  items: T[]
}

function sameParts<T>(a: ReadonlyMap<string, readonly T[]>, b: ReadonlyMap<string, readonly T[]>): boolean {
  if (a.size !== b.size) return false
  for (const [key, part] of a) if (b.get(key) !== part) return false
  return true
}

/** Keep the existing upload buffer when only readiness, patch priority, or another band changed. */
export function forestPatchBatch<T>(
  previous: ForestPatchBatch<T> | undefined,
  parts: ReadonlyMap<string, readonly T[]>,
): ForestPatchBatch<T> {
  if (previous && sameParts(parts, previous.parts)) return previous
  return { parts, items: [...parts.values()].flat() }
}

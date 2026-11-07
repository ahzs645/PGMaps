/** Explicit, serializable screening assumptions shared by drainage and evidence. */
export type DepressionPolicy =
  | { mode: 'fill-all' }
  | { mode: 'preserve' }
  | { mode: 'depth-limited'; maxDepthM: number }

export type SnapPolicy = 'max-accumulation' | 'lowest-elevation'

/** Undefined is the legacy Priority-Flood treatment; invalid inputs are rejected. */
export function parseDepressionPolicy(value?: unknown): DepressionPolicy {
  if (value === undefined) return { mode: 'fill-all' }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Depression policy must be an object.')
  }
  const policy = value as Record<string, unknown>
  if (policy.mode === 'fill-all' || policy.mode === 'preserve') return { mode: policy.mode }
  if (policy.mode === 'depth-limited') {
    if (
      typeof policy.maxDepthM !== 'number' ||
      !Number.isFinite(policy.maxDepthM) ||
      policy.maxDepthM < 0 ||
      policy.maxDepthM > 1000
    ) {
      throw new Error('Maximum depression fill depth must be between 0 and 1000 m.')
    }
    return { mode: 'depth-limited', maxDepthM: policy.maxDepthM }
  }
  throw new Error('Unknown depression policy.')
}

/** Undefined preserves the existing maximum contributing-area snapping behavior. */
export function parseSnapPolicy(value?: unknown): SnapPolicy {
  if (value === undefined) return 'max-accumulation'
  if (value === 'max-accumulation' || value === 'lowest-elevation') return value
  throw new Error('Unknown pour-point snap policy.')
}

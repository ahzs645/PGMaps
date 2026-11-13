/** Net rise/run over the selected distance, read from the plotted samples in increasing x order. */
export function averageSlopePercent(
  points: ReadonlyArray<{ x: number; ground: number | null; design: number | null }>,
  key: 'ground' | 'design',
  a: number,
  b: number,
): number | null {
  const start = Math.min(a, b),
    end = Math.max(a, b)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 1e-6) return null
  const elevationAt = (x: number): number | null => {
    for (let i = 0; i < points.length; i++) {
      const point = points[i],
        z = point[key]
      if (point.x === x) return z !== null && Number.isFinite(z) ? z : null
      if (point.x > x) {
        const previous = points[i - 1],
          before = previous?.[key]
        if (before == null || !Number.isFinite(before) || z === null || !Number.isFinite(z)) return null
        return before + ((x - previous.x) / (point.x - previous.x)) * (z - before)
      }
    }
    return null
  }
  const from = elevationAt(start),
    to = elevationAt(end)
  if (from === null || to === null) return null
  // A reading across a gap would imply coverage the graph does not have.
  if (points.some((p) => p.x > start && p.x < end && (p[key] === null || !Number.isFinite(p[key])))) return null
  return ((to - from) / (end - start)) * 100
}

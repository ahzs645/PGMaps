/** Small statistics and geometry helpers for the canopy-source benches. */
export const round = (v: number, d = 2) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null)

export function quantile(values: ArrayLike<number>, q: number) {
  if (!values.length) return NaN
  const s = Array.from(values).sort((a, b) => a - b)
  const i = (s.length - 1) * q,
    lo = Math.floor(i),
    hi = Math.ceil(i)
  return s[lo] + (s[hi] - s[lo]) * (i - lo)
}

export function pearson(x: number[], y: number[]) {
  const n = Math.min(x.length, y.length)
  if (n < 3) return NaN
  let mx = 0,
    my = 0
  for (let i = 0; i < n; i++) {
    mx += x[i]
    my += y[i]
  }
  mx /= n
  my /= n
  let sxy = 0,
    sxx = 0,
    syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my)
    sxx += (x[i] - mx) ** 2
    syy += (y[i] - my) ** 2
  }
  return sxy / Math.sqrt(sxx * syy)
}

type Ring = [number, number][]
export function ringsOf(geometry: { type: string; coordinates: unknown }): Ring[] {
  if (geometry.type === 'Polygon') return geometry.coordinates as Ring[]
  if (geometry.type === 'MultiPolygon') return (geometry.coordinates as Ring[][]).flat()
  return []
}

/** Even-odd test over every ring, so holes and multipolygon parts both work. */
export function pointInRings(rings: Ring[], lon: number, lat: number) {
  let inside = false
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i],
        [xj, yj] = ring[j]
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
    }
  return inside
}

/** Ordinary least squares y = intercept + slope × x, with the residual spread. */
export function linearFit(x: number[], y: number[]) {
  const n = Math.min(x.length, y.length)
  if (n < 3) return null
  const mx = x.reduce((s, v) => s + v, 0) / n,
    my = y.reduce((s, v) => s + v, 0) / n
  let sxy = 0,
    sxx = 0
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my)
    sxx += (x[i] - mx) ** 2
  }
  const slope = sxy / sxx,
    intercept = my - slope * mx
  const residual = Math.sqrt(y.reduce((s, v, i) => s + (v - intercept - slope * x[i]) ** 2, 0) / n)
  return { slope: round(slope, 3), intercept: round(intercept, 2), residualM: round(residual, 2), n }
}

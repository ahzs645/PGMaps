import type { CastorConfig, CastorPixel, CastorYieldCurve, CastorYieldPoint } from './types'

export const roundTiesToEven = (value: number): number => {
  const floor = Math.floor(value)
  const fraction = value - floor
  return floor + (fraction > 0.5 || (fraction === 0.5 && floor % 2 !== 0) ? 1 : 0)
}

/** Same first-step midpoint convention as growingStockCastor, without JS half-up rounding. */
export function growthYears(config: CastorConfig, period: number): number {
  return period === 1 && config.growthTiming === 'upstream-midpoint'
    ? Math.max(1, roundTiesToEven(config.stepYears / 2))
    : config.stepYears
}

/** Piecewise-linear yield interpolation. Outside the supplied range, hold the nearest knot. */
export function interpolateYield(curve: CastorYieldCurve, age: number): CastorYieldPoint {
  const points = curve.points
  if (age <= points[0].age) return { ...points[0], age }
  if (age >= points[points.length - 1].age) return { ...points[points.length - 1], age }
  let low = 0
  let high = points.length - 1
  while (high - low > 1) {
    const mid = (low + high) >>> 1
    if (points[mid].age <= age) low = mid
    else high = mid
  }
  const a = points[low]
  const b = points[high]
  const fraction = (age - a.age) / (b.age - a.age)
  const result: CastorYieldPoint = {
    age,
    volume: a.volume + fraction * (b.volume - a.volume),
    height: a.height + fraction * (b.height - a.height),
  }
  for (const key of ['eca', 'basalArea', 'crownClosure', 'deciduousPercent', 'qmd'] as const) {
    const av = a[key]
    const bv = b[key]
    if (av !== undefined && bv !== undefined) result[key] = av + fraction * (bv - av)
    else if (fraction === 0 && av !== undefined) result[key] = av
  }
  return result
}

export function applyYield(pixel: CastorPixel, curve: CastorYieldCurve, volumeScale = 1): void {
  const yieldPoint = interpolateYield(curve, pixel.age)
  pixel.volume = Math.max(0, yieldPoint.volume * volumeScale)
  pixel.height = Math.max(0, yieldPoint.height)
  for (const key of ['eca', 'basalArea', 'crownClosure', 'deciduousPercent', 'qmd'] as const) {
    const value = yieldPoint[key]
    if (value !== undefined) pixel[key] = value
  }
}

/** Culmination priority is the volume at maximum mean annual increment, not the MAI itself. */
export function culminationVolume(curve: CastorYieldCurve): number {
  let bestMai = -Infinity
  let volume = 0
  for (const point of curve.points)
    if (point.age > 0 && point.volume / point.age > bestMai) {
      bestMai = point.volume / point.age
      volume = point.volume
    }
  return volume
}

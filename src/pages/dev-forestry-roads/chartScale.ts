/** Round-number axis ticks for the road charts, in the 1–2–2.5–5 × 10ⁿ series engineering plots use. */
export interface AxisTicks {
  step: number
  major: number[]
  minor: number[]
  /** Decimals that show every major tick distinctly. */
  decimals: number
}

const STEPS = [1, 2, 2.5, 5, 10]

export function niceStep(span: number, targetCount: number): number {
  if (!(span > 0) || !(targetCount > 0)) return 1
  const raw = span / targetCount
  const power = 10 ** Math.floor(Math.log10(raw))
  return (STEPS.find((s) => s * power >= raw - 1e-12) ?? 10) * power
}

export function axisTicks(min: number, max: number, targetCount: number): AxisTicks {
  const low = Math.min(min, max),
    high = Math.max(min, max)
  const step = niceStep(high - low, Math.max(1, targetCount))
  const at = (n: number) => Math.round(n / step) * step
  const major: number[] = []
  for (let value = Math.ceil(low / step - 1e-9) * step; value <= high + step * 1e-9; value += step)
    major.push(Number(at(value).toPrecision(12)))
  // Five minor divisions for 1/5/10 steps, four for 2 and 2.5 (so 2.5 → 0.625 is avoided).
  const leading = Number((step / 10 ** Math.floor(Math.log10(step))).toPrecision(3))
  const divisions = leading === 2 || leading === 2.5 ? 4 : 5
  const minorStep = step / divisions
  const minor: number[] = []
  for (let value = Math.ceil(low / minorStep - 1e-9) * minorStep; value <= high + minorStep * 1e-9; value += minorStep) {
    const rounded = Number(value.toPrecision(12))
    if (!major.some((m) => Math.abs(m - rounded) < minorStep * 1e-6)) minor.push(rounded)
  }
  const decimals = Math.max(0, Math.min(3, -Math.floor(Math.log10(step) + 1e-9) + (leading === 2.5 ? 1 : 0)))
  return { step, major, minor, decimals }
}

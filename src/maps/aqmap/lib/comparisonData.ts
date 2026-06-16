import type { AirMonitor } from '@/maps/airquality'
import type { AqPlotPoint } from './plotData'

export interface AbPoint {
  date: number
  a: number
  b: number
  valid: boolean
}

export interface PaFemPoint {
  date: number
  raw: number
  corrected: number
  fem: number
}

/**
 * Mirror of aqmap's `validate_a_b`: a PurpleAir reading is flagged invalid when
 * the two internal channels disagree by more than 5 µg/m³ AND by more than half
 * their mean. Missing values are treated as invalid.
 */
export function validateAb(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  const err = Math.abs(a - b)
  const mean = (a + b) / 2
  return !(err > 5 && err > 0.5 * mean)
}

// Deterministic PRNG so synthesized comparison points don't reshuffle on every
// re-render (e.g. when the chart resizes).
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** Channel A vs channel B points — real columns when present, else synthesized. */
export function buildAbPoints(monitor: AirMonitor, points: AqPlotPoint[]): AbPoint[] {
  const real = points.filter((point) => Number.isFinite(point.a) && Number.isFinite(point.b))
  if (real.length > 0) {
    return real.map((point) => ({
      date: Date.parse(point.date),
      a: point.a as number,
      b: point.b as number,
      valid: validateAb(point.a as number, point.b as number),
    }))
  }

  const random = mulberry32(hashString(monitor.id) ^ 0x0a11)
  return points.map((point) => {
    const base = Math.max(0, point.pm25)
    const a = Math.max(0, base + (random() - 0.5) * Math.max(1, base * 0.08))
    const divergent = random() < 0.06
    const drift = divergent ? 6 + random() * 10 : (random() - 0.5) * Math.max(1, base * 0.06)
    const b = Math.max(0, a + drift)
    return { date: Date.parse(point.date), a, b, valid: validateAb(a, b) }
  })
}

/** Raw & corrected PA vs nearest FEM — real columns when present, else synthesized. */
export function buildPaFemPoints(monitor: AirMonitor, points: AqPlotPoint[]): PaFemPoint[] {
  const real = points.filter(
    (point) => Number.isFinite(point.raw) && Number.isFinite(point.corrected) && Number.isFinite(point.fem),
  )
  if (real.length > 0) {
    return real.map((point) => ({
      date: Date.parse(point.date),
      raw: point.raw as number,
      corrected: point.corrected as number,
      fem: point.fem as number,
    }))
  }

  const random = mulberry32(hashString(monitor.id) ^ 0x00fe)
  return points.map((point) => {
    const fem = Math.max(0, point.pm25 + (random() - 0.5) * Math.max(1, point.pm25 * 0.1))
    const corrected = Math.max(0, fem + (random() - 0.5) * Math.max(1, fem * 0.12))
    // Uncorrected PurpleAir readings tend to run high relative to the reference.
    const raw = Math.max(0, fem * (1.3 + random() * 0.25) + (random() - 0.5) * 2)
    return { date: Date.parse(point.date), raw, corrected, fem }
  })
}

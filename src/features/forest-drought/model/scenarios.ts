// SPDX-License-Identifier: Apache-2.0
// Explicit, deterministic replacements for legacy yearSelect/asmrFuture preparation.
import { validateClimate } from './inputs'
import type { ClimateDay, MonthlyAnomaly } from './types'

export interface MonthlyNormal {
  month: number
  tmn: number
  tmx: number
  ppt: number
}

function normalMap(normals: readonly MonthlyNormal[]): Map<number, MonthlyNormal> {
  if (normals.length !== 12 || new Set(normals.map((normal) => normal.month)).size !== 12) {
    throw new Error('Normals require exactly one entry for every month, 1–12.')
  }
  for (const normal of normals) {
    if (!Number.isInteger(normal.month) || normal.month < 1 || normal.month > 12)
      throw new Error('Normal month must be from 1 to 12.')
    if (![normal.tmn, normal.tmx, normal.ppt].every(Number.isFinite) || normal.tmn > normal.tmx || normal.ppt < 0) {
      throw new Error(
        `Month ${normal.month}: climate normals need finite ordered temperatures and nonnegative precipitation.`,
      )
    }
  }
  return new Map(normals.map((normal) => [normal.month, normal]))
}

/** Same additive-temperature/multiplicative-precipitation method as asmrFuture. */
export function deriveMonthlyAnomalies(
  baseline: readonly MonthlyNormal[],
  future: readonly MonthlyNormal[],
): MonthlyAnomaly[] {
  const baselineByMonth = normalMap(baseline)
  const futureByMonth = normalMap(future)
  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1
    const before = baselineByMonth.get(month)!
    const after = futureByMonth.get(month)!
    if (before.ppt === 0)
      throw new Error(
        `Month ${month}: baseline precipitation is zero, so a multiplicative anomaly is undefined. Supply an explicit multiplier instead.`,
      )
    return {
      month,
      tminDelta: after.tmn - before.tmn,
      tmaxDelta: after.tmx - before.tmx,
      precipMultiplier: after.ppt / before.ppt,
    }
  })
}

/** For example, average RCP4.5/RCP8.5 normals before deriving the legacy mean scenario. */
export function averageMonthlyNormals(series: readonly (readonly MonthlyNormal[])[]): MonthlyNormal[] {
  if (series.length < 1) throw new Error('Supply at least one set of monthly normals.')
  const maps = series.map(normalMap)
  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1
    const values = maps.map((map) => map.get(month)!)
    const average = (field: 'tmn' | 'tmx' | 'ppt') =>
      values.reduce((sum, value) => sum + value[field], 0) / values.length
    return { month, tmn: average('tmn'), tmx: average('tmx'), ppt: average('ppt') }
  })
}

export interface PreferredYearOptions {
  count?: number
  preferred?: readonly [number, number]
  allowed?: readonly [number, number]
  seed?: number
}

/**
 * Deterministic selection policy corresponding to yearSelect, not R's RNG sequence.
 * Apply selected years to already calculated daily outputs with summarizeCalculatedYears.
 */
export function selectPreferredYears(climate: readonly ClimateDay[], options: PreferredYearOptions = {}): number[] {
  validateClimate(climate)
  const count = options.count ?? 10
  const preferred = options.preferred ?? [1961, 1990]
  const allowed = options.allowed ?? [1940, 2000]
  let state = options.seed ?? 1
  if (!Number.isInteger(count) || count < 1) throw new Error('Year count must be a positive integer.')
  if (!Number.isInteger(state) || state < 0 || state > 0xffffffff)
    throw new Error('Sampling seed must be an unsigned 32-bit integer.')
  for (const interval of [preferred, allowed]) {
    if (!interval.every(Number.isInteger) || interval[0] > interval[1])
      throw new Error('Year windows must be ordered integer pairs.')
  }
  const all = [...new Set(climate.map((day) => day.year))].filter((year) => year >= allowed[0] && year <= allowed[1])
  if (all.length < count)
    throw new Error(`Only ${all.length} complete years lie in the allowed window; ${count} requested.`)
  const ideal = all.filter((year) => year >= preferred[0] && year <= preferred[1])
  const outside = all.filter((year) => !ideal.includes(year))
  const sample = (values: number[], length: number) => {
    const shuffled = [...values]
    for (let i = shuffled.length - 1; i > 0; i--) {
      // Mulberry32 gives reproducible selection even for seed zero.
      state = (state + 0x6d2b79f5) >>> 0
      let value = Math.imul(state ^ (state >>> 15), state | 1)
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
      const fraction = ((value ^ (value >>> 14)) >>> 0) / 4294967296
      const j = Math.floor(fraction * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    return shuffled.slice(0, length)
  }
  return (ideal.length >= count ? sample(ideal, count) : [...ideal, ...sample(outside, count - ideal.length)]).sort(
    (a, b) => a - b,
  )
}

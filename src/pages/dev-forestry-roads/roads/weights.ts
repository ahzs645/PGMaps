/**
 * TypeScript adaptation of LandSciTech/roads R/weightFunctions.R (Apache-2.0).
 * Copyright 2021 Her Majesty the Queen in Right of Canada, represented by the
 * Minister of Environment; Copyright 2018 Province of British Columbia.
 * See this directory's LICENSE and NOTICE. Scalar outputs preserve the R formulas.
 */
import type { GradePenaltyOptions } from './types'

export const DEFAULT_GRADE_PENALTY: GradePenaltyOptions = { baseCost: 16178, limit: 20, penalty: 504 }

/** Mean endpoint weight times supplied horizontal distance. No currency/unit conversion. */
export function simpleCostFn(x1: number, x2: number, hdistance: number): number {
  return (hdistance * (x1 + x2)) / 2
}

/**
 * Strict scalar upstream formula, including its zero-road and negative-barrier conventions.
 * A zero road endpoint still participates in the grade LIMIT test; zero-to-zero returns
 * baseCost × distance, not zero. Raw cost/km × metres is a relative score, not dollars.
 */
export function gradePenaltyFn(
  x1: number,
  x2: number,
  hdistance: number,
  options: Partial<GradePenaltyOptions> = {},
): number {
  if (!Number.isFinite(x1) || !Number.isFinite(x2) || !Number.isFinite(hdistance) || hdistance <= 0) return NaN
  const { baseCost, limit, penalty, limitWeight } = { ...DEFAULT_GRADE_PENALTY, ...options }
  const minimum = Math.min(x1, x2)
  if (minimum < 0) return Math.abs(minimum) * hdistance
  const grade = (100 * Math.abs(x1 - x2)) / hdistance
  if (grade > limit) return (limitWeight ?? NaN) * hdistance
  return (baseCost + grade * penalty * Number(minimum > 0)) * hdistance
}

/**
 * Explicit PGMaps planning extension: grades use unchanged terrain, and an existing
 * road edge can be free without replacing elevations with zero. The same relative
 * units as gradePenaltyFn are retained. This is not the upstream overloaded-raster formula.
 */
export function terrainGradeCost(
  elevation1: number,
  elevation2: number,
  hdistance: number,
  options: GradePenaltyOptions,
): number {
  if (!Number.isFinite(elevation1) || !Number.isFinite(elevation2)) return NaN
  const grade = (100 * Math.abs(elevation1 - elevation2)) / hdistance
  if (grade > options.limit) return (options.limitWeight ?? NaN) * hdistance
  return (options.baseCost + grade * options.penalty) * hdistance
}

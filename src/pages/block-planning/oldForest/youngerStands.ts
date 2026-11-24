/**
 * D.4 of the 2004 order: "Where it can be demonstrated that equal or better conservation benefits
 * would result, up to 20% of the Old Forest Retention and Old Interior Forest objectives may be
 * comprised of younger age classes."
 *
 * The benefit is a judgement, so D.4 is the reviewer's, never the model's: it is off unless the
 * reviewer switches it on, states the age from which younger stands count and states the benefit.
 * When on, stands from that age up to the unit's old age (CFLB ground, less reset ground and less
 * ground already counted whole under D.1) are kept as their own supply, and what counts toward each
 * objective is capped at 20% of its requirement (`withYoungerCap`). The non-pine minimum (policy
 * Tables 8–10) is not one of the two objectives D.4 names, and D.4 never counts toward it.
 *
 * DOM- and network-free. See docs/forestry-old-forest.md, **D.4: younger stands**.
 */
import type { OldForestUnit } from './units'

/** D.4's ceiling: the share of each objective that younger stands may supply. */
export const YOUNGER_STANDS_MAX_SHARE = 0.2

/** What the calculation needs to count younger stands. */
export interface YoungerStandsSettings {
  /** Stands this age or older, and younger than the unit's old age, count under D.4. */
  fromAge: number
}

/** What the reviewer states on the plan (`OldForestChoices.younger`). */
export interface YoungerStandsChoice {
  /** No default: the reviewer must enter it. */
  fromAge?: number
  /** The conservation benefit D.4 requires to be demonstrated. Required. */
  benefit: string
}

/** The D.4 figures for one year. The supplies are uncapped; the counted figures are capped. */
export interface YoungerStandsYear {
  /** Younger-stand ground that would count as old forest, before the cap. */
  d4OldSupplyHa: number
  /** Of that, what counts toward old forest: at most 20% of `requiredOldHa`. */
  d4OldHa: number
  /** Interior the younger stands add, before the cap. Null when interior was not calculated. */
  d4InteriorSupplyHa: number | null
  /** Of that, what counts toward old interior: at most 20% of `requiredInteriorHa`. */
  d4InteriorHa: number | null
}

/** Why the D.4 choice cannot be calculated yet, or null. `units` are every unit the run assesses. */
export function youngerStandsProblem(choice: YoungerStandsChoice, units: OldForestUnit[]): string | null {
  if (choice.fromAge === undefined || !Number.isInteger(choice.fromAge) || choice.fromAge < 1)
    return 'D.4 is on: state the age from which younger stands count.'
  const oldest = units.find((u) => choice.fromAge! >= u.oldFromAge)
  if (oldest)
    return `D.4 is on: younger stands must count from below ${oldest.unit}’s old age (${oldest.oldFromAge} years).`
  if (!choice.benefit.trim()) return 'D.4 is on: state the conservation benefit it relies on.'
  return null
}

/** The calculation's D.4 settings from the reviewer's choice; throws when the choice is incomplete. */
export function youngerStandsSettings(
  choice: YoungerStandsChoice | undefined,
  units: OldForestUnit[],
): YoungerStandsSettings | null {
  if (!choice) return null
  const problem = youngerStandsProblem(choice, units)
  if (problem) throw Error(problem)
  return { fromAge: choice.fromAge! }
}

/** True when a stand of this age counts under D.4 for a unit. */
export const countsAsYounger = (age: number | null, unit: OldForestUnit, d4: YoungerStandsSettings) =>
  age !== null && age >= d4.fromAge && age < unit.oldFromAge

/**
 * Applies D.4's 20% ceiling to a year's supplies against its requirements. A pool applies it again to
 * its summed supplies and requirements, so the ceiling is always 20% of the requirement assessed.
 */
export function withYoungerCap<
  T extends { requiredOldHa: number; requiredInteriorHa: number } & Partial<YoungerStandsYear>,
>(y: T): T {
  if (y.d4OldSupplyHa === undefined) return y
  const cap = (supply: number, required: number) => Math.min(supply, YOUNGER_STANDS_MAX_SHARE * required)
  const interiorSupply = y.d4InteriorSupplyHa ?? null
  return {
    ...y,
    d4OldHa: cap(y.d4OldSupplyHa, y.requiredOldHa),
    d4InteriorHa: interiorSupply === null ? null : cap(interiorSupply, y.requiredInteriorHa),
  }
}

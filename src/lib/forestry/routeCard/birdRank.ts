/**
 * An estimated migratory bird nest-density rank for a forest inventory stand (VRI rank 1), by the stated rule in
 * `catalogue/birdNestRank.json`. The route card tool's ranks come from an unpublished industry matrix; this is PGMaps'
 * own assumption, calibrated against the ranks the tool printed and labelled an estimate wherever it prints. No DOM or
 * network access.
 */
import rule from './catalogue/birdNestRank.json'

export const BIRD_NEST_RANK = rule

/** The VRI fields the estimate reads. */
export const BIRD_RANK_FIELDS = [
  'BCLCS_LEVEL_2',
  'PROJ_AGE_1',
  'PROJ_HEIGHT_1',
  ...[1, 2, 3, 4, 5, 6].flatMap((i) => [`SPECIES_CD_${i}`, `SPECIES_PCT_${i}`]),
]

const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const code = (value: unknown) => (typeof value === 'string' ? value.trim().toUpperCase() : '')

/** The stand's rank, 1 to 6, or null for ground that is not treed or a stand without an age and height. */
export function estimateNestRank(props: Record<string, unknown>): number | null {
  if (rule.treedOnly && code(props.BCLCS_LEVEL_2) !== 'T') return null
  const age = num(props.PROJ_AGE_1)
  const height = num(props.PROJ_HEIGHT_1)
  if (age === null || height === null) return null
  const species = [1, 2, 3, 4, 5, 6]
    .map((i) => ({ code: code(props[`SPECIES_CD_${i}`]), percent: num(props[`SPECIES_PCT_${i}`]) ?? 0 }))
    .filter((entry) => entry.code)
  if (!species.length) return null
  const ageClass = rule.ageClasses.find((entry) => entry.maxYears === null || age <= entry.maxYears)!
  let rank = ageClass.base
  if (age > rule.heightBonus.olderThanYears) {
    const step = [...rule.heightBonus.steps].reverse().find((entry) => height >= entry.fromMeters)
    if (step) rank += step.add
  }
  const deciduous = species
    .filter((entry) => rule.deciduous.includes(entry.code))
    .reduce((sum, e) => sum + e.percent, 0)
  const pine = species
    .filter((entry) => entry.code === 'P' || entry.code.startsWith('PL'))
    .reduce((s, e) => s + e.percent, 0)
  for (const adjustment of rule.adjustments) {
    const applies =
      adjustment.when === 'pineAtLeast'
        ? pine >= (adjustment.percent ?? 100)
        : adjustment.when === 'deciduousAtLeast'
          ? deciduous >= (adjustment.percent ?? 100)
          : adjustment.when === 'leading'
            ? (adjustment.species ?? []).includes(species[0].code)
            : false
    if (applies) rank += adjustment.add
  }
  return Math.max(rule.min, Math.min(rule.max, rank))
}

import type { CastorConfig, CastorHarvestRow, CastorRunOptions, CastorUncertaintyRow } from './types'

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

export function quantile(values: number[], probability: number): number {
  if (!values.length) return 0
  const position = (values.length - 1) * probability
  const lo = Math.floor(position)
  const hi = Math.ceil(position)
  return values[lo] + (values[hi] - values[lo]) * (position - lo)
}

/**
 * PGMaps sensitivity extension, not forestryCastor's unimplemented calibration model.
 * One mean-one lognormal multiplier per replicate represents systematic yield error,
 * shared by every period of the already selected schedule. It does not rerun scheduling.
 */
export function yieldSensitivity(
  rows: CastorHarvestRow[],
  config: CastorConfig,
  options: CastorRunOptions = {},
): CastorUncertaintyRow[] {
  if (!config.uncertainty.enabled) return []
  const { seed, replicates, coefficientOfVariation } = config.uncertainty
  const random = seededRandom(seed)
  const variance = Math.log1p(coefficientOfVariation ** 2)
  const sigma = Math.sqrt(variance)
  const multipliers: number[] = []
  for (let i = 0; i < replicates; i++) {
    if (options.shouldCancel?.()) throw new Error('Simulation cancelled.')
    const normal = Math.sqrt(-2 * Math.log(Math.max(Number.MIN_VALUE, random()))) * Math.cos(2 * Math.PI * random())
    multipliers.push(coefficientOfVariation === 0 ? 1 : Math.exp(-variance / 2 + sigma * normal))
    if (i % 100 === 0 || i + 1 === replicates)
      options.onProgress?.({
        phase: 'uncertainty',
        completed: i + 1,
        total: replicates,
        message: `Yield sensitivity replicate ${i + 1} of ${replicates}`,
      })
  }
  multipliers.sort((a, b) => a - b)
  return rows
    .filter((row): row is CastorHarvestRow & { targetM3: number } => row.targetM3 !== null)
    .map((row) => {
      const outcomes = multipliers.map((multiplier) => row.volumeM3 * multiplier)
      return {
        period: row.period,
        year: row.year,
        compartment: row.compartment,
        flowId: row.flowId,
        targetM3: row.targetM3,
        p05M3: quantile(outcomes, 0.05),
        medianM3: quantile(outcomes, 0.5),
        p95M3: quantile(outcomes, 0.95),
        probabilityTarget: outcomes.filter((value) => value + 1e-9 >= row.targetM3).length / replicates,
      }
    })
}

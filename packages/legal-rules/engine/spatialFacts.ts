import patch from '../spatial/patch-analysis.json'
import riparian from '../spatial/riparian-analysis.json'
import type { Pack, FactSet, Scalar } from '../src/contract'

export const operations = [patch, riparian]
export type Measurement = { operation: string; output: string; value: Scalar | null; evidence: string }

/** A release binds an engine output by name and unit. Missing measurements stay unknown. */
export function spatialFacts(pack: Pack, measurements: Measurement[]): FactSet['facts'] {
  return (pack.spatialBindings ?? []).map((binding) => {
    const measurement = measurements.find((m) => m.operation === binding.operation && m.output === binding.output)
    return {
      id: binding.fact,
      value: measurement?.value ?? null,
      evidence: measurement?.evidence ?? 'No measurement for this plan and interval.',
    }
  })
}

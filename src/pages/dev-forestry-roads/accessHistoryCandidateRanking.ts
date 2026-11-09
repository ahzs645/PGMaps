/** Rank geometry candidates without manufacturing a block entrance or a road-use relationship. */
import type { HistoricalSource } from './accessHistoryTypes'
import { nearbyRoadCandidates, type NearbyRoadCandidate } from './harvestHistory'
import type { ContextFeature } from './types'

export type SourceCodeComparison = 'same' | 'different' | 'unknown' | 'conflicting'
export interface HistoricalRoadCandidate extends NearbyRoadCandidate {
  client: SourceCodeComparison
  timberMark: SourceCodeComparison
}

function compareCode(value: string | undefined, blockValues: readonly string[]): SourceCodeComparison {
  const values = new Set(blockValues)
  if (values.size > 1) return 'conflicting'
  if (!value || !values.size) return 'unknown'
  return values.has(value) ? 'same' : 'different'
}

/** The caller scopes roads to the selected study; sibling polygon parts retain the full opening footprint. */
export function historicalRoadCandidates({
  block,
  context,
  roads,
  sources,
}: {
  block: ContextFeature
  context: readonly ContextFeature[]
  roads: readonly ContextFeature[]
  sources: readonly HistoricalSource[]
}): HistoricalRoadCandidate[] {
  const identities = sources.flatMap((source) =>
    source.blockIdentity && source.blockIdentity.openingId === block.harvestEvidence?.openingId
      ? [source.blockIdentity]
      : [],
  )
  const clients = identities.flatMap((identity) => identity.clientNumber ?? [])
  const marks = identities.flatMap((identity) => identity.timberMark ?? [])
  const candidates = nearbyRoadCandidates(
    block,
    [...context.filter((feature) => feature.kind === 'harvest'), ...roads],
    { maxDistanceM: 1000 },
  )
  return candidates.map((candidate) => ({
    ...candidate,
    client: compareCode(candidate.road.roadEvidence?.clientNumber, clients),
    timberMark: compareCode(candidate.road.roadEvidence?.timberMark, marks),
  }))
}

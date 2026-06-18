import { buildCandidates } from '@/lib/acknowledgement/candidates'
import type { RelationshipGraph } from '@/lib/acknowledgement/engine'
import { findPronunciation, sourceMeta } from './data'
import type { CandidateNation, SourceKey, SourceLookupState } from './types'

/**
 * App adapter over the tested `buildCandidates` engine helper — wires in the
 * page's source labels and pronunciation database.
 */
export function buildCandidatesFromLookups(
  lookups: Record<SourceKey, SourceLookupState>,
  graph: RelationshipGraph | null = null,
): CandidateNation[] {
  return buildCandidates(lookups, {
    sourceLabel: (source) => sourceMeta[source].label,
    findPronunciation,
    graph,
  })
}

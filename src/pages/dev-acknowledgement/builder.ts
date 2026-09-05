import { buildCandidatesFromLookups } from './candidates'
import { initialLookupState } from './data'
import type {
  CandidateNation,
  GeocodeResult,
  MatchedRelationshipPlace,
  RelationshipGraph,
  SourceKey,
  SourceLookupState,
} from './types'

export const defaultSources: Record<SourceKey, boolean> = {
  verified: true,
  nativeLand: false,
  cad: false,
  treaty: false,
  reserve: false,
  local: false,
}
export type BuilderLocation = {
  id: string
  result: GeocodeResult
  status: 'loading' | 'done' | 'error'
  lookupKey?: string
  lookups: Record<SourceKey, SourceLookupState>
  match: MatchedRelationshipPlace | null
  /** null means untouched; an empty array is an explicit choice to include nobody. */
  selectedIds: string[] | null
}
export function createLocation(result: GeocodeResult, id: string = crypto.randomUUID()): BuilderLocation {
  return { id, result, status: 'loading', lookups: initialLookupState, match: null, selectedIds: null }
}
export function locationCandidates(
  location: BuilderLocation,
  graph: RelationshipGraph | null,
  enabled: Record<SourceKey, boolean>,
): CandidateNation[] {
  const lookups = { ...location.lookups }
  for (const source of Object.keys(enabled) as SourceKey[]) {
    if (!enabled[source]) lookups[source] = { status: 'idle', matches: [] }
  }
  // Language and treaty names are context, never candidates for Nation wording.
  lookups.nativeLand = {
    ...lookups.nativeLand,
    matches: lookups.nativeLand.matches.filter((match) => match.label === 'Native Land territory overlap'),
  }
  return buildCandidatesFromLookups(lookups, graph)
}
export function chosenCandidates(location: BuilderLocation, candidates: CandidateNation[]) {
  return location.selectedIds === null
    ? candidates.filter((candidate) => candidate.confidence === 'strong' && candidate.sources.verified)
    : candidates.filter((candidate) => location.selectedIds!.includes(candidate.id))
}
export function locationReady(location: BuilderLocation, selected: CandidateNation[]) {
  return (
    location.status === 'done' &&
    selected.length > 0 &&
    (location.selectedIds === null ||
      location.selectedIds.every((id) => selected.some((candidate) => candidate.id === id)))
  )
}

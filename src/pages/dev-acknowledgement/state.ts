import type { CandidateNation, MatchType, SourceKey } from './types'

export function visibleAcknowledgementCandidates(
  candidates: CandidateNation[],
  enabledSources: Record<SourceKey, boolean>,
) {
  return candidates.filter((candidate) => (
    Object.keys(candidate.sources).some((source) => enabledSources[source as SourceKey])
  ))
}

export function effectiveSelectedCandidateIds(
  visibleCandidates: CandidateNation[],
  selectedIds: string[],
) {
  if (visibleCandidates.length === 0) return []
  // An explicitly empty selection stays empty — the user unchecked everything.
  if (selectedIds.length === 0) return []

  const available = new Set(visibleCandidates.map((candidate) => candidate.id))
  const kept = selectedIds.filter((id) => available.has(id))
  if (kept.length > 0) return kept

  // The prior selection is stale (e.g. the address moved to a new region). Only
  // auto-select a candidate we are confident in; naming a weak single-source
  // overlap (like an oversized Native Land polygon) by default is worse than
  // asking the user to choose.
  const strong = visibleCandidates.find((candidate) => candidate.confidence === 'strong')
  return strong ? [strong.id] : []
}

export function selectedCandidateNames(
  visibleCandidates: CandidateNation[],
  selectedIds: string[],
) {
  return visibleCandidates
    .filter((candidate) => selectedIds.includes(candidate.id))
    .map((candidate) => candidate.preferredName)
}

export function toggleMatchTypeState(
  current: Record<MatchType, boolean>,
  matchType: MatchType,
) {
  return { ...current, [matchType]: !current[matchType] }
}

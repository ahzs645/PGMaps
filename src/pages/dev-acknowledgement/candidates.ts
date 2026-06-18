import { findPronunciation, sourceMeta } from './data'
import { candidateId, normalizeName } from './names'
import type { CandidateNation, Confidence, SourceKey, SourceLookupState } from './types'

export function buildCandidatesFromLookups(lookups: Record<SourceKey, SourceLookupState>): CandidateNation[] {
  const byName = new Map<string, CandidateNation>()
  const sourceOrder: SourceKey[] = ['verified', 'local', 'nativeLand', 'treaty', 'reserve', 'cad']

  Object.values(lookups).flatMap((lookup) => lookup.matches).forEach((match) => {
    const key = normalizeName(match.name) || match.name
    const existing = byName.get(key)
    const nextSources = {
      ...(existing?.sources ?? {}),
      [match.source]: match.detail ? `${match.label}: ${match.detail}` : match.label,
    }
    const sourceCount = sourceOrder.filter((source) => nextSources[source]).length
    const confidence: Confidence = nextSources.verified || sourceCount >= 2
      ? 'strong'
      : nextSources.reserve
        ? 'strong'
        : nextSources.treaty
          ? 'moderate'
          : 'review_required'
    const sourceLabels = sourceOrder
      .filter((source) => nextSources[source])
      .map((source) => sourceMeta[source].label)

    byName.set(key, {
      id: candidateId(match.name),
      name: existing?.name ?? match.name,
      preferredName: existing?.preferredName ?? match.name,
      confidence,
      pronunciation: existing?.pronunciation ?? findPronunciation(match.name),
      reason: `${match.name} appears in ${sourceLabels.join(', ')} for this location.`,
      sources: nextSources,
      notes: nextSources.verified
        ? 'Curated relationship facts matched this place. Generated variants still need review before publication.'
        : confidence === 'strong'
        ? 'Multiple source signals are present. Final wording should still be reviewed.'
        : 'Single-source match. Keep as context and confirm before using in final wording.',
    })
  })

  return Array.from(byName.values()).sort((left, right) => {
    const rank: Record<Confidence, number> = { strong: 0, moderate: 1, review_required: 2 }
    return rank[left.confidence] - rank[right.confidence] || left.name.localeCompare(right.name)
  })
}

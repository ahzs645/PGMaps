import { buildNationAliasIndex, candidateId, nationName, normalizeName, resolveNationId } from './engine'
import type { RelationshipGraph, SourceKey, SourceMatch } from './engine'

export type Confidence = 'strong' | 'moderate' | 'review_required'
export type SourceStatus = 'idle' | 'loading' | 'success' | 'error' | 'skipped'

export type SourceLookupState = {
  status: SourceStatus
  matches: SourceMatch[]
  message?: string
}

export type PronunciationInfo = {
  phonetic?: string
  audioUrl?: string
  sourceLabel: string
  sourceUrl: string
  caveat: string
}

export type CandidateNation = {
  id: string
  name: string
  preferredName: string
  confidence: Confidence
  pronunciation?: PronunciationInfo
  reason: string
  sources: Partial<Record<SourceKey, string>>
  notes: string
}

export type BuildCandidatesOptions = {
  /** Human-readable label for a source key (e.g. "Verified relationships"). */
  sourceLabel: (source: SourceKey) => string
  /** Optional pronunciation lookup keyed by Nation name. */
  findPronunciation?: (name: string) => PronunciationInfo | undefined
  /** Relationship graph, used to resolve Nation identity from names + aliases. */
  graph?: RelationshipGraph | null
}

const SOURCE_ORDER: SourceKey[] = ['verified', 'local', 'nativeLand', 'treaty', 'reserve', 'cad']

// Lower rank == higher trust. Used to keep the strongest verification level when
// several curated relationships resolve to the same Nation.
const VERIFICATION_RANK: Record<string, number> = {
  verified_institutional: 0,
  verified_local_context: 0,
  verified_institutional_context: 1,
  boundary_context: 1,
  template_context: 2,
}

/** Maps a curated relationship's verificationStatus onto candidate confidence. */
export function verificationConfidence(status: string | undefined): Confidence {
  switch (status) {
    case 'verified_institutional':
    case 'verified_local_context':
      return 'strong'
    case 'verified_institutional_context':
    case 'boundary_context':
      return 'moderate'
    case 'template_context':
      return 'review_required'
    default:
      // Unknown/absent status on a verified curated match: treat as strong.
      return 'strong'
  }
}

function sourceConfidence(sources: Partial<Record<SourceKey, string>>): Confidence {
  const sourceCount = SOURCE_ORDER.filter((source) => sources[source]).length
  if (sourceCount >= 2) return 'strong'
  if (sources.reserve) return 'strong'
  if (sources.treaty) return 'moderate'
  return 'review_required'
}

/**
 * Collapses the per-source spatial/relationship lookups into a deduplicated,
 * confidence-ranked list of candidate Nations for acknowledgement wording.
 * Verified curated matches take their confidence from the relationship's
 * verificationStatus (so boundary/template context reads weaker than a
 * directly verified place); everything else falls back to source corroboration.
 */
export function buildCandidates(
  lookups: Record<SourceKey, SourceLookupState>,
  options: BuildCandidatesOptions,
): CandidateNation[] {
  const { sourceLabel, findPronunciation, graph } = options
  const aliasIndex = graph ? buildNationAliasIndex(graph) : null
  const byKey = new Map<string, CandidateNation>()
  const verifiedStatusByKey = new Map<string, { status?: string; rank: number }>()

  Object.values(lookups).flatMap((lookup) => lookup.matches).forEach((match) => {
    // Resolve every source's free-text Nation name to a stable nation.id when we
    // can, so differently-named matches for one Nation merge into one candidate.
    const nationId = aliasIndex ? resolveNationId(match.name, aliasIndex) : undefined
    const displayName = nationId && graph ? nationName(graph, nationId) : match.name
    const key = nationId ?? (normalizeName(match.name) || match.name)
    const existing = byKey.get(key)
    const nextSources = {
      ...(existing?.sources ?? {}),
      [match.source]: match.detail ? `${match.label}: ${match.detail}` : match.label,
    }

    if (match.source === 'verified') {
      const rank = VERIFICATION_RANK[match.verificationStatus ?? ''] ?? 0
      const prev = verifiedStatusByKey.get(key)
      if (!prev || rank < prev.rank) verifiedStatusByKey.set(key, { status: match.verificationStatus, rank })
    }
    const verifiedStatus = verifiedStatusByKey.get(key)?.status
    const confidence = nextSources.verified ? verificationConfidence(verifiedStatus) : sourceConfidence(nextSources)

    const name = existing?.name ?? displayName
    const sourceLabels = SOURCE_ORDER
      .filter((source) => nextSources[source])
      .map((source) => sourceLabel(source))

    byKey.set(key, {
      id: existing?.id ?? nationId ?? candidateId(match.name),
      name,
      preferredName: existing?.preferredName ?? displayName,
      confidence,
      pronunciation: existing?.pronunciation ?? findPronunciation?.(displayName),
      reason: `${name} appears in ${sourceLabels.join(', ')} for this location.`,
      sources: nextSources,
      notes: nextSources.verified
        ? 'Curated relationship facts matched this place. Generated variants still need review before publication.'
        : confidence === 'strong'
        ? 'Multiple source signals are present. Final wording should still be reviewed.'
        : 'Single-source match. Keep as context and confirm before using in final wording.',
    })
  })

  return Array.from(byKey.values()).sort((left, right) => {
    const rank: Record<Confidence, number> = { strong: 0, moderate: 1, review_required: 2 }
    return rank[left.confidence] - rank[right.confidence] || left.name.localeCompare(right.name)
  })
}

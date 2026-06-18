import { describe, expect, it } from 'vitest'

import { buildCandidates, verificationConfidence, type SourceLookupState } from './candidates'
import type { RelationshipGraph, SourceKey, SourceMatch } from './engine'

const sourceLabel = (source: SourceKey) => source

function lookups(matches: SourceMatch[]): Record<SourceKey, SourceLookupState> {
  const empty = (): SourceLookupState => ({ status: 'idle', matches: [] })
  const base: Record<SourceKey, SourceLookupState> = {
    verified: empty(),
    nativeLand: empty(),
    cad: empty(),
    treaty: empty(),
    reserve: empty(),
    local: empty(),
  }
  for (const match of matches) base[match.source].matches.push(match)
  return base
}

const m = (source: SourceKey, name: string, extra: Partial<SourceMatch> = {}): SourceMatch => ({
  source,
  name,
  label: `${source} match`,
  ...extra,
})

describe('verificationConfidence', () => {
  it('maps directly verified levels to strong', () => {
    expect(verificationConfidence('verified_institutional')).toBe('strong')
    expect(verificationConfidence('verified_local_context')).toBe('strong')
  })

  it('maps context-only levels to moderate', () => {
    expect(verificationConfidence('verified_institutional_context')).toBe('moderate')
    expect(verificationConfidence('boundary_context')).toBe('moderate')
  })

  it('maps template context to review_required', () => {
    expect(verificationConfidence('template_context')).toBe('review_required')
  })

  it('defaults unknown/absent verified status to strong', () => {
    expect(verificationConfidence(undefined)).toBe('strong')
    expect(verificationConfidence('something_new')).toBe('strong')
  })
})

describe('buildCandidates confidence', () => {
  const opts = { sourceLabel }

  it('reads verified confidence from the relationship verificationStatus', () => {
    const strong = buildCandidates(lookups([m('verified', 'A', { verificationStatus: 'verified_institutional' })]), opts)
    const moderate = buildCandidates(lookups([m('verified', 'B', { verificationStatus: 'boundary_context' })]), opts)
    const review = buildCandidates(lookups([m('verified', 'C', { verificationStatus: 'template_context' })]), opts)

    expect(strong[0].confidence).toBe('strong')
    expect(moderate[0].confidence).toBe('moderate')
    expect(review[0].confidence).toBe('review_required')
  })

  it('keeps the strongest verification level when several relationships resolve to one Nation', () => {
    const [candidate] = buildCandidates(lookups([
      m('verified', 'Y', { verificationStatus: 'boundary_context', label: 'a' }),
      m('verified', 'Y', { verificationStatus: 'verified_institutional', label: 'b' }),
    ]), opts)

    expect(candidate.confidence).toBe('strong')
  })

  it('falls back to source corroboration when no verified match is present', () => {
    expect(buildCandidates(lookups([m('nativeLand', 'X')]), opts)[0].confidence).toBe('review_required')
    expect(buildCandidates(lookups([m('nativeLand', 'X'), m('treaty', 'X')]), opts)[0].confidence).toBe('strong')
    expect(buildCandidates(lookups([m('reserve', 'X')]), opts)[0].confidence).toBe('strong')
    expect(buildCandidates(lookups([m('treaty', 'X')]), opts)[0].confidence).toBe('moderate')
  })
})

describe('buildCandidates identity (nation.id + alternateNames)', () => {
  const graph = {
    generatedAt: '',
    sources: [],
    peopleGroups: [],
    nations: [{ id: 'musqueam', preferredName: 'Musqueam Indian Band', alternateNames: ['xʷməθkʷəy̓əm'] }],
    referenceAreas: [],
    places: [],
    placeRelationships: [],
  } as RelationshipGraph
  const opts = { sourceLabel, graph }

  it('keys candidate id on the stable nation.id (not the normalized name)', () => {
    const [candidate] = buildCandidates(lookups([
      m('verified', 'Musqueam Indian Band', { verificationStatus: 'verified_institutional' }),
    ]), opts)
    expect(candidate.id).toBe('musqueam')
    expect(candidate.preferredName).toBe('Musqueam Indian Band')
  })

  it('merges differently-named matches for one Nation via alternateNames', () => {
    const candidates = buildCandidates(lookups([
      m('verified', 'Musqueam Indian Band', { verificationStatus: 'verified_institutional', label: 'v' }),
      m('nativeLand', 'xʷməθkʷəy̓əm', { label: 'nl' }),
    ]), opts)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].id).toBe('musqueam')
    expect(candidates[0].sources.verified).toBeDefined()
    expect(candidates[0].sources.nativeLand).toBeDefined()
  })

  it('falls back to a name-derived id when no graph is supplied', () => {
    const [candidate] = buildCandidates(lookups([m('reserve', 'Musqueam Indian Band')]), { sourceLabel })
    expect(candidate.id).toBe('musqueam')
  })
})

import { describe, expect, it } from 'vitest'

import type { CandidateNation, MatchType, SourceKey } from './types'
import {
  effectiveSelectedCandidateIds,
  nextDraftWording,
  selectedCandidateNames,
  toggleMatchTypeState,
  visibleAcknowledgementCandidates,
} from './state'

function sources(overrides: Partial<Record<SourceKey, string>>) {
  return overrides
}

function candidate(
  id: string,
  sourceMatches: Partial<Record<SourceKey, string>>,
  confidence: CandidateNation['confidence'] = 'review_required',
): CandidateNation {
  return {
    id,
    name: id,
    preferredName: `${id} preferred`,
    confidence,
    reason: '',
    sources: sources(sourceMatches),
    notes: '',
  }
}

const enabledSources: Record<SourceKey, boolean> = {
  verified: true,
  nativeLand: true,
  cad: true,
  treaty: true,
  reserve: true,
  local: true,
}

describe('acknowledgement source/selection state', () => {
  it('excludes disabled-source candidates from wording selection', () => {
    const candidates = [
      candidate('verified-only', { verified: 'Verified match' }, 'strong'),
      candidate('native-only', { nativeLand: 'Native Land match' }),
    ]
    const visible = visibleAcknowledgementCandidates(candidates, { ...enabledSources, nativeLand: false })
    const selected = effectiveSelectedCandidateIds(visible, ['native-only'])

    expect(visible.map((item) => item.id)).toEqual(['verified-only'])
    expect(selected).toEqual(['verified-only'])
    expect(selectedCandidateNames(visible, selected)).toEqual(['verified-only preferred'])
  })

  it('selects the strongest visible candidate when selected ids become hidden', () => {
    const visible = [
      candidate('moderate', { treaty: 'Treaty match' }, 'moderate'),
      candidate('strong', { reserve: 'Reserve match' }, 'strong'),
    ]

    expect(effectiveSelectedCandidateIds(visible, ['hidden'])).toEqual(['strong'])
  })

  it('returns an empty effective selection when no candidates are visible', () => {
    expect(effectiveSelectedCandidateIds([], ['hidden'])).toEqual([])
    expect(selectedCandidateNames([], ['hidden'])).toEqual([])
  })
})

describe('acknowledgement match-type state', () => {
  const current: Record<MatchType, boolean> = {
    place: true,
    municipality: true,
    boundary: false,
  }

  it('toggles only the requested match type without mutating the previous object', () => {
    const next = toggleMatchTypeState(current, 'boundary')

    expect(next).toEqual({ place: true, municipality: true, boundary: true })
    expect(current).toEqual({ place: true, municipality: true, boundary: false })
    expect(next).not.toBe(current)
  })

  it('can toggle twice back to the original value shape', () => {
    const next = toggleMatchTypeState(toggleMatchTypeState(current, 'place'), 'place')

    expect(next).toEqual(current)
  })
})

describe('acknowledgement wording draft state', () => {
  it('syncs an empty initial draft with generated wording', () => {
    expect(nextDraftWording('', '', 'Generated')).toBe('Generated')
  })

  it('updates a clean draft when generated wording changes', () => {
    expect(nextDraftWording('Old generated', 'Old generated', 'New generated')).toBe('New generated')
  })

  it('preserves a manually edited draft when generated wording changes', () => {
    expect(nextDraftWording('Manual edit', 'Old generated', 'New generated')).toBe('Manual edit')
  })

  it('treats manually clearing the draft as an edit', () => {
    expect(nextDraftWording('', 'Old generated', 'New generated')).toBe('')
  })
})

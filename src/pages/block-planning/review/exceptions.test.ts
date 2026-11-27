import { describe, expect, it } from 'vitest'
import { assess } from '../../../../packages/legal-rules/engine/evaluate'
import { parseFacts, parsePack, type Claim, type Scalar } from '../../../../packages/legal-rules/src/contract'
import fpprPack from '../../../../packages/legal-rules/packs/bc-fppr-planning-1.3.0.json'
import type { ReviewCase } from '../plan'
import { setClaim } from './caseEdits'
import { questions } from './questions'

const fppr = parsePack(fpprPack)
const over = { applicable: true, holder: true, minor: false, region: 'Omineca', nar: 70 }

function limit60(answers: Record<string, Scalar>, claim?: Claim) {
  const set = {
    format: 'pgmaps-legal-facts/v1' as const,
    pack: fppr.id,
    version: fppr.version,
    source: 'test',
    facts: Object.entries(answers).map(([id, value]) => ({ id, value })),
    ...(claim ? { claims: [claim] } : {}),
  }
  const release = assess('2026-11-17', [fppr], [set]).releases[0]
  return { release, finding: release.findings.find((f) => f.rule === 'limit-60')! }
}
const standing = (f: ReturnType<typeof limit60>['finding']) => ('exception' in f ? f.exception?.standing : undefined)

describe('claimed exceptions', () => {
  it('leave the finding raised and say where the claim stands', () => {
    expect(limit60(over).finding.status).toBe('review_required')
    expect(standing(limit60(over).finding)).toBeUndefined()
    const basal: Claim = { rule: 'limit-60', exception: 'basal-retention', rationale: 'Group retention' }
    expect(standing(limit60(over, basal).finding)).toBe('unanswered')
    expect(standing(limit60({ ...over, 'basal-retained': 45 }, basal).finding)).toBe('relied_on')
    expect(standing(limit60({ ...over, 'basal-retained': 30 }, basal).finding)).toBe('not_supported')
    for (const value of [45, 30])
      expect(limit60({ ...over, 'basal-retained': value }, basal).finding.status).toBe('review_required')
  })

  it('ask what an exception claimed waits on, and nothing for one not claimed', () => {
    const ask = (claim?: Claim) => {
      const { release } = limit60(over, claim)
      return questions(fppr, release.facts, release.findings, new Set())
        .filter((q) => q.state === 'open')
        .map((q) => q.fact.id)
    }
    expect(ask()).not.toContain('basal-retained')
    expect(ask({ rule: 'limit-60', exception: 'basal-retention' })).toContain('basal-retained')
  })

  it('hold an exception that needs a decision pending until who decided and when are recorded', () => {
    const claim: Claim = { rule: 'limit-60', exception: 'fsp-result' }
    expect(standing(limit60(over, claim).finding)).toBe('pending')
    expect(standing(limit60(over, { ...claim, decision: { by: 'District manager' } }).finding)).toBe('pending')
    expect(
      standing(limit60(over, { ...claim, decision: { by: 'District manager', date: '2025-04-01' } }).finding),
    ).toBe('decided')
  })

  it('refuse a claim of an exception the rule does not list', () => {
    const set = {
      format: 'pgmaps-legal-facts/v1',
      pack: fppr.id,
      version: fppr.version,
      source: 'test',
      facts: [],
      claims: [{ rule: 'limit-60', exception: 'authorized-burn' }],
    }
    expect(() => parseFacts(set, fppr)).toThrow(/Unknown exception/)
  })

  it('are kept beside the answers, one per rule, and withdrawing the last leaves no claims', () => {
    const review: ReviewCase = { selected: ['bc.fppr@1.3.0'], date: '2026-11-17', sets: {} }
    const one = setClaim(review, fppr, 'limit-60', { rule: 'limit-60', exception: 'tree-lengths' })
    const two = setClaim(one, fppr, 'limit-60', { rule: 'limit-60', exception: 'basal-retention' })
    expect(two.sets['bc.fppr@1.3.0'].claims).toEqual([{ rule: 'limit-60', exception: 'basal-retention' }])
    expect(setClaim(two, fppr, 'limit-60', undefined).sets['bc.fppr@1.3.0']).not.toHaveProperty('claims')
  })
})

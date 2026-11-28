import { describe, expect, it } from 'vitest'
import { assess } from '../../../../packages/legal-rules/engine/evaluate'
import { parsePack, type Claim, type Pack, type Scalar } from '../../../../packages/legal-rules/src/contract'
import profile from '../../../../packages/legal-rules/forestry-profile.json'
import permitsPack from '../../../../packages/legal-rules/packs/bc-forest-permits.json'
import permitsEarlier from '../../../../packages/legal-rules/packs/bc-forest-permits-v1.1.0.json'
import permitsSaved from '../../../../packages/legal-rules/packs/bc-forest-permits-v1.2.0.json'
import operationsPack from '../../../../packages/legal-rules/packs/bc-forest-operations.json'
import { questions } from './questions'
import { ruleTopic } from './topics'

const permits = parsePack(permitsPack)
const operations = parsePack(operationsPack)

function run(pack: Pack, answers: Record<string, Scalar>, claim?: Claim) {
  const set = {
    format: 'pgmaps-legal-facts/v1' as const,
    pack: pack.id,
    version: pack.version,
    source: 'test',
    facts: Object.entries(answers).map(([id, value]) => ({ id, value })),
    ...(claim ? { claims: [claim] } : {}),
  }
  const release = assess('2026-11-17', [pack], [set]).releases[0]
  const status = (rule: string) => release.findings.find((f) => f.rule === rule)!.status
  const standing = (rule: string) => {
    const f = release.findings.find((x) => x.rule === rule)!
    return 'exception' in f ? f.exception?.standing : undefined
  }
  const open = questions(pack, release.facts, release.findings, new Set())
    .filter((q) => q.state === 'open')
    .map((q) => q.fact.id)
  return { release, status, standing, open }
}

const RESULTS = [
  'fsp-soils',
  'fsp-timber',
  'fsp-wildlife',
  'fsp-water',
  'fsp-landscape',
  'fsp-stand',
  'fsp-visual',
  'fsp-heritage',
  'fsp-other',
]
const NONE = 'The plan has none that bears on the block'
const MET = 'Yes, and the design achieves it or carries it out'
const SHORT = 'Yes, and the design falls short of it'
const licensee = {
  tenure: 'A forest licence, tree farm licence, community forest agreement, timber licence or major licence to cut',
  'landscape-area': 'No',
  fdu: true,
}

describe('the permit pack 1.2.0: the FSP’s results for an ordinary block (FRPA §20.22)', () => {
  it('keeps 1.1.0 for saved reviews and moves the block profile to 1.2.0', () => {
    expect(parsePack(permitsEarlier).version).toBe('1.1.0')
    expect(parsePack(permitsEarlier).rules.some((r) => r.id === 'fsp-results')).toBe(false)
    expect(profile.blockReleases).toContain('bc.forest-permits@1.3.0')
    expect(profile.blockReleases).not.toContain('bc.forest-permits@1.1.0')
    expect(profile.blockReleases).not.toContain('bc.forest-permits@1.2.0')
  })

  it('asks the plan’s standing first, then every kind of result at once', () => {
    expect(run(permits, licensee).open).toContain('fsp-standing')
    const asked = run(permits, { ...licensee, 'fsp-standing': 'It is in its term' }).open
    expect(asked).toEqual(expect.arrayContaining(RESULTS))
    // The replacement is asked only when an exception claimed waits on it.
    expect(asked).not.toContain('fsp-replacement')
  })

  it('raises the rule when the design falls short of one result, and settles when it meets each', () => {
    const inTerm = { ...licensee, 'fsp-standing': 'It is in its term' }
    const all = (value: string) => Object.fromEntries(RESULTS.map((id) => [id, value]))
    expect(run(permits, { ...inTerm, ...all(NONE) }).status('fsp-results')).toBe('condition_not_triggered')
    expect(run(permits, { ...inTerm, ...all(MET) }).status('fsp-results')).toBe('condition_not_triggered')
    expect(run(permits, { ...inTerm, 'fsp-visual': SHORT }).status('fsp-results')).toBe('review_required')
  })

  it('binds a plan that has expired, and lists §20.22(4)’s replacement as an exception, never a question', () => {
    const expired = { ...licensee, 'fsp-standing': 'It has expired', 'fsp-landscape': SHORT }
    expect(run(permits, expired).status('fsp-results')).toBe('review_required')
    const claim: Claim = { rule: 'fsp-results', exception: 'replaced', rationale: 'Replaced by the new plan' }
    expect(run(permits, expired, claim).standing('fsp-results')).toBe('unanswered')
    expect(run(permits, expired, claim).open).toContain('fsp-replacement')
    expect(run(permits, { ...expired, 'fsp-replacement': true }, claim).standing('fsp-results')).toBe('relied_on')
    expect(run(permits, { ...expired, 'fsp-replacement': true }, claim).status('fsp-results')).toBe('review_required')
    const inTerm = { ...expired, 'fsp-standing': 'It is in its term', 'fsp-replacement': true }
    expect(run(permits, inTerm, claim).standing('fsp-results')).toBe('not_supported')
  })

  it('leaves a block in a forest landscape area, or one outside a forest development unit, to the other rules', () => {
    expect(run(permits, { ...licensee, 'landscape-area': 'Yes' }).status('fsp-results')).toBe('outside_scope')
    expect(run(permits, { ...licensee, fdu: false }).status('fsp-results')).toBe('outside_scope')
    expect(run(permits, { ...licensee, tenure: 'A woodlot licence' }).status('fsp-results')).toBe('outside_scope')
  })
})

const AGREEMENT = operations.facts.find((f) => f.id === 'holder')!.choices![0]
const inArea = { 'landscape-area': 'Yes', holder: AGREEMENT, 'fop-held': true, 'fop-listed': true }

describe('the forest operations plan pack (FRPA §§2.35–2.47, FPPR §§4.11–4.36)', () => {
  it('is in the block profile and switches off outside a forest landscape area', () => {
    expect(profile.blockReleases).toContain('bc.forest-operations@1.0.0')
    // An empty case asks only whether the block is in a forest landscape area.
    expect(run(operations, {}).open).toEqual(['landscape-area'])
    const outside = run(operations, { 'landscape-area': 'No' })
    expect(outside.release.findings.every((f) => f.status === 'outside_scope')).toBe(true)
    expect(outside.open).toEqual([])
    const woodlot = run(operations, { 'landscape-area': 'Yes', holder: operations.facts[1].choices![2] })
    expect(woodlot.release.findings.every((f) => f.status === 'outside_scope')).toBe(true)
  })

  it('needs an approved plan for the land, with the law’s exceptions listed on the rule', () => {
    const none = { ...inArea, 'fop-held': false }
    expect(run(operations, none).status('fop-required')).toBe('review_required')
    expect(run(operations, none).status('fop-listed')).toBe('outside_scope')
    const ids = operations.rules.find((r) => r.id === 'fop-required')!.exceptions!.map((x) => x.id)
    expect(ids).toEqual(['earlier-permit', 'fsp-permit', 'purpose', 'new-landscape-area'])
    const claim: Claim = { rule: 'fop-required', exception: 'purpose', rationale: 'Danger trees only' }
    expect(run(operations, none, claim).standing('fop-required')).toBe('relied_on')
    expect(run(operations, none, claim).status('fop-required')).toBe('review_required')
  })

  it('finds a block missing from the plan, and an amendment not yet in effect', () => {
    expect(run(operations, { ...inArea, 'fop-listed': false }).status('fop-listed')).toBe('review_required')
    const pending = run(operations, { ...inArea, 'fop-added': 'By an amendment not yet approved or not yet in effect' })
    expect(pending.status('fop-amendment')).toBe('review_required')
    expect(
      run(operations, { ...inArea, 'fop-added': 'By an amendment the minister approved' }).status('fop-amendment'),
    ).toBe('condition_not_triggered')
  })

  it('compares the start year with the plan and the annual schedule', () => {
    expect(run(operations, { ...inArea, 'year-shown': false }).status('fop-year')).toBe('review_required')
    expect(run(operations, { ...inArea, 'year-shown': false }).status('schedule-year')).toBe('outside_scope')
    expect(run(operations, { ...inArea, 'year-shown': true, 'year-matches': false }).status('schedule-year')).toBe(
      'review_required',
    )
    expect(run(operations, { ...inArea, 'fds-shown': false }).status('schedule')).toBe('review_required')
    expect(run(operations, { ...inArea, 'fds-shown': true }).status('schedule')).toBe('condition_not_triggered')
  })

  it('holds the plan and an approved amendment to 60 days of review, a §4.43 amendment to 30', () => {
    const review = (added: string, days: number) =>
      run(operations, { ...inArea, 'fop-added': added, 'review-days': days }).status('public-review')
    expect(review('In the plan as the minister approved it', 59)).toBe('review_required')
    expect(review('In the plan as the minister approved it', 60)).toBe('condition_not_triggered')
    expect(review('By an amendment the minister approved', 45)).toBe('review_required')
    expect(review('By an amendment that needs no approval (FPPR §4.43), now in effect', 29)).toBe('review_required')
    expect(review('By an amendment that needs no approval (FPPR §4.43), now in effect', 30)).toBe(
      'condition_not_triggered',
    )
  })

  it('takes a shorter period only as the minister’s decision, and never under 10 days', () => {
    const short = { ...inArea, 'fop-added': 'In the plan as the minister approved it' }
    const claim: Claim = { rule: 'public-review', exception: 'shorter-period' }
    expect(run(operations, { ...short, 'review-days': 20 }, claim).standing('public-review')).toBe('pending')
    const decided = { ...claim, decision: { by: 'District manager', date: '2026-03-01' } }
    expect(run(operations, { ...short, 'review-days': 20 }, decided).standing('public-review')).toBe('decided')
    expect(run(operations, { ...short, 'review-days': 9 }, decided).standing('public-review')).toBe('not_supported')
  })

  it('checks notice to rights holders, their extension, the review notice and engagement', () => {
    expect(run(operations, { ...inArea, 'rights-notice': false }).status('rights-notice')).toBe('review_required')
    expect(
      run(operations, { ...inArea, 'rights-extension': 'Yes, and it was not given' }).status('rights-extension'),
    ).toBe('review_required')
    expect(run(operations, { ...inArea, 'rights-extension': 'No' }).status('rights-extension')).toBe(
      'condition_not_triggered',
    )
    expect(run(operations, { ...inArea, 'review-notice': false }).status('review-notice')).toBe('review_required')
    expect(run(operations, { ...inArea, engagement: false }).status('engagement')).toBe('review_required')
  })

  it('needs a site level plan unless FPPR §4.59 waives it, and the plan’s requirements met', () => {
    expect(run(operations, { ...inArea, 'site-level-plan': false }).status('site-level-plan')).toBe('review_required')
    const claim: Claim = { rule: 'site-level-plan', exception: 'no-plan-needed' }
    expect(run(operations, { ...inArea, 'site-level-plan': false }, claim).standing('site-level-plan')).toBe(
      'relied_on',
    )
    expect(run(operations, { ...inArea, 'fop-requirements': false }).status('fop-requirements')).toBe('review_required')
  })

  it('puts every rule of both packs under a named topic', () => {
    for (const pack of [permits, operations])
      expect(pack.rules.filter((r) => ruleTopic(pack, r).id.startsWith('section-')).map((r) => r.id)).toEqual([])
  })
})

describe('the permit pack 1.3.0: when a site plan is not required (FPPR §33)', () => {
  it('keeps 1.2.0 for saved reviews, with the site plan rule as it was', () => {
    const earlier = parsePack(permitsSaved)
    expect(earlier.version).toBe('1.2.0')
    expect(earlier.rules.find((r) => r.id === 'site-plan')?.exceptions).toBeUndefined()
    expect(permits.version).toBe('1.3.0')
    // Only the exceptions and the action's words changed: the rule's scope and trigger are 1.2.0's.
    const now = permits.rules.find((r) => r.id === 'site-plan')!
    const then = earlier.rules.find((r) => r.id === 'site-plan')!
    expect([now.scope, now.when, now.provision]).toEqual([then.scope, then.when, then.provision])
  })

  it('lists FPPR §33(1) and (2) on the site plan rule, and leaves the finding raised when one is claimed', () => {
    const answers = { ...licensee, 'site-plan': false }
    expect(run(permits, answers).status('site-plan')).toBe('review_required')
    const exceptions = permits.rules.find((r) => r.id === 'site-plan')!.exceptions!
    expect(exceptions.map((x) => [x.id, x.source, x.provision, x.kind])).toEqual([
      ['fppr-33-cutblock', 'instrument', '33(1)', 'by-law'],
      ['fppr-33-road', 'instrument', '33(2)', 'by-law'],
    ])
    const claimed = run(permits, answers, {
      rule: 'site-plan',
      exception: 'fppr-33-cutblock',
      rationale: 'Harvest limited to 50 m³',
    })
    expect(claimed.status('site-plan')).toBe('review_required')
    expect(claimed.standing('site-plan')).toBe('relied_on')
  })
})

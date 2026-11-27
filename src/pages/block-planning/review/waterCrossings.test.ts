import { describe, expect, it } from 'vitest'
import raw from '../../../../packages/legal-rules/packs/bc-water-crossings.json'
import raw100 from '../../../../packages/legal-rules/packs/bc-water-crossings-v1.0.0.json'
import profile from '../../../../packages/legal-rules/forestry-profile.json'
import { assess } from '../../../../packages/legal-rules/engine/evaluate'
import { parsePack, releaseKey, type Claim, type Scalar } from '../../../../packages/legal-rules/src/contract'
import { questions } from './questions'
import { ruleTopic } from './topics'

const pack = parsePack(raw)
type Answers = Record<string, Scalar>

function run(answers: Answers, claims: Claim[] = []) {
  const set = {
    format: 'pgmaps-legal-facts/v1' as const,
    pack: pack.id,
    version: pack.version,
    source: 'test',
    facts: Object.entries(answers).map(([id, value]) => ({ id, value })),
    ...(claims.length ? { claims } : {}),
  }
  const release = assess(profile.assessmentDate, [pack], [set]).releases[0]
  expect(release.findings.every((f) => f.status !== 'outside_source_window')).toBe(true)
  return release
}
const statuses = (answers: Answers) => Object.fromEntries(run(answers).findings.map((f) => [f.rule, f.status]))
const raised = (answers: Answers) =>
  run(answers)
    .findings.filter((f) => f.status === 'review_required')
    .map((f) => f.rule)
const asked = (answers: Answers, claims: Claim[] = []) => {
  const release = run(answers, claims)
  return questions(pack, release.facts, release.findings, new Set())
    .filter((q) => q.state === 'open')
    .map((q) => q.fact.id)
}
function standing(answers: Answers, rule: string, exception: string) {
  const f = run(answers, [{ rule, exception }]).findings.find((x) => x.rule === rule)!
  return { status: f.status, standing: 'exception' in f ? f.exception?.standing : undefined }
}

const forest = { 'stream-changes': true, 'route-forest': true, 'route-listed': false, 'route-approval': false }
const culvert = { 'stream-changes': true, 'route-forest': false, 'route-listed': true, 'listed-culvert': true }

describe('Stream crossings under the Water Sustainability Act', () => {
  it('is a crossing release, and an empty case asks only whether the crossing changes a stream', () => {
    expect(pack.version).toBe('2.0.0')
    expect(profile.crossingReleases).toContain(releaseKey(pack))
    expect(profile.blockReleases.some((k) => k.startsWith(pack.id + '@'))).toBe(false)
    expect(asked({})).toEqual(['stream-changes'])
    expect(raised({ 'stream-changes': false })).toEqual([])
    expect(new Set(Object.values(statuses({ 'stream-changes': false })))).toEqual(
      new Set(['condition_not_triggered', 'outside_scope']),
    )
  })

  it('raises a change in and about a stream that rests on no authority (Act §11(2))', () => {
    const none = { 'stream-changes': true, 'route-forest': false, 'route-listed': false, 'route-approval': false }
    expect(raised(none)).toEqual(['change-authority'])
    expect(statuses(forest)['change-authority']).toBe('condition_not_triggered')
    expect(statuses({ ...none, 'route-approval': true, 'approval-held': false })).toMatchObject({
      'change-authority': 'condition_not_triggered',
      'approval-terms': 'review_required',
    })
  })

  it('authorizes a forest crossing under §39(2) only for a person it names who complies with FRPA', () => {
    expect(statuses(forest)['forest-route']).toBe('missing_evidence')
    expect(raised({ ...forest, 'forest-holder': true, 'frpa-compliant': true })).toEqual(['aquatic-damage'])
    expect(raised({ ...forest, 'forest-holder': false })).toContain('forest-route')
    expect(raised({ ...forest, 'forest-holder': true, 'frpa-compliant': false })).toContain('forest-route')
    // The forest route gives no notice under §38(1) and is not tested on §39(1)'s conditions.
    expect(statuses(forest)).toMatchObject({ 'habitat-notice': 'outside_scope', 'culvert-size': 'outside_scope' })
  })

  it('takes a crossing off Part 3 when an engineer requires a change approval (§37(2)–(3))', () => {
    expect(raised({ ...forest, 'engineer-required': true })).toContain('engineer-requirement')
    expect(statuses({ ...forest, 'engineer-required': false })['engineer-requirement']).toBe('condition_not_triggered')
    expect(
      raised({ ...forest, 'officer-terms': true, 'within-officer-terms': false, 'engineer-required': false }),
    ).toContain('officer-terms')
  })

  it('tests a §39(1)(a) culvert on each figure at the regulation’s own thresholds', () => {
    const at = (answers: Answers) => statuses({ ...culvert, ...answers })
    expect(at({ 'culvert-diameter': 599 })['culvert-size']).toBe('review_required')
    expect(at({ 'culvert-diameter': 600 })['culvert-size']).toBe('condition_not_triggered')
    expect(at({ 'culvert-cover': 299 })['culvert-cover']).toBe('review_required')
    expect(at({ 'culvert-cover': 300 })['culvert-cover']).toBe('condition_not_triggered')
    expect(at({ 'culvert-fill': 2 })['culvert-fill']).toBe('condition_not_triggered')
    expect(at({ 'culvert-fill': 2.1 })['culvert-fill']).toBe('review_required')
    expect(at({ 'fish-bearing': true, 'culvert-fish-passage': false })['culvert-fish']).toBe('review_required')
    expect(at({ 'fish-bearing': false })['culvert-fish']).toBe('condition_not_triggered')
    expect(at({ 'culvert-large': true, 'culvert-engineered': false })['culvert-design']).toBe('review_required')
    expect(at({ 'culvert-capacity': false, 'culvert-practices': false })).toMatchObject({
      'culvert-capacity': 'review_required',
      'culvert-practices': 'review_required',
    })
    // A bridge, ford or winter crossing is tested only where the case has one.
    expect(at({ 'listed-bridge': false })['bridge-conditions']).toBe('outside_scope')
    expect(at({ 'listed-winter': true, 'winter-conditions': false })['winter-conditions']).toBe('review_required')
    expect(at({ 'listed-ford': true, 'ford-conditions': false })['ford-conditions']).toBe('review_required')
  })

  it('lists the manufacturer’s cover as the cover rule’s exception, never a question that clears it', () => {
    expect(standing({ ...culvert, 'culvert-cover': 250 }, 'culvert-cover', 'manufacturer-cover')).toEqual({
      status: 'review_required',
      standing: 'relied_on',
    })
  })

  it('needs 45 days’ notice and the officer’s terms for a listed change, unless the officer did not reply', () => {
    expect(raised({ ...culvert, 'notice-given': false })).toContain('habitat-notice')
    const notified = { ...culvert, 'notice-given': true, 'statement-obtained': false }
    expect(raised(notified)).toContain('habitat-statement')
    expect(asked(notified)).not.toContain('no-contact-45')
    const claim = { rule: 'habitat-statement', exception: 'no-contact' }
    expect(asked(notified, [claim])).toContain('no-contact-45')
    expect(standing({ ...notified, 'no-contact-45': true }, 'habitat-statement', 'no-contact')).toEqual({
      status: 'review_required',
      standing: 'relied_on',
    })
    expect(standing({ ...notified, 'no-contact-45': false }, 'habitat-statement', 'no-contact').standing).toBe(
      'not_supported',
    )
  })

  it('keeps 1.0.0 for reviews saved with it, with the same rules and facts, and words 2.0.0 for one crossing', () => {
    const earlier = parsePack(raw100)
    expect(earlier.version).toBe('1.0.0')
    expect(earlier.rules.map((r) => r.id)).toEqual(pack.rules.map((r) => r.id))
    expect(earlier.facts.map((f) => f.id)).toEqual(pack.facts.map((f) => f.id))
    expect(earlier.rules.map((r) => JSON.stringify([r.scope, r.when]))).toEqual(
      pack.rules.map((r) => JSON.stringify([r.scope, r.when])),
    )
    const words = JSON.stringify([pack.facts.map((f) => f.label), pack.rules.map((r) => [r.finding, r.actions])])
    for (const blockWide of ['worst', 'any of these', 'every change', 'each crossing', 'the block'])
      expect(words.toLowerCase()).not.toContain(blockWide)
  })

  it('groups the rules by authority, forest route, listed changes and notice', () => {
    const topic = (rule: string) => ruleTopic(pack, pack.rules.find((r) => r.id === rule)!).id
    expect(['change-authority', 'approval-terms', 'engineer-requirement', 'officer-terms'].map(topic)).toEqual([
      'authority',
      'authority',
      'authority',
      'authority',
    ])
    expect(topic('forest-route')).toBe('forest')
    expect(topic('culvert-size')).toBe('listed')
    expect(topic('winter-conditions')).toBe('listed')
    expect(['habitat-notice', 'habitat-statement', 'aquatic-damage'].map(topic)).toEqual(['notice', 'notice', 'notice'])
  })
})

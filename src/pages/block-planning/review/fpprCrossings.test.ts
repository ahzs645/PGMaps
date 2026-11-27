import { describe, expect, it } from 'vitest'
import raw from '../../../../packages/legal-rules/packs/bc-fppr-crossings.json'
import blockRaw from '../../../../packages/legal-rules/packs/bc-block-crossings.json'
import profile from '../../../../packages/legal-rules/forestry-profile.json'
import { assess } from '../../../../packages/legal-rules/engine/evaluate'
import {
  parsePack,
  releaseKey,
  type Claim,
  type Pack,
  type Scalar,
} from '../../../../packages/legal-rules/src/contract'
import { questions } from './questions'
import { ruleTopic } from './topics'

const pack = parsePack(raw)
const blockPack = parsePack(blockRaw)
type Answers = Record<string, Scalar>

function run(answers: Answers, claims: Claim[] = [], p: Pack = pack) {
  const set = {
    format: 'pgmaps-legal-facts/v1' as const,
    pack: p.id,
    version: p.version,
    source: 'test',
    facts: Object.entries(answers).map(([id, value]) => ({ id, value })),
    ...(claims.length ? { claims } : {}),
  }
  const release = assess(profile.assessmentDate, [p], [set]).releases[0]
  expect(release.findings.every((f) => f.status !== 'outside_source_window')).toBe(true)
  return release
}
const statusOf = (answers: Answers, rule: string, p: Pack = pack) =>
  run(answers, [], p).findings.find((f) => f.rule === rule)!.status
const asked = (answers: Answers, claims: Claim[] = [], p: Pack = pack) => {
  const release = run(answers, claims, p)
  return questions(p, release.facts, release.findings, new Set())
    .filter((q) => q.state === 'open')
    .map((q) => q.fact.id)
}
function standing(answers: Answers, rule: string, exception: string) {
  const f = run(answers, [{ rule, exception }]).findings.find((x) => x.rule === rule)!
  return { status: f.status, standing: 'exception' in f ? f.exception?.standing : undefined }
}

const noRebuttals = { 'no-listed-species': false, 'barrier-dry-upstream': false, 'barrier-no-habitat-upstream': false }
/** §56(1) raised once the stream is a fish stream. */
const passage = { 'authorized-person': true, 'activity-passage-effect': true }

describe('FPPR at a stream crossing', () => {
  it('is a crossing release beside the water pack, and never a block release', () => {
    expect(profile.crossingReleases).toEqual(['bc.water-crossings@2.0.0', releaseKey(pack)])
    expect(profile.blockReleases.some((k) => k.startsWith(pack.id + '@'))).toBe(false)
    expect(pack.rules.map((r) => [r.id, r.provision])).toEqual([
      ['crossing-build', '55(1)'],
      ['crossing-removal', '55(2)'],
      ['fish-passage-activity', '56(1), 1 "fish stream"'],
      ['fish-passage-crossing', '56(2), 1 "fish stream"'],
      ['fish-habitat', '57'],
      ['structure-sound', '72'],
      ['bridge-design', '73'],
    ])
  })

  describe('the fish stream definition, limb by limb', () => {
    it('limb (a): a listed species frequenting the watercourse makes it a fish stream whatever its gradient', () => {
      expect(statusOf({ ...passage, 'listed-species': true, 'stream-gradient': 45 }, 'fish-passage-activity')).toBe(
        'review_required',
      )
    })

    it('limb (b): a gradient of 20% or more makes no fish stream by (b), though (a) still may', () => {
      expect(statusOf({ ...passage, 'listed-species': false, 'stream-gradient': 20 }, 'fish-passage-activity')).toBe(
        'outside_scope',
      )
      // With limb (a) unanswered, the steep stream is not cleared: it waits on (a).
      expect(statusOf({ ...passage, 'stream-gradient': 24 }, 'fish-passage-activity')).toBe('missing_evidence')
      expect(asked({ ...passage, 'stream-gradient': 24 })).toContain('listed-species')
    })

    it('limb (b): under 20% presumes a fish stream only once none of its three rebuttals is shown', () => {
      const gentle = { ...passage, 'listed-species': false, 'stream-gradient': 4 }
      expect(statusOf({ ...gentle, ...noRebuttals }, 'fish-passage-activity')).toBe('review_required')
      // Unknown stays unknown, and never passes: each rebuttal is asked in turn.
      expect(statusOf(gentle, 'fish-passage-activity')).toBe('missing_evidence')
      expect(asked(gentle)).toContain('no-listed-species')
      for (const rebuttal of Object.keys(noRebuttals))
        expect(statusOf({ ...gentle, ...noRebuttals, [rebuttal]: true }, 'fish-passage-activity')).toBe('outside_scope')
      expect(statusOf({ ...passage, ...noRebuttals, 'listed-species': false }, 'fish-passage-activity')).toBe(
        'missing_evidence',
      )
    })

    it('asks nothing of the stream before the person is known to be an authorized person', () => {
      expect(asked({})).toContain('authorized-person')
      expect(asked({})).not.toContain('stream-gradient')
      expect(statusOf({ 'authorized-person': false, 'listed-species': true }, 'fish-passage-activity')).toBe(
        'outside_scope',
      )
    })
  })

  it('§56(2) binds a maintained fish stream crossing only when it was built after June 15, 1995', () => {
    const maintained = {
      'authorized-person': true,
      maintains: true,
      'listed-species': true,
      'crossing-passage-effect': true,
    }
    expect(statusOf({ ...maintained, 'built-after-1995': true }, 'fish-passage-crossing')).toBe('review_required')
    expect(statusOf({ ...maintained, 'built-after-1995': false }, 'fish-passage-crossing')).toBe('outside_scope')
    expect(statusOf(maintained, 'fish-passage-crossing')).toBe('missing_evidence')
    expect(asked(maintained)).toContain('built-after-1995')
    expect(statusOf({ ...maintained, 'built-after-1995': true, maintains: false }, 'fish-passage-crossing')).toBe(
      'outside_scope',
    )
  })

  it('lists §56(3)’s temporary effect as a by-law exception that never clears the finding', () => {
    const raised = { ...passage, 'listed-species': true }
    expect(asked(raised)).not.toContain('temporary-road-work')
    const claim = { rule: 'fish-passage-activity', exception: 'temporary-effect' }
    expect(asked(raised, [claim])).toContain('temporary-road-work')
    const held = { ...raised, 'temporary-road-work': true, 'fish-not-migrating': true, 'source-removed': true }
    expect(standing(held, 'fish-passage-activity', 'temporary-effect')).toEqual({
      status: 'review_required',
      standing: 'relied_on',
    })
    expect(
      standing({ ...held, 'fish-not-migrating': false }, 'fish-passage-activity', 'temporary-effect').standing,
    ).toBe('not_supported')
  })

  it('lists §12.31’s forest stewardship plan result as a decision, held only in a fisheries sensitive watershed', () => {
    const raised = { ...passage, 'listed-species': true }
    const decision = { by: 'District manager', date: '2025-04-01' }
    const run12 = (answers: Answers) =>
      run(answers, [{ rule: 'fish-passage-activity', exception: 'fsp-fsw-result', decision }]).findings.find(
        (f) => f.rule === 'fish-passage-activity',
      )!
    const standingOf = (f: ReturnType<typeof run12>) => ('exception' in f ? f.exception?.standing : undefined)
    expect(standingOf(run12({ ...raised, 'fisheries-sensitive-watershed': true }))).toBe('decided')
    expect(standingOf(run12({ ...raised, 'fisheries-sensitive-watershed': false }))).toBe('not_supported')
    for (const rule of [
      'crossing-build',
      'crossing-removal',
      'fish-passage-activity',
      'fish-passage-crossing',
      'fish-habitat',
    ])
      expect(
        pack.rules
          .find((r) => r.id === rule)!
          .exceptions!.map((x) => x.id)
          .sort(),
      ).toEqual(expect.arrayContaining(['fop-exemption', 'fsp-fsw-result', 'workers-compensation']))
    // §4.51's table names §§55–57 and not §§72–73.
    for (const rule of ['structure-sound', 'bridge-design'])
      expect(pack.rules.find((r) => r.id === rule)!.exceptions!.map((x) => x.id)).toEqual(['workers-compensation'])
  })

  it('§55: a crossing an authorized person builds on a road or access structure, and a temporary one’s removal', () => {
    const built = { 'authorized-person': true, builds: true, 'is-stream': true }
    expect(statusOf({ ...built, 'built-as': 'A road', 'channel-protected': false }, 'crossing-build')).toBe(
      'review_required',
    )
    expect(
      statusOf(
        { ...built, 'built-as': 'A road', 'channel-protected': true, 'disturbance-mitigated': true },
        'crossing-build',
      ),
    ).toBe('condition_not_triggered')
    expect(statusOf({ ...built, 'built-as': 'Something else' }, 'crossing-build')).toBe('outside_scope')
    expect(statusOf({ ...built, 'built-as': 'A road', 'removal-planned': false }, 'crossing-removal')).toBe(
      'outside_scope',
    )
    expect(
      statusOf({ ...built, 'built-as': 'A temporary access structure', 'removal-planned': false }, 'crossing-removal'),
    ).toBe('review_required')
  })

  it('§§72–73: any person building or maintaining a road; a bridge’s design only for a bridge it builds', () => {
    expect(statusOf({ 'built-as': 'A road', maintains: true, 'structure-sound': false }, 'structure-sound')).toBe(
      'review_required',
    )
    const bridge = { 'built-as': 'A road', builds: true, structure: 'Bridge' }
    expect(statusOf({ ...bridge, 'bridge-standards': true, 'bridge-loads': false }, 'bridge-design')).toBe(
      'review_required',
    )
    expect(statusOf({ ...bridge, structure: 'Culvert', 'bridge-loads': false }, 'bridge-design')).toBe('outside_scope')
  })

  it('groups its rules by section', () => {
    const topic = (rule: string) => ruleTopic(pack, pack.rules.find((r) => r.id === rule)!).id
    expect(pack.rules.map((r) => topic(r.id))).toEqual([
      'crossing',
      'crossing',
      'fish-passage',
      'fish-passage',
      'fish-habitat',
      'structure',
      'structure',
    ])
  })
})

describe('Stream crossings on the block', () => {
  it('keeps the block’s one question, and raises a stream change whose crossings are not listed', () => {
    expect(profile.blockReleases).toContain(releaseKey(blockPack))
    expect(asked({}, [], blockPack)).toEqual(['stream-changes'])
    expect(statusOf({ 'stream-changes': false }, 'list-crossings', blockPack)).toBe('condition_not_triggered')
    expect(asked({ 'stream-changes': true }, [], blockPack)).toEqual(['crossings-listed'])
    expect(statusOf({ 'stream-changes': true, 'crossings-listed': false }, 'list-crossings', blockPack)).toBe(
      'review_required',
    )
    expect(statusOf({ 'stream-changes': true, 'crossings-listed': true }, 'list-crossings', blockPack)).toBe(
      'condition_not_triggered',
    )
  })
})

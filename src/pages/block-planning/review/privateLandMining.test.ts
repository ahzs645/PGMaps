import { describe, expect, it } from 'vitest'
import pmflRaw from '../../../../packages/legal-rules/packs/bc-private-managed-forest.json'
import miningRaw from '../../../../packages/legal-rules/packs/bc-mineral-tenure.json'
import landRaw from '../../../../packages/legal-rules/packs/bc-land-status.json'
import profile from '../../../../packages/legal-rules/forestry-profile.json'
import { assess } from '../../../../packages/legal-rules/engine/evaluate'
import { checkFactLinks, parsePack, type Pack, type Scalar } from '../../../../packages/legal-rules/src/contract'
import { questions } from './questions'
import { ruleTopic } from './topics'

const pmfl = parsePack(pmflRaw)
const mining = parsePack(miningRaw)
const land = parsePack(landRaw)
type Answers = Record<string, Scalar>

function run(pack: Pack, answers: Answers) {
  const set = {
    format: 'pgmaps-legal-facts/v1' as const,
    pack: pack.id,
    version: pack.version,
    source: 'test',
    facts: Object.entries(answers).map(([id, value]) => ({ id, value })),
  }
  const release = assess(profile.assessmentDate, [pack], [set]).releases[0]
  expect(release.findings.every((f) => f.status !== 'outside_source_window')).toBe(true)
  return release
}
const raised = (pack: Pack, answers: Answers) =>
  run(pack, answers)
    .findings.filter((f) => f.status === 'review_required')
    .map((f) => f.rule)
    .sort()
const asked = (pack: Pack, answers: Answers) => {
  const release = run(pack, answers)
  return questions(pack, release.facts, release.findings, new Set())
    .filter((q) => q.state === 'open')
    .map((q) => q.fact.id)
}

const MFL = { land: 'Private land', 'managed-forest': true, 'licence-area': 'None of these' }
const NOTHING = {
  'class-a': false,
  'class-b': false,
  'class-c': false,
  'class-d-e': false,
  'road-near-stream': false,
  crossing: false,
  'drinking-intake': false,
  'intake-upslope': false,
  'wildlife-notice': false,
  'possible-habitat': false,
}

describe('private managed forest land', () => {
  it('is reviewed on every block and shares its land questions with land status', () => {
    expect(profile.blockReleases).toContain('bc.private-managed-forest@1.0.0')
    expect(() => checkFactLinks([land, pmfl])).not.toThrow()
    for (const id of ['land', 'managed-forest', 'licence-area'])
      expect(pmfl.facts.find((f) => f.id === id)?.sameAs).toBe(`bc.land-status:${id}`)
  })

  it('asks nothing more of a Crown block once its land is answered', () => {
    expect(asked(pmfl, { land: 'Crown land' })).toEqual([])
    expect(raised(pmfl, { land: 'Crown land' })).toEqual([])
  })

  it('stays out of a woodlot, tree farm or community forest area, where the Act does not apply (PMFLA §3)', () => {
    for (const area of ['A woodlot licence', 'A tree farm licence', 'A community forest agreement'])
      expect(raised(pmfl, { ...MFL, 'licence-area': area, region: 'The Interior', ...NOTHING })).toEqual([])
  })

  it('holds roads to the minimum and reforests at the Interior’s or the Coast’s density', () => {
    expect(raised(pmfl, { ...MFL, region: 'The Interior', ...NOTHING })).toEqual([
      'reforest-interior',
      'roads-trails-minimum',
    ])
    expect(raised(pmfl, { ...MFL, region: 'The Coast', ...NOTHING })).toEqual([
      'reforest-coast',
      'roads-trails-minimum',
    ])
  })

  it('keeps trees by stream class, with understory and sediment rules beside any classed stream', () => {
    expect(raised(pmfl, { ...MFL, region: 'The Interior', ...NOTHING, 'class-a': true })).toEqual([
      'reforest-interior',
      'retain-class-a',
      'roads-trails-minimum',
      'sediment',
      'understory',
    ])
    expect(raised(pmfl, { ...MFL, region: 'The Interior', ...NOTHING, 'class-d-e': true })).toEqual([
      'reforest-interior',
      'roads-trails-minimum',
      'sediment',
      'understory',
    ])
  })

  it('raises the road distance, the intake and the wildlife notice only when they arise', () => {
    const all = {
      ...MFL,
      region: 'The Interior',
      ...NOTHING,
      'road-near-stream': true,
      'intake-upslope': true,
      'drinking-intake': true,
      'wildlife-notice': true,
      'possible-habitat': true,
    }
    expect(raised(pmfl, all)).toEqual(
      expect.arrayContaining([
        'road-near-stream',
        'intake-road',
        'drinking-water',
        'critical-habitat',
        'possible-habitat',
      ]),
    )
  })

  it('lists the Council Regulation’s §3 exemptions on its practice rules, never on the wildlife notice', () => {
    const exceptions = (id: string) => pmfl.rules.find((r) => r.id === id)!.exceptions?.map((x) => x.id) ?? []
    expect(exceptions('road-near-stream')).toEqual(
      expect.arrayContaining(['more-sediment', 'no-option', 'crossing', 'prevent-damage']),
    )
    expect(exceptions('critical-habitat')).toEqual([])
  })
})

describe('mineral tenures and mines', () => {
  it('asks about a title first, and nothing more when there is none', () => {
    expect(asked(mining, {})).toEqual(expect.arrayContaining(['mineral-title', 'pit']))
    expect(raised(mining, { 'mineral-title': false, pit: false })).toEqual([])
    expect(asked(mining, { 'mineral-title': false, pit: false })).toEqual([])
  })

  it('raises the holder’s surface rights for any title, and its permit and timber authority when it cuts', () => {
    expect(raised(mining, { 'mineral-title': true, 'holder-cuts': false, pit: false })).toEqual(['surface-rights'])
    expect(raised(mining, { 'mineral-title': true, 'in-production': false, 'holder-cuts': true, pit: false })).toEqual([
      'holder-permit',
      'holder-timber',
      'surface-rights',
    ])
    expect(raised(mining, { 'mineral-title': true, 'in-production': true, 'holder-cuts': true, pit: false })).toEqual([
      'holder-permit',
      'holder-timber-production',
      'surface-rights',
    ])
  })

  it('calls a road pit a mine that needs a permit, with the two exemptions listed', () => {
    expect(raised(mining, { 'mineral-title': false, pit: true })).toEqual(['pit-permit'])
    const pit = mining.rules.find((r) => r.id === 'pit-permit')!
    expect(pit.exceptions?.map((x) => [x.id, x.kind])).toEqual([
      ['regulation', 'by-law'],
      ['officer', 'decision'],
    ])
  })

  it('groups every rule of both packs under a topic', () => {
    for (const pack of [pmfl, mining])
      for (const rule of pack.rules) expect(ruleTopic(pack, rule).id, rule.id).not.toMatch(/^section-/)
  })
})

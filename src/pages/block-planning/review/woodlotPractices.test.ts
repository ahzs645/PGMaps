import { describe, expect, it } from 'vitest'
import woodlotRaw from '../../../../packages/legal-rules/packs/bc-woodlot-practices.json'
import landRaw from '../../../../packages/legal-rules/packs/bc-land-status.json'
import profile from '../../../../packages/legal-rules/forestry-profile.json'
import { assess } from '../../../../packages/legal-rules/engine/evaluate'
import { checkFactLinks, parsePack, releaseKey, type Scalar } from '../../../../packages/legal-rules/src/contract'
import { questions } from './questions'
import { ruleTopic } from './topics'

const woodlot = parsePack(woodlotRaw)
const land = parsePack(landRaw)
type Answers = Record<string, Scalar>

function run(answers: Answers) {
  const set = {
    format: 'pgmaps-legal-facts/v1' as const,
    pack: woodlot.id,
    version: woodlot.version,
    source: 'test',
    facts: Object.entries(answers).map(([id, value]) => ({ id, value })),
  }
  const release = assess(profile.assessmentDate, [woodlot], [set]).releases[0]
  expect(release.findings.every((f) => f.status !== 'outside_source_window')).toBe(true)
  return release
}
const raised = (answers: Answers) =>
  run(answers)
    .findings.filter((f) => f.status === 'review_required')
    .map((f) => f.rule)
    .sort()
const asked = (answers: Answers) => {
  const release = run(answers)
  return questions(woodlot, release.facts, release.findings, new Set())
    .filter((q) => q.state === 'open')
    .map((q) => q.fact.id)
}

const HOLDER = { land: 'Crown land', 'licence-area': 'A woodlot licence', 'woodlot-holder': true }
/** A woodlot holder's block with every limit met and nothing beside it: the regulation's own figures. */
const QUIET = {
  ...HOLDER,
  'plan-avoid': false,
  'plan-modify': false,
  'plan-soil': false,
  'soil-disturbance': 5,
  'plan-access-block': false,
  'cutblock-ha': 12,
  'access-block': 6,
  'plan-access-area': false,
  'access-area': 4,
  'riparian-reserve': false,
  'riparian-management': false,
  'plan-riparian-widths': false,
  'road-in-reserve': false,
  'road-in-management': false,
  'bank-stability': false,
  'fish-passage': false,
  waterworks: false,
  'intake-upslope': false,
  spring: false,
  'wtra-lower': false,
  'wtra-share': 9,
  'wildlife-trees': false,
  gwm: false,
}

describe('woodlot licence practices', () => {
  it('is reviewed on every block and shares its deciding questions with land status', () => {
    expect(profile.blockReleases).toContain(releaseKey(woodlot))
    expect(profile.blockReleases).toContain(releaseKey(land))
    expect(() => checkFactLinks([land, woodlot])).not.toThrow()
    for (const id of ['land', 'licence-area', 'woodlot-holder']) {
      const own = woodlot.facts.find((f) => f.id === id)!
      const { sameAs, ...asked } = own
      expect(sameAs).toBe(`bc.land-status:${id}`)
      expect(asked).toEqual(land.facts.find((f) => f.id === id))
    }
    for (const rule of woodlot.rules)
      expect(rule.scope?.[0].slice(0, 3).map((c) => c.fact)).toEqual(['land', 'licence-area', 'woodlot-holder'])
  })

  it('asks nothing of a Crown block outside a woodlot licence area, nor of another licensee in one', () => {
    for (const answers of <Answers[]>[
      { land: 'Crown land', 'licence-area': 'None of these' },
      { land: 'Crown land', 'licence-area': 'A tree farm licence' },
      { land: 'Private land', 'licence-area': 'None of these' },
      { land: 'Federal land, including an Indian reserve' },
      { ...HOLDER, 'woodlot-holder': false },
    ]) {
      expect(asked(answers), JSON.stringify(answers)).toEqual([])
      expect(raised(answers)).toEqual([])
    }
  })

  it('asks the plan’s own figure before the regulation’s, once the land makes it apply', () => {
    const open = asked(HOLDER)
    expect(open).toEqual(expect.arrayContaining(['plan-avoid', 'plan-soil', 'plan-access-block', 'wtra-lower']))
    expect(open).not.toContain('soil-disturbance')
    expect(open).not.toContain('soil-over-plan')
    expect(asked({ ...HOLDER, 'plan-soil': false })).toContain('soil-disturbance')
    expect(asked({ ...HOLDER, 'plan-soil': true })).toContain('soil-over-plan')
  })

  it('raises nothing on a woodlot holder’s block that keeps the regulation’s limits, private land included', () => {
    expect(raised(QUIET)).toEqual([])
    expect(raised({ ...QUIET, land: 'Private land' })).toEqual([])
  })

  it('holds soil disturbance to 8% and permanent access to 7% or 10% by cutblock size', () => {
    expect(raised({ ...QUIET, 'soil-disturbance': 9 })).toEqual(['soil-disturbance'])
    expect(raised({ ...QUIET, 'soil-disturbance': 8 })).toEqual([])
    expect(raised({ ...QUIET, 'access-block': 8 })).toEqual(['access-cutblock'])
    expect(raised({ ...QUIET, 'access-block': 8, 'cutblock-ha': 4 })).toEqual([])
    expect(raised({ ...QUIET, 'access-block': 11, 'cutblock-ha': 4 })).toEqual(['access-cutblock'])
    expect(raised({ ...QUIET, 'access-area': 7.5 })).toEqual(['access-licence-area'])
    expect(raised({ ...QUIET, 'wtra-share': 7 })).toEqual(['wildlife-tree-area'])
  })

  it('reads the woodlot licence plan’s alternative figures in place of the regulation’s', () => {
    // 9% soil disturbance breaks the regulation's 8%, but not a plan that allows more.
    expect(raised({ ...QUIET, 'soil-disturbance': 9, 'plan-soil': true, 'soil-over-plan': false })).toEqual([])
    // 4% keeps the regulation's 8%, but not a plan that allows less.
    expect(raised({ ...QUIET, 'plan-soil': true, 'soil-over-plan': true })).toEqual(['soil-disturbance'])
    expect(raised({ ...QUIET, 'access-block': 8, 'plan-access-block': true, 'access-over-plan-block': false })).toEqual(
      [],
    )
    expect(raised({ ...QUIET, 'plan-access-area': true, 'access-over-plan-area': true })).toEqual([
      'access-licence-area',
    ])
    // 7% of the licence area falls short of 8%, but meets a lower share the plan specifies.
    expect(raised({ ...QUIET, 'wtra-share': 7, 'wtra-lower': true, 'wtra-below-least': false })).toEqual([])
    // Riparian widths come from the plan or from the table, never both.
    expect(raised({ ...QUIET, 'riparian-management': true })).toEqual(['management-zone-trees', 'riparian-widths'])
    expect(raised({ ...QUIET, 'riparian-management': true, 'plan-riparian-widths': true })).toEqual([
      'management-zone-trees',
      'riparian-widths-plan',
    ])
  })

  it('raises the plan’s areas, the riparian zones, water and wildlife only when they arise', () => {
    expect(raised({ ...QUIET, 'plan-avoid': true, 'plan-modify': true })).toEqual(['avoid-area', 'modified-area'])
    expect(raised({ ...QUIET, 'riparian-reserve': true, 'road-in-reserve': true, 'road-in-management': true })).toEqual(
      ['management-zone-road', 'reserve-zone-road', 'reserve-zone-treatments', 'reserve-zone-trees', 'riparian-widths'],
    )
    expect(
      raised({
        ...QUIET,
        'bank-stability': true,
        'fish-passage': true,
        waterworks: true,
        'intake-upslope': true,
        spring: true,
        'wildlife-trees': true,
        gwm: true,
      }),
    ).toEqual([
      'bank-stability',
      'fish-passage',
      'general-wildlife-measure',
      'intake-upslope',
      'spring-road',
      'waterworks',
      'wildlife-trees',
    ])
  })

  it('raises no cutblock size or adjacency rule, which the WLPPR does not have', () => {
    const big = { ...QUIET, 'cutblock-ha': 400, 'access-block': 2 }
    expect(raised(big)).toEqual([])
    expect(woodlot.rules.map((r) => r.provision).join(' ')).not.toMatch(/\b6[45]\b/)
  })

  it('lists the law’s exceptions: the Workers Compensation Act on every rule, the minister only where §78(1) reaches', () => {
    const exceptions = (id: string) => woodlot.rules.find((r) => r.id === id)!.exceptions?.map((x) => x.id) ?? []
    for (const rule of woodlot.rules) expect(exceptions(rule.id), rule.id).toContain('workers-compensation')
    expect(exceptions('intake-upslope')).toEqual(['no-more-sediment', 'minister-exempts', 'workers-compensation'])
    expect(exceptions('reserve-zone-trees')).not.toContain('minister-exempts')
    expect(exceptions('general-wildlife-measure')).toEqual(
      expect.arrayContaining(['wildlife-minister', 'earlier-permit', 'private-pre-1995']),
    )
  })

  it('points land status’s WLPPR finding at this pack', () => {
    const rule = land.rules.find((r) => r.id === 'woodlot-wlppr')!
    expect(rule.finding).toContain('bc.woodlot-practices')
    expect(rule.finding).not.toMatch(/does not yet assess/)
  })

  it('groups every rule under a topic', () => {
    for (const rule of woodlot.rules) expect(ruleTopic(woodlot, rule).id, rule.id).not.toMatch(/^section-/)
  })
})

import { describe, expect, it } from 'vitest'
import raw from '../../../../packages/legal-rules/packs/bc-land-status.json'
import profile from '../../../../packages/legal-rules/forestry-profile.json'
import { assess } from '../../../../packages/legal-rules/engine/evaluate'
import { parsePack, type Scalar } from '../../../../packages/legal-rules/src/contract'
import { questions } from './questions'
import { ruleTopic } from './topics'

const pack = parsePack(raw)
type Answers = Record<string, Scalar>

const CROWN = 'Crown land'
const PRIVATE = 'Private land'
const BOTH = 'Both Crown and private land'
const RESERVE = 'Federal land, including an Indian reserve'
const TREATY = 'Treaty settlement land'
const NONE = 'None of these'

function run(answers: Answers) {
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
const raised = (answers: Answers) =>
  run(answers)
    .findings.filter((f) => f.status === 'review_required')
    .map((f) => f.rule)
    .sort()
const asked = (answers: Answers) => {
  const release = run(answers)
  return questions(pack, release.facts, release.findings, new Set())
    .filter((q) => q.state === 'open')
    .map((q) => q.fact.id)
}

describe('land status', () => {
  it('is reviewed for every block, first', () => {
    expect(profile.blockReleases[0]).toBe('bc.land-status@1.0.0')
  })

  it('asks what land the block is on before anything else', () => {
    expect(asked({})).toEqual(['land'])
  })

  it('sends a Crown block to FRPA and asks nothing about private land', () => {
    expect(raised({ land: CROWN, 'licence-area': NONE })).toEqual(['frpa-reach'])
    expect(asked({ land: CROWN, 'licence-area': NONE })).toEqual([])
  })

  it('takes FRPA off private land outside a tree farm, community forest or woodlot licence area', () => {
    const answers = {
      land: PRIVATE,
      'licence-area': NONE,
      'managed-forest': false,
      'timber-reserved': false,
      'adjacent-crown': false,
    }
    expect(raised(answers)).toEqual(['frpa-no-reach', 'scaling', 'timber-mark'])
  })

  it('keeps FRPA on private land a woodlot licence includes, and names the WLPPR for its holder', () => {
    const answers = {
      land: PRIVATE,
      'licence-area': 'A woodlot licence',
      'woodlot-holder': true,
      'timber-reserved': false,
      'adjacent-crown': false,
    }
    expect(raised(answers)).toEqual(['frpa-reach', 'scaling', 'timber-mark', 'woodlot-wlppr'])
    // The PMFLA does not apply in a woodlot licence area (§3), so it is not asked.
    expect(asked(answers)).not.toContain('managed-forest')
  })

  it('names the WLPPR on a woodlot licence’s Crown land too, only for its holder', () => {
    expect(raised({ land: CROWN, 'licence-area': 'A woodlot licence', 'woodlot-holder': true })).toEqual([
      'frpa-reach',
      'woodlot-wlppr',
    ])
    expect(raised({ land: CROWN, 'licence-area': 'A woodlot licence', 'woodlot-holder': false })).toEqual([
      'frpa-reach',
    ])
  })

  it('sends private managed forest land to the PMFLA, and only outside the three licence areas', () => {
    const base = { land: PRIVATE, 'timber-reserved': false, 'adjacent-crown': false, 'managed-forest': true }
    expect(raised({ ...base, 'licence-area': NONE })).toContain('managed-forest-land')
    expect(raised({ ...base, 'licence-area': 'A First Nations woodland licence' })).toContain('managed-forest-land')
    expect(raised({ ...base, 'licence-area': 'A tree farm licence' })).not.toContain('managed-forest-land')
  })

  it('raises reserved timber and boundaries beside Crown land on a block partly on private land', () => {
    const answers = {
      land: BOTH,
      'licence-area': NONE,
      'managed-forest': false,
      'timber-reserved': true,
      'adjacent-crown': true,
    }
    expect(raised(answers)).toEqual(['crown-timber', 'frpa-reach', 'private-boundaries', 'scaling', 'timber-mark'])
  })

  it('assesses nothing on a reserve or treaty settlement land, and says so by leaving every rule out of scope', () => {
    for (const land of [RESERVE, TREATY]) {
      const release = run({ land })
      expect(release.findings.filter((f) => f.status === 'review_required')).toEqual([])
      expect(release.findings.every((f) => f.status === 'outside_scope')).toBe(true)
      expect(asked({ land })).toEqual([])
    }
  })

  it('groups every rule under a topic', () => {
    for (const rule of pack.rules) expect(ruleTopic(pack, rule).id, rule.id).not.toMatch(/^section-/)
  })
})

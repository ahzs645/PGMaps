import { describe, expect, it } from 'vitest'
import { assess } from '../../../../packages/legal-rules/engine/evaluate'
import { parsePack, type FactSet } from '../../../../packages/legal-rules/src/contract'
import fppr from '../../../../packages/legal-rules/packs/bc-fppr-planning-1.1.0.json'
import pg from '../../../../packages/legal-rules/packs/bc-pgtsa-planning-1.2.0.json'
import { dateGaps, dateGapText, findingCounts, questions } from './questions'
import { describeCheck, STATUS_WORDS } from './wording'

const pack = parsePack(fppr)
const order = parsePack(pg)
const set = (p: typeof pack, facts: FactSet['facts']): FactSet => ({
  format: 'pgmaps-legal-facts/v1',
  pack: p.id,
  version: p.version,
  source: 'test',
  facts,
})
const run = (p: typeof pack, facts: FactSet['facts']) => {
  const release = assess('2026-11-17', [p], [set(p, facts)]).releases[0]
  return { release, asked: questions(p, release.facts, release.findings, new Set()) }
}

describe('review questions', () => {
  it('asks only the scope questions of an empty FPPR case, applicability first', () => {
    const { asked } = run(pack, [])
    const ids = asked.map((q) => q.fact.id)
    expect(ids[0]).toBe('applicable')
    // A trigger's question waits until its rule is known to apply.
    expect(ids).not.toContain('nar')
    // Every FPPR rule's scope starts with applicability, so an empty case asks that alone.
    expect(asked.filter((q) => q.state === 'open').map((q) => q.fact.id)).toEqual(['applicable'])
  })

  it('drops a rule’s questions once the regime is said not to apply', () => {
    const { asked, release } = run(pack, [{ id: 'applicable', value: false }])
    expect(asked.filter((q) => q.state === 'open')).toEqual([])
    expect(findingCounts(release.findings).notApplicable).toBe(pack.rules.length)
  })

  it('asks for the net area once an Omineca holder’s block is in scope', () => {
    const { asked } = run(pack, [
      { id: 'applicable', value: true },
      { id: 'holder', value: true },
      { id: 'minor', value: false },
      { id: 'region', value: 'Omineca' },
      { id: 'landscape-default', value: true },
    ])
    expect(asked.some((q) => q.fact.id === 'nar' && q.state === 'open')).toBe(true)
  })

  it('never asks for a fact a measurement fills', () => {
    const release = assess('2026-11-17', [order], [set(order, [{ id: 'applicable', value: true }])]).releases[0]
    const asked = questions(order, release.facts, release.findings, new Set(['patch-class-away']))
    expect(asked.find((q) => q.fact.id === 'patch-class-away')?.state).toBe('measured')
  })

  it('words a numeric check with its unit and result', () => {
    const fact = pack.facts.find((f) => f.id === 'nar')!
    const line = describeCheck(pack, { fact: 'nar', operator: 'gt', expected: 60, actual: 63, result: true })
    expect(line.asks).toBe(`${fact.label}: more than 60${fact.unit ? ' ' + fact.unit : ''}`)
    expect(line.answer).toContain('63')
    expect(line.held).toBe('met')
    expect(STATUS_WORDS.review_required).toBe('Needs review')
  })
})

describe('grouping by provision', () => {
  it('puts shared questions under the whole case and the rest under their provisions', async () => {
    const { groupQuestions, ruleTopic, sectionOf } = await import('./topics')
    expect(sectionOf('64(1)(b) and 64(2)–(4)')).toBe('64')
    expect(sectionOf('4.33(1)–(3)')).toBe('4.33')
    expect(sectionOf('D.5(a)')).toBe('D.5')
    expect(sectionOf('C / Table 7')).toBe('C')
    // Every FPPR rule falls under a named topic, none under a bare section.
    expect(pack.rules.filter((r) => ruleTopic(pack, r).id.startsWith('section-'))).toEqual([])
    const { asked } = run(pack, [
      { id: 'applicable', value: true },
      { id: 'holder', value: true },
    ])
    const groups = groupQuestions(
      pack,
      asked.filter((q) => q.state === 'open'),
    )
    expect(groups.length).toBeGreaterThan(1)
    // A question is in exactly one group, and the groups keep the evaluator's questions.
    expect(groups.flatMap((g) => g.questions).length).toBe(asked.filter((q) => q.state === 'open').length)
  })

  it('groups an installed pack with no table by its sections', async () => {
    const { ruleTopic } = await import('./topics')
    const other = { ...pack, id: 'example.other' }
    expect(ruleTopic(other, pack.rules[0])).toEqual({ id: 'section-64', label: 'Section 64' })
  })
})

describe('a review date a release does not cover', () => {
  const later = (date: string) => assess(date, [pack], [set(pack, [{ id: 'applicable', value: false }])]).releases[0]

  it('counts its rules as not assessed, never as not applying', () => {
    const counts = findingCounts(later('2026-12-15').findings)
    expect(counts.outsideDates).toBe(pack.rules.length)
    expect(counts.notApplicable).toBe(0)
    expect(STATUS_WORDS.outside_source_window).toMatch(/^Not assessed/)
  })

  it('names the release’s window and says which side the date falls on', () => {
    const after = later('2026-12-15')
    const [gap] = dateGaps('2026-12-15', [after])
    expect(gap).toMatchObject({ side: 'after', rules: pack.rules.length, date: '2026-12-15' })
    const text = dateGapText(gap)
    expect(text).toContain(`${pack.coverage.from} to ${pack.coverage.through}`)
    expect(text).toContain('none of its')
    expect(text).not.toMatch(/does not apply|complies/)
    // A historical date (a permit's issue date) is before the window: the law as it stood then is not held.
    const [before] = dateGaps('2016-06-01', [later('2016-06-01')])
    expect(before.side).toBe('before')
    expect(dateGapText(before)).toMatch(/law as it stood then/)
    // A date the release covers leaves no gap.
    expect(dateGaps(pack.coverage.through, [later(pack.coverage.through)])).toEqual([])
  })

  it('keeps a rule outside the release’s dates from asking anything', () => {
    const release = assess('2016-06-01', [pack], [set(pack, [])]).releases[0]
    expect(questions(pack, release.facts, release.findings, new Set()).filter((q) => q.state === 'open')).toEqual([])
  })
})

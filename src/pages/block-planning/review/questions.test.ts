import { describe, expect, it } from 'vitest'
import { assess } from '../../../../packages/legal-rules/engine/evaluate'
import { parsePack, type FactSet } from '../../../../packages/legal-rules/src/contract'
import fppr from '../../../../packages/legal-rules/packs/bc-fppr-planning-1.1.0.json'
import pg from '../../../../packages/legal-rules/packs/bc-pgtsa-planning-1.2.0.json'
import { findingCounts, questions } from './questions'
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

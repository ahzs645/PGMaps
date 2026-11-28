import { describe, expect, it } from 'vitest'
import { assess } from '../../../../packages/legal-rules/engine/evaluate'
import { parsePack, type Scalar } from '../../../../packages/legal-rules/src/contract'
import profile from '../../../../packages/legal-rules/forestry-profile.json'
import raw from '../../../../packages/legal-rules/packs/bc-omineca-old-growth.json'
import saved from '../../../../packages/legal-rules/packs/bc-omineca-old-growth-v1.1.0.json'
import { findingCounts } from './questions'
import { ruleTopic } from './topics'

const pack = parsePack(raw)
const earlier = parsePack(saved)
const run = (p: typeof pack, answers: Record<string, Scalar>, date = '2026-11-27') =>
  assess(
    date,
    [p],
    [
      {
        format: 'pgmaps-legal-facts/v1',
        pack: p.id,
        version: p.version,
        source: 'test',
        facts: Object.entries(answers).map(([id, value]) => ({ id, value })),
      },
    ],
  ).releases[0]
const raised = (p: typeof pack, answers: Record<string, Scalar>, date?: string) =>
  run(p, answers, date)
    .findings.filter((f) => f.status === 'review_required')
    .map((f) => f.rule)

describe('old growth 1.2.0', () => {
  it('is the block profile’s release, and covers the date its orders were transcribed', () => {
    expect(profile.blockReleases).toContain('bc.omineca.old-growth@1.2.0')
    expect(pack.coverage).toEqual({ from: '2026-11-17', through: '2026-11-27' })
    expect(earlier.coverage.through).toBe('2026-11-17')
  })

  it('raises a legal OGMA under an order it does not transcribe, citing Land Act §93.4, where 1.1.0 raised nothing', () => {
    const other = { 'ogma-order': 'Another order' }
    expect(raised(earlier, other, '2026-11-17')).toEqual([])
    expect(raised(pack, other)).toEqual(['ogma-other-order'])
    const rule = pack.rules.find((r) => r.id === 'ogma-other-order')!
    expect(pack.sources.find((s) => s.id === rule.source)?.url).toContain('96245_01')
    expect(rule.provision).toBe('93.4(1)')
    expect(rule.finding).toMatch(/order’s own text, which decides/)
    expect(rule.finding).not.toMatch(/compl/i)
    expect(ruleTopic(pack, rule).id).not.toMatch(/^section-/)
    // An order the release holds keeps its own rules and does not raise the general one.
    expect(raised(pack, { 'ogma-order': 'No legal OGMA' })).not.toContain('ogma-other-order')
  })

  it('assesses a review dated today, where 1.1.0 assessed none of its rules', () => {
    expect(findingCounts(run(earlier, {}, '2026-11-27').findings).outsideDates).toBe(earlier.rules.length)
    expect(findingCounts(run(pack, {}).findings).outsideDates).toBe(0)
  })
})

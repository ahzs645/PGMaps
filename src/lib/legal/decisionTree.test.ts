import { describe, expect, it } from 'vitest'
import { assess } from '../../../packages/legal-rules/engine/evaluate'
import { parsePack, type Fact, type Pack, type Scalar } from '../../../packages/legal-rules/src/contract'
import { decisionTree, routesOf, treeToMermaid, type TreeNode } from './decisionTree'

const packs = Object.values(
  import.meta.glob('../../../packages/legal-rules/packs/*.json', { eager: true, import: 'default' }),
).map(parsePack)

/** A small deterministic generator, so a failure names a case that can be run again. */
function random(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

/** Values a rule compares against, so random answers land on both sides of each condition. */
function candidates(pack: Pack, fact: Fact): Scalar[] {
  if (fact.type === 'boolean') return [true, false]
  if (fact.type === 'choice') return fact.choices!
  const used = pack.rules
    .flatMap((r) => [...(r.scope ?? []), ...r.when].flat())
    .filter((p) => p.fact === fact.id)
    .flatMap((p) => {
      const v =
        typeof p.value === 'object' && !Array.isArray(p.value)
          ? pack.parameters.find((x) => x.id === (p.value as { parameter: string }).parameter)!.value
          : p.value
      return Array.isArray(v) ? v : [v]
    })
  if (fact.type === 'number')
    return used
      .flatMap((v) => [Number(v) - 1, Number(v), Number(v) + 1])
      .filter((v) => (fact.min ?? -Infinity) <= v && v <= (fact.max ?? Infinity))
  return used.length ? used : ['text']
}

const nodes = (n: TreeNode): TreeNode[] => (n.kind === 'rule' ? [n] : [n, ...n.edges.flatMap((e) => nodes(e.to))])

describe('decisionTree', () => {
  it('reaches exactly the rules the evaluator triggers, for random answers to every shipped pack', () => {
    for (const pack of packs) {
      const next = random(pack.rules.length * 7919)
      for (let trial = 0; trial < 300; trial++) {
        const answers: Record<string, Scalar | null> = {}
        for (const fact of pack.facts) {
          const options = candidates(pack, fact)
          answers[fact.id] = next() < 0.2 || !options.length ? null : options[Math.floor(next() * options.length)]
        }
        const facts = Object.entries(answers)
          .filter(([, v]) => v !== null)
          .map(([id, value]) => ({ id, value }))
        const report = assess(
          pack.coverage.from,
          [pack],
          [{ format: 'pgmaps-legal-facts/v1', pack: pack.id, version: pack.version, source: 'test', facts }],
        )
        const triggered = report.releases[0].findings.filter((f) => f.status === 'review_required').map((f) => f.rule)
        const tree = decisionTree(pack, answers)
        expect([...new Set(tree.reached)].sort(), `${pack.id}@${pack.version} trial ${trial}`).toEqual(triggered.sort())
      }
    }
    // Every shipped pack, 300 evaluations each: the evaluator parses its pack on every call.
  }, 20_000)

  it('puts every rule in the tree once per way it can be met', () => {
    for (const pack of packs) {
      const tree = decisionTree(pack, {})
      const leaves = nodes(tree.root).filter((n) => n.kind === 'rule')
      const routes = pack.rules.reduce(
        (sum, r) => sum + new Set(routesOf(pack, r).map((x) => JSON.stringify(x))).size,
        0,
      )
      expect(leaves.length, pack.id).toBe(routes)
    }
  })

  it('shares a question several rules ask first, and stops the lit route at an unanswered one', () => {
    const pack = packs.find((p) => p.id === 'bc.crown-grazing')!
    const ada = pack.rules.filter((r) => r.id.startsWith('ada-sra')).map((r) => r.id)
    const tree = decisionTree(pack, { 'ada-sra-applicable': true }, ada)
    expect(tree.root.kind).toBe('question')
    if (tree.root.kind !== 'question') return
    expect(tree.root.fact.id).toBe('ada-sra-applicable')
    expect(tree.root.edges.map((e) => e.label)).toEqual(['Yes'])
    expect(tree.waiting).toContain('ada-sra-excluded')
    expect(tree.reached).toEqual([])
  })

  it('writes Mermaid with the lit route marked', () => {
    const pack = packs.find((p) => p.id === 'bc.fppr' && p.version === '1.1.0')!
    const text = treeToMermaid(decisionTree(pack, {}, ['limit-60']))
    expect(text.startsWith('flowchart TD')).toBe(true)
    expect(text).toContain('Cutblock size')
    expect(text).toContain('class ')
  })
})

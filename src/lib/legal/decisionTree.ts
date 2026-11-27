/**
 * A pack's rules drawn as one decision tree: every rule's conditions (its scope, then its trigger)
 * become a route of questions, routes that ask the same question first share it, and each route
 * ends at the rule's finding. Answers label the branches, and a case's answers light the route it
 * takes, the way a naming builder highlights the current name's path.
 *
 * The evaluator (`engine/evaluate.ts`) decides every finding; this only lays the rules out and
 * reads the same answers. A branch nobody's answers reach stays unlit, an unanswered question
 * stops the route there, and a rule whose route is lit to its end is the rule the evaluator
 * triggers. DOM-free.
 */
import { operand, type Fact, type Pack, type Predicate, type Scalar } from '../../../packages/legal-rules/src/contract'

type Rule = Pack['rules'][number]

export interface TreeEdge {
  /** "Yes", "No", "Part B: forest-health harvest", "> 60 ha". */
  label: string
  predicate: Predicate | null
  /** true: the case's answer takes this branch; false: it doesn't; null: not answered yet. */
  taken: boolean | null
  to: TreeNode
}
export interface QuestionNode {
  kind: 'question'
  id: string
  fact: Fact
  /** The planner measures this answer (a spatial binding); the reviewer doesn't enter it. */
  measured: boolean
  answer: Scalar | null
  edges: TreeEdge[]
}
export interface RuleNode {
  kind: 'rule'
  id: string
  rule: Rule
}
/** Several routes leave the same point by different questions: each is a branch of its own. */
export interface ForkNode {
  kind: 'fork'
  id: string
  edges: TreeEdge[]
}
export type TreeNode = QuestionNode | RuleNode | ForkNode

export interface DecisionTree {
  root: TreeNode
  /** Every node the case's answers reach, by id. */
  lit: Set<string>
  /** Rules whose whole route the answers satisfy. */
  reached: string[]
  /** Questions where the lit route stops for want of an answer. */
  waiting: string[]
}

const SYMBOL: Record<Predicate['op'], string> = { eq: '', ne: 'not ', in: '', gt: '> ', gte: '≥ ', lt: '< ', lte: '≤ ' }

/** What a branch reads as: "Yes", "No", "not Part A", "> 60 ha", "A or B". */
export function branchLabel(pack: Pack, fact: Fact, p: Predicate) {
  const rhs = operand(pack, p)
  const show = (v: Scalar) => (typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v))
  const unit = fact.type === 'number' && fact.unit ? ' ' + fact.unit : ''
  if (Array.isArray(rhs)) return rhs.map(show).join(' or ')
  if (p.op === 'ne' && typeof rhs === 'boolean') return rhs ? 'No' : 'Yes'
  return SYMBOL[p.op] + show(rhs) + unit
}

function holds(actual: Scalar | null, p: Predicate, expected: Scalar | Scalar[]): boolean | null {
  if (actual === null) return null
  switch (p.op) {
    case 'eq':
      return actual === expected
    case 'ne':
      return actual !== expected
    case 'in':
      return Array.isArray(expected) && expected.includes(actual)
    case 'gt':
      return Number(actual) > Number(expected)
    case 'gte':
      return Number(actual) >= Number(expected)
    case 'lt':
      return Number(actual) < Number(expected)
    case 'lte':
      return Number(actual) <= Number(expected)
  }
}

/** Each way a rule can be met: one scope alternative and one trigger alternative, in question order. */
export function routesOf(pack: Pack, rule: Rule): Predicate[][] {
  const order = new Map(pack.facts.map((f, i) => [f.id, i]))
  const scopes = rule.scope ?? [[]]
  const routes: Predicate[][] = []
  for (const scope of scopes)
    for (const when of rule.when) {
      const seen = new Set<string>()
      const route = [...scope, ...when].filter((p) => {
        const key = JSON.stringify(p)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      routes.push(route.sort((a, b) => (order.get(a.fact) ?? 0) - (order.get(b.fact) ?? 0)))
    }
  return routes
}

interface Trie {
  rules: string[]
  next: Map<string, { predicate: Predicate; trie: Trie }>
}

/**
 * The tree for some of a pack's rules (all of them by default), with the case's answers.
 * `answers` maps a fact id to its value, `null` when unanswered.
 */
export function decisionTree(
  pack: Pack,
  answers: Record<string, Scalar | null>,
  ruleIds: string[] = pack.rules.map((r) => r.id),
): DecisionTree {
  const rules = pack.rules.filter((r) => ruleIds.includes(r.id))
  const measured = new Set((pack.spatialBindings ?? []).map((b) => b.fact))
  const facts = new Map(pack.facts.map((f) => [f.id, f]))
  const top: Trie = { rules: [], next: new Map() }
  for (const rule of rules)
    for (const route of routesOf(pack, rule)) {
      let at = top
      for (const p of route) {
        const key = JSON.stringify(p)
        let step = at.next.get(key)
        if (!step) {
          step = { predicate: p, trie: { rules: [], next: new Map() } }
          at.next.set(key, step)
        }
        at = step.trie
      }
      if (!at.rules.includes(rule.id)) at.rules.push(rule.id)
    }

  let serial = 0
  const lit = new Set<string>()
  const reached: string[] = []
  const waiting: string[] = []
  const answer = (id: string) => (id in answers ? answers[id] : null)

  /** The node for what follows a point in the trie; `on` says whether the answers reach it. */
  function build(trie: Trie, on: boolean): TreeNode {
    const branches: TreeNode[] = []
    for (const id of trie.rules) {
      const node: RuleNode = { kind: 'rule', id: `r${serial++}`, rule: rules.find((r) => r.id === id)! }
      if (on) {
        lit.add(node.id)
        reached.push(id)
      }
      branches.push(node)
    }
    // Steps that ask the same question are one question with several answers.
    const byFact = new Map<string, { predicate: Predicate; trie: Trie }[]>()
    for (const step of trie.next.values()) {
      const list = byFact.get(step.predicate.fact) ?? []
      list.push(step)
      byFact.set(step.predicate.fact, list)
    }
    for (const [factId, steps] of byFact) {
      const fact = facts.get(factId)!
      const value = answer(factId)
      const node: QuestionNode = {
        kind: 'question',
        id: `q${serial++}`,
        fact,
        measured: measured.has(factId),
        answer: value,
        edges: [],
      }
      if (on) lit.add(node.id)
      if (on && value === null) waiting.push(factId)
      for (const step of steps) {
        const taken = holds(value, step.predicate, operand(pack, step.predicate))
        node.edges.push({
          label: branchLabel(pack, fact, step.predicate),
          predicate: step.predicate,
          taken,
          to: build(step.trie, on && taken === true),
        })
      }
      branches.push(node)
    }
    if (branches.length === 1) return branches[0]
    const fork: ForkNode = {
      kind: 'fork',
      id: `f${serial++}`,
      edges: branches.map((to) => ({ label: '', predicate: null, taken: on ? true : false, to })),
    }
    if (on) lit.add(fork.id)
    return fork
  }
  const root = build(top, true)
  return { root, lit, reached, waiting: [...new Set(waiting)] }
}

/** The tree as Mermaid text, with the lit route in its own class, for pasting into a document. */
export function treeToMermaid(tree: DecisionTree) {
  const lines = ['flowchart TD']
  const clean = (s: string) => s.replace(/"/g, "'").replace(/#/g, 'no. ').replace(/[;\n]/g, ' ')
  const on: string[] = []
  let edge = 0
  const walk = (n: TreeNode) => {
    if (n.kind === 'question') lines.push(`  ${n.id}{"${clean(n.fact.label)}"}`)
    else if (n.kind === 'rule') lines.push(`  ${n.id}(["${clean(n.rule.title)} · ${clean(n.rule.provision)}"])`)
    else lines.push(`  ${n.id}(( ))`)
    if (n.kind === 'rule') return
    for (const e of n.edges) {
      lines.push(`  ${n.id} -->${e.label ? `|"${clean(e.label)}"|` : ''} ${e.to.id}`)
      if (tree.lit.has(n.id) && e.taken === true) on.push(String(edge))
      edge++
      walk(e.to)
    }
  }
  walk(tree.root)
  lines.push('  classDef lit stroke-width:3px')
  if (tree.lit.size) lines.push(`  class ${[...tree.lit].join(',')} lit`)
  if (on.length) lines.push(`  linkStyle ${on.join(',')} stroke-width:3px`)
  return lines.join('\n')
}

/** An action's kind in words, for a finding's list of what to do. */
export const ACTION_KIND: Record<string, string> = {
  review: 'Review',
  submit: 'Submit',
  'obtain-approval': 'Obtain approval',
  implement: 'Implement',
  monitor: 'Monitor',
}

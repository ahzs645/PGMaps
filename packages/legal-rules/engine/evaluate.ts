import { z } from 'zod'
import {
  operand,
  parseFacts,
  parsePack,
  releaseKey,
  type Expression,
  type FactSet,
  type Pack,
  type Predicate,
  type Scalar,
} from '../src/contract'

type Truth = boolean | null
function compare(actual: Scalar, op: Predicate['op'], expected: Scalar | Scalar[]): boolean {
  switch (op) {
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
function test(expression: Expression, p: Pack, facts: FactSet) {
  const trace = expression.map((group) =>
    group.map((c) => {
      const input = facts.facts.find((f) => f.id === c.fact),
        expected = operand(p, c)
      return {
        fact: c.fact,
        operator: c.op,
        expected,
        actual: input?.value ?? null,
        result: input?.value == null ? null : compare(input.value, c.op, expected),
      }
    }),
  )
  const groups: Truth[] = trace.map((group) =>
    group.some((t) => t.result === false) ? false : group.some((t) => t.result === null) ? null : true,
  )
  const result = groups.includes(true) ? true : groups.includes(null) ? null : false
  return { result, trace }
}
export function assess(date: string, packs: Pack[], inputs: FactSet[]) {
  z.iso.date().parse(date)
  if (new Set(packs.map((p) => p.id)).size !== packs.length) throw Error('Select one release per instrument.')
  const keys = new Set(packs.map(releaseKey))
  const inputKeys = inputs.map((s) => s.pack + '@' + s.version)
  if (new Set(inputKeys).size !== inputs.length || inputKeys.some((k) => !keys.has(k)))
    throw Error('Unmatched or duplicate fact set.')
  const releases = packs.map((raw) => {
    const p = parsePack(raw)
    const input = inputs.find((s) => s.pack === p.id)
    const facts = parseFacts(
      input ?? {
        format: 'pgmaps-legal-facts/v1',
        pack: p.id,
        version: p.version,
        source: 'No case evidence supplied',
        facts: [],
      },
      p,
    )
    const findings = p.rules.map((r) => {
      const source = p.sources.find((s) => s.id === r.source)!
      const row = { rule: r.id, title: r.title, source, provision: r.provision }
      if (date < p.coverage.from || date > p.coverage.through)
        return { ...row, status: 'outside_source_window' as const }
      const scope = r.scope ? test(r.scope, p, facts) : { result: true, trace: [] }
      if (scope.result !== true)
        return {
          ...row,
          status: scope.result === false ? ('outside_scope' as const) : ('missing_evidence' as const),
          scope,
        }
      const condition = test(r.when, p, facts)
      if (condition.result !== true)
        return {
          ...row,
          status: condition.result === false ? ('condition_not_triggered' as const) : ('missing_evidence' as const),
          scope,
          condition,
        }
      return { ...row, status: 'review_required' as const, scope, condition, finding: r.finding, actions: r.actions }
    })
    return { pack: p, facts, findings }
  })
  return {
    format: 'pgmaps-legal-assessment/v1',
    engineVersion: '1.0.0',
    assessmentDate: date,
    bindingDecision: false,
    releases,
  }
}

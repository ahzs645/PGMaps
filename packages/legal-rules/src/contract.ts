import { z } from 'zod'
import { operations } from '../engine/spatialFacts'

const id = z
  .string()
  .regex(/^[a-z][a-z0-9.-]*$/)
  .refine((s) => !['constructor', 'prototype'].includes(s), 'Reserved identifier')
const title = z.string().trim().min(1)
const date = z.iso.date()
const version = z.string().regex(/^\d+\.\d+\.\d+$/)
const scalar = z.union([z.boolean(), z.number(), title])
export type Scalar = z.infer<typeof scalar>
const fact = z.strictObject({
  id,
  label: title,
  type: z.enum(['number', 'boolean', 'text', 'choice']),
  unit: title.optional(),
  choices: z.array(title).min(1).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
})
const predicate = z.strictObject({
  fact: id,
  op: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in']),
  value: z.union([scalar, z.array(scalar).min(1), z.strictObject({ parameter: id })]),
})
// An outer OR of inner AND groups. No source expressions are evaluated as JavaScript.
const expression = z.array(z.array(predicate).min(1)).min(1)
/**
 * An exception the law makes to a rule, with its own citation. `by-law` holds once its facts do
 * (its `when`, if the pack can state them); `decision` holds only once the person it names has
 * decided. A reviewer claims one on a raised finding; the finding stays raised, with the claim.
 */
const exception = z.strictObject({
  id,
  label: title,
  source: id,
  provision: title,
  kind: z.enum(['by-law', 'decision']),
  decidedBy: title.optional(),
  when: expression.optional(),
  evidence: z.array(title).min(1).optional(),
})
const rule = z.strictObject({
  id,
  title,
  source: id,
  provision: title,
  scope: expression.optional(),
  when: expression,
  exceptions: z.array(exception).min(1).optional(),
  finding: title,
  actions: z.array(
    z.strictObject({
      kind: z.enum(['review', 'submit', 'obtain-approval', 'implement', 'monitor']),
      description: title,
    }),
  ),
})
export const packSchema = z.strictObject({
  format: z.literal('pgmaps-legal-pack/v1'),
  id,
  version,
  title,
  description: title,
  relatedPacks: z.array(z.strictObject({ id, relationship: title })).optional(),
  spatialBindings: z.array(z.strictObject({ fact: id, operation: id, output: id })).optional(),
  coverage: z.strictObject({ from: date, through: date }),
  sources: z.array(z.strictObject({ id, title, url: z.url({ protocol: /^https?$/ }), asOf: date })).min(1),
  facts: z.array(fact).min(1),
  parameters: z.array(z.strictObject({ id, value: scalar, unit: title.optional() })),
  rules: z.array(rule).min(1),
})
export type Pack = z.infer<typeof packSchema>
export type Fact = Pack['facts'][number]
export type Rule = Pack['rules'][number]
export type RuleException = z.infer<typeof exception>
export type Predicate = z.infer<typeof predicate>
export type Expression = z.infer<typeof expression>
export const releaseKey = (p: Pick<Pack, 'id' | 'version'>) => p.id + '@' + p.version
const claim = z.strictObject({
  rule: id,
  exception: id,
  rationale: z.string().optional(),
  evidence: z
    .array(z.strictObject({ label: title, reference: z.string().optional(), date: date.optional() }))
    .optional(),
  decision: z.strictObject({ by: z.string(), date: date.optional(), reference: z.string().optional() }).optional(),
})
export const factSetSchema = z.strictObject({
  format: z.literal('pgmaps-legal-facts/v1'),
  pack: id,
  version,
  source: title,
  facts: z.array(z.strictObject({ id, value: scalar.nullable(), evidence: title.optional() })),
  /** The exceptions the reviewer relies on, one per rule at most. Never a fact. */
  claims: z.array(claim).optional(),
})
export type FactSet = z.infer<typeof factSetSchema>
export type Claim = z.infer<typeof claim>
function unique<T>(items: T[], key: (v: T) => string, kind: string) {
  const ids = items.map(key)
  if (new Set(ids).size !== ids.length) throw Error('Duplicate ' + kind + ' identifier.')
}
export function accepts(f: Fact, v: Scalar) {
  switch (f.type) {
    case 'boolean':
      return typeof v === 'boolean'
    case 'choice':
      return typeof v === 'string' && !!f.choices?.includes(v)
    case 'number':
      return (
        typeof v === 'number' &&
        Number.isFinite(v) &&
        (f.min === undefined || v >= f.min) &&
        (f.max === undefined || v <= f.max)
      )
    case 'text':
      return typeof v === 'string' && v.trim().length > 0
  }
}
export function parsePack(value: unknown): Pack {
  const p = packSchema.parse(value)
  if (p.coverage.from > p.coverage.through) throw Error('Reversed assessment date window.')
  for (const [kind, rows] of Object.entries({
    fact: p.facts,
    source: p.sources,
    rule: p.rules,
    parameter: p.parameters,
  }))
    unique<{ id: string }>(rows, (x) => x.id, kind)
  for (const f of p.facts) {
    if ((f.type === 'choice') !== !!f.choices) throw Error('Choice lists belong to choice facts: ' + f.id)
    if (f.choices) unique(f.choices, (s) => s, 'choice')
    if (
      (f.min !== undefined || f.max !== undefined) &&
      (f.type !== 'number' || (f.min ?? -Infinity) > (f.max ?? Infinity))
    )
      throw Error('Invalid numeric bounds: ' + f.id)
  }
  unique(p.spatialBindings ?? [], (b) => b.fact, 'spatial fact')
  for (const binding of p.spatialBindings ?? []) {
    const output = operations.find((op) => op.id === binding.operation)?.outputs.find((o) => o.id === binding.output)
    const field = p.facts.find((f) => f.id === binding.fact)
    if (!field || !output || field.type !== output.type || field.unit !== ('unit' in output ? output.unit : undefined))
      throw Error('Unsupported spatial binding for ' + binding.fact)
  }
  for (const r of p.rules) {
    if (!p.sources.some((s) => s.id === r.source)) throw Error('Unknown source: ' + r.source)
    unique(r.exceptions ?? [], (x) => x.id, 'exception of ' + r.id)
    for (const x of r.exceptions ?? []) {
      if (!p.sources.some((s) => s.id === x.source)) throw Error('Unknown source: ' + x.source)
      if (x.kind === 'decision' && !x.decidedBy) throw Error('A decision names who decides: ' + r.id + '#' + x.id)
    }
    for (const c of [...(r.scope ?? []), ...r.when, ...(r.exceptions ?? []).flatMap((x) => x.when ?? [])].flat()) {
      const f = p.facts.find((f) => f.id === c.fact)
      if (!f) throw Error('Unknown fact: ' + c.fact)
      const rhs = operand(p, c)
      if ((c.op === 'in') !== Array.isArray(rhs)) throw Error('Only the in operator accepts a list.')
      if (!['eq', 'ne', 'in'].includes(c.op) && f.type !== 'number')
        throw Error('Ordered comparison requires a numeric fact.')
      if (!(Array.isArray(rhs) ? rhs : [rhs]).every((v) => accepts(f, v)))
        throw Error('Invalid comparison value for ' + f.id)
      if (typeof c.value === 'object' && !Array.isArray(c.value)) {
        const parameterId = c.value.parameter
        const param = p.parameters.find((x) => x.id === parameterId)
        if (param?.unit !== f.unit) throw Error('Parameter and fact units differ for ' + f.id)
      }
    }
  }
  return p
}
export function operand(p: Pack, c: Predicate): Scalar | Scalar[] {
  const rhs = c.value
  if (typeof rhs !== 'object' || Array.isArray(rhs)) return rhs
  const parameter = p.parameters.find((v) => v.id === rhs.parameter)
  if (!parameter) throw Error('Unknown parameter: ' + rhs.parameter)
  return parameter.value
}
export function parseFacts(raw: unknown, p: Pack): FactSet {
  const set = factSetSchema.parse(raw)
  if (set.pack !== p.id || set.version !== p.version) throw Error('Facts require the matching installed release.')
  unique(set.facts, (x) => x.id, 'case fact')
  for (const input of set.facts) {
    const f = p.facts.find((x) => x.id === input.id)
    if (!f || (input.value !== null && !accepts(f, input.value))) throw Error('Invalid case fact: ' + input.id)
  }
  unique(set.claims ?? [], (c) => c.rule, 'claim')
  for (const c of set.claims ?? [])
    if (!p.rules.find((r) => r.id === c.rule)?.exceptions?.some((x) => x.id === c.exception))
      throw Error('Unknown exception claimed: ' + c.rule + '#' + c.exception)
  return set
}
export const authoringSchema = () => z.toJSONSchema(packSchema)

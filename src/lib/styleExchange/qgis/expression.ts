/**
 * Rule filters as QGIS expressions and back. QGIS's rule-based renderer draws every rule a feature
 * matches, while PGMaps draws the first, so the writer gives each rule its own test AND NOT each
 * earlier test it could overlap (`coalesce(…, FALSE)` keeps a NULL attribute from failing the NOT).
 * The reader parses the subset of the expression language the writer uses and simple hand-written
 * filters (`"F" = 'v'`, `"F" IN (…)`, `"F" >= a AND "F" < b`, ORs of equalities), drops NOT terms
 * that repeat an earlier rule (first-match makes them redundant), and refuses anything else.
 * No DOM or network access.
 */
import type { FieldValue, RuleFilter, StyleRule } from '../model'

export const quoteField = (name: string) => `"${name.replace(/"/g, '""')}"`

export function literal(value: FieldValue): string {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  return `'${value.replace(/'/g, "''")}'`
}

/** One filter as an expression. */
export function filterExpression(filter: RuleFilter): string {
  const field = quoteField(filter.field)
  if (filter.op === 'eq') return `${field} = ${literal(filter.value)}`
  if (filter.op === 'in') return `${field} IN (${filter.values.map(literal).join(', ')})`
  const parts = [
    ...(filter.min !== undefined ? [`${field} >= ${literal(filter.min)}`] : []),
    ...(filter.max !== undefined ? [`${field} < ${literal(filter.max)}`] : []),
  ]
  return parts.length ? parts.join(' AND ') : `${field} IS NOT NULL`
}

const valuesOf = (filter: RuleFilter): FieldValue[] | null =>
  filter.op === 'eq' ? [filter.value] : filter.op === 'in' ? filter.values : null

const inRange = (value: FieldValue, range: { min?: number; max?: number }) =>
  typeof value === 'number' &&
  (range.min === undefined || value >= range.min) &&
  (range.max === undefined || value < range.max)

/** Whether no feature can match both filters: same field, and no shared value or overlapping range. */
export function filtersDisjoint(a: RuleFilter, b: RuleFilter): boolean {
  if (a.field !== b.field) return false
  const va = valuesOf(a),
    vb = valuesOf(b)
  if (va && vb) return !va.some((value) => vb.includes(value))
  if (a.op === 'range' && b.op === 'range') {
    const lowA = a.min ?? -Infinity,
      highA = a.max ?? Infinity,
      lowB = b.min ?? -Infinity,
      highB = b.max ?? Infinity
    return highA <= lowB || highB <= lowA
  }
  const values = va ?? vb!
  const range = (a.op === 'range' ? a : b) as { min?: number; max?: number }
  return values.every((value) => typeof value === 'number' && !inRange(value, range))
}

const wrap = (expression: string) => (/ AND | OR /.test(expression) ? `(${expression})` : expression)

/**
 * Mutually exclusive expressions for first-match rules: each rule's own test, AND NOT every earlier
 * test it could share a feature with. The filterless rule last becomes QGIS's `ELSE`.
 */
export function exclusiveExpressions(rules: readonly StyleRule[]): string[] {
  return rules.map((rule, index) => {
    if (!rule.filter) return 'ELSE'
    const own = filterExpression(rule.filter)
    const excluded = rules
      .slice(0, index)
      .map((earlier) => earlier.filter)
      .filter((earlier): earlier is RuleFilter => Boolean(earlier) && !filtersDisjoint(earlier!, rule.filter!))
      .map((earlier) => `NOT coalesce(${filterExpression(earlier)}, FALSE)`)
    return excluded.length ? [wrap(own), ...excluded].join(' AND ') : own
  })
}

// ---- Reading ---------------------------------------------------------------------------------

export type Expr =
  | { type: 'or' | 'and'; items: Expr[] }
  | { type: 'not'; item: Expr }
  | { type: 'cmp'; op: '=' | '<>' | '<' | '<=' | '>' | '>='; left: Expr; right: Expr }
  | { type: 'in'; left: Expr; values: Expr[]; negate: boolean }
  | { type: 'isnull'; left: Expr; negate: boolean }
  | { type: 'field'; name: string }
  | { type: 'lit'; value: FieldValue | null }
  | { type: 'call'; name: string; args: Expr[] }

type Token =
  | { kind: 'field' | 'string' | 'word'; text: string }
  | { kind: 'number'; value: number }
  | { kind: 'op'; text: string }

/** Longest expression the reader parses. */
const MAX_EXPRESSION_LENGTH = 20000

function tokenize(text: string): Token[] {
  if (text.length > MAX_EXPRESSION_LENGTH) throw Error('The expression is too long.')
  const tokens: Token[] = []
  let i = 0
  const quoted = (quote: string) => {
    let out = ''
    i++
    for (;;) {
      if (i >= text.length) throw Error(`An unclosed ${quote} in the expression.`)
      if (text[i] === quote) {
        if (text[i + 1] === quote) {
          out += quote
          i += 2
          continue
        }
        i++
        return out
      }
      if (text[i] === '\\' && i + 1 < text.length) {
        out += text[i + 1]
        i += 2
        continue
      }
      out += text[i++]
    }
  }
  while (i < text.length) {
    const c = text[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (c === '"') {
      tokens.push({ kind: 'field', text: quoted('"') })
      continue
    }
    if (c === "'") {
      tokens.push({ kind: 'string', text: quoted("'") })
      continue
    }
    const number = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(text.slice(i))
    const previous = tokens[tokens.length - 1]
    const signAllowed = !previous || previous.kind === 'op' || previous.kind === 'word'
    if (number && (c !== '-' || signAllowed)) {
      tokens.push({ kind: 'number', value: Number(number[0]) })
      i += number[0].length
      continue
    }
    const op = /^(>=|<=|<>|!=|=|<|>|\(|\)|,)/.exec(text.slice(i))
    if (op) {
      tokens.push({ kind: 'op', text: op[0] === '!=' ? '<>' : op[0] })
      i += op[0].length
      continue
    }
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i))
    if (word) {
      tokens.push({ kind: 'word', text: word[0] })
      i += word[0].length
      continue
    }
    throw Error(`"${c}" is not part of the expressions this reader understands.`)
  }
  return tokens
}

const KEYWORDS = new Set(['AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'TRUE', 'FALSE'])

/** Parses the expression subset; throws an Error naming what it could not read. */
export function parseQgisExpression(text: string): Expr {
  const tokens = tokenize(text)
  let at = 0
  const peek = () => tokens[at]
  const isWord = (word: string) => {
    const token = peek()
    return token?.kind === 'word' && token.text.toUpperCase() === word
  }
  const isOp = (op: string) => {
    const token = peek()
    return token?.kind === 'op' && token.text === op
  }
  const expectOp = (op: string) => {
    if (!isOp(op)) throw Error(`Expected "${op}" in the expression.`)
    at++
  }
  const or = (): Expr => {
    const items = [and()]
    while (isWord('OR')) {
      at++
      items.push(and())
    }
    return items.length === 1 ? items[0] : { type: 'or', items }
  }
  const and = (): Expr => {
    const items = [not()]
    while (isWord('AND')) {
      at++
      items.push(not())
    }
    return items.length === 1 ? items[0] : { type: 'and', items }
  }
  const not = (): Expr => {
    if (isWord('NOT')) {
      at++
      return { type: 'not', item: not() }
    }
    return comparison()
  }
  const list = (): Expr[] => {
    expectOp('(')
    const values: Expr[] = []
    if (!isOp(')'))
      for (;;) {
        values.push(or())
        if (!isOp(',')) break
        at++
      }
    expectOp(')')
    return values
  }
  const comparison = (): Expr => {
    const left = atom()
    const token = peek()
    if (token?.kind === 'op' && ['=', '<>', '<', '<=', '>', '>='].includes(token.text)) {
      at++
      return { type: 'cmp', op: token.text as '=', left, right: atom() }
    }
    if (isWord('IN')) {
      at++
      return { type: 'in', left, values: list(), negate: false }
    }
    if (
      isWord('NOT') &&
      tokens[at + 1]?.kind === 'word' &&
      (tokens[at + 1] as { text: string }).text.toUpperCase() === 'IN'
    ) {
      at += 2
      return { type: 'in', left, values: list(), negate: true }
    }
    if (isWord('IS')) {
      at++
      const negate = isWord('NOT')
      if (negate) at++
      if (!isWord('NULL')) throw Error('Only IS NULL and IS NOT NULL are read.')
      at++
      return { type: 'isnull', left, negate }
    }
    return left
  }
  const atom = (): Expr => {
    const token = peek()
    if (!token) throw Error('The expression ends early.')
    at++
    if (token.kind === 'field') return { type: 'field', name: token.text }
    if (token.kind === 'string') return { type: 'lit', value: token.text }
    if (token.kind === 'number') return { type: 'lit', value: token.value }
    if (token.kind === 'op') {
      if (token.text !== '(') throw Error(`Unexpected "${token.text}" in the expression.`)
      const inner = or()
      expectOp(')')
      return inner
    }
    const upper = token.text.toUpperCase()
    if (upper === 'TRUE' || upper === 'FALSE') return { type: 'lit', value: upper === 'TRUE' }
    if (upper === 'NULL') return { type: 'lit', value: null }
    if (KEYWORDS.has(upper)) throw Error(`Unexpected ${upper} in the expression.`)
    if (isOp('(')) return { type: 'call', name: token.text.toLowerCase(), args: list() }
    return { type: 'field', name: token.text }
  }
  const expression = or()
  if (at < tokens.length) throw Error('The expression has text this reader does not understand.')
  return expression
}

type Value = FieldValue | null

/** Evaluates the subset with QGIS's NULL logic: comparisons with NULL are NULL, NULL is falsy. */
export function evaluateQgisExpression(expression: Expr, properties: Record<string, unknown>): Value {
  const truth = (value: Value): boolean | null => (value === null ? null : Boolean(value))
  switch (expression.type) {
    case 'field': {
      const value = properties[expression.name]
      return value === undefined || value === null ? null : (value as FieldValue)
    }
    case 'lit':
      return expression.value
    case 'not': {
      const value = truth(evaluateQgisExpression(expression.item, properties))
      return value === null ? null : !value
    }
    case 'and': {
      let sawNull = false
      for (const item of expression.items) {
        const value = truth(evaluateQgisExpression(item, properties))
        if (value === false) return false
        if (value === null) sawNull = true
      }
      return sawNull ? null : true
    }
    case 'or': {
      let sawNull = false
      for (const item of expression.items) {
        const value = truth(evaluateQgisExpression(item, properties))
        if (value === true) return true
        if (value === null) sawNull = true
      }
      return sawNull ? null : false
    }
    case 'isnull': {
      const isNull = evaluateQgisExpression(expression.left, properties) === null
      return expression.negate ? !isNull : isNull
    }
    case 'in': {
      const value = evaluateQgisExpression(expression.left, properties)
      if (value === null) return null
      const found = expression.values.some((item) => evaluateQgisExpression(item, properties) === value)
      return expression.negate ? !found : found
    }
    case 'cmp': {
      const a = evaluateQgisExpression(expression.left, properties)
      const b = evaluateQgisExpression(expression.right, properties)
      if (a === null || b === null) return null
      switch (expression.op) {
        case '=':
          return a === b
        case '<>':
          return a !== b
        case '<':
          return a < b
        case '<=':
          return a <= b
        case '>':
          return a > b
        case '>=':
          return a >= b
      }
      return null
    }
    case 'call':
      if (expression.name === 'coalesce') {
        for (const arg of expression.args) {
          const value = evaluateQgisExpression(arg, properties)
          if (value !== null) return value
        }
        return null
      }
      throw Error(`${expression.name}() is not evaluated.`)
  }
}

/** Whether a QGIS rule expression matches a feature, as QGIS decides (NULL does not match). */
export const qgisRuleMatches = (expression: string, properties: Record<string, unknown>) =>
  evaluateQgisExpression(parseQgisExpression(expression), properties) === true

const sameFilter = (a: RuleFilter, b: RuleFilter) => JSON.stringify(a) === JSON.stringify(b)

const flatten = (expression: Expr, type: 'and' | 'or'): Expr[] =>
  expression.type === type ? expression.items.flatMap((item) => flatten(item, type)) : [expression]

type Bound = { op: '<' | '<=' | '>' | '>='; value: number }
type Reading = { filter: RuleFilter; warnings: string[] }

const literalValue = (expression: Expr): FieldValue | undefined =>
  expression.type === 'lit' && expression.value !== null ? expression.value : undefined

/** A comparison as field, operator and value, turning `5 < "F"` round to `"F" > 5`. */
function fieldComparison(expression: Expr): { field: string; op: string; value: FieldValue } | null {
  if (expression.type !== 'cmp') return null
  const flip: Record<string, string> = { '=': '=', '<>': '<>', '<': '>', '<=': '>=', '>': '<', '>=': '<=' }
  const left = expression.left,
    right = expression.right
  const leftValue = literalValue(left),
    rightValue = literalValue(right)
  if (left.type === 'field' && rightValue !== undefined)
    return { field: left.name, op: expression.op, value: rightValue }
  if (right.type === 'field' && leftValue !== undefined)
    return { field: right.name, op: flip[expression.op], value: leftValue }
  return null
}

/** One positive term (or several range bounds on one field) as a filter. */
function filterFromTerms(terms: Expr[]): Reading | null {
  const warnings: string[] = []
  if (terms.length === 1) {
    const term = terms[0]
    if (term.type === 'in' && !term.negate && term.left.type === 'field') {
      const values = term.values.map(literalValue)
      if (values.every((value): value is FieldValue => value !== undefined))
        return { filter: { field: term.left.name, op: 'in', values }, warnings }
      return null
    }
    if (term.type === 'isnull' && term.negate && term.left.type === 'field')
      return { filter: { field: term.left.name, op: 'range' }, warnings: ['IS NOT NULL was read as any number.'] }
    if (term.type === 'or') {
      const parts = flatten(term, 'or').map(fieldComparison)
      if (parts.every((part) => part && part.op === '=' && part.field === parts[0]!.field))
        return { filter: { field: parts[0]!.field, op: 'in', values: parts.map((part) => part!.value) }, warnings }
      return null
    }
    const comparison = fieldComparison(term)
    if (comparison?.op === '=')
      return { filter: { field: comparison.field, op: 'eq', value: comparison.value }, warnings }
  }
  const bounds: Bound[] = []
  let field: string | null = null
  for (const term of terms) {
    const comparison = fieldComparison(term)
    if (!comparison || !['<', '<=', '>', '>='].includes(comparison.op) || typeof comparison.value !== 'number')
      return null
    if (field !== null && comparison.field !== field) return null
    field = comparison.field
    bounds.push({ op: comparison.op as Bound['op'], value: comparison.value })
  }
  if (field === null) return null
  let min: number | undefined, max: number | undefined
  for (const bound of bounds) {
    if (bound.op === '>' || bound.op === '>=') {
      if (bound.op === '>')
        warnings.push(`"> ${bound.value}" was read as ">= ${bound.value}": PGMaps classes include their lower bound.`)
      min = min === undefined ? bound.value : Math.max(min, bound.value)
    } else {
      if (bound.op === '<=')
        warnings.push(`"<= ${bound.value}" was read as "< ${bound.value}": PGMaps classes exclude their upper bound.`)
      max = max === undefined ? bound.value : Math.min(max, bound.value)
    }
  }
  return {
    filter: { field, op: 'range', ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) },
    warnings,
  }
}

export interface ExpressionReading {
  filter?: RuleFilter
  /** Earlier filters this expression excludes with NOT terms, which first-match makes redundant. */
  excludes: RuleFilter[]
  warnings: string[]
  error?: string
}

/**
 * A rule expression as a filter. NOT terms are accepted only when they repeat a filter in `earlier`,
 * which first-match rules already exclude.
 */
export function filterFromExpression(text: string, earlier: readonly RuleFilter[]): ExpressionReading {
  let expression: Expr
  try {
    expression = parseQgisExpression(text)
  } catch (error) {
    return { excludes: [], warnings: [], error: error instanceof Error ? error.message : String(error) }
  }
  const positive: Expr[] = []
  const excludes: RuleFilter[] = []
  for (const term of flatten(expression, 'and')) {
    if (term.type !== 'not') {
      positive.push(term)
      continue
    }
    let inner = term.item
    if (inner.type === 'call' && inner.name === 'coalesce' && inner.args.length === 2) {
      const fallback = inner.args[1]
      if (fallback.type === 'lit' && fallback.value === false) inner = inner.args[0]
    }
    const reading = filterFromTerms(flatten(inner, 'and'))
    const match = reading && earlier.find((filter) => sameFilter(filter, reading.filter))
    if (!match)
      return {
        excludes,
        warnings: [],
        error: `NOT (${text.length > 80 ? 'part of the expression' : text}) does not repeat an earlier rule.`,
      }
    excludes.push(match)
  }
  if (!positive.length) return { excludes, warnings: [], error: 'The expression has no test of its own.' }
  const reading = filterFromTerms(positive)
  if (!reading)
    return { excludes, warnings: [], error: 'Only "FIELD" = value, IN (…), ranges and ORs of equalities are read.' }
  return { filter: reading.filter, excludes, warnings: reading.warnings }
}

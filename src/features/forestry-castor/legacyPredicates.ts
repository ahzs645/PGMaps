// SPDX-License-Identifier: Apache-2.0
import type { CastorPredicate } from './types'

/** Explicit translation of Castor column names; no SQL or JavaScript is executed. */
export const CASTOR_COLUMN_FIELDS: Record<string, string> = {
  pixelid: 'id',
  blockid: 'blockId',
  compartid: 'compartment',
  own: 'owned',
  age: 'age',
  vol: 'volume',
  tvol: 'volume',
  thlb: 'thlbHa',
  height: 'height',
  eca: 'eca',
  dist: 'distance',
  elv: 'elevation',
  salvage_vol: 'salvageVolume',
  yieldid: 'curveId',
  yieldid_trans: 'managedCurveId',
  crownclosure: 'crownClosure',
  crown_closure: 'crownClosure',
  basalarea: 'basalArea',
  dec_pcnt: 'deciduousPercent',
  qmd: 'qmd',
  culvar: 'culminationVolume',
}

type Token = { type: 'word' | 'number' | 'string' | 'operator' | 'punctuation'; value: string }
function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let position = 0
  while (position < source.length) {
    const rest = source.slice(position)
    const match =
      /^(\s+|'(?:[^']|'')*'|"(?:[^"]|"")*"|[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|>=|<=|!=|<>|==|[=<>]|[(),&|]|[A-Za-z_][A-Za-z_0-9.]*)/.exec(
        rest,
      )
    if (!match)
      throw new Error(
        `Unsupported Castor predicate near ${JSON.stringify(rest.slice(0, 40))}. Use structured conditions in project JSON for other expressions.`,
      )
    position += match[0].length
    const text = match[0]
    if (/^\s/.test(text)) continue
    if (text.startsWith("'")) tokens.push({ type: 'string', value: text.slice(1, -1).replace(/''/g, "'") })
    else if (text.startsWith('"')) tokens.push({ type: 'word', value: text.slice(1, -1).replace(/""/g, '"') })
    else if (/^[+\-\d.]/.test(text)) tokens.push({ type: 'number', value: text })
    else if (/^[=<>!]/.test(text)) tokens.push({ type: 'operator', value: text })
    else if (/^[(),&|]$/.test(text)) tokens.push({ type: 'punctuation', value: text })
    else tokens.push({ type: 'word', value: text })
    if (tokens.length > 512) throw new Error('Castor predicate exceeds 512 tokens.')
  }
  return tokens
}

/** Supports comparisons, AND/OR/NOT, IN and BETWEEN. Rejects calls and subqueries. */
export function parseLegacyPredicate(input: unknown, denominatorFragment = false): CastorPredicate | undefined {
  if (input === null || input === undefined || input === '' || input === 'NA') return undefined
  if (typeof input !== 'string') throw new Error('A legacy Castor predicate must be text.')
  let source = input.trim()
  if (denominatorFragment) source = source.replace(/\s+AND\s*$/i, '').trim()
  if (!source) return undefined
  if (source.length > 8192) throw new Error('Castor predicate exceeds 8 KB.')
  const tokens = tokenize(source)
  let position = 0
  let depth = 0
  const peek = (value: string) => tokens[position]?.value.toUpperCase() === value
  const take = () => {
    const token = tokens[position++]
    if (!token) throw new Error('Incomplete Castor predicate.')
    return token
  }
  const expect = (value: string) => {
    if (!peek(value)) throw new Error(`Expected ${value} in Castor predicate.`)
    position++
  }
  function literal(field: string): number | string | boolean {
    const token = take()
    let value: number | string | boolean
    if (token.type === 'number') {
      value = Number(token.value)
      if (!Number.isFinite(value)) throw new Error('Predicate numbers must be finite.')
    } else if (token.type === 'string') value = token.value
    else if (token.value.toUpperCase() === 'TRUE') value = true
    else if (token.value.toUpperCase() === 'FALSE') value = false
    else throw new Error(`Expected a literal value in Castor predicate; found ${token.value}.`)
    if (['curveId', 'managedCurveId', 'blockId', 'compartment'].includes(field)) return String(value)
    if (field === 'owned' && (value === 0 || value === 1)) return value === 1
    return value
  }
  function comparison(): CastorPredicate {
    const left = take()
    // Constant true/false clauses occur in default SQL partitions.
    if (left.type === 'number') {
      expect('=')
      const right = take()
      if (right.type !== 'number' || !Number.isFinite(Number(left.value)) || !Number.isFinite(Number(right.value)))
        throw new Error('Constant predicates require two finite numbers.')
      return { field: 'id', op: Number(left.value) === Number(right.value) ? 'ge' : 'lt', value: 0 }
    }
    if (left.type !== 'word') throw new Error('Expected a field name in Castor predicate.')
    const legacy = left.value.replace(/^p\./i, '')
    const lower = legacy.toLowerCase()
    const knownLegacy = Object.prototype.hasOwnProperty.call(CASTOR_COLUMN_FIELDS, lower)
    const canonicalLegacy = knownLegacy ? lower : legacy
    let field = knownLegacy ? CASTOR_COLUMN_FIELDS[lower] : legacy
    // Numeric legacy IDs remain numeric in extra attributes for ordered SQL comparisons.
    if (
      ['blockId', 'curveId', 'managedCurveId', 'compartment'].includes(field) &&
      (peek('>') || peek('>=') || peek('<') || peek('<=') || peek('BETWEEN'))
    )
      field = canonicalLegacy
    if (peek('BETWEEN')) {
      position++
      const low = literal(field)
      expect('AND')
      return {
        all: [
          { field, op: 'ge', value: low },
          { field, op: 'le', value: literal(field) },
        ],
      }
    }
    let inverted = false
    if (peek('NOT')) {
      position++
      inverted = true
    }
    if (peek('IN')) {
      position++
      expect('(')
      const any: CastorPredicate[] = [{ field, op: 'eq', value: literal(field) }]
      while (peek(',')) {
        position++
        any.push({ field, op: 'eq', value: literal(field) })
      }
      expect(')')
      return inverted ? { not: { any } } : { any }
    }
    if (inverted) throw new Error('NOT after a field is supported only with IN.')
    const operator = take().value
    const op = (
      { '=': 'eq', '==': 'eq', '!=': 'ne', '<>': 'ne', '>': 'gt', '>=': 'ge', '<': 'lt', '<=': 'le' } as const
    )[operator as '=']
    if (!op) throw new Error(`Unsupported Castor comparison ${operator}.`)
    return { field, op, value: literal(field) }
  }
  function term(): CastorPredicate {
    if (++depth > 20) throw new Error('Castor predicate nesting exceeds 20 levels.')
    let result: CastorPredicate
    if (peek('NOT')) {
      position++
      result = { not: term() }
    } else if (peek('(')) {
      position++
      result = expression()
      expect(')')
    } else result = comparison()
    depth--
    return result
  }
  function conjunction(): CastorPredicate {
    const all = [term()]
    while (peek('AND') || peek('&')) {
      position++
      all.push(term())
    }
    return all.length === 1 ? all[0] : { all }
  }
  function expression(): CastorPredicate {
    const any = [conjunction()]
    while (peek('OR') || peek('|')) {
      position++
      any.push(conjunction())
    }
    return any.length === 1 ? any[0] : { any }
  }
  const result = expression()
  if (position !== tokens.length) throw new Error(`Unexpected ${tokens[position].value} in Castor predicate.`)
  return result
}

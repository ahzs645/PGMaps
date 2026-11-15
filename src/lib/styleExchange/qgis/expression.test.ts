import { describe, expect, it } from 'vitest'
import type { RuleFilter } from '../model'
import {
  exclusiveExpressions,
  filterExpression,
  filterFromExpression,
  filtersDisjoint,
  qgisRuleMatches,
} from './expression'

const eq = (field: string, value: string | number): RuleFilter => ({ field, op: 'eq', value })

describe('QGIS expressions', () => {
  it('writes each filter kind', () => {
    expect(filterExpression(eq('NAME', "Spur B's"))).toBe(`"NAME" = 'Spur B''s'`)
    expect(filterExpression({ field: 'A"B', op: 'in', values: [1, 'x'] })).toBe(`"A""B" IN (1, 'x')`)
    expect(filterExpression({ field: 'G', op: 'range', min: 4, max: 8 })).toBe('"G" >= 4 AND "G" < 8')
    expect(filterExpression({ field: 'G', op: 'range', max: 8 })).toBe('"G" < 8')
  })

  it('reads simple hand-written filters', () => {
    expect(filterFromExpression(`"KEY" = 'a'`, []).filter).toEqual(eq('KEY', 'a'))
    expect(filterFromExpression(`KEY = 5`, []).filter).toEqual(eq('KEY', 5))
    expect(filterFromExpression(`"KEY" IN ('a', 'b')`, []).filter).toEqual({
      field: 'KEY',
      op: 'in',
      values: ['a', 'b'],
    })
    expect(filterFromExpression(`"KEY" = 'a' OR "KEY" = 'b'`, []).filter).toEqual({
      field: 'KEY',
      op: 'in',
      values: ['a', 'b'],
    })
    expect(filterFromExpression(`"G" >= 2 AND "G" < 3.5`, []).filter).toEqual({
      field: 'G',
      op: 'range',
      min: 2,
      max: 3.5,
    })
    expect(filterFromExpression(`10 <= "G"`, []).filter).toEqual({ field: 'G', op: 'range', min: 10 })
  })

  it('warns where a bound moves and refuses what it cannot read', () => {
    const reading = filterFromExpression(`"G" > 2 AND "G" <= 3`, [])
    expect(reading.filter).toEqual({ field: 'G', op: 'range', min: 2, max: 3 })
    expect(reading.warnings).toHaveLength(2)
    expect(filterFromExpression(`upper("KEY") = 'A'`, []).error).toBeTruthy()
    expect(filterFromExpression(`"A" = 1 OR "B" = 2`, []).error).toBeTruthy()
    expect(filterFromExpression(`"KEY" LIKE 'a%'`, []).error).toBeTruthy()
    expect(filterFromExpression(`"KEY" = 'a' AND NOT "KEY" = 'b'`, []).error).toMatch(/earlier rule/)
  })

  it('drops NOT terms that repeat an earlier rule', () => {
    const earlier = [eq('NAME', 'Main')]
    const reading = filterFromExpression(`"G" >= 12 AND NOT coalesce("NAME" = 'Main', FALSE)`, earlier)
    expect(reading.filter).toEqual({ field: 'G', op: 'range', min: 12 })
    expect(reading.excludes).toEqual([earlier[0]])
  })

  it('leaves out NOT terms where the filters cannot share a feature', () => {
    expect(filtersDisjoint(eq('K', 'a'), eq('K', 'b'))).toBe(true)
    expect(filtersDisjoint({ field: 'G', op: 'range', max: 5 }, { field: 'G', op: 'range', min: 5 })).toBe(true)
    expect(filtersDisjoint(eq('K', 'a'), eq('L', 'b'))).toBe(false)
    const expressions = exclusiveExpressions([
      { label: 'a', filter: eq('K', 'a'), symbol: { kind: 'class', label: 'a', color: '#000', opacity: 1 } },
      { label: 'b', filter: eq('K', 'b'), symbol: { kind: 'class', label: 'b', color: '#000', opacity: 1 } },
      { label: 'else', filter: null, symbol: { kind: 'class', label: 'e', color: '#000', opacity: 1 } },
    ])
    expect(expressions).toEqual([`"K" = 'a'`, `"K" = 'b'`, 'ELSE'])
  })

  it('evaluates NULL as QGIS does', () => {
    expect(qgisRuleMatches(`"A" = 1`, { A: null })).toBe(false)
    expect(qgisRuleMatches(`NOT ("A" = 1)`, { A: null })).toBe(false)
    expect(qgisRuleMatches(`NOT coalesce("A" = 1, FALSE)`, { A: null })).toBe(true)
  })
})

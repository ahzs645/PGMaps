import { geographicArea } from './workspace'
import { parsePortalSearch } from '@/lib/nechakoPortal'

export type SearchClause =
  | { kind: 'term'; text: string }
  | {
      kind: 'field'
      field: string
      operator: '=' | '!=' | '~' | '>' | '>=' | '<' | '<='
      value: string
      valueType: 'text' | 'number' | 'boolean'
      /** A captured field can be scoped to its supplied form using the existing Form ID column. */
      scopeFormId?: string
    }
  | { kind: 'group'; operator: 'AND' | 'OR'; clauses: SearchClause[] }
export type SearchFieldOption = {
  id: string
  field: string
  label: string
  valueType: 'text' | 'number' | 'boolean'
  scopeFormId?: string
}
export type SearchFieldGroup = { id: string; label: string; fields: SearchFieldOption[] }
export type SavedSearch = {
  id: string
  name: string
  expression: string
  contexts: string[]
  area: { mode: 'none' | 'extent' | 'polygon'; bounds: [number, number, number, number]; vectorId: string }
}
export const QUERY_STORAGE_KEY = 'pgmaps-nechako-searches-v1'
const quote = (value: string) => {
  if (!value.trim() || /["\r\n]/.test(value))
    throw new Error('Enter nonempty text without double quotes or line breaks.')
  return `"${value}"`
}
export function compileSearchClause(clause: SearchClause, depth = 0): string {
  if (depth > 8) throw new Error('Use at most eight nested expression groups.')
  if (clause.kind === 'term') return quote(clause.text)
  if (clause.kind === 'field') {
    if (!clause.field.trim() || /[{}\r\n]/.test(clause.field))
      throw new Error('Enter a field name without braces or line breaks.')
    if (!['=', '!=', '~', '>', '>=', '<', '<='].includes(clause.operator))
      throw new Error('Invalid comparison operator.')
    const value =
      clause.valueType === 'text'
        ? quote(clause.value)
        : clause.valueType === 'boolean' && /^(true|false)$/.test(clause.value)
          ? clause.value
          : clause.valueType === 'number' && /^\d+(?:\.\d+)?$/.test(clause.value)
            ? clause.value
            : (() => {
                throw new Error('Enter a valid nonnegative number or true/false value.')
              })()
    const comparison = `{${clause.field}} ${clause.operator} ${value}`
    if (clause.scopeFormId !== undefined) {
      if (!/^[1-9]\d*$/.test(clause.scopeFormId) || !Number.isSafeInteger(Number(clause.scopeFormId)))
        throw new Error('Choose a valid captured form ID.')
      return `({Form ID} = ${clause.scopeFormId} AND ${comparison})`
    }
    return comparison
  }
  if (!clause.clauses.length || clause.clauses.length > 50 || !['AND', 'OR'].includes(clause.operator))
    throw new Error('A group needs between one and 50 rules.')
  return `(${clause.clauses.map((child) => compileSearchClause(child, depth + 1)).join(` ${clause.operator} `)})`
}
export function checkedSavedSearches(value: unknown): SavedSearch[] {
  if (!Array.isArray(value) || value.length > 50)
    throw new Error('A saved-query collection must contain at most 50 queries.')
  const ids = new Set<string>()
  return value.map((raw) => {
    const item = raw as SavedSearch
    if (
      !item ||
      typeof item.id !== 'string' ||
      !item.id ||
      ids.has(item.id) ||
      typeof item.name !== 'string' ||
      !item.name.trim() ||
      item.name.length > 160 ||
      typeof item.expression !== 'string' ||
      item.expression.length > 5000 ||
      !Array.isArray(item.contexts) ||
      item.contexts.length > 50 ||
      item.contexts.some((c) => typeof c !== 'string' || c.length > 160)
    )
      throw new Error('Invalid saved query.')
    parsePortalSearch(item.expression)
    if (
      !item.area ||
      !['none', 'extent', 'polygon'].includes(item.area.mode) ||
      typeof item.area.vectorId !== 'string' ||
      !Array.isArray(item.area.bounds) ||
      item.area.bounds.length !== 4
    )
      throw new Error('Invalid saved geographic filter.')
    geographicArea(item.area.bounds)
    ids.add(item.id)
    return {
      id: item.id,
      name: item.name,
      expression: item.expression,
      contexts: [...item.contexts],
      area: { ...item.area, bounds: [...item.area.bounds] },
    }
  })
}
export function filterLocalSearch<T extends { title: string; searchText: string }>(rows: T[], query: string): T[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return rows.filter((row) =>
    terms.every((term) => `${row.title} ${row.searchText}`.toLocaleLowerCase().includes(term)),
  )
}

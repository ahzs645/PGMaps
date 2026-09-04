import { fetchJson } from '@/lib/fetchJson'
import type { BoundarySource, RegionLevel } from './types'

export interface BoundarySearchRecord {
  id: string
  source: BoundarySource
  sourceLabel: string
  group: string
  level: RegionLevel
  levelLabel: string
  code: string
  name: string
  bounds: [number, number, number, number]
  fields: Array<[string, string]>
  searchText: string
}

interface BoundarySearchCatalog {
  version: 1
  records: BoundarySearchRecord[]
}

interface BoundarySearchManifest {
  version: 1
  catalog: {
    file: string
    revision: string
  }
}

export interface BoundarySearchFilters {
  group?: string
  source?: BoundarySource
  level?: RegionLevel
  match?: BoundarySearchMatchMode
}

export type BoundarySearchMatchMode = 'contains' | 'startsWith' | 'exact'

export interface BoundarySearchMatch {
  record: BoundarySearchRecord
  matchedField: [string, string] | null
}

export function normalizeBoundarySearchText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function searchableValues(record: BoundarySearchRecord) {
  return [record.name, record.code, ...record.fields.map(([, value]) => value)]
    .map(normalizeBoundarySearchText)
    .filter(Boolean)
}

function valueMatches(value: string, normalizedQuery: string, mode: BoundarySearchMatchMode) {
  if (mode === 'exact') return value === normalizedQuery
  if (mode === 'startsWith') return value.startsWith(normalizedQuery)
  return value.includes(normalizedQuery)
}

function matchedField(
  record: BoundarySearchRecord,
  normalizedQuery: string,
  tokens: string[],
  mode: BoundarySearchMatchMode,
) {
  if (mode !== 'contains') {
    return (
      record.fields.find(([, value]) => valueMatches(normalizeBoundarySearchText(value), normalizedQuery, mode)) ?? null
    )
  }
  const direct = record.fields.find(([key, value]) =>
    normalizeBoundarySearchText(`${key} ${value}`).includes(normalizedQuery),
  )
  if (direct) return direct
  return (
    record.fields.find(([key, value]) => {
      const fieldText = normalizeBoundarySearchText(`${key} ${value}`)
      return tokens.every((token) => fieldText.includes(token))
    }) ?? null
  )
}

function recordScore(record: BoundarySearchRecord, normalizedQuery: string) {
  const name = normalizeBoundarySearchText(record.name)
  const code = normalizeBoundarySearchText(record.code)
  if (code === normalizedQuery) return 0
  if (name === normalizedQuery) return 1
  if (name.startsWith(normalizedQuery)) return 2
  if (name.split(' ').some((word) => word.startsWith(normalizedQuery))) return 3
  if (code.startsWith(normalizedQuery)) return 4
  return 5
}

export function searchBoundaryCatalog(
  records: BoundarySearchRecord[],
  query: string,
  filters: BoundarySearchFilters = {},
  limit = 80,
): BoundarySearchMatch[] {
  const normalizedQuery = normalizeBoundarySearchText(query)
  const tokens = normalizedQuery.split(' ').filter(Boolean)
  if (tokens.length === 0) return []
  const matchMode = filters.match ?? 'contains'

  return records
    .filter(
      (record) =>
        (!filters.group || record.group === filters.group) &&
        (!filters.source || record.source === filters.source) &&
        (!filters.level || record.level === filters.level) &&
        (matchMode === 'contains'
          ? tokens.every((token) => record.searchText.includes(token))
          : searchableValues(record).some((value) => valueMatches(value, normalizedQuery, matchMode))),
    )
    .map((record) => ({
      record,
      matchedField: matchedField(record, normalizedQuery, tokens, matchMode),
      score: recordScore(record, normalizedQuery),
    }))
    .sort(
      (a, b) =>
        a.score - b.score || a.record.name.localeCompare(b.record.name) || a.record.code.localeCompare(b.record.code),
    )
    .slice(0, limit)
    .map(({ record, matchedField }) => ({ record, matchedField }))
}

export async function loadBoundarySearchCatalog(signal?: AbortSignal): Promise<BoundarySearchRecord[]> {
  const manifest = await fetchJson<BoundarySearchManifest>('/data/boundary-search/manifest.json', signal)
  if (manifest.version !== 1) throw new Error(`Unsupported boundary search manifest version: ${manifest.version}`)
  const separator = manifest.catalog.file.includes('?') ? '&' : '?'
  const catalog = await fetchJson<BoundarySearchCatalog>(
    `/data/boundary-search/${manifest.catalog.file}${separator}v=${encodeURIComponent(manifest.catalog.revision)}`,
    signal,
  )
  if (catalog.version !== 1 || !Array.isArray(catalog.records)) {
    throw new Error('Boundary search catalog is invalid')
  }
  return catalog.records
}

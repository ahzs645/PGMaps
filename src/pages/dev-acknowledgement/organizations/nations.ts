// Normalization layer for the free-text Nation names used in the org database.
// The org JSON keeps the names each organization actually writes; this resolver
// maps each to a canonical identity in our relationship graph (a Nation or a
// people-group) where one exists, so we can measure coverage and dedupe.

import { buildNationAliasIndex, normalizeName } from '@/lib/acknowledgement/engine'
import type { RelationshipGraph } from '@/lib/acknowledgement/engine'

// Free-text names that DO correspond to a graph Nation but the graph's own
// alias index misses (the graph stores them under a different preferred name).
// Add an entry here when a new org names one of these forms. Key = normalizeName(name).
const NATION_ALIASES: Record<string, string> = {
  squamish: 'squamish',
  'tsleil waututh': 'tsleil-waututh',
  syilx: 'syilx-okanagan-nation',
}

export type NationStatus = 'nation' | 'people-group' | 'unlisted'

export type NationResolution = {
  /** The free-text name as written by the org. */
  input: string
  /** Canonical name (graph preferred name when linked, else the input). */
  canonical: string
  /** Whether it maps to a Nation, a people-group, or nothing in our database. */
  status: NationStatus
  /** Graph id (nation or people-group) when linked. */
  id?: string
}

/**
 * Build a resolver that canonicalizes free-text Nation names against the graph.
 * Memoize on `graph` in the caller — it indexes the graph once.
 */
export function createNationResolver(graph: RelationshipGraph | null) {
  const nationIndex = graph ? buildNationAliasIndex(graph) : new Map<string, string>()
  const nationName = new Map<string, string>()
  const peopleGroupIndex = new Map<string, { id: string; name: string }>()

  if (graph) {
    for (const nation of graph.nations) nationName.set(nation.id, nation.preferredName)
    for (const group of graph.peopleGroups) {
      const display = group.displayName || group.preferredName
      const add = (value?: string) => {
        if (!value) return
        const key = normalizeName(value)
        if (key && !peopleGroupIndex.has(key)) peopleGroupIndex.set(key, { id: group.id, name: display })
      }
      add(group.preferredName)
      add(group.displayName)
      group.alternateNames?.forEach(add)
    }
  }

  return function canonicalize(name: string): NationResolution {
    const key = normalizeName(name)
    const nationId = nationIndex.get(key) ?? NATION_ALIASES[key]
    if (nationId) return { input: name, canonical: nationName.get(nationId) ?? name, status: 'nation', id: nationId }
    const group = peopleGroupIndex.get(key)
    if (group) return { input: name, canonical: group.name, status: 'people-group', id: group.id }
    return { input: name, canonical: name, status: 'unlisted' }
  }
}

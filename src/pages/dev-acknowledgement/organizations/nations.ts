// Normalization layer for the free-text Nation names used in the org database.
// The org JSON keeps the names each organization actually writes; this resolver
// maps each to a canonical identity. It references TWO sources:
//   1. the relationship graph (verified Nations + people-groups), and
//   2. `nationRegistry` below — an in-repo list we maintain ourselves, including
//      Nations that are NOT in the relationship graph. So coverage does not depend
//      on editing the submodule graph — add an entry here instead.

import { buildNationAliasIndex, normalizeName } from '@/lib/acknowledgement/engine'
import type { RelationshipGraph } from '@/lib/acknowledgement/engine'

export type NationStatus = 'nation' | 'people-group' | 'unlisted'

export type NationRegistryEntry = {
  /** Canonical display name. */
  canonical: string
  kind: 'nation' | 'people-group'
  /** Other free-text forms that should resolve to this entry. */
  aliases?: string[]
  /** Set when this Nation is also in the relationship graph (links the two). */
  graphNationId?: string
}

export type NationResolution = {
  input: string
  canonical: string
  status: NationStatus
  /** Graph id when linked to the relationship graph. */
  id?: string
  /** True when backed by the verified relationship graph (vs. registry-only). */
  inGraph: boolean
}

// In-repo canonical Nation registry. Add a record here to map an org's free text
// to a Nation we recognize, whether or not it exists in the relationship graph.
export const nationRegistry: NationRegistryEntry[] = [
  // Alias gaps — Nations that ARE in the graph, under a different preferred name.
  { canonical: 'Skwxwú7mesh (Squamish)', kind: 'nation', graphNationId: 'squamish', aliases: ['Squamish', 'Squamish Nation'] },
  { canonical: 'səl̓ilwətaɁɬ (Tsleil-Waututh)', kind: 'nation', graphNationId: 'tsleil-waututh', aliases: ['Tsleil-Waututh', 'Tsleil-Waututh Nation'] },
  { canonical: 'Syilx Okanagan Nation', kind: 'nation', graphNationId: 'syilx-okanagan-nation', aliases: ['Syilx'] },

  // Nations not in the relationship graph yet (registry-backed).
  { canonical: 'Snuneymuxw First Nation', kind: 'nation', aliases: ['Snuneymuxw'] },
  { canonical: 'Katzie First Nation', kind: 'nation', aliases: ['Katzie'] },
  { canonical: 'Kwantlen First Nation', kind: 'nation', aliases: ['Kwantlen'] },
  { canonical: 'Semiahmoo First Nation', kind: 'nation', aliases: ['Semiahmoo'] },
  { canonical: 'Qayqayt First Nation', kind: 'nation', aliases: ['Qayqayt'] },
  { canonical: 'Tsawwassen First Nation', kind: 'nation', aliases: ['Tsawwassen'] },
  { canonical: 'Kwikwetlem First Nation', kind: 'nation', aliases: ['Kwikwetlem'] },
  { canonical: 'Lil’wat Nation', kind: 'nation', aliases: ['Lil’wat'] },
  { canonical: 'Qualicum First Nation', kind: 'nation', aliases: ['Qualicum'] },
  { canonical: 'Snaw-naw-as', kind: 'nation' },
  { canonical: 'Tla’amin Nation', kind: 'nation', aliases: ['Tla’amin'] },
  { canonical: 'Matsqui First Nation', kind: 'nation', aliases: ['Matsqui'] },
  { canonical: 'Tk’emlúps te Secwépemc', kind: 'nation' },
  { canonical: 'Quw’utsun', kind: 'nation' },
  { canonical: 'Wet’suwet’en', kind: 'nation' },
  { canonical: 'Gitxsan', kind: 'nation' },
  { canonical: 'Haida Nation', kind: 'nation', aliases: ['Haida'] },
  { canonical: 'Haisla Nation', kind: 'nation', aliases: ['Haisla'] },
  { canonical: 'Tahltan Nation', kind: 'nation', aliases: ['Tahltan'] },
  { canonical: 'Saulteau First Nations', kind: 'nation', aliases: ['Saulteau'] },
  { canonical: 'Sinixt', kind: 'nation', aliases: ['Sinixt (Lakes)'] },
  { canonical: 'Tse’Khene', kind: 'nation', aliases: ['Tsek’ehne', 'Tse’khene'] },
  { canonical: 'T’exelc', kind: 'nation' },

  // People-groups not in the relationship graph yet (registry-backed).
  { canonical: 'Nuu-chah-nulth', kind: 'people-group' },
  { canonical: 'Kwakwaka’wakw', kind: 'people-group' },
  { canonical: 'Secwépemc', kind: 'people-group' },
  { canonical: 'Nlaka’pamux', kind: 'people-group' },
  { canonical: 'Ktunaxa', kind: 'people-group' },
  { canonical: 'St’át’imc', kind: 'people-group' },
  { canonical: 'Dakelh (Carrier) Peoples', kind: 'people-group', aliases: ['Dãkelh Dené'] },
  { canonical: 'Cree', kind: 'people-group' },
  { canonical: 'Kaska Dena', kind: 'people-group', aliases: ['Kaska'] },
  { canonical: 'Métis', kind: 'people-group' },
  { canonical: 'Tlingit', kind: 'people-group' },
]

/**
 * Build a resolver that canonicalizes free-text Nation names against the graph
 * and the in-repo registry. Memoize on `graph` in the caller.
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

  const registryIndex = new Map<string, NationRegistryEntry>()
  for (const entry of nationRegistry) {
    const add = (value: string) => {
      const key = normalizeName(value)
      if (key && !registryIndex.has(key)) registryIndex.set(key, entry)
    }
    add(entry.canonical)
    entry.aliases?.forEach(add)
  }

  return function canonicalize(name: string): NationResolution {
    const key = normalizeName(name)

    const nationId = nationIndex.get(key)
    if (nationId) return { input: name, canonical: nationName.get(nationId) ?? name, status: 'nation', id: nationId, inGraph: true }

    const group = peopleGroupIndex.get(key)
    if (group) return { input: name, canonical: group.name, status: 'people-group', id: group.id, inGraph: true }

    const entry = registryIndex.get(key)
    if (entry) {
      const canonical = entry.graphNationId ? (nationName.get(entry.graphNationId) ?? entry.canonical) : entry.canonical
      return { input: name, canonical, status: entry.kind, id: entry.graphNationId, inGraph: Boolean(entry.graphNationId) }
    }

    return { input: name, canonical: name, status: 'unlisted', inGraph: false }
  }
}

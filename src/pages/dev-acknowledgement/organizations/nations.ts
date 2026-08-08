// Normalization layer for the free-text Nation names used in the org database.
// The org JSON keeps the names each organization actually writes; this resolver
// maps each to a canonical identity. It references THREE sources:
//   1. the relationship graph (verified Nations + people-groups),
//   2. the bcdatamapper Nation registry (incl. Nations not in the graph), and
//   3. (optional) the BC First Nation Community Locations GIS dataset, used to
//      VALIDATE a Nation and enrich it with coordinates / website / language.

import { buildNationAliasIndex, normalizeName } from '@/lib/acknowledgement/engine'
import type { RelationshipGraph } from '@/lib/acknowledgement/engine'
import nationRegistryData from '../../../../vendor/bcdatamapper/datascrapers/manual/output/acknowledgement/nation-registry.json'

export type NationStatus = 'nation' | 'people-group' | 'unlisted'

export type NationRegistryEntry = {
  canonical: string
  kind: 'nation' | 'people-group'
  aliases?: string[]
  graphNationId?: string
}

/** Authoritative GIS record for a Nation (from BC First Nation Community Locations). */
export type NationGisEntry = {
  name: string
  coordinates?: [number, number]
  website?: string
  languageGroup?: string
}

export type NationResolution = {
  input: string
  canonical: string
  status: NationStatus
  id?: string
  /** Backed by the verified relationship graph (vs. registry-only). */
  inGraph: boolean
  /** Authoritative GIS match (coordinates, website, language) when found. */
  gis?: NationGisEntry
}

// Canonical Nation registry owned by the bcdatamapper submodule.
export const nationRegistry = nationRegistryData as NationRegistryEntry[]

function nameMatches(a: string, b: string) {
  if (!a || !b) return false
  if (a === b) return true
  if (a.includes(b) && b.length >= 4) return true
  if (b.includes(a) && a.length >= 4) return true
  return false
}

const GIS_NAME_FIELDS = [
  'PREFERRED_NAME',
  'FIRST_NATION_BC_NAME',
  'FIRST_NATION_FEDERAL_NAME',
  'ALTERNATIVE_NAME_1',
  'ALTERNATIVE_NAME_2',
]

/** Index the BC First Nation Community Locations features by normalized name. */
export function buildGisNationIndex(features: GeoJSON.Feature[]) {
  const index = new Map<string, NationGisEntry>()
  for (const feature of features) {
    const props = (feature.properties ?? {}) as Record<string, unknown>
    const name = String(
      props.FIRST_NATION_BC_NAME || props.PREFERRED_NAME || props.FIRST_NATION_FEDERAL_NAME || '',
    ).trim()
    if (!name) continue
    const coordinates =
      feature.geometry?.type === 'Point' ? (feature.geometry.coordinates as [number, number]) : undefined
    const website = String(props.URL_TO_FIRST_NATION_WEBSITE || props.URL_TO_BC_WEBSITE || '').trim() || undefined
    const languageGroup = String(props.LANGUAGE_GROUP || '').trim() || undefined
    const entry: NationGisEntry = { name, coordinates, website, languageGroup }
    for (const field of GIS_NAME_FIELDS) {
      const value = props[field]
      if (!value) continue
      const key = normalizeName(String(value))
      if (key && !index.has(key)) index.set(key, entry)
    }
  }
  return index
}

/**
 * Build a resolver that canonicalizes free-text Nation names against the graph
 * and the in-repo registry, and (when `gisFeatures` is supplied) enriches each
 * match with authoritative GIS data. Memoize on its inputs in the caller.
 */
export function createNationResolver(graph: RelationshipGraph | null, gisFeatures?: GeoJSON.Feature[]) {
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

  const gisIndex = gisFeatures ? buildGisNationIndex(gisFeatures) : null
  const gisList = gisIndex ? [...gisIndex.entries()] : []
  const gisLookup = (...names: string[]): NationGisEntry | undefined => {
    if (!gisIndex) return undefined
    for (const name of names) {
      const key = normalizeName(name)
      const exact = gisIndex.get(key)
      if (exact) return exact
    }
    for (const name of names) {
      const key = normalizeName(name)
      for (const [gisKey, entry] of gisList) if (nameMatches(gisKey, key)) return entry
    }
    return undefined
  }

  return function canonicalize(name: string): NationResolution {
    const key = normalizeName(name)
    let resolution: NationResolution

    const nationId = nationIndex.get(key)
    const group = peopleGroupIndex.get(key)
    const entry = registryIndex.get(key)

    if (nationId) {
      resolution = {
        input: name,
        canonical: nationName.get(nationId) ?? name,
        status: 'nation',
        id: nationId,
        inGraph: true,
      }
    } else if (group) {
      resolution = { input: name, canonical: group.name, status: 'people-group', id: group.id, inGraph: true }
    } else if (entry) {
      const canonical = entry.graphNationId ? (nationName.get(entry.graphNationId) ?? entry.canonical) : entry.canonical
      resolution = {
        input: name,
        canonical,
        status: entry.kind,
        id: entry.graphNationId,
        inGraph: Boolean(entry.graphNationId),
      }
    } else {
      resolution = { input: name, canonical: name, status: 'unlisted', inGraph: false }
    }

    const gis = gisLookup(name, resolution.canonical)
    return gis ? { ...resolution, gis } : resolution
  }
}
